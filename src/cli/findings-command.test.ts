import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appendLedger, readLedger } from "../packs/ledger.js";
import { CHANGES_NOTE, CHANGES_WHICH, NO_REVIEW_YET, noKeptFix, unfinishedReview } from "../packs/render.js";
import { exampleRepo, sampleFinding, writeReview, writeFixPhase, FIX_PHASE_FINDINGS } from "../packs/review-fixtures.js";
import { FindingsDocument } from "../packs/findings-document.js";
import { initTempRepo } from "../temp-repo.js";
import { withoutAt } from "../without-at.js";
import { delivery, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { alreadyTakenOn, approvedLine, noSuchProblem, skippedLine, testsOnlyApproved, NOTHING_CHOSEN, SCHEMA_ALONE } from "./findings-command.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import type { MockScript } from "../mock-script.js";

const repo = () => initTempRepo("findings-", { "a.js": "x\n" });
const TWO = [sampleFinding(), sampleFinding({ id: "111111111111", title: "Old payment code", severity: "low", check: { kind: "none" } })];
const NEGATIVE = sampleFinding();
const SECURITY = { name: "security", title: "Security review", hold: "high" as const, consequenceLabel: "what-could-happen" as const };
const FIXES_CHECKOUT = {
  when: { promptContains: NEGATIVE.id },
  effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }],
  json: { status: "completed", rationale: "a total never goes below zero" },
};
const env = async (script: MockScript) => ({ [TEST_MOCK_SCRIPT]: await scriptFile(script) });

describe("delivery findings", () => {
  it("says there is no review yet and how to start one", async () => {
    const { exitCode, stdout } = await delivery(["findings"], { cwd: repo() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${NO_REVIEW_YET}\n`);
  });

  it("lists the latest review's problems, how serious each is, and that none is decided yet", async () => {
    const project = repo();
    await writeReview(project, { findings: TWO, unconfirmed: [{ title: "Rounding", severity: "medium", path: "p.js", problem: "x", reason: "no_such_file" }] });
    const { stdout } = await delivery(["findings"], { cwd: project });
    expect(stdout).toContain("1. The price shown at checkout can be negative (high): not yet decided\n2. Old payment code (low): not yet decided\n");
    expect(stdout).toContain("1 more could not be confirmed");
  });

  it("shows one problem in full with the block for engineers", async () => {
    const project = repo();
    await writeReview(project, { findings: TWO });
    const { exitCode, stdout } = await delivery(["findings", "1"], { cwd: project });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("1. The price shown at checkout can be negative (high)\n    Where: checkout.js, line 3\n");
    expect(stdout).toContain("FOR ENGINEERS\n  Category: correctness (Wrong results)\n  File: checkout.js, line 3\n  Check: anchor-gone");
  });

  it("refuses a number the review does not have, saying how many it has", async () => {
    const project = repo();
    await writeReview(project, { findings: TWO });
    const { exitCode, stderr } = await delivery(["findings", "9"], { cwd: project });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${noSuchProblem("9", 2)}\n`);
  });

  it("lists what could not be confirmed, with why", async () => {
    const project = repo();
    await writeReview(project, { unconfirmed: [{ title: "Rounding", severity: "medium", path: "p.js", problem: "Rounds down.", reason: "no_such_file" }] });
    const { stdout } = await delivery(["findings", "--unconfirmed"], { cwd: project });
    expect(stdout).toContain("    Why it is not offered: that file is not in your last commit.\n");
  });

  it("says a review stopped before it was saved should be run again to finish", async () => {
    const project = repo();
    await writeReview(project, { finished: false });
    const { stdout } = await delivery(["findings"], { cwd: project });
    expect(stdout).toBe(`${unfinishedReview("code")}\n`);
  });

  it("names a damaged review record and offers a fresh review, with no stack trace", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: TWO });
    writeFileSync(join(dir, "review.json"), "{ torn");
    const { exitCode, stderr } = await delivery(["findings"], { cwd: project });
    expect(exitCode).toBe(EXIT.unexpected);
    expect(stderr).toContain(join(dir, "review.json"));
    expect(stderr).toContain("delivery review code");
    expect(stderr).not.toMatch(/^\s+at /m);
  });

  it("shows the owner's choices recorded for the latest review", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: TWO });
    await appendLedger(dir, { t: "decision", ids: [TWO[1]?.id ?? ""], choice: "skip" });
    const { stdout } = await delivery(["findings"], { cwd: project });
    expect(stdout).toContain("1. The price shown at checkout can be negative (high): not yet decided\n2. Old payment code (low): skipped by you\n");
  });
});

