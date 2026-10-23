import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { EDIT_GUARD } from "../guards.js";
import { ledgerPath, readItemLedger } from "../item-ledger.js";
import type { MockScript } from "../mock-script.js";
import { ideasScript, type ScriptedIdea } from "../packs/review-fixtures.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, movesProject, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { allRuns } from "./runs.js";

const RISKY: ScriptedIdea = { file: "20261023T120000Z-prices-still-use.md", title: "Prices still use the old code", severity: "high", workflow: "moves:code",
  check: { kind: "anchor-gone", path: "price.js", anchor: "export const price = old(1);" }, body: "Prices still call the old code." };
const TEST_MOVE: ScriptedIdea = { file: "20261023T120100Z-a-test-still-uses.md", title: "A test still uses the old code", severity: "high", workflow: "moves:tests",
  check: { kind: "anchor-gone", path: "a.test.js", anchor: "old(2);" }, body: "A test still calls the old code." };
const CHEAT: ScriptedIdea = { file: "20261023T120200Z-another-test-still-uses.md", title: "Another test still uses the old code", severity: "low", workflow: "moves:code",
  check: { kind: "anchor-gone", path: "b.test.js", anchor: "old(3);" }, body: "Another test still calls the old code." };

const fix = (title: string, path: string, content: string): MockScript["expectations"][number] =>
  ({ when: { promptContains: title }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: "moved" } });
const FIXES: MockScript = { expectations: [
  fix(RISKY.title, "price.js", "export const price = 1;\n"),
  fix(TEST_MOVE.title, "a.test.js", "// moved\n"),
  fix(CHEAT.title, "b.test.js", "// moved\n"),
] };

/** A fresh moves project taken through review, approve and run, each command with its own scripted agent. */
async function ranMoves() {
  const repo = movesProject({ "price.js": "export const price = old(1);\n", "a.test.js": "old(2);\n", "b.test.js": "old(3);\n" });
  const state = mkdtempSync(join(tmpdir(), "pack-acts-state-"));
  const env = async (script: MockScript) => ({ XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) });
  const step = async (args: string[], script: MockScript) => delivery(args, { cwd: repo, env: await env(script) });
  for (const [args, script] of [[["review", "moves"], ideasScript([RISKY, TEST_MOVE, CHEAT])], [["approve", "--all"], FIXES]] as const) {
    const { exitCode, stdout, stderr } = await step([...args], script);
    expect(exitCode, stdout + stderr).toBe(EXIT.ok);
  }
  // The run ends needing a person (a held idea, a refused one), so its exit code is not "ok"; the ledger below says what happened.
  await step(["run", "--sources", "--max", "3"], FIXES);
  const ledger = await readItemLedger(ledgerPath(repo, await env(FIXES)));
  return { repo, ledger, as: async () => env(FIXES) };
}

describe("delivery run on a pack's ideas", () => {
  it("holds a high-severity idea in an act with a hold, and lands one of the same severity in an act without", async () => {
    const { repo, ledger } = await ranMoves();
    expect(ledger.get(`backlog:${RISKY.file}`)).toMatchObject({ parked: "held" });
    expect(git(repo, ["show", "delivery/main:a.test.js"])).toBe("// moved");
    expect(git(repo, ["show", "delivery/main:price.js"])).toBe("export const price = old(1);");
  }, RUN_TIMEOUT * 4);

  it("refuses a test edit under the act that keeps tests unchanged, and accepts it under the one that does not", async () => {
    const { repo, ledger } = await ranMoves();
    const cheat = ledger.get(`backlog:${CHEAT.file}`);
    expect(cheat?.lastClass).not.toBeNull(); // it ran: an item never dispatched would also be "not delivered"
    expect(cheat?.lastClass).not.toBe("delivered");
    expect(cheat?.lastClass).not.toBe("held");
    const record = (await allRuns(repo)).find((r) => r.runId === cheat?.lastRunId);
    expect(record?.caseFile.history.some((e) => e.t === "gate" && e.newFailures.some((f) => f.id === EDIT_GUARD))).toBe(true);
    expect(git(repo, ["show", "delivery/main:b.test.js"])).toBe("old(3);");
    expect(ledger.get(`backlog:${TEST_MOVE.file}`)?.lastClass).toBe("delivered");
  }, RUN_TIMEOUT * 4);

  it("lists the held idea in the backlog, lands it on sign-off, and reports the run as for any item", async () => {
    const { repo, as } = await ranMoves();
    const io = async () => ({ cwd: repo, env: await as() });
    expect((await delivery(["backlog"], await io())).stdout).toMatch(/held/i);
    expect((await delivery(["sign-off", "prices-still-use"], await io())).exitCode).toBe(EXIT.ok);
    expect(git(repo, ["show", "delivery/main:price.js"])).toBe("export const price = 1;");
    expect((await delivery(["report"], await io())).exitCode).toBe(EXIT.ok);
  }, RUN_TIMEOUT * 4);

  it("sets a held idea aside on reject and never lands it", async () => {
    const { repo, as } = await ranMoves();
    expect((await delivery(["reject", "prices-still-use"], { cwd: repo, env: await as() })).exitCode).toBe(EXIT.ok);
    expect(git(repo, ["show", "delivery/main:price.js"])).toBe("export const price = old(1);");
  }, RUN_TIMEOUT * 4);
});
