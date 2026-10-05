import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_REVIEW_YET, unfinishedReview } from "../packs/render.js";
import { sampleFinding, writeReview } from "../packs/review-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { noSuchProblem } from "./findings-command.js";

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
});