describe("choosing which problems to fix", () => {
  const THREE = [...TWO, sampleFinding({ id: "222222222222", title: "Settings errors are unhelpful", severity: "medium" })];

  it("records approvals and skips for exactly the problems named, and the latest choice wins", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: THREE });
    const approved = await delivery(["findings", "approve", "1", "3"], { cwd: project });
    await delivery(["findings", "skip", "3"], { cwd: project });

    expect(approved.exitCode).toBe(EXIT.ok);
    expect(approved.stdout).toContain(approvedLine([1, 3]));
    expect(withoutAt(await readLedger(dir))).toEqual([
      { t: "decision", ids: [THREE[0]?.id, THREE[2]?.id], choice: "approve" },
      { t: "decision", ids: [THREE[2]?.id], choice: "skip" },
    ]);
    const { stdout } = await delivery(["findings"], { cwd: project });
    expect(stdout).toContain("1. The price shown at checkout can be negative (high): being fixed\n2. Old payment code (low): not yet decided\n3. Settings errors are unhelpful (medium): skipped by you\n");
  });

  it("approves every problem listed now with --all, naming each so a later review cannot widen it", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: THREE });
    await delivery(["findings", "approve", "--all"], { cwd: project });
    expect(withoutAt(await readLedger(dir))).toEqual([{ t: "decision", ids: THREE.map((f) => f.id), choice: "approve" }]);
  });

  it("says once that a tests-only problem can be proved fixed only by the existing tests", async () => {
    const project = repo();
    await writeReview(project, { findings: THREE });
    const { stdout } = await delivery(["findings", "approve", "1", "2"], { cwd: project });
    expect(stdout.split("\n").filter((line) => line === testsOnlyApproved(2))).toHaveLength(1);
    expect(stdout).not.toContain(testsOnlyApproved(1));
  });

  it("records nothing when any number is not in the list", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: THREE });
    const { exitCode, stderr } = await delivery(["findings", "approve", "1", "9"], { cwd: project });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${noSuchProblem("9", 3)}\n`);
    expect(await readLedger(dir)).toEqual([]);
  });

  it("asks which problems when none is named", async () => {
    const project = repo();
    await writeReview(project, { findings: THREE });
    expect((await delivery(["findings", "skip"], { cwd: project })).stderr).toBe(`${NOTHING_CHOSEN}\n`);
  });

  it("will not change the choice for a problem already being fixed", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: THREE });
    await appendLedger(dir, { t: "authorise", ids: [THREE[0]?.id ?? ""], verify: { type: "command", command: "npm test", parseMode: "exitcode" } });
    const { exitCode, stderr } = await delivery(["findings", "skip", "1"], { cwd: project });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${alreadyTakenOn(1)}\n`);
  });

  it("acts on the repository named with --repo", async () => {
    const project = repo();
    const dir = await writeReview(project, { findings: THREE });
    await delivery(["findings", "skip", "2", "--repo", project], { cwd: tmpdir() });
    expect(withoutAt(await readLedger(dir))).toEqual([{ t: "decision", ids: [THREE[1]?.id], choice: "skip" }]);
  });

  it("says there is no review yet, and how to start one", async () => {
    const { exitCode, stderr } = await delivery(["findings", "approve", "1"], { cwd: repo() });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NO_REVIEW_YET}\n`);
  });

  it("says each choice in the owner's words", () => {
    expect(approvedLine([1, 3, 4])).toBe("Approved 1, 3 and 4. Start fixing with: delivery fix");
    expect(skippedLine([2])).toBe("Skipped 2: nothing will be done about it.");
  });
});

describe("delivery findings <n> --changes", () => {
  it(
    "shows a kept fix's changed files and the change, after saying it cannot say the change is safe",
    async () => {
      const repo = exampleRepo("findings-changes-");
      await writeReview(repo, { reviewId: "security-20261006T101500Z", findings: [NEGATIVE], pack: SECURITY });
      await delivery(["findings", "approve", "1"], { cwd: repo });
      await delivery(["fix"], { cwd: repo, env: await env({ expectations: [FIXES_CHECKOUT] }) });

      const { exitCode, stdout } = await delivery(["findings", "1", "--changes"], { cwd: repo });
      expect(exitCode).toBe(EXIT.ok);
      const lines = stdout.split("\n");
      expect(lines[0]).toBe(CHANGES_NOTE);
      expect(stdout).toMatch(/checkout\.js \| 2 \+-/);
      expect(stdout).toContain("-  return price - discount;");
      expect(stdout).toContain("+  return Math.max(0, price - discount);");
    },
    RUN_TIMEOUT,
  );

  it("refuses for a problem with no kept fix, saying where it stands", async () => {
    const repo = exampleRepo("findings-changes-");
    await writeReview(repo, { findings: [NEGATIVE] });
    const { exitCode, stderr } = await delivery(["findings", "1", "--changes"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${noKeptFix(1, "not yet decided")}\n`);
  });

  it("asks which problem when none is named", async () => {
    const repo = exampleRepo("findings-changes-");
    await writeReview(repo, { findings: [NEGATIVE] });
    const { exitCode, stderr } = await delivery(["findings", "--changes"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${CHANGES_WHICH}\n`);
  });
});

describe("delivery findings as data", () => {
  it("prints one versioned document with every problem, its state, its check and its fix's run", async () => {
    const project = exampleRepo("findings-json-");
    await writeFixPhase(project);

    const { exitCode, stdout } = await delivery(["findings", "--json"], { cwd: project });
    const doc = FindingsDocument.parse(JSON.parse(stdout));

    expect(doc.schema).toBe("delivery.findings/1");
    expect(doc.problems.map((problem) => problem.state)).toEqual(["held", "fixed", "fixed", "unfixable", "stopped", "skipped"]);
    expect(doc.problems[2]?.check).toEqual({ kind: "none", level: "tests only: no check of this specific problem" });
    expect(doc.problems[0]?.fix?.run).toBe("fix-1-20261005T110000Z");
    expect(doc.problems[5]?.fix).toBeNull();
    expect(doc.problems.map((problem) => problem.id)).toEqual(FIX_PHASE_FINDINGS.map((finding) => finding.id));
    expect(exitCode).toBe(0);
  });

  it("prints its JSON Schema anywhere, needing no project", async () => {
    const nowhere = mkdtempSync(join(tmpdir(), "findings-schema-"));

    const { exitCode, stdout } = await delivery(["findings", "--schema"], { cwd: nowhere });

    expect(Object.keys(JSON.parse(stdout))).toEqual(["delivery.findings/1"]);
    expect(exitCode).toBe(0);
  });

  it("refuses --schema with anything it would otherwise show", async () => {
    const { exitCode, stderr } = await delivery(["findings", "1", "--schema"], { cwd: repo() });
    expect(stderr).toContain(SCHEMA_ALONE);
    expect(exitCode).toBe(EXIT.configuration);
  });
});
