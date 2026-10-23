import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { checkPack, WEAKENED_TESTS } from "../src/cli/pack-check.js";
import { delivery, PACKAGE, RUN_TIMEOUT, scriptFile } from "../src/cli/command-fixtures.js";
import { EXIT } from "../src/cli/failures.js";
import { packLines } from "../src/cli/packs-command.js";
import { findWords } from "../src/cli/review-command.js";
import { allRuns } from "../src/cli/runs.js";
import { EDIT_GUARD } from "../src/guards.js";
import { ledgerPath, readItemLedger } from "../src/item-ledger.js";
import type { MockScript } from "../src/mock-script.js";
import { BUILT_IN_PACKS, IDEA_CAP, loadPack } from "../src/packs/manifest.js";
import { readFixtures } from "../src/packs/pack-fixtures.js";
import { ideasScript, type ScriptedIdea } from "../src/packs/review-fixtures.js";
import { FORBIDDEN } from "../src/report/report-fixtures.js";
import { initTempRepo } from "../src/temp-repo.js";
import { git } from "./helpers.js";

const DEPRECATIONS = join(BUILT_IN_PACKS, "deprecations");

/** The words the pack's owner text may not use: the harness's own, beyond what the review UX already forbids. */
const OWNER_FORBIDDEN = /pattern-absent|guard|deprecation sweep|check kind/i;

const TITLES = {
  invoice: "Invoices still use the old date handling the team marked as replaced",
  receipt: "Receipts still use the old date handling the team marked as replaced",
  receiptTest: "The receipt test still uses the old date handling the team marked as replaced",
} as const;

const FILES = {
  invoice: "20260101T000000Z-invoice-dates.md",
  receipt: "20260101T000100Z-receipt-dates.md",
  receiptTest: "20260101T000200Z-receipt-test-dates.md",
} as const;

/** The owner text of the receipt test idea, as review.json writes it. */
const RECEIPT_TEST_BODY =
  "src/receipt.test.js checks a date with legacyFormat from lib/legacy-dates.js, which the team has marked as replaced by formatDate in lib/dates.js.\n\n## Why it matters\n\nThe test keeps the old date handling alive, so the team cannot remove it.\n\n## What fixed looks like\n\nThe test checks the same date with the replacement the team named, and expects the same text.\n\n## For engineers\n\nIn src/receipt.test.js, replace legacyFormat with formatDate from ../lib/dates.js in the one test that uses it. Keep every expected value the same.";

/** The owner text of one idea file: its title and body up to "## For engineers", front matter excluded. */
const ownerText = (file: string): string => (file.replace(/^---\n[\s\S]*?\n---\n/, "").split("## For engineers")[0] ?? "");

/** The project files of the pack's fixtures, in a fresh repository, with its two scripts parsed. */
async function fixtureProject(): Promise<{ repo: string; review: MockScript; fixes: MockScript }> {
  const read = await readFixtures(DEPRECATIONS);
  if (!read.ok) throw new Error(`the pack's fixtures are not readable: ${JSON.stringify(read.problems)}`);
  const { project, reviewScript, fixesScript } = read.fixtures;
  return {
    repo: initTempRepo("deprecations-fixture-", project),
    review: JSON.parse(reviewScript) as MockScript,
    fixes: JSON.parse(fixesScript) as MockScript,
  };
}

/**
 * A fresh fixture project taken through review, approve and run, each command with its own scripted agent. The run
 * uses the fixtures' fixes unless another review is given, and at most `max` ideas.
 */
async function ranDeprecations(max = 3, review?: MockScript) {
  const project = await fixtureProject();
  const state = mkdtempSync(join(tmpdir(), "deprecations-state-"));
  const env = async (script: MockScript) => ({ XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) });
  const step = async (args: string[], script: MockScript) => delivery(args, { cwd: project.repo, env: await env(script) });
  for (const [args, script] of [[["review", "deprecations"], review ?? project.review], [["approve", "--all"], project.fixes]] as const) {
    const { exitCode, stdout, stderr } = await step([...args], script);
    expect(exitCode, stdout + stderr).toBe(EXIT.ok);
  }
  // The run ends needing a person (a held idea, a refused one), so its exit code is not "ok"; the ledger below says what happened.
  await step(["run", "--sources", "--max", String(max)], project.fixes);
  const ledger = await readItemLedger(ledgerPath(project.repo, await env(project.fixes)));
  return { repo: project.repo, ledger, as: async () => env(project.fixes) };
}

