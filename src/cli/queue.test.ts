import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setOutcome } from "../case-file.js";
import type { GateRef, TaskDef } from "../schema.js";
import { writeRunRecord } from "./command-fixtures.js";
import { allRuns } from "./runs.js";
import { runsRoot } from "./run-location.js";
import { environmentGaveUp, findQueueRun, listExitCode, listStandings, liveRunFound, nextQueueTask, queuePositionOf, queueTasks, runPickedUp, runShape, taskEnded } from "./queue.js";
import { EXIT } from "./failures.js";

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const PAGE = "add a page that shows who's on call today";
const SWAP = "let someone swap their on-call day with a teammate";

/** One run's record on disk, started with exactly this task. Unfinished unless it is given an outcome. */
async function writeRun(repoPath: string, runId: string, taskDef: TaskDef, finished = false): Promise<void> {
  const dir = join(runsRoot(repoPath), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef, gateRef: GATE, closerRef: { type: "commit-to-branch" } }, DEFAULT_BUDGETS);
  if (finished) await setOutcome(dir, { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" });
}

const scratchRepo = () => mkdtemp(join(tmpdir(), "queue-"));

describe("the tasks a project's list asks for", () => {
  it("is empty for a project that listed none", () => {
    expect(queueTasks({})).toEqual([]);
  });

  it("keeps the order they were written in, whatever shape each was written in", () => {
    expect(queueTasks({ tasks: [PAGE, { intent: SWAP, area: "rota" }] })).toEqual([{ intent: PAGE }, { intent: SWAP, area: "rota" }]);
  });
});

describe("which run answers for a task", () => {
  it("finds none when nothing has ever run here", async () => {
    expect(findQueueRun(await allRuns(await scratchRepo()), { intent: PAGE })).toBeUndefined();
  });

  it("matches on what the task says, not on where it sits in the list", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE }, true);
    await writeRun(repo, "let-someone-swap-20260917T100000Z", { intent: SWAP });
    const records = await allRuns(repo);

    expect(findQueueRun(records, { intent: PAGE })?.runId).toBe("add-a-page-20260917T090000Z");
    expect(findQueueRun(records, { intent: SWAP })?.runId).toBe("let-someone-swap-20260917T100000Z");
  });

  it("finds nothing for a task whose wording was changed, which is how a finished task is run again", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE }, true);
    expect(findQueueRun(await allRuns(repo), { intent: `${PAGE}, with a test` })).toBeUndefined();
  });

  it("tells two tasks apart by every field they carry, not by their sentence alone", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE, area: "rota" }, true);
    const records = await allRuns(repo);

    expect(findQueueRun(records, { intent: PAGE, area: "rota" })?.runId).toBe("add-a-page-20260917T090000Z");
    expect(findQueueRun(records, { intent: PAGE })).toBeUndefined();
  });

  it("lets the most recently started run answer when several were started for the same task", async () => {
    const repo = await scratchRepo();
    await writeRun(repo, "add-a-page-20260917T090000Z", { intent: PAGE }, true);
    await writeRun(repo, "add-a-page-20260917T140000Z", { intent: PAGE });
    expect(findQueueRun(await allRuns(repo), { intent: PAGE })?.runId).toBe("add-a-page-20260917T140000Z");
  });
});

describe("where a task sits in the list as it is written now", () => {
  it("counts from one, out of however many are listed", () => {
    const tasks = queueTasks({ tasks: [PAGE, SWAP, "send a reminder the morning before"] });
    expect(queuePositionOf(tasks, { intent: SWAP })).toEqual({ task: 2, of: 3 });
  });

  it("moves with the entry when the list is reordered", () => {
    const tasks = queueTasks({ tasks: [SWAP, PAGE] });
    expect(queuePositionOf(tasks, { intent: PAGE })).toEqual({ task: 2, of: 2 });
  });

  it("says nothing about a task the list no longer asks for", () => {
    expect(queuePositionOf(queueTasks({ tasks: [SWAP] }), { intent: PAGE })).toBeUndefined();
  });
});

describe("the next task on the list, as `delivery run` would pick it", () => {
  const WAVE = "add a function that waves at a name";
  const tasks = queueTasks({ tasks: [PAGE, SWAP, WAVE] });
  const at = "2026-09-17T09:00:00.000Z";

  it("is the first task when nothing has run yet", async () => {
    expect(nextQueueTask(await allRuns(await scratchRepo()), tasks)).toEqual({ task: 1, of: 3 });
  });

  it("passes over a task whose run was delivered", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE, outcome: { kind: "closed", source: "close", reason: "committed", at } });
    expect(nextQueueTask(await allRuns(repo), tasks)).toEqual({ task: 2, of: 3 });
  });

  it("stops at a task whose run needs a decision, rather than skipping it", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE, outcome: { kind: "escalated", source: "worker", reason: "authority", at } });
    expect(nextQueueTask(await allRuns(repo), tasks)).toEqual({ task: 1, of: 3 });
  });

  it("stops at a task whose run was interrupted", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE });
    expect(nextQueueTask(await allRuns(repo), tasks)).toEqual({ task: 1, of: 3 });
  });

  it("is nothing when every task was delivered", async () => {
    const repo = await scratchRepo();
    for (const [i, task] of [PAGE, SWAP, WAVE].entries()) {
      await writeRunRecord(repo, { runId: `task-${i}-20260917T09000${i}Z`, task, outcome: { kind: "closed", source: "close", reason: "committed", at } });
    }
    expect(nextQueueTask(await allRuns(repo), tasks)).toBeUndefined();
  });

  it("passes over a task a slot has already taken in this run", async () => {
    expect(nextQueueTask(await allRuns(await scratchRepo()), tasks, [{ intent: PAGE }])).toEqual({ task: 2, of: 3 });
  });

  it("passes over a task whose run needs a decision once a slot has taken it, so it is not started twice", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-page-20260917T090000Z", task: PAGE, outcome: { kind: "escalated", source: "worker", reason: "authority", at } });
    expect(nextQueueTask(await allRuns(repo), tasks, [{ intent: PAGE }])).toEqual({ task: 2, of: 3 });
  });

  it("is nothing when every task not yet delivered has been taken", async () => {
    expect(nextQueueTask(await allRuns(await scratchRepo()), tasks, [{ intent: PAGE }, { intent: SWAP }, { intent: WAVE }])).toBeUndefined();
  });
});

