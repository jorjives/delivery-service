import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setRunOutcome } from "../run-file.js";
import type { CaseFileOutcome, RunEntry, SlotOutcome } from "../schema.js";
import { ESCALATION, writeRunRecord, writeSupervisedRun } from "./command-fixtures.js";
import { queueTasks } from "./queue.js";
import { allRuns, readSupervisedRun } from "./runs.js";
import { claimedBy, overallOutcome, standingCounts, supervisedView, type SupervisedView } from "./supervised-view.js";

const RUN = "run-20260930T090000Z";
const AT = "2026-09-30T09:05:00.000Z";
const CLOSED: CaseFileOutcome = { kind: "closed", source: "closer", reason: "committed", at: AT };
const ESCALATED: CaseFileOutcome = { kind: "escalated", source: "worker", reason: "authority limit", at: AT };
const ABORTED: CaseFileOutcome = { kind: "aborted", source: "provisioning", reason: "no worktree", at: AT };
const HELLO = "add a hello";
const GREETING = "delete the greeting";
const GOODBYE = "add a goodbye";
const ID = { hello: "add-a-hello-20260930T090000Z", greeting: "delete-the-greeting-20260930T090000Z", goodbye: "add-a-goodbye-20260930T090100Z" };

const fill = (slot: number, surfaceId: string, intent: string): RunEntry => ({ t: "slot_fill", slot, surfaceId, taskDef: { intent } });
const free = (slot: number, surfaceId: string, outcome: SlotOutcome): RunEntry => ({ t: "slot_free", slot, surfaceId, outcome });

/** The view of one supervised run in a scratch repository, against a list as it is written now. */
async function viewOf(
  { list, runs, history, drained = false, live = false }:
    { list: string[]; runs: { runId: string; task: string; outcome?: CaseFileOutcome }[]; history: RunEntry[]; drained?: boolean; live?: boolean },
): Promise<SupervisedView> {
  const repo = await mkdtemp(join(tmpdir(), "supervised-view-"));
  for (const run of runs) await writeRunRecord(repo, { ...run, packet: run.outcome?.kind === "escalated" ? ESCALATION : undefined });
  const dir = await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: list.length }, history);
  if (drained) await setRunOutcome(dir, { kind: "drained", at: AT });
  return supervisedView((await readSupervisedRun(repo, RUN)).runFile, await allRuns(repo), queueTasks({ tasks: list }), live);
}

const summary = (view: SupervisedView) =>
  view.tasks.map((task) => ({ intent: task.taskDef.intent, position: task.position?.task, standing: task.standing, id: task.record?.runId }));

