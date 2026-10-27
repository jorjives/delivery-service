import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { ledgerPath, readItemLedger } from "../item-ledger.js";
import { appendLine } from "../journal.js";
import { git } from "../../tests/helpers.js";
import { promptsSent, readJournal } from "../mock-script.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { completes, delivery, PACKAGE, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { answered, notParked, notWaitingForAnswer, signedOff, unparked } from "./item-commands.js";
import { branchName } from "../provision.js";
import { takeRepoLock } from "../repo-lock.js";
import { liveRunFound } from "./run-exclusion.js";

const at = "2026-10-16T09:00:00.000Z";
const KEY = "backlog:20261016T090000Z-greet.md";

async function withLedger(entries: object[]) {
  const repo = initTempRepo("item-commands-", { "package.json": PACKAGE });
  const state = mkdtempSync(join(tmpdir(), "item-state-"));
  const path = ledgerPath(repo, { XDG_STATE_HOME: state });
  await mkdir(dirname(path), { recursive: true });
  for (const entry of entries) await appendLine(path, entry);
  return { repo, env: { XDG_STATE_HOME: state }, path };
}

const decided = [
  { t: "dispatched", key: KEY, runId: "r1", intent: "Greet people.", at },
  { t: "ended", key: KEY, runId: "r1", class: "decision", question: "Formal?", at },
  { t: "parked", key: KEY, reason: "decision", at },
];

