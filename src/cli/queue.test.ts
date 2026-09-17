import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, setOutcome } from "../case-file.js";
import type { GateRef, TaskDef } from "../schema.js";
import { allRuns } from "./runs.js";
import { runsRoot } from "./run-location.js";
import { findQueueRun, queuePositionOf, queueTasks } from "./queue.js";

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