describe("what each task of a run of several at once is doing", () => {
  it("gives every task the run took the standing its own record says, in list order", async () => {
    const view = await viewOf({
      list: [HELLO, GREETING, GOODBYE],
      runs: [
        { runId: ID.hello, task: HELLO, outcome: CLOSED },
        { runId: ID.greeting, task: GREETING, outcome: ESCALATED },
        { runId: ID.goodbye, task: GOODBYE, outcome: ABORTED },
      ],
      history: [fill(1, ID.greeting, GREETING), fill(2, ID.hello, HELLO), free(2, ID.hello, "closed"), fill(2, ID.goodbye, GOODBYE)],
      drained: true,
    });
    expect(summary(view)).toEqual([
      { intent: HELLO, position: 1, standing: "closed", id: ID.hello },
      { intent: GREETING, position: 2, standing: "escalated", id: ID.greeting },
      { intent: GOODBYE, position: 3, standing: "aborted", id: ID.goodbye },
    ]);
  });

  it("says a task under way has not finished", async () => {
    const view = await viewOf({ list: [HELLO], runs: [{ runId: ID.hello, task: HELLO }], history: [fill(1, ID.hello, HELLO)] });
    expect(summary(view)).toEqual([{ intent: HELLO, position: 1, standing: "unfinished", id: ID.hello }]);
  });

  it("counts a task the run took but never got to start as queued", async () => {
    const view = await viewOf({ list: [HELLO], runs: [], history: [fill(1, ID.hello, HELLO)] });
    expect(summary(view)).toEqual([{ intent: HELLO, position: 1, standing: "queued", id: undefined }]);
  });

  it("lists, for a run still going, every list task it has yet to take, but not one an earlier run delivered", async () => {
    const view = await viewOf({
      list: [HELLO, GREETING, GOODBYE],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }, { runId: ID.greeting, task: GREETING }],
      history: [fill(1, ID.greeting, GREETING)],
    });
    expect(summary(view)).toEqual([
      { intent: GREETING, position: 2, standing: "unfinished", id: ID.greeting },
      { intent: GOODBYE, position: 3, standing: "queued", id: undefined },
    ]);
  });

  it("lists nothing queued for a run that has finished, even when the list has grown since", async () => {
    const view = await viewOf({
      list: [HELLO, GOODBYE],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }],
      history: [fill(1, ID.hello, HELLO), free(1, ID.hello, "closed")],
      drained: true,
    });
    expect(summary(view)).toEqual([{ intent: HELLO, position: 1, standing: "closed", id: ID.hello }]);
  });

  it("shows a task once when a resumed run took it again", async () => {
    const view = await viewOf({
      list: [HELLO],
      runs: [{ runId: ID.hello, task: HELLO }],
      history: [fill(1, ID.hello, HELLO), fill(1, ID.hello, HELLO)],
    });
    expect(view.tasks).toHaveLength(1);
    expect(claimedBy(view.runFile)).toEqual([{ surfaceId: ID.hello, taskDef: { intent: HELLO } }]);
  });

  it("puts a task no longer on the list after those that are, with no position", async () => {
    const view = await viewOf({
      list: [GREETING],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }, { runId: ID.greeting, task: GREETING, outcome: CLOSED }],
      history: [fill(1, ID.hello, HELLO), fill(2, ID.greeting, GREETING)],
      drained: true,
    });
    expect(summary(view)).toEqual([
      { intent: GREETING, position: 1, standing: "closed", id: ID.greeting },
      { intent: HELLO, position: undefined, standing: "closed", id: ID.hello },
    ]);
  });

  it("reports the shared environment as healthy, and whether the run is going, as it was told", async () => {
    const view = await viewOf({ list: [HELLO], runs: [], history: [], live: true });
    expect(view.breaker).toBe("HEALTHY");
    expect(view.live).toBe(true);
  });
});

describe("a run of several at once, summed up", () => {
  it("counts every standing, zeros included", async () => {
    const view = await viewOf({
      list: [HELLO, GREETING, GOODBYE],
      runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }, { runId: ID.greeting, task: GREETING, outcome: ESCALATED }],
      history: [fill(1, ID.hello, HELLO), fill(2, ID.greeting, GREETING)],
    });
    expect(standingCounts(view.tasks)).toEqual({ closed: 1, escalated: 1, aborted: 0, unfinished: 0, queued: 1 });
  });

  it("has not finished until its record says so", async () => {
    const view = await viewOf({ list: [HELLO], runs: [{ runId: ID.hello, task: HELLO, outcome: CLOSED }], history: [fill(1, ID.hello, HELLO)] });
    expect(overallOutcome(view)).toBe("unfinished");
  });

  it("ended wanting a decision if any task did, then stopped if any task stopped, and closed only if every task closed", async () => {
    const ended = (outcomes: CaseFileOutcome[]) =>
      viewOf({
        list: [HELLO, GREETING],
        runs: [{ runId: ID.hello, task: HELLO, outcome: outcomes[0] }, { runId: ID.greeting, task: GREETING, outcome: outcomes[1] }],
        history: [fill(1, ID.hello, HELLO), fill(2, ID.greeting, GREETING)],
        drained: true,
      });
    expect(overallOutcome(await ended([ABORTED, ESCALATED]))).toBe("escalated");
    expect(overallOutcome(await ended([CLOSED, ABORTED]))).toBe("aborted");
    expect(overallOutcome(await ended([CLOSED, CLOSED]))).toBe("closed");
  });
});
