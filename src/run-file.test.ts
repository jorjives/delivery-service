import { afterEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorruptRunFile, ImmutabilityViolation, RunFileNotFound } from "./errors.js";
import { appendRunEntry, createRunFile, loadRunFile, setRunOutcome } from "./run-file.js";
import type { RunEntry, RunHeader } from "./schema.js";
import { withoutAt } from "./without-at.js";

const HEADER: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 3, tasks: 10, runBudgetMax: { gateMaintenance: 2 } };
const runDir = () => mkdtempSync(join(tmpdir(), "run-file-"));

describe("the time a step of a run of several tasks is recorded", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is written with the step, as the time of writing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T02:20:00.000Z"));
    const dir = runDir();
    await createRunFile(dir, HEADER);

    await appendRunEntry(dir, { t: "breaker_healthy" });

    expect((await loadRunFile(dir)).history).toEqual([{ t: "breaker_healthy", at: "2026-10-01T02:20:00.000Z" }]);
  });
});

describe("a supervised run's record", () => {
  it("reads back the header it was created with, nothing yet in its history and no outcome", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    expect(await loadRunFile(dir)).toEqual({ header: HEADER, history: [], outcome: undefined });
  });

  it("keeps which task took which slot, and when each slot was freed, in the order it happened", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await appendRunEntry(dir, { t: "slot_fill", slot: 1, surfaceId: "add-a-page-20260930T090000Z", taskDef: { intent: "add a page" } });
    await appendRunEntry(dir, { t: "slot_free", slot: 1, surfaceId: "add-a-page-20260930T090000Z", outcome: "escalated" });
    expect(withoutAt((await loadRunFile(dir)).history)).toEqual([
      { t: "slot_fill", slot: 1, surfaceId: "add-a-page-20260930T090000Z", taskDef: { intent: "add a page" } },
      { t: "slot_free", slot: 1, surfaceId: "add-a-page-20260930T090000Z", outcome: "escalated" },
    ]);
  });

  it("refuses an entry of the wrong shape before writing anything", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await expect(appendRunEntry(dir, { t: "slot_fill", slot: 0, surfaceId: "x", taskDef: {} })).rejects.toThrow();
    expect(withoutAt((await loadRunFile(dir)).history)).toEqual([]);
  });

  it("drops a final entry a crash cut short, as the case file does", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await appendRunEntry(dir, { t: "slot_fill", slot: 1, surfaceId: "a", taskDef: { intent: "a" } });
    appendFileSync(join(dir, "log.jsonl"), '{"t":"slot_fr');
    expect((await loadRunFile(dir)).history).toHaveLength(1);
  });

  it("writes its outcome once, and refuses a second", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T09:10:00.000Z" });
    expect((await loadRunFile(dir)).outcome).toEqual({ kind: "drained", at: "2026-09-30T09:10:00.000Z" });
    await expect(setRunOutcome(dir, { kind: "drained", at: "2026-09-30T09:11:00.000Z" })).rejects.toThrow(ImmutabilityViolation);
  });

  it("says plainly when there is no record in the folder", async () => {
    const err = await loadRunFile(runDir()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RunFileNotFound);
    expect((err as Error).message).toMatch(/run record not found/i);
  });

  it("names a corrupt run.json as a damaged run record, never as a case file", async () => {
    const dir = runDir();
    writeFileSync(join(dir, "run.json"), "{ not json");
    const err = await loadRunFile(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CorruptRunFile);
    expect((err as Error).message).toMatch(/corrupt run record/i);
    expect((err as Error).message).not.toMatch(/case file/i);
  });

  it("names a corrupt history as a damaged run record, never as a case file", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    appendFileSync(join(dir, "log.jsonl"), "garbage\n{\"t\":\"slot_free\"}\n");
    const err = await loadRunFile(dir).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CorruptRunFile);
    expect((err as Error).message).not.toMatch(/case file/i);
  });
});

describe("the breaker and its repairs, in the run file", () => {
  const header: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } };

  it("reads back every breaker entry exactly as it was appended", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-file-breaker-"));
    await createRunFile(dir, header);
    const entries: RunEntry[] = [
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: "a", reason: "the shared helper is missing" } },
      { t: "repair_request", surfaceId: "a", key: null },
      { t: "held", surfaceId: "b" },
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: "a" },
      { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored it" },
      { t: "breaker_healthy" },
      { t: "run_escalated", reason: "the shared environment could not be repaired after 2 attempts" },
    ];
    for (const entry of entries) await appendRunEntry(dir, entry);
    expect(withoutAt((await loadRunFile(dir)).history)).toEqual(entries);
  });

  it("keeps a run that gave up on the shared environment as its outcome, naming the cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-file-escalated-"));
    await createRunFile(dir, header);
    const outcome = { kind: "escalated", cause: "shared_environment", reason: "could not be repaired", at: "2026-09-30T10:00:00.000Z" } as const;
    await setRunOutcome(dir, outcome);
    expect((await loadRunFile(dir)).outcome).toEqual(outcome);
  });

  it("refuses a header that does not pin the run's repair limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-file-no-limit-"));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { runBudgetMax: _dropped, ...withoutLimit } = header;
    await expect(createRunFile(dir, withoutLimit as RunHeader)).rejects.toThrow();
  });
});
