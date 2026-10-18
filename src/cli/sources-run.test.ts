import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../tests/helpers.js";
import { createGhStandIn } from "../gh-stand-in.js";
import { UNTRUSTED_TASK } from "../prompt-assembly.js";
import { promptsSent, readJournal, type MockScript } from "../mock-script.js";
import { addLocalOrigin, initTempRepo } from "../temp-repo.js";
import { deliveryLedgerPath, readDelivery, readDeliveryEntries } from "../delivery-ledger.js";
import { ledgerPath, readItemLedger, recordDispatched } from "../item-ledger.js";
import { readRef } from "../case-file.js";
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
  it("picks up a backlog item, delivers it onto the delivery branch, and marks it resolved there", async () => {
    const repo = project();
    const state = stateDir();
    const { exitCode } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

    expect(exitCode).toBe(EXIT.ok);
    const [record] = await allRuns(repo);
    expect(record?.caseFile.header.item).toEqual({ key: KEY, source: "backlog", id: ITEM, resolve: ITEM_PATH });
    expect(record?.runId).toBeDefined();
    const branch = "delivery/main";
    expect(git(repo, ["show", `${branch}:${ITEM_PATH}`])).toContain("status: resolved");
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
    expect((await readItemLedger(ledgerPath(repo, { XDG_STATE_HOME: state }))).get(KEY)).toMatchObject({ lastClass: "delivered", attempts: 0 });
  }, RUN_TIMEOUT);

  it("lands several items one after another on one delivery branch, and hands it to the closer once", async () => {
    const SECOND = "20261016T090100Z-say-goodbye.md";
    const repo = project({ [`.delivery/backlog/${SECOND}`]: "---\nstatus: open\npriority: 2\n---\nAdd a function that says goodbye.\n" });
    const state = stateDir();
    const script: MockScript = {
      expectations: [
        { when: { promptContains: "says hello" }, effects: [{ write: { path: "hello.js", content: "export const hello = 1;\n" } }], json: { status: "completed", rationale: "hello" } },
        { when: { promptContains: "says goodbye" }, effects: [{ write: { path: "goodbye.js", content: "export const goodbye = 1;\n" } }], json: { status: "completed", rationale: "goodbye" } },
      ],
    };

    const { exitCode, stdout } = await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) } });

    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
    expect(git(repo, ["show", "delivery/main:hello.js"])).toContain("hello");
    expect(git(repo, ["show", "delivery/main:goodbye.js"])).toContain("goodbye");
    const delivered = await readDelivery(deliveryLedgerPath(ledgerPath(repo, { XDG_STATE_HOME: state })), "delivery/main");
    expect(delivered.landed).toHaveLength(2);
    expect(delivered.closer).toMatchObject({ status: "DONE" });
    expect(stdout).toContain("delivery/main");
  }, RUN_TIMEOUT * 2);

  it("never lands an item that escalates, and still lands the others", async () => {
    const SECOND = "20261016T090100Z-say-goodbye.md";
    const repo = project({ [`.delivery/backlog/${SECOND}`]: "---\nstatus: open\npriority: 2\n---\nAdd a function that says goodbye.\n" });
    const state = stateDir();
    const script: MockScript = {
      expectations: [
        { when: { promptContains: "says hello" }, effects: [{ write: { path: "hello.js", content: "export const hello = 1;\n" } }], json: { status: "escalate", rationale: "cannot tell what hello means here" } },
        { when: { promptContains: "says goodbye" }, effects: [{ write: { path: "goodbye.js", content: "export const goodbye = 1;\n" } }], json: { status: "completed", rationale: "goodbye" } },
      ],
    };

    await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) } });

    expect(git(repo, ["show", "delivery/main:goodbye.js"])).toContain("goodbye");
    expect(() => git(repo, ["show", "delivery/main:hello.js"])).toThrow();
    const delivered = await readDelivery(deliveryLedgerPath(ledgerPath(repo, { XDG_STATE_HOME: state })), "delivery/main");
    expect(delivered.landed.map((e) => e.intent)).toEqual([expect.stringContaining("goodbye")]);
  }, RUN_TIMEOUT * 2);

  it("starts no task, and says what blocks it, when the owner's base commits cannot be brought in; and does not try again until something moves", async () => {
    const repo = project({ "shared.txt": "one\n" });
    git(repo, ["branch", "delivery/main"]);
    const scratch = join(mkdtempSync(join(tmpdir(), "sources-blocked-")), "wt");
    git(repo, ["worktree", "add", "-q", scratch, "delivery/main"]);
    writeFileSync(join(scratch, "shared.txt"), "delivered\n");
    git(scratch, ["commit", "-q", "-am", "delivered"]);
    git(repo, ["worktree", "remove", "--force", scratch]);
    writeFileSync(join(repo, "shared.txt"), "the owner's\n");
    git(repo, ["commit", "-q", "-am", "the owner's"]);
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };

    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    const second = await delivery(["run", "--sources"], { cwd: repo, env });

    expect(first.exitCode).toBe(EXIT.escalated);
    expect(first.stdout).toContain("No task was started");
    expect(first.stdout).toContain("shared.txt");
    expect(second.stdout).toContain("shared.txt");
    expect(await allRuns(repo)).toHaveLength(0);
    const entries = readFileSync(deliveryLedgerPath(ledgerPath(repo, env)), "utf-8").trim().split("\n");
    expect(entries.filter((line) => line.includes('"blocked"'))).toHaveLength(1);
  }, RUN_TIMEOUT);

  it("retries a closer that failed last run, on a run with nothing to work, after bringing the owner's base commits in", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" } }) });
    addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    // main is held by another worktree, so merge-back cannot move it: the first run's closer is refused.
    git(repo, ["checkout", "-q", "-b", "elsewhere"]);
    const holder = join(mkdtempSync(join(tmpdir(), "sources-holder-")), "main");
    git(repo, ["worktree", "add", "-q", holder, "main"]);
    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.exitCode).toBe(EXIT.escalated);
    expect(git(repo, ["branch", "--list", "delivery/main"])).not.toBe("");
    git(repo, ["worktree", "remove", "--force", holder]);
    git(repo, ["checkout", "-q", "main"]);
    writeFileSync(join(repo, "unrelated.txt"), "the owner's own commit\n");
    git(repo, ["add", "unrelated.txt"]);
    git(repo, ["commit", "-q", "-m", "the owner's own commit"]);

    const second = await delivery(["run", "--sources"], { cwd: repo, env });

    expect(second.stdout).toContain("Handed delivery/main to your closer");
    expect(git(repo, ["show", "main:hello.js"])).toContain("hello");
    expect(git(repo, ["show", "main:unrelated.txt"])).toBe("the owner's own commit");
    const kinds = (await readDeliveryEntries(deliveryLedgerPath(ledgerPath(repo, env)))).map((e) => e.t === "closed" ? `closed ${e.status}` : e.t);
    expect(kinds.indexOf("base_merged")).toBeGreaterThan(-1);
    expect(kinds.indexOf("base_merged")).toBeLessThan(kinds.lastIndexOf("closed DONE"));
  }, RUN_TIMEOUT * 2);

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

    // Run ids can tie within a second (the second gets a "-2" slug suffix), so the later run is the one that continues the other.
    const runs = await allRuns(repo);
    const later = runs.find((r) => r.caseFile.header.continues !== undefined);
    const earlier = runs.find((r) => r !== later);
    expect(later?.caseFile.header.continues).toMatchObject({ runId: earlier?.runId, worktreePath: earlier?.caseFile.cursor.worktreeRef, turn: { kind: "interrupted" } });
    // The same working copy, so a real agent's session transcript (found by its working directory) can be resumed.
    expect(later?.caseFile.cursor.worktreeRef).toBe(earlier?.caseFile.cursor.worktreeRef);
    // What the interrupted run wrote is in the delivered work, beside what the carried-on run added.
    expect(git(repo, ["show", "delivery/main:partial.js"])).toBe("export const partial = true;");
    expect(git(repo, ["show", "delivery/main:hello.js"])).toContain("hello");
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
    expect(git(repo, ["show", "delivery/main:draft.md"])).toBe("A first draft of the greeting.");
    expect(git(repo, ["show", "delivery/main:hello.js"])).toContain("Good day");
  }, RUN_TIMEOUT * 2);

  it("names the delivery branch in status and report, with what landed on it and what the closer did", async () => {
    const repo = project();
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    await delivery(["run", "--sources"], { cwd: repo, env });

    const status = await delivery(["status"], { cwd: repo, env });
    const report = await delivery(["report"], { cwd: repo, env });
    const json = JSON.parse((await delivery(["report", "--json"], { cwd: repo, env })).stdout) as { delivery: { branch: string; landed: { item: string }[]; closer: { status: string } } };

    for (const out of [status.stdout, report.stdout]) {
      expect(out).toContain("Delivery branch delivery/main");
      expect(out).toContain(KEY);
      expect(out).toContain("Your closer");
    }
    expect(json.delivery).toMatchObject({ branch: "delivery/main", landed: [{ item: KEY }], closer: { status: "DONE" } });
  }, RUN_TIMEOUT);

  it("runs the notify command with the report, parked items included, on its standard input", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ notify: "cat > notified.json" }) });
    await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(asks) } });
    const sent = JSON.parse(readFileSync(join(repo, "notified.json"), "utf-8")) as { schema: string; parked: { item: string; question: string }[] };
    expect(sent.schema).toBe("delivery.report/1");
    expect(sent.parked).toEqual([expect.objectContaining({ item: KEY, question: "Formal or casual greeting?" })]);
  }, RUN_TIMEOUT);

  it("runs the notify command on a run with nothing to work", async () => {
    const repo = initTempRepo("sources-notify-empty-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ notify: "cat > notified.json" }) });
    const { stdout } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect(stdout).toContain(NOTHING_TO_WORK);
    const sent = JSON.parse(readFileSync(join(repo, "notified.json"), "utf-8")) as { schema: string };
    expect(sent.schema).toBe("delivery.report/1");
  }, RUN_TIMEOUT);

  it("runs the notify command on a run that starts no task because the delivery branch is blocked", async () => {
    const repo = project({ "shared.txt": "one\n", "delivery.config.json": JSON.stringify({ notify: "cat > notified.json" }) });
    git(repo, ["branch", "delivery/main"]);
    const scratch = join(mkdtempSync(join(tmpdir(), "sources-notify-blocked-")), "wt");
    git(repo, ["worktree", "add", "-q", scratch, "delivery/main"]);
    writeFileSync(join(scratch, "shared.txt"), "delivered\n");
    git(scratch, ["commit", "-q", "-am", "delivered"]);
    git(repo, ["worktree", "remove", "--force", scratch]);
    writeFileSync(join(repo, "shared.txt"), "the owner's\n");
    git(repo, ["commit", "-q", "-am", "the owner's"]);

    const { exitCode } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

    expect(exitCode).toBe(EXIT.escalated);
    // The branch was made by hand, so the delivery ledger holds a `blocked` entry but no `opened` one, and
    // `deliveryIn` reports `delivery: null`: assert the notification arrived, not the blocked reason.
    const sent = JSON.parse(readFileSync(join(repo, "notified.json"), "utf-8")) as { schema: string };
    expect(sent.schema).toBe("delivery.report/1");
  }, RUN_TIMEOUT);

  it("keeps a tracker item's follow-up off the delivery branch and holds it in the run's record", async () => {
    const FOLLOW = ".delivery/backlog/20261018T090000Z-tidy-the-readme.md";
    const script = `#!/bin/sh\ncase "$1" in\n list) [ -f done ] && echo '[]' || echo '[{"id":"t1","intent":"say hello"}]';;\n complete) echo "$2" > done;;\nesac\n`;
    const repo = initTempRepo("sources-hold-", { "package.json": PACKAGE, "tasks.sh": script, "delivery.config.json": JSON.stringify({ sources: [{ type: "command", command: "sh tasks.sh", name: "tracker", tracker: true }] }) });
    const writesFollowUp: MockScript = {
      expectations: [{ effects: [{ write: { path: "hello.js", content: "export const hello = 1;\n" } }, { write: { path: FOLLOW, content: "---\nstatus: open\n---\nTidy the README.\n" } }], json: { status: "completed", rationale: "hello, and a follow-up" } }],
    };

    await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(writesFollowUp) } });

    expect(git(repo, ["show", "delivery/main:hello.js"])).toContain("hello");
    expect(() => git(repo, ["show", `delivery/main:${FOLLOW}`])).toThrow();
    const [record] = await allRuns(repo);
    expect(record?.caseFile.header.item).toMatchObject({ source: "tracker", raise: true });
    expect(await readRef(record?.dir ?? "", "follow-ups")).toEqual([{ file: "20261018T090000Z-tidy-the-readme.md", text: "---\nstatus: open\n---\nTidy the README.\n" }]);
  }, RUN_TIMEOUT);

  it("leaves a command source that is not a tracker alone: its follow-up lands on the delivery branch and nothing is held", async () => {
    const FOLLOW = ".delivery/backlog/20261018T090000Z-tidy-the-readme.md";
    // The spec's own example of a command source: it lists and completes, and has no `raise`.
    const script = `#!/bin/sh\ncase "$1" in\n list) [ -f done ] && echo '[]' || echo '[{"id":"t1","intent":"say hello"}]';;\n complete) echo "$2" > done;;\nesac\n`;
    const repo = initTempRepo("sources-no-hold-", { "package.json": PACKAGE, "tasks.sh": script, "delivery.config.json": JSON.stringify({ sources: [{ type: "command", command: "sh tasks.sh", name: "earliest" }] }) });
    const writesFollowUp: MockScript = {
      expectations: [{ effects: [{ write: { path: "hello.js", content: "export const hello = 1;\n" } }, { write: { path: FOLLOW, content: "---\nstatus: open\n---\nTidy the README.\n" } }], json: { status: "completed", rationale: "hello, and a follow-up" } }],
    };

    const { exitCode } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(writesFollowUp) } });

    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["show", `delivery/main:${FOLLOW}`])).toContain("Tidy the README.");
    const [record] = await allRuns(repo);
    expect(record?.caseFile.header.item).not.toHaveProperty("raise");
  }, RUN_TIMEOUT);

  it("records the after steps and their outcome against the run, in report, status and the notify JSON", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ notify: "cat > notified.json", after: [{ name: "release notes", run: "echo notes", in: "base" }] }) });
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    await delivery(["run", "--sources"], { cwd: repo, env });

    const report = await delivery(["report"], { cwd: repo, env });
    const status = await delivery(["status"], { cwd: repo, env });
    for (const out of [report.stdout, status.stdout]) {
      expect(out).toContain("After landing");
      expect(out).toContain("- release notes: done");
      expect(out).toContain("(batch ");
    }
    const sent = JSON.parse(readFileSync(join(repo, "notified.json"), "utf-8")) as { after: { steps: { label: string; status: string }[] }[] };
    expect(sent.after.at(-1)?.steps).toEqual([expect.objectContaining({ label: "release notes", status: "done" })]);
  }, RUN_TIMEOUT);

  it("runs the after steps once the closer has taken the delivery branch, and not on a run where nothing landed", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ after: [{ run: 'echo "$DELIVERY_COMMIT" >> after.log', in: "base", check: "test -s after.log" }] }) });
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };

    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    const second = await delivery(["run", "--sources"], { cwd: repo, env });

    expect(first.exitCode).toBe(EXIT.ok);
    expect(readFileSync(join(repo, "after.log"), "utf-8").trim()).toBe(git(repo, ["rev-parse", "delivery/main"]));
    // The step has no name, so it is labelled by its command (stepLabel), not by its check.
    expect(first.stdout).toContain("After landing, echo \"$DELIVERY_COMMIT\" >> after.log: done.");
    expect(second.stdout).toContain(NOTHING_TO_WORK);
    expect(readFileSync(join(repo, "after.log"), "utf-8").trim().split("\n")).toHaveLength(1);
  }, RUN_TIMEOUT);

  it("keeps a failed after step pending, and tries it first on the next run, from the step that failed", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ after: [{ name: "deploy", run: "echo deployed >> steps.log", in: "base", check: "test -f healthy" }, { name: "announce", run: "echo announced >> steps.log", in: "base" }] }) });
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };

    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.exitCode).toBe(EXIT.escalated);
    expect(first.stdout).toContain("After landing, deploy did not work");
    expect(readFileSync(join(repo, "steps.log"), "utf-8")).toBe("deployed\n");

    writeFileSync(join(repo, "healthy"), "");
    const second = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(second.exitCode).toBe(EXIT.ok);
    expect(readFileSync(join(repo, "steps.log"), "utf-8")).toBe("deployed\ndeployed\nannounced\n");
  }, RUN_TIMEOUT);

  it("repairs a stuck step from the corrected config, and never redeploys an older commit over a newer one", async () => {
    // Fails on a commit without second.js, so c1's deploy fails and c2's works.
    const deploy = { name: "deploy", run: 'echo "$DELIVERY_COMMIT" >> deploys.log; git cat-file -e "$DELIVERY_COMMIT:second.js"', in: "base" };
    const repo = project({ "delivery.config.json": JSON.stringify({ after: [deploy] }) });
    const writes = (path: string): MockScript["expectations"][number] => ({ effects: [{ write: { path, content: "export const x = 1;\n" } }], json: { status: "completed", rationale: "done" } });
    // Each session matches the script afresh, so each item's session is told apart by what its prompt says.
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [{ when: { promptContains: "says hello" }, ...writes("hello.js") }, { when: { promptContains: "second function" }, ...writes("second.js") }] }) };
    const deploys = () => readFileSync(join(repo, "deploys.log"), "utf-8").trim().split("\n");

    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.exitCode).toBe(EXIT.escalated);
    const c1 = deploys()[0];

    // A second item arrives; the next run retries c1's deploy (still failing), then lands c2 and deploys that.
    mkdirSync(join(repo, ".delivery", "backlog"), { recursive: true });
    writeFileSync(join(repo, ".delivery", "backlog", "20261018T110000Z-second.md"), "---\nstatus: open\n---\nAdd a second function.\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "second item"]);
    const second = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(second.exitCode).toBe(EXIT.ok);
    expect(second.stdout).toContain("Skipped one waiting after-landing step from an earlier run");
    expect(deploys()).toHaveLength(3);

    const third = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(third.stdout).toContain(NOTHING_TO_WORK);
    expect(deploys()).toHaveLength(3);
    expect(deploys().filter((commit) => commit === c1)).toHaveLength(2);
  }, RUN_TIMEOUT * 3);

  it("runs a corrected step on the next run in place of the one that was stuck", async () => {
    const repo = project({ "delivery.config.json": JSON.stringify({ after: [{ name: "deploy", run: "make-deploy-typo", in: "base" }] }) });
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.escalated);

    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ after: [{ name: "deploy", run: "touch deployed", in: "base" }] }));
    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    expect(existsSync(join(repo, "deployed"))).toBe(true);
  }, RUN_TIMEOUT * 2);

  it("raises a tracker item's follow-up once the closer has succeeded, exactly once even when raising is retried", async () => {
    const FOLLOW = ".delivery/backlog/20261018T090000Z-tidy-the-readme.md";
    const script = [
      "#!/bin/sh",
      'case "$1" in',
      " list) [ -f done ] && echo '[]' || echo '[{\"id\":\"t1\",\"intent\":\"say hello\"}]';;",
      ' complete) echo "$2" > done;;',
      " raise) [ -f tracker-up ] || exit 1; cat >> raised.jsonl; echo >> raised.jsonl; echo '#7';;",
      "esac",
    ].join("\n");
    const repo = initTempRepo("sources-raise-", { "package.json": PACKAGE, "tasks.sh": script, "delivery.config.json": JSON.stringify({ sources: [{ type: "command", command: "sh tasks.sh", name: "tracker", tracker: true }] }) });
    const writesFollowUp: MockScript = {
      expectations: [{ effects: [{ write: { path: "hello.js", content: "export const hello = 1;\n" } }, { write: { path: FOLLOW, content: "---\nstatus: open\n---\nTidy the README.\n" } }], json: { status: "completed", rationale: "hello, and a follow-up" } }],
    };
    const env = { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(writesFollowUp) };

    await delivery(["run", "--sources"], { cwd: repo, env });
    expect(existsSync(join(repo, "raised.jsonl"))).toBe(false);

    writeFileSync(join(repo, "tracker-up"), "");
    await delivery(["run", "--sources"], { cwd: repo, env });
    await delivery(["run", "--sources"], { cwd: repo, env });

    const raised = readFileSync(join(repo, "raised.jsonl"), "utf-8").trim().split("\n");
    expect(raised).toHaveLength(1);
    expect(JSON.parse(raised[0] ?? "")).toMatchObject({ file: "20261018T090000Z-tidy-the-readme.md", body: "Tidy the README.\n" });
  }, RUN_TIMEOUT * 2);

  it("runs an after agent pass whose follow-up lands on the delivery branch and whose other changes are discarded", async () => {
    const FOLLOW = ".delivery/backlog/20261018T100000Z-check-the-docs.md";
    const repo = project({ "README.md": "hello\n", "delivery.config.json": JSON.stringify({ after: [{ name: "release notes", prompt: "Write release notes for the landed commits." }] }) });
    const script: MockScript = {
      expectations: [
        { when: { promptContains: "Write release notes" }, effects: [{ write: { path: FOLLOW, content: "---\nstatus: open\n---\nCheck the docs.\n" } }, { edit: { path: "README.md", old: "hello", new: "changed" } }], json: { status: "completed", rationale: "notes written" } },
        ...completes.expectations,
      ],
    };

    const { stdout } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(script) } });

    expect(stdout).toContain("After landing, release notes: done.");
    expect(stdout).toContain("changed README.md; those changes were discarded");
    expect(git(repo, ["show", `delivery/main:${FOLLOW}`])).toContain("Check the docs.");
    expect(git(repo, ["show", "delivery/main:README.md"])).toBe("hello");
  }, RUN_TIMEOUT);

  it("runs a workflow's own after steps in place of the project's", async () => {
    const repo = initTempRepo("sources-workflow-after-", {
      "package.json": PACKAGE,
      [ITEM_PATH]: "---\nstatus: open\nworkflow: quiet\n---\nAdd a function that says hello to a name.\n",
      "delivery.config.json": JSON.stringify({ after: [{ run: "touch deployed", in: "base" }], workflows: { quiet: { steps: [{ name: "do", prompt: "do it" }], after: [] } } }),
    });
    await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect(git(repo, ["show", "delivery/main:hello.js"])).toContain("hello");
    expect(existsSync(join(repo, "deployed"))).toBe(false);
  }, RUN_TIMEOUT);

  it("pins an issue's item as untrusted, so its text reaches the agent framed as data", async () => {
    const gh = createGhStandIn();
    gh.openIssue({ title: "Add a function that says hello to a name", body: "Please.", labels: ["delivery"] });
    const repo = initTempRepo("sources-run-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ sources: [{ type: "github" }] }) });
    const script = await scriptFile(completes);
    const { exitCode } = await delivery(["run", "--sources"], { cwd: repo, env: { XDG_STATE_HOME: stateDir(), PATH: `${gh.binDir}:${process.env.PATH ?? ""}`, [TEST_MOCK_SCRIPT]: script } });
    expect(exitCode).toBe(EXIT.ok);
    const [record] = await allRuns(repo);
    expect(record?.caseFile.header.item).toEqual({ key: "github:1", source: "github", id: "1", raise: true, untrusted: true });
    expect(promptsSent(await readJournal(`${script}.journal.jsonl`)).some((p) => p.includes(UNTRUSTED_TASK))).toBe(true);
  }, RUN_TIMEOUT);
});
