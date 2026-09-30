import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CorruptRunFile, ImmutabilityViolation, RunFileNotFound } from "./errors.js";
import { appendRunEntry, createRunFile, loadRunFile, setRunOutcome } from "./run-file.js";
import type { RunHeader } from "./schema.js";

const HEADER: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 3, tasks: 10 };
const runDir = () => mkdtempSync(join(tmpdir(), "run-file-"));

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
    expect((await loadRunFile(dir)).history).toEqual([
      { t: "slot_fill", slot: 1, surfaceId: "add-a-page-20260930T090000Z", taskDef: { intent: "add a page" } },
      { t: "slot_free", slot: 1, surfaceId: "add-a-page-20260930T090000Z", outcome: "escalated" },
    ]);
  });

  it("refuses an entry of the wrong shape before writing anything", async () => {
    const dir = runDir();
    await createRunFile(dir, HEADER);
    await expect(appendRunEntry(dir, { t: "slot_fill", slot: 0, surfaceId: "x", taskDef: {} })).rejects.toThrow();
    expect((await loadRunFile(dir)).history).toEqual([]);
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
