import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRunEntry, createRunFile, loadRunFile } from "./run-file.js";
import type { RunHeader, RunEntry, SlotOutcome } from "./schema.js";
import { withoutAt } from "./without-at.js";
import { supervise, type Claim } from "./supervisor.js";

/** Let every promise callback already queued run, so a test sees what the pool has started so far. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A list of `count` tasks, and a driver whose tasks end only when the test says so. */
function pool(count: number) {
  const tasks: Claim[] = Array.from({ length: count }, (_, i) => ({ taskDef: { intent: `task ${i + 1}` }, surfaceId: `task-${i + 1}` }));
  const started: string[] = [];
  const endings = new Map<string, PromiseWithResolvers<SlotOutcome>>();
  let running = 0;
  let peak = 0;
  return {
    started,
    peak: () => peak,
    next: async (claimed: readonly Claim[]) => tasks.find((task) => !claimed.some((claim) => claim.surfaceId === task.surfaceId)),
    drive: async (claim: Claim): Promise<SlotOutcome> => {
      started.push(claim.surfaceId);
      running += 1;
      peak = Math.max(peak, running);
      const ending = Promise.withResolvers<SlotOutcome>();
      endings.set(claim.surfaceId, ending);
      try {
        return await ending.promise;
      } finally {
        running -= 1;
      }
    },
    async end(surfaceId: string, outcome: SlotOutcome = "closed") {
      endings.get(surfaceId)?.resolve(outcome);
      await settle();
    },
    async fail(surfaceId: string, error: Error) {
      endings.get(surfaceId)?.reject(error);
      await settle();
    },
  };
}

describe("running several tasks from a list at once", () => {
  it("starts up to the number of slots at once, in list order, and starts the next as soon as one ends", async () => {
    const p = pool(4);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false });
    await settle();
    expect(p.started).toEqual(["task-1", "task-2"]);

    await p.end("task-2");
    expect(p.started).toEqual(["task-1", "task-2", "task-3"]);
    await p.end("task-1");
    expect(p.started).toEqual(["task-1", "task-2", "task-3", "task-4"]);
    await p.end("task-3");
    await p.end("task-4");

    expect((await done).map((settled) => settled.claim.surfaceId)).toEqual(["task-2", "task-1", "task-3", "task-4"]);
    expect(p.peak()).toBe(2);
  });

  it("never starts a task twice, and ends once every task has ended", async () => {
    const p = pool(3);
    const done = supervise({ slots: 5, next: p.next, drive: p.drive, waitOnSetback: false });
    await settle();
    for (const id of ["task-1", "task-2", "task-3"]) await p.end(id);
    expect(await done).toHaveLength(3);
    expect(new Set(p.started).size).toBe(p.started.length);
  });

  it("carries on past a task that needs a decision, filling its slot with the next task", async () => {
    const p = pool(3);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false });
    await settle();
    await p.end("task-1", "escalated");
    expect(p.started).toContain("task-3");
    await p.end("task-2");
    await p.end("task-3");
    expect((await done).map((settled) => settled.outcome)).toEqual(["escalated", "closed", "closed"]);
  });

  it("starts nothing more after a task that did not close, when the list waits on setbacks", async () => {
    const p = pool(3);
    const done = supervise({ slots: 1, next: p.next, drive: p.drive, waitOnSetback: true });
    await settle();
    await p.end("task-1");
    expect(p.started).toEqual(["task-1", "task-2"]);
    await p.end("task-2", "aborted");
    expect((await done).map((settled) => settled.outcome)).toEqual(["closed", "aborted"]);
    expect(p.started).toEqual(["task-1", "task-2"]);
  });

  it("ends at once, having started nothing, when there is nothing to take", async () => {
    const p = pool(0);
    expect(await supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false })).toEqual([]);
  });

  it("lets every running task finish, starting nothing new, then throws, when driving one throws", async () => {
    const p = pool(3);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false });
    const result = done.then(
      () => "finished",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    await settle();
    await p.fail("task-1", new Error("the harness broke"));
    expect(p.started).toEqual(["task-1", "task-2"]);

    let over = false;
    void result.then(() => (over = true));
    await settle();
    expect(over).toBe(false);

    await p.end("task-2");
    expect(await result).toBe("the harness broke");
  });

  it("records which task took which slot and how each ended, then that the run drained", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supervise-"));
    const header: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } };
    await createRunFile(dir, header);
    const p = pool(3);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false, record: { dir } });
    await vi.waitFor(() => expect(p.started).toEqual(["task-1", "task-2"]));
    await p.end("task-1");
    await vi.waitFor(() => expect(p.started).toContain("task-3"));
    await p.end("task-2");
    await p.end("task-3");
    await done;

    const runFile = await loadRunFile(dir);
    expect(runFile.header).toEqual(header);
    expect(withoutAt(runFile.history.slice(0, 4))).toEqual([
      { t: "slot_fill", slot: 1, surfaceId: "task-1", taskDef: { intent: "task 1" } },
      { t: "slot_fill", slot: 2, surfaceId: "task-2", taskDef: { intent: "task 2" } },
      { t: "slot_free", slot: 1, surfaceId: "task-1", outcome: "closed" },
      // The lowest free slot is taken, so a freed slot is refilled.
      { t: "slot_fill", slot: 1, surfaceId: "task-3", taskDef: { intent: "task 3" } },
    ]);
    expect(runFile.history.slice(4)).toHaveLength(2);
    expect(withoutAt(runFile.history.slice(4))).toEqual(
      expect.arrayContaining([
        { t: "slot_free", slot: 2, surfaceId: "task-2", outcome: "closed" },
        { t: "slot_free", slot: 1, surfaceId: "task-3", outcome: "closed" },
      ]),
    );
    expect(runFile.outcome?.kind).toBe("drained");
  });

  it("carries on a record it is handed: what it already holds is kept, and this run's slots are written after it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "supervise-resume-"));
    const header: RunHeader = { runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } };
    await createRunFile(dir, header);
    const before: RunEntry[] = [
      { t: "slot_fill", slot: 1, surfaceId: "earlier", taskDef: { intent: "an earlier task" } },
      { t: "slot_free", slot: 1, surfaceId: "earlier", outcome: "closed" },
    ];
    for (const entry of before) await appendRunEntry(dir, entry);

    const p = pool(1);
    const done = supervise({ slots: 2, next: p.next, drive: p.drive, waitOnSetback: false, record: { dir } });
    await vi.waitFor(() => expect(p.started).toEqual(["task-1"]));
    await p.end("task-1");
    await done;

    const runFile = await loadRunFile(dir);
    expect(runFile.header).toEqual(header);
    expect(withoutAt(runFile.history)).toEqual([
      ...before,
      { t: "slot_fill", slot: 1, surfaceId: "task-1", taskDef: { intent: "task 1" } },
      { t: "slot_free", slot: 1, surfaceId: "task-1", outcome: "closed" },
    ]);
    expect(runFile.outcome?.kind).toBe("drained");
  });
});
