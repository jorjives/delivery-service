import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../tests/helpers.js";
import { promptsSent, readJournal, type MockScript } from "../mock-script.js";
import { addLocalOrigin, initTempRepo } from "../temp-repo.js";
import { ledgerPath, readItemLedger, recordDispatched } from "../item-ledger.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { completes, delivery, interruptedRun, PACKAGE, RUN_TIMEOUT, scriptFile, writesHello } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { allRuns } from "./runs.js";
import { MAX_NEEDS_SOURCES, SOURCES_AND_TASK } from "./settings.js";
import { NOTHING_TO_WORK } from "./sources-run.js";

const ITEM = "20261016T090000Z-say-hello.md";
const ITEM_PATH = `.delivery/backlog/${ITEM}`;
const KEY = `backlog:${ITEM}`;
const BRIEF = "---\nstatus: open\npriority: 1\n---\nAdd a function that says hello to a name.\n";

const project = (files: Record<string, string> = {}) => initTempRepo("sources-run-", { "package.json": PACKAGE, [ITEM_PATH]: BRIEF, ...files });
const stateDir = () => mkdtempSync(join(tmpdir(), "sources-state-"));

const asks: MockScript = {
  expectations: [
    { when: { promptContains: "Their answer: Formal, please." }, effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `Good day, ${name}`;\n" } }], json: { status: "completed", rationale: "formal greeting" } },
    // It writes a first draft before it stops to ask: the answered run must still have it.
    { effects: [{ write: { path: "draft.md", content: "A first draft of the greeting.\n" } }], json: { status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the item does not say" } },
  ],
};

// Writes part of the work, then ends every session without a reply, until the run stops interrupted (its terminus budget spent).
const writesThenStops: MockScript = {
  expectations: [{ effects: [{ write: { path: "partial.js", content: "export const partial = true;\n" } }], reply: "I ran out of room before finishing." }],
};

describe("delivery run --sources", () => {
  it("picks up a backlog item, delivers it, and marks it resolved on its branch", async () => {
    const repo = project();
    const state = stateDir();
    const { exitCode } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

    expect(exitCode).toBe(EXIT.ok);
    const [record] = await allRuns(repo);
    expect(record?.caseFile.header.item).toEqual({ key: KEY, source: "backlog", id: ITEM, resolve: ITEM_PATH });
    const branch = `surface/${record?.runId}`;
    expect(git(repo, ["show", `${branch}:${ITEM_PATH}`])).toContain("status: resolved");
    expect((await readItemLedger(ledgerPath(repo, { XDG_STATE_HOME: state }))).get(KEY)).toMatchObject({ lastClass: "delivered", attempts: 0 });
  }, RUN_TIMEOUT);

  it("does not take a delivered item again while its branch waits to be merged (commit-to-branch, no origin)", async () => {
    const repo = project();
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    await delivery(["run", "--sources"], { cwd: repo, env });
    const { stdout } = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(stdout).toContain(NOTHING_TO_WORK);
    expect(await allRuns(repo)).toHaveLength(1);
  }, RUN_TIMEOUT);

  it("does not take a delivered item again when merge-back landed it on local main and the repository has an origin", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" } }) });
    addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };

    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.exitCode).toBe(EXIT.ok);
    // merge-back fast-forwarded local main and deleted the branch; nothing was pushed, so origin/main still shows the item open.
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
    expect(git(repo, ["show", `origin/main:${ITEM_PATH}`])).toContain("status: open");

    const second = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(second.stdout).toContain(NOTHING_TO_WORK);
    expect(await allRuns(repo)).toHaveLength(1);
  }, RUN_TIMEOUT * 2);

  it("parks an item whose agent asks a question, and skips it until it is answered", async () => {
    const repo = project();
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(asks) };

    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.exitCode).toBe(EXIT.escalated);
    expect(first.stdout).toContain(`Parked ${KEY}: it needs your answer. The agent asked: Formal or casual greeting?`);

    const skipped = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(skipped.stdout).toContain(NOTHING_TO_WORK);
  }, RUN_TIMEOUT * 2);

  it("picks a run killed part way back up in its own record before choosing new work", async () => {
    const repo = project();
    const state = stateDir();
    const runId = await interruptedRun(repo, state, { task: "Add a function that says hello to a name.", steps: 3, worker: writesHello });
    await recordDispatched(ledgerPath(repo, { XDG_STATE_HOME: state }), KEY, runId, "Add a function that says hello to a name.");

    const { exitCode } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

    expect(exitCode).toBe(EXIT.ok);
    const records = await allRuns(repo);
    expect(records.map((r) => r.runId)).toEqual([runId]);
    expect(records[0]?.caseFile.outcome?.kind).toBe("closed");
    expect((await readItemLedger(ledgerPath(repo, { XDG_STATE_HOME: state }))).get(KEY)).toMatchObject({ lastRunId: runId, lastClass: "delivered", settled: true });
  }, RUN_TIMEOUT);

  it("carries on an interrupted item on the next run, with the work it had written, in the same working copy", async () => {
    const repo = project();
    const state = stateDir();
    const first = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(writesThenStops) } });
    expect(first.exitCode).toBe(EXIT.escalated);
    expect((await readItemLedger(ledgerPath(repo, { XDG_STATE_HOME: state }))).get(KEY)).toMatchObject({ lastClass: "interrupted" });
    const script = await scriptFile(completes);
    const second = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script } });
    expect(second.exitCode).toBe(EXIT.ok);

    const [earlier, later] = (await allRuns(repo)).sort((a, b) => (a.runId < b.runId ? -1 : 1));
    expect(later?.caseFile.header.continues).toMatchObject({ runId: earlier?.runId, worktreePath: earlier?.caseFile.cursor.worktreeRef, turn: { kind: "interrupted" } });
    // The same working copy, so a real agent's session transcript (found by its working directory) can be resumed.
    expect(later?.caseFile.cursor.worktreeRef).toBe(earlier?.caseFile.cursor.worktreeRef);
    // What the interrupted run wrote is in the delivered work, beside what the carried-on run added.
    expect(git(repo, ["show", `surface/${later?.runId}:partial.js`])).toBe("export const partial = true;");
    expect(git(repo, ["show", `surface/${later?.runId}:hello.js`])).toContain("hello");
    expect(promptsSent(await readJournal(`${script}.journal.jsonl`)).some((p) => p.includes("was interrupted before it finished"))).toBe(true);
  }, RUN_TIMEOUT * 2);

  it("starts an item afresh after a run used up its corrections, keeping the old branch", async () => {
    const repo = project({ "hello.test.js": "// a test\n" });
    const state = stateDir();
    // The first session deletes the test; a correction session, whose prompt names the deletion, claims completion without deleting again (a repeated delete would fail on the missing file and end the session in an error).
    const cheats: MockScript = { expectations: [{ when: { promptContains: "hello.test.js deleted" }, json: { status: "completed", rationale: "still removed" } }, { effects: [{ delete: { path: "hello.test.js" } }], json: { status: "completed", rationale: "removed the test" } }] };
    await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(cheats) } });
    const [failed] = await allRuns(repo);
    await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

    const fresh = (await allRuns(repo)).find((r) => r.runId !== failed?.runId);
    expect(fresh?.caseFile.header.continues).toBeUndefined();
    expect(fresh?.caseFile.header.startCommit).toBe(git(repo, ["rev-parse", "main"]));
    expect(git(repo, ["branch", "--list", `surface/${failed?.runId}`])).not.toBe("");
  }, RUN_TIMEOUT * 2);

  it("parks an item after parkAfter runs in a row end undelivered, and skips it after", async () => {
    const repo = project({ "hello.test.js": "// a test\n", "delivery.config.json": JSON.stringify({ parkAfter: 1 }) });
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [{ effects: [{ delete: { path: "hello.test.js" } }], json: { status: "completed", rationale: "x" } }] }) };
    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.stdout).toContain(`Parked ${KEY}: it ended without being delivered 1 runs in a row.`);
    expect((await delivery(["run", "--sources"], { cwd: repo, env })).stdout).toContain(NOTHING_TO_WORK);
  }, RUN_TIMEOUT * 2);

  it("takes up to --max items in one run", async () => {
    const repo = project({ ".delivery/backlog/20261016T090100Z-second.md": "---\nstatus: open\npriority: 2\n---\nAdd a second greeting.\n" });
    await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect((await allRuns(repo)).map((r) => r.caseFile.header.item?.id).sort()).toEqual([ITEM, "20261016T090100Z-second.md"]);
  }, RUN_TIMEOUT * 2);

  it("marks a command source's item done once it is delivered", async () => {
    const script = `#!/bin/sh\ncase "$1" in\n list) [ -f done ] && echo '[]' || echo '[{"id":"t1","intent":"say hello"}]';;\n complete) echo "$2" > done;;\nesac\n`;
    const repo = initTempRepo("sources-command-", { "package.json": PACKAGE, "tasks.sh": script, "delivery.config.json": JSON.stringify({ sources: [{ type: "command", command: "sh tasks.sh" }] }) });
    await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect(readFileSync(join(repo, "done"), "utf-8")).toBe("t1\n");
  }, RUN_TIMEOUT);

  it("refuses --sources with a task, and --max without --sources", async () => {
    const repo = project();
    expect((await delivery(["run", "--sources", "--task", "x"], { cwd: repo })).stderr).toContain(SOURCES_AND_TASK);
    expect((await delivery(["run", "--max", "2"], { cwd: repo })).stderr).toContain(MAX_NEEDS_SOURCES);
  });

  it("carries on a parked question's work once it is answered", async () => {
    const repo = project();
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(asks) };
    await delivery(["run", "--sources"], { cwd: repo, env });

    expect((await delivery(["answer", KEY, "Formal, please."], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const carried = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(carried.exitCode).toBe(EXIT.ok);

    // Run ids can tie within a second (the second gets a "-2" slug suffix), so the later run is the one that continues the other.
    const runs = await allRuns(repo);
    const latest = runs.find((r) => r.caseFile.header.continues !== undefined);
    const earlier = runs.find((r) => r !== latest);
    expect(latest?.caseFile.header.continues).toMatchObject({ runId: earlier?.runId, turn: { kind: "answer", question: "Formal or casual greeting?", answer: "Formal, please." } });
    expect(latest?.caseFile.cursor.worktreeRef).toBe(earlier?.caseFile.cursor.worktreeRef);
    // The draft written before the question is still there once the answer is acted on.
    expect(git(repo, ["show", `surface/${latest?.runId}:draft.md`])).toBe("A first draft of the greeting.");
    expect(git(repo, ["show", `surface/${latest?.runId}:hello.js`])).toContain("Good day");
  }, RUN_TIMEOUT * 2);
});
