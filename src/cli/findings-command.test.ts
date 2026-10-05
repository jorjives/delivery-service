import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { appendLedger, readLedger } from "../packs/ledger.js";
import { NO_REVIEW_YET, unfinishedReview } from "../packs/render.js";
import { sampleFinding, writeReview } from "../packs/review-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { withoutAt } from "../without-at.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { alreadyTakenOn, approvedLine, noSuchProblem, skippedLine, testsOnlyApproved, NOTHING_CHOSEN } from "./findings-command.js";

const repo = () => initTempRepo("findings-", { "a.js": "x\n" });
const TWO = [sampleFinding(), sampleFinding({ id: "111111111111", title: "Old payment code", severity: "low", check: { kind: "none" } })];

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
