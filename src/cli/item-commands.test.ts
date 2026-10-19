import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
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

describe("delivery unpark", () => {
  it("puts a parked item back in the queue, to start afresh", async () => {
    const { repo, env, path } = await withLedger([{ t: "parked", key: KEY, reason: "escalated", at }]);
    const { exitCode, stdout } = await delivery(["unpark", KEY], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(unparked(KEY));
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, lastClass: null, attempts: 0 });
  });
});

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

  // Third case, required (see "Notes for the implementer"): a held item whose work no longer passes where it lands
  // (a later item landed a conflicting change to the same line on delivery/main first) goes to triage and a worker
  // with the signed_off turn text, and is held again rather than landed: assert the second prompt contains that text,
  // `delivery/main` lacks the held work, and the ledger shows `parked: "held"` again.

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