describe("delivery answer", () => {
  it("records the answer and unparks the item, by key or by id", async () => {
    const { repo, env, path } = await withLedger(decided);
    const { exitCode, stdout } = await delivery(["answer", "20261016T090000Z-greet.md", "Formal, please."], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(answered(KEY));
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, answer: "Formal, please." });
  });

  it("refuses an item that is not waiting on an answer", async () => {
    const { repo, env } = await withLedger([{ t: "parked", key: KEY, reason: "attempts", at }]);
    const { exitCode, stderr } = await delivery(["answer", KEY, "yes"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(notWaitingForAnswer(KEY));
  });

  it("refuses an item it does not know, naming what is parked", async () => {
    const { repo, env } = await withLedger(decided);
    expect((await delivery(["answer", "nope", "yes"], { cwd: repo, env })).stderr).toContain(notParked("nope", [KEY]));
  });
});

describe("delivery answer for a run started with --task", () => {
  it("records the answer to the question a --task run stopped on, named by its run id", async () => {
    const repo = initTempRepo("item-commands-task-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "item-task-state-"));
    const asks = { expectations: [{ json: { status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the task does not say" } }] };
    const env = { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(asks as never) };
    const stopped = await delivery(["run", "--task", "Add a greeting function."], { cwd: repo, env });
    expect(stopped.exitCode).toBe(EXIT.escalated);
    const runId = /Starting run (\S+):/.exec(stopped.stdout)?.[1] ?? "";
    expect(runId).not.toBe("");

    const { exitCode, stderr } = await delivery(["answer", runId, "Formal, please."], { cwd: repo, env });
    expect(stderr).not.toContain("is parked here");
    expect(exitCode).toBe(EXIT.ok);
  }, RUN_TIMEOUT);
});

describe("delivery unpark", () => {
  it("puts a parked item back in the queue, to start afresh", async () => {
    const { repo, env, path } = await withLedger([{ t: "parked", key: KEY, reason: "escalated", at }]);
    const { exitCode, stdout } = await delivery(["unpark", KEY], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(unparked(KEY));
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, lastClass: null, attempts: 0 });
  });
});

const SIGNED_OFF_TEXT = "The operator signed this work off, but it no longer passes its checks where it is to land.";
const HELD = "20261019T120000Z-key-in-code.md";
const HELD_KEY = `backlog:${HELD}`;
const heldProject = () =>
  initTempRepo("sign-off-", {
    "package.json": PACKAGE,
    "delivery.config.json": JSON.stringify({ workflows: { fix: { steps: [{ name: "fix", prompt: "fix it" }], hold: "high" } } }),
    [`.delivery/backlog/${HELD}`]: "---\nstatus: open\nworkflow: fix\nseverity: critical\n---\nAdd a function that says hello to a name.\n",
  });

describe("delivery sign-off", () => {
  it("lands a held item on the delivery branch with no agent session, and resolves it there", async () => {
    const repo = heldProject();
    const state = mkdtempSync(join(tmpdir(), "sign-off-state-"));
    const script = await scriptFile(completes);
    const env = { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script };
    const first = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(first.stdout + first.stderr).toContain(`Holding ${HELD_KEY}`);
    // The run opens delivery/main before any task is claimed (reconcileDeliveryBranch), so the branch exists; the held work is not on it.
    expect(() => git(repo, ["show", "delivery/main:hello.js"])).toThrow();
    expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)).toMatchObject({ parked: "held" });
    const promptsBefore = promptsSent(await readJournal(`${script}.journal.jsonl`)).length;

    const { exitCode, stdout } = await delivery(["sign-off", "key-in-code"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(signedOff(HELD_KEY));
    expect(promptsSent(await readJournal(`${script}.journal.jsonl`))).toHaveLength(promptsBefore);
    expect(git(repo, ["show", `delivery/main:hello.js`])).toContain("hello");
    expect(git(repo, ["show", `delivery/main:.delivery/backlog/${HELD}`])).toContain("status: resolved");
    expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)).toMatchObject({ lastClass: "delivered", parked: null });
  }, RUN_TIMEOUT);

  it("refuses to sign off while another run is going here, leaving the held item held", async () => {
    const repo = heldProject();
    const state = mkdtempSync(join(tmpdir(), "sign-off-lock-state-"));
    const env = { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    await delivery(["run", "--sources"], { cwd: repo, env });
    const release = await takeRepoLock(repo);
    try {
      const { exitCode, stderr } = await delivery(["sign-off", "key-in-code"], { cwd: repo, env });
      expect(exitCode).toBe(EXIT.configuration);
      expect(stderr.trimEnd()).toBe(liveRunFound(undefined));
      expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)).toMatchObject({ parked: "held" });
      expect(() => git(repo, ["show", "delivery/main:hello.js"])).toThrow();
    } finally {
      await release?.();
    }
  }, RUN_TIMEOUT);

  it("holds the work again when it no longer passes where it lands, sending it to a worker with the sign-off text", async () => {
    const repo = initTempRepo("sign-off-recheck-", {
      "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "test ! -f blocker.txt || test ! -f hello.js || grep -q fixed hello.js" } }),
      "delivery.config.json": JSON.stringify({ workflows: { fix: { steps: [{ name: "fix", prompt: "fix it" }], hold: "high" } } }),
      [`.delivery/backlog/${HELD}`]: "---\nstatus: open\nworkflow: fix\nseverity: critical\n---\nAdd a function that says hello to a name.\n",
    });
    const state = mkdtempSync(join(tmpdir(), "sign-off-recheck-state-"));
    const script = await scriptFile({
      expectations: [
        { when: { promptContains: SIGNED_OFF_TEXT }, effects: [{ write: { path: "hello.js", content: "// fixed for the later change\nexport const hello = (name) => `hello ${name}`;\n" } }], json: { status: "completed", rationale: "adjusted to the later change" } },
        ...completes.expectations,
      ],
    });
    const env = { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script };
    await delivery(["run", "--sources"], { cwd: repo, env });
    expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)).toMatchObject({ parked: "held" });

    // A later item lands a change on delivery/main that makes the held work fail its check there.
    const other = mkdtempSync(join(tmpdir(), "sign-off-later-"));
    git(repo, ["worktree", "add", join(other, "wt"), "delivery/main"]);
    writeFileSync(join(other, "wt", "blocker.txt"), "later work\n");
    git(join(other, "wt"), ["add", "blocker.txt"]);
    git(join(other, "wt"), ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-m", "Later item"]);
    git(repo, ["worktree", "remove", "--force", join(other, "wt")]);
    const promptsBefore = promptsSent(await readJournal(`${script}.journal.jsonl`)).length;

    await delivery(["sign-off", "key-in-code"], { cwd: repo, env });
    const prompts = promptsSent(await readJournal(`${script}.journal.jsonl`));
    expect(prompts.length).toBeGreaterThan(promptsBefore);
    expect(prompts[promptsBefore]).toContain(SIGNED_OFF_TEXT);
    expect(() => git(repo, ["show", "delivery/main:hello.js"])).toThrow();
    expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)).toMatchObject({ parked: "held" });
  }, RUN_TIMEOUT * 2);

  it("does not land work whose branch was edited after the review", async () => {
    const repo = heldProject();
    const state = mkdtempSync(join(tmpdir(), "sign-off-edited-state-"));
    const env = { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    await delivery(["run", "--sources"], { cwd: repo, env });
    const held = (await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY);
    expect(held).toMatchObject({ parked: "held" });

    // Something is added to the held branch after the owner read it, and before they sign it off.
    const other = mkdtempSync(join(tmpdir(), "sign-off-edit-"));
    git(repo, ["worktree", "add", join(other, "wt"), branchName(held?.lastRunId ?? "")]);
    writeFileSync(join(other, "wt", "unreviewed.txt"), "slipped in after review\n");
    git(join(other, "wt"), ["add", "unreviewed.txt"]);
    git(join(other, "wt"), ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-m", "After review"]);
    git(repo, ["worktree", "remove", "--force", join(other, "wt")]);

    await delivery(["sign-off", "key-in-code"], { cwd: repo, env });
    expect(() => git(repo, ["show", "delivery/main:unreviewed.txt"])).toThrow();
    expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)).toMatchObject({ parked: "held" });
  }, RUN_TIMEOUT * 2);

  it("refuses an item that is not held", async () => {
    const repo = heldProject();
    const { stderr } = await delivery(["sign-off", "key-in-code"], { cwd: repo, env: { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "sign-off-none-")) } });
    expect(stderr).toContain("No item called key-in-code is parked here");
  });
});

describe("delivery reject", () => {
  it("declines a held item in a commit of that file alone, and keeps its work on its branch", async () => {
    const repo = heldProject();
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "reject-state-")), [TEST_MOCK_SCRIPT]: await scriptFile(completes) };
    await delivery(["run", "--sources"], { cwd: repo, env });
    const { exitCode, stdout } = await delivery(["reject", HELD], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(git(repo, ["show", `HEAD:.delivery/backlog/${HELD}`])).toContain("status: declined");
    expect(git(repo, ["show", "--name-only", "--format=", "HEAD"]).trim()).toBe(`.delivery/backlog/${HELD}`);
    expect(stdout).toMatch(/Its work stays on branch surface\/\S+/);
    expect((await readItemLedger(ledgerPath(repo, env))).get(HELD_KEY)?.parked).toBeNull();
  }, RUN_TIMEOUT);
});