describe("the exit code a whole list ends with", () => {
  it("is 0 only when every task was delivered", () => {
    expect(listExitCode(["closed", "closed"])).toBe(EXIT.ok);
    expect(listExitCode([])).toBe(EXIT.ok);
  });

  it("needs a decision when any task does, whatever else stopped", () => {
    expect(listExitCode(["closed", "aborted", "escalated"])).toBe(EXIT.escalated);
  });

  it("says a task stopped when one did and none needs a decision", () => {
    expect(listExitCode(["closed", "aborted"])).toBe(EXIT.aborted);
  });
});

describe("what a list of several at once says", () => {
  it("opens by naming the run and its shape", () => {
    expect(runShape("run-20260926T090000Z", 10, 3)).toBe("Starting run run-20260926T090000Z: 10 tasks, up to 3 at once");
    expect(runShape("run-20260926T090000Z", 1, 2)).toBe("Starting run run-20260926T090000Z: 1 task, up to 2 at once");
  });

  it("opens a run it picked up by saying so, with the run's id and shape", () => {
    expect(runPickedUp("run-20260930T090000Z", 4, 2)).toBe("Picking up run run-20260930T090000Z: 4 tasks, up to 2 at once");
    expect(runPickedUp("run-20260930T090000Z", 1, 2)).toBe("Picking up run run-20260930T090000Z: 1 task, up to 2 at once");
  });

  it("ends by naming each task that was not delivered, and that the rest carried on", () => {
    expect(taskEnded({ task: 3, of: 10 }, "escalated")).toBe("Task 3 of 10 needs your decision; the rest of the list carried on without it.");
    expect(taskEnded({ task: 5, of: 10 }, "aborted")).toBe("Task 5 of 10 stopped before it finished; the rest of the list carried on without it.");
  });
});

describe("why a second run cannot start on top of a live one", () => {
  it("names the live run, when it started and its shape, and how to look at it", () => {
    expect(liveRunFound({ runId: "run-20260930T090000Z", repoPath: "/repo", concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } })).toBe(
      "Another run is already going here (started `2026-09-30 09:00 UTC`, 4 tasks, up to 2 at once: `run-20260930T090000Z`). " +
        "Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });

  it("still says a run is going when its record cannot be found", () => {
    expect(liveRunFound(undefined)).toBe(
      "Another run is already going here. Run `delivery status` to see how it is getting on, or wait for it to finish before starting another.",
    );
  });
});

describe("what a run of several at once says when it gives up on its shared environment", () => {
  it("says how many attempts it made, and how many tasks were waiting, had finished and are still queued", () => {
    expect(environmentGaveUp(2, { waiting: 2, finished: 5, queued: 3 }, 10)).toBe(
      "Couldn't fix it after 2 attempts. Stopping the run. 2 of 10 tasks were waiting on this and need your attention; 5 had already finished, 3 are still queued.",
    );
    expect(environmentGaveUp(1, { waiting: 1, finished: 0, queued: 1 }, 2)).toBe(
      "Couldn't fix it after 1 attempt. Stopping the run. 1 of 2 tasks was waiting on this and needs your attention; 0 had already finished, 1 is still queued.",
    );
  });

  it("counts a list task with an unfinished run as waiting, one with an ended run as finished, and one with none as queued", async () => {
    const repo = await scratchRepo();
    await writeRunRecord(repo, { runId: "add-a-hello-20260930T090000Z", task: "add a hello" });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260930T090000Z", task: "add a goodbye", outcome: { kind: "closed", source: "closer", reason: "done", at: "2026-09-30T09:10:00.000Z" } });
    const tasks = [{ intent: "add a hello" }, { intent: "add a goodbye" }, { intent: "add a shout" }];
    expect(listStandings(await allRuns(repo), tasks)).toEqual({ waiting: 1, finished: 1, queued: 1 });
  });

  it("names a usage limit, and no number of attempts, when that is what stopped the repair", () => {
    expect(environmentGaveUp(1, { waiting: 2, finished: 0, queued: 1 }, 3, "rate")).toBe(
      "The repair could not run because the AI service is limiting requests. Stopping the run. 2 of 3 tasks were waiting on this and need your attention; 0 had already finished, 1 is still queued.",
    );
    expect(environmentGaveUp(1, { waiting: 1, finished: 0, queued: 1 }, 2, "spend")).toBe(
      "The repair could not run because the spending limit has been reached. Stopping the run. 1 of 2 tasks was waiting on this and needs your attention; 0 had already finished, 1 is still queued.",
    );
  });
});
