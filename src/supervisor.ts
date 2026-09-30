import { appendRunEntry, createRunFile, setRunOutcome } from "./run-file.js";
import type { RunEntry, RunHeader, SlotOutcome, TaskDef } from "./schema.js";

/** A task a slot has taken: what it says, and the id its run has, or will have once started. */
export interface Claim {
  taskDef: TaskDef;
  surfaceId: string;
}

/** A task that has ended, and how. */
export interface Settled<C extends Claim> {
  claim: C;
  outcome: SlotOutcome;
}

export interface Supervision<C extends Claim> {
  /** How many tasks may run at once. */
  slots: number;
  /**
   * The next task to start, worked out afresh at every fill, or nothing when no
   * task is left to take. `claimed` is every task a slot has taken in this run,
   * running or ended, so a task is never started twice.
   */
  next(claimed: readonly C[]): Promise<C | undefined>;
  /** Take one task to its end. A throw is a broken harness or setup, never a task's own setback. */
  drive(claim: C): Promise<SlotOutcome>;
  /** Start nothing more once a task ends without closing: the list worked down one at a time waits on it. */
  waitOnSetback: boolean;
  /** Where to keep the run's own record, in a folder that already exists; none for a list worked down one at a time. */
  record?: { dir: string; header: RunHeader };
}

/**
 * Keep up to `slots` tasks running, starting the next as soon as one ends,
 * until there is nothing left to take. A small launcher of its own rather than
 * a general concurrency library, because every start must work out the next
 * task afresh and record which slot took it before it runs.
 *
 * A task that throws stops new starts but not the tasks already running: they
 * are left to end, so none is abandoned half way through a git call, and then
 * the first error is thrown. The run's record gets no outcome in that case,
 * which is what an interrupted run leaves behind.
 */
export async function supervise<C extends Claim>({ slots, next, drive, waitOnSetback, record }: Supervision<C>): Promise<Settled<C>[]> {
  if (record) await createRunFile(record.dir, record.header);
  const note = async (entry: RunEntry): Promise<void> => {
    if (record) await appendRunEntry(record.dir, entry);
  };

  const free = new Set(Array.from({ length: slots }, (_, index) => index + 1));
  const claimed: C[] = [];
  const settled: Settled<C>[] = [];
  const running = new Set<Promise<void>>();
  let exhausted = false;
  let halted = false;
  let failure: { error: unknown } | undefined;
  const stop = (error: unknown): void => {
    failure ??= { error };
    halted = true;
  };

  async function start(): Promise<void> {
    const claim = await next(claimed);
    // A task can end, and halt the pool, while the next one is being worked out.
    if (halted) return;
    if (claim === undefined) {
      exhausted = true;
      return;
    }
    const slot = Math.min(...free);
    free.delete(slot);
    claimed.push(claim);
    await note({ t: "slot_fill", slot, surfaceId: claim.surfaceId, taskDef: claim.taskDef });
    const task: Promise<void> = drive(claim)
      .then(async (outcome) => {
        settled.push({ claim, outcome });
        await note({ t: "slot_free", slot, surfaceId: claim.surfaceId, outcome });
        if (waitOnSetback && outcome !== "closed") halted = true;
      })
      .catch(stop)
      .finally(() => {
        free.add(slot);
        running.delete(task);
      });
    running.add(task);
  }

  for (;;) {
    while (!exhausted && !halted && free.size > 0) await start().catch(stop);
    if (running.size === 0) break;
    await Promise.race(running);
  }

  if (failure) throw failure.error;
  if (record) await setRunOutcome(record.dir, { kind: "drained", at: new Date().toISOString() });
  return settled;
}
