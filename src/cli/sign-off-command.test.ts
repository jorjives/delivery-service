import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../git-env.js";
import { readLedger } from "../packs/ledger.js";
import { CHECKING_SIGN_OFF, NOT_LANDED_WHY } from "../packs/render.js";
import { exampleRepo, sampleFinding, writeReview } from "../packs/review-fixtures.js";
import { takeRepoLock } from "../repo-lock.js";
import type { MockScript } from "../mock-script.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { alreadyMerged, declinedLine, mergedLine, notMergedLine, notWaiting, SIGN_OFF_BUSY } from "./sign-off-command.js";

const NEGATIVE = sampleFinding();
const SECURITY = { name: "security", title: "Security review", hold: "high" as const, consequenceLabel: "what-could-happen" as const };
const FIXES_CHECKOUT = {
  when: { promptContains: NEGATIVE.id },
  effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }],
  json: { status: "completed", rationale: "a total never goes below zero" },
};
const env = async (script: MockScript) => ({ [TEST_MOCK_SCRIPT]: await scriptFile(script) });
const git = (repo: string, args: string[]): string => execFileSync("git", args, { cwd: repo, env: cleanGitEnv(), encoding: "utf-8" }).trim();
const commit = (repo: string, files: Record<string, string>, message: string): void => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message]);
};
const branchOf = (repo: string): string => git(repo, ["branch", "--list", "surface/*", "--format=%(refname:short)"]);

/** A security review whose one high problem was fixed and is waiting for sign-off. */
async function waiting(): Promise<{ repo: string; dir: string }> {
  const repo = exampleRepo("sign-off-");
  const dir = await writeReview(repo, { reviewId: "security-20261006T101500Z", findings: [NEGATIVE], pack: SECURITY });
  await delivery(["findings", "approve", "1"], { cwd: repo });
  const { stdout } = await delivery(["fix"], { cwd: repo, env: await env({ expectations: [FIXES_CHECKOUT] }) });
  expect(stdout).toContain("(high): waiting for your sign-off");
  return { repo, dir };
}

describe("delivery findings sign-off", () => {
  it(
    "checks the fix on the current main copy and merges it, after another change has landed there",
    async () => {
      const { repo, dir } = await waiting();
      commit(repo, { "settings.js": `${readFileSync(join(repo, "settings.js"), "utf-8")}// reviewed\n` }, "Another change lands first");

      const { exitCode, stdout } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toBe(`${CHECKING_SIGN_OFF}\n${mergedLine(1, "fixed and merged")}\n`);
      expect(readFileSync(join(repo, "checkout.js"), "utf-8")).toContain("Math.max(0, price - discount)");
      expect(readFileSync(join(repo, "settings.js"), "utf-8")).toContain("// reviewed");
      expect(branchOf(repo)).toBe("");
      expect((await readLedger(dir)).map((entry) => entry.t).slice(-2)).toEqual(["signed_off", "landed"]);
      expect((await delivery(["findings"], { cwd: repo })).stdout).toContain("(high): fixed and merged");
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "changes nothing when run again after the fix was merged",
    async () => {
      const { repo, dir } = await waiting();
      await delivery(["findings", "sign-off", "1"], { cwd: repo });
      const head = git(repo, ["rev-parse", "HEAD"]);
      const entries = (await readLedger(dir)).length;
      const { exitCode, stdout } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toBe(`${alreadyMerged(1)}\n`);
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
      expect((await readLedger(dir)).length).toBe(entries);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "merges nothing and keeps the branch when the main copy changed the same lines",
    async () => {
      const { repo } = await waiting();
      const branch = branchOf(repo);
      commit(repo, { "checkout.js": readFileSync(join(repo, "checkout.js"), "utf-8").replace("return price - discount;", "return price - discount; // agreed with finance") }, "Change the same line");
      const head = git(repo, ["rev-parse", "HEAD"]);

      const { exitCode, stdout } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain(notMergedLine(1, "conflict", branch));
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
      expect(branchOf(repo)).toBe(branch);
      expect((await delivery(["findings"], { cwd: repo })).stdout).toContain(`(high): signed off but could not be merged\n    Why: ${NOT_LANDED_WHY.conflict}.`);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "merges nothing when the fix no longer passes its check on the current main copy",
    async () => {
      const { repo } = await waiting();
      const branch = branchOf(repo);
      commit(
        repo,
        { "refund.test.js": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { total } from "./checkout.js";\n\ntest("a discount bigger than the price is a refund", () => {\n  assert.equal(total(5, 10), -5);\n});\n' },
        "Rely on negative totals",
      );
      const head = git(repo, ["rev-parse", "HEAD"]);

      const { exitCode, stdout } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain(notMergedLine(1, "check_failed", branch));
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
      expect(branchOf(repo)).toBe(branch);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "waits for nothing and changes nothing while fixes are being made",
    async () => {
      const { repo } = await waiting();
      const release = await takeRepoLock(repo);
      try {
        const { exitCode, stderr } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
        expect(exitCode).toBe(EXIT.configuration);
        expect(stderr).toBe(`${SIGN_OFF_BUSY}\n`);
      } finally {
        await release?.();
      }
    },
    RUN_TIMEOUT,
  );

  it(
    "never reads a kept branch deleted after a failed sign-off as merged",
    async () => {
      const { repo } = await waiting();
      const branch = branchOf(repo);
      commit(repo, { "checkout.js": readFileSync(join(repo, "checkout.js"), "utf-8").replace("return price - discount;", "return price - discount; // agreed with finance") }, "Change the same line");
      await delivery(["findings", "sign-off", "1"], { cwd: repo });
      git(repo, ["branch", "-D", branch]);
      const head = git(repo, ["rev-parse", "HEAD"]);

      const { exitCode, stdout } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain(notMergedLine(1, "branch_gone", branch));
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
    },
    RUN_TIMEOUT * 2,
  );

  it("refuses a problem that is not waiting for sign-off", async () => {
    const repo = exampleRepo("sign-off-");
    await writeReview(repo, { findings: [NEGATIVE] });
    const { exitCode, stderr } = await delivery(["findings", "sign-off", "1"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${notWaiting(1, "not yet decided")}\n`);
  });
});

describe("delivery findings reject", () => {
  it(
    "declines the fix, merges nothing and keeps the branch for an engineer",
    async () => {
      const { repo, dir } = await waiting();
      const branch = branchOf(repo);
      const head = git(repo, ["rev-parse", "HEAD"]);
      const { exitCode, stdout } = await delivery(["findings", "reject", "1"], { cwd: repo });
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toBe(`${declinedLine(1, branch)}\n`);
      expect(git(repo, ["rev-parse", "HEAD"])).toBe(head);
      expect(branchOf(repo)).toBe(branch);
      expect((await readLedger(dir)).at(-1)).toMatchObject({ t: "rejected", id: NEGATIVE.id });
      expect((await delivery(["findings"], { cwd: repo })).stdout).toContain("(high): declined at sign-off");
    },
    RUN_TIMEOUT * 2,
  );
});