describe("the built-in deprecations pack", () => {
  it("never uses the harness's own words in the pack's owner text", async () => {
    const pack = await loadPack(DEPRECATIONS);
    const words = findWords(pack);
    const { review } = await fixtureProject();
    const ideas = review.expectations.flatMap((e) => (e.effects ?? []).flatMap((effect) => ("write" in effect ? [ownerText(effect.write.content)] : [])));
    const all = [pack.manifest.title, pack.manifest.summary, ...packLines([pack]), ...words.starting(undefined), ...words.starting("src"),
      ...words.added(0), ...words.added(3), ...words.added(IDEA_CAP), ...words.raised(3, "GitHub"), words.task(undefined).intent, ...ideas];
    for (const line of all) {
      expect(line).not.toMatch(OWNER_FORBIDDEN);
      expect(line).not.toMatch(FORBIDDEN); // src/report/report-fixtures.ts: the words the review UX already forbids (spec section 3, item 5)
    }
    expect(ideas).toHaveLength(3);
  });

  it("says plainly that it found nothing when the project marks nothing as deprecated", async () => {
    const repo = initTempRepo("deprecations-none-", { "package.json": PACKAGE, "a.js": "export const a = 1;\n" });
    const { exitCode, stdout } = await delivery(["review", "deprecations"], { cwd: repo, env: { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "deprecations-none-state-")), [TEST_MOCK_SCRIPT]: await scriptFile(ideasScript([])) } });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Move off deprecated code found nothing to add. That is the agent's reading of your project, not a guarantee.");
  }, RUN_TIMEOUT);

  it("is listed in every project with no configuration, with its sentence and start command", async () => {
    const { exitCode, stdout } = await delivery(["packs"], { cwd: initTempRepo("deprecations-listed-", { "a.js": "x\n" }) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")).toContain("  deprecations  Finds places that still use code your team has marked as replaced, and moves them. Start it with: delivery review deprecations");
  });

  it("passes the pack check: three ideas found, the honest moves pass, the test-editing cheat refused", async () => {
    const check = await checkPack(DEPRECATIONS);
    expect(check.problems).toEqual([]);
    expect(check.run).toMatchObject({
      find: "deprecations:scan",
      found: [TITLES.invoice, TITLES.receipt, TITLES.receiptTest],
      fixed: [TITLES.invoice, TITLES.receiptTest],
      refused: [{ title: TITLES.receipt, why: WEAKENED_TESTS }],
      workflowOf: { [TITLES.invoice]: "deprecations:code", [TITLES.receipt]: "deprecations:code", [TITLES.receiptTest]: "deprecations:tests" },
    });
  }, 120_000);

  it("lands the unheld honest move, holds the high-severity one, and refuses the cheat", async () => {
    const { repo, ledger } = await ranDeprecations();
    expect(ledger.get(`backlog:${FILES.invoice}`)).toMatchObject({ parked: "held" });
    expect(git(repo, ["show", "delivery/main:src/invoice.js"])).toContain("legacy-dates");
    expect(git(repo, ["show", "delivery/main:src/receipt.test.js"])).toContain('from "../lib/dates.js"');
    expect(ledger.get(`backlog:${FILES.receiptTest}`)?.lastClass).toBe("delivered");
    const receipt = ledger.get(`backlog:${FILES.receipt}`);
    expect(receipt?.lastClass).not.toBeNull();
    expect(["delivered", "held"]).not.toContain(receipt?.lastClass);
    expect(git(repo, ["show", "delivery/main:src/receipt.js"])).toContain("legacy-dates");
  }, RUN_TIMEOUT * 4);

  it("lands the held high-severity move once it is signed off, and reports the run", async () => {
    const { repo, as } = await ranDeprecations();
    const io = async () => ({ cwd: repo, env: await as() });
    expect((await delivery(["sign-off", "invoice-dates"], await io())).exitCode).toBe(EXIT.ok);
    expect(git(repo, ["show", "delivery/main:src/invoice.js"])).toContain('from "../lib/dates.js"');
    expect((await delivery(["report"], await io())).exitCode).toBe(EXIT.ok);
  }, RUN_TIMEOUT * 4);

  it.each([
    ["deprecations:tests", "accepts", true],
    ["deprecations:code", "refuses", false],
  ])("under %s it %s the same honest edit to a test file's own calls", async (workflow, _verb, lands) => {
    const idea: ScriptedIdea = {
      file: FILES.receiptTest,
      title: TITLES.receiptTest,
      severity: "low",
      workflow,
      check: { kind: "pattern-absent", pattern: "legacy-dates", paths: ["src/receipt.test.js"] },
      body: RECEIPT_TEST_BODY,
    };
    const { repo, ledger } = await ranDeprecations(1, ideasScript([idea]));
    const item = ledger.get(`backlog:${FILES.receiptTest}`);
    if (lands) {
      expect(item?.lastClass).toBe("delivered");
      expect(git(repo, ["show", "delivery/main:src/receipt.test.js"])).toContain('from "../lib/dates.js"');
    } else {
      expect(item?.lastClass).not.toBeNull(); // it ran: an item never dispatched would also be "not delivered"
      expect(item?.lastClass).not.toBe("delivered");
      expect(item?.lastClass).not.toBe("held");
      const record = (await allRuns(repo)).find((r) => r.runId === item?.lastRunId);
      expect(record?.caseFile.history.some((e) => e.t === "gate" && e.newFailures.some((f) => f.id === EDIT_GUARD))).toBe(true);
      expect(git(repo, ["show", "delivery/main:src/receipt.test.js"])).toContain("legacy-dates");
    }
  }, RUN_TIMEOUT * 4);
});
