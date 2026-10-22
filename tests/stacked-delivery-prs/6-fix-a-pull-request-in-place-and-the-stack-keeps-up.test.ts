// Slice 6: Fix a Pull Request in Place and the Stack Keeps Up
// Source: docs/superpowers/specs/2026-10-19-stacked-delivery-prs-slices.md
// Recorded: 2026-10-22 against commit 9119c7f
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's runDelivery over
// dist/cli/main.js), in a scratch project with a local bare origin and the open-pr closer with
// stack mode on. The real `gh` is swapped for the contributor-only stand-in (src/gh-stand-in.ts)
// first on PATH. The operator's "push a fix to the pull request's branch" is a commit pushed to
// origin from a separate clone. The agent is routed to the vendored scripted agent through the
// contributor-only test seam.

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import { createGhStandIn } from "../../src/gh-stand-in.js";
import type { MockScript } from "../../src/mock-script.js";
import { addLocalOrigin, initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const brief = (priority: number, text: string): string => `---\nstatus: open\npriority: ${priority}\n---\n${text}\n`;
const THREE: Record<string, string> = {
  ".delivery/backlog/20261016T090000Z-say-hello.md": brief(1, "Add a function that says hello to a name."),
  ".delivery/backlog/20261016T090100Z-say-goodbye.md": brief(2, "Add a function that says goodbye."),
  ".delivery/backlog/20261016T090200Z-say-thanks.md": brief(3, "Add a function that says thanks."),
};
const FOUR: Record<string, string> = { ...THREE, ".delivery/backlog/20261016T090300Z-say-farewell.md": brief(4, "Add a function that says farewell.") };
const STACK = { closer: { type: "open-pr", stack: true } };

const writes = (sentence: string, file: string): MockScript["expectations"][number] => ({
  when: { promptContains: sentence },
  effects: [{ write: { path: file, content: `export const ${file.split(".")[0]} = 1;\n` } }],
  json: { status: "completed", rationale: sentence },
});
const script: MockScript = {
  expectations: [writes("says hello", "hello.js"), writes("says goodbye", "goodbye.js"), writes("says thanks", "thanks.js"), writes("says farewell", "farewell.js")],
};

async function project(items: Record<string, string>, config: object = STACK, extra: Record<string, string> = {}) {
  const gh = createGhStandIn();
  const repo = initTempRepo("uat-fix-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config), ...items, ...extra });
  const origin = addLocalOrigin(repo);
  git(repo, ["remote", "set-head", "origin", "main"]);
  const env = {
    ...process.env,
    PATH: `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`,
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-fix-state-")),
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
  };
  return { gh, repo, origin, env };
}

/** A stack of three published. */
async function threeStack(config: object = STACK, extra: Record<string, string> = {}) {
  const p = await project(THREE, config, extra);
  expect(runDelivery(["run", "--sources", "--max", "3"], { cwd: p.repo, env: p.env }).status).toBe(0);
  expect(p.gh.pullRequests()).toHaveLength(3);
  return p;
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const levelsIn = (status: string): string[] => lines(status).filter((l) => /- \d+\. /.test(l));
const ownFiles = (origin: string, parent: string, head: string): string[] =>
  lines(git(origin, ["diff", "--name-only", `${parent}..${head}`])).filter((f) => !f.startsWith(".delivery/"));

/** Work in a separate clone of origin, as the operator would on their own machine. */
function inClone<T>(origin: string, body: (clone: string) => T): T {
  const clone = mkdtempSync(join(tmpdir(), "uat-fix-owner-"));
  try {
    git(tmpdir(), ["clone", "-q", origin, clone]);
    git(clone, ["config", "user.name", "Owner"]);
    git(clone, ["config", "user.email", "owner@example.invalid"]);
    return body(clone);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

/** The operator pushes a small fix commit on top of a pull request's branch. */
function pushFix(origin: string, branch: string, file: string, text: string): void {
  inClone(origin, (clone) => {
    git(clone, ["checkout", "-q", "-B", "fix", `origin/${branch}`]);
    writeFileSync(join(clone, file), text);
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", `fix: ${file}`]);
    git(clone, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
  });
}

/** The operator rewrites a pull request's branch so it no longer holds what was published. */
function forcePushRewrite(origin: string, branch: string): void {
  inClone(origin, (clone) => {
    git(clone, ["checkout", "-q", "-B", "rewrite", `origin/${branch}~1`]);
    writeFileSync(join(clone, "rewritten.txt"), "rewritten\n");
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", "rewrite"]);
    git(clone, ["push", "-q", "--force", "origin", `HEAD:refs/heads/${branch}`]);
  });
}

describe("UAT: fix a pull request in place and the stack keeps up", () => {
  it("UAT: a fix pushed to the second pull request is kept, the third builds on it with only its own changes, and status shows three levels and no block", async () => {
    const { gh, repo, origin, env } = await threeStack();
    const [, second] = gh.pullRequests();
    pushFix(origin, second?.head ?? "", "fix.txt", "fix\n");

    const run = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(run.status).toBe(0);

    const [pr1, pr2, pr3] = gh.pullRequests();
    expect(pr2?.head).toBe(second?.head);
    expect(ownFiles(origin, pr1?.head ?? "", pr2?.head ?? "").sort()).toEqual(["fix.txt", "goodbye.js"]);
    expect(pr3?.base).toBe(pr2?.head);
    expect(ownFiles(origin, pr2?.head ?? "", pr3?.head ?? "")).toEqual(["thanks.js"]);
    expect(lines(git(origin, ["ls-tree", "-r", "--name-only", pr3?.head ?? ""]))).toContain("fix.txt");

    const status = runDelivery(["status"], { cwd: repo, env }).stdout;
    expect(levelsIn(status)).toHaveLength(3);
    expect(status).not.toContain("Blocked");
  }, 600_000);

  it("AC: the operator's fix survives every later publish, including a new level opened on top", async () => {
    const { gh, repo, origin, env } = await project(FOUR);
    expect(runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env }).status).toBe(0);
    const [, second] = gh.pullRequests();
    pushFix(origin, second?.head ?? "", "fix.txt", "fix\n");

    expect(runDelivery(["run", "--sources", "--max", "1"], { cwd: repo, env }).status).toBe(0);
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);

    const prs = gh.pullRequests();
    expect(prs).toHaveLength(4);
    expect(lines(git(origin, ["ls-tree", "-r", "--name-only", prs[1]?.head ?? ""]))).toContain("fix.txt");
    expect(lines(git(origin, ["ls-tree", "-r", "--name-only", prs[3]?.head ?? ""]))).toContain("fix.txt");
    expect(levelsIn(runDelivery(["status"], { cwd: repo, env }).stdout)).toHaveLength(4);
  }, 600_000);

  it("AC: adopted content that fails its check blocks the stack, naming the level and its pull request", async () => {
    const strict = 'echo "1..2"\necho "ok 1 - base"\nif [ -f bad.txt ]; then echo "not ok 2 - bad"; else echo "ok 2 - bad"; fi\n';
    const config = { ...STACK, gate: { type: "command", command: "sh check.sh", parseMode: "tap" } };
    const { gh, repo, origin, env } = await threeStack(config, { "check.sh": strict });
    const [, second] = gh.pullRequests();
    pushFix(origin, second?.head ?? "", "bad.txt", "bad\n");

    const run = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(run.status).not.toBe(0);
    const status = runDelivery(["status"], { cwd: repo, env }).stdout;
    expect(status).toMatch(/Blocked, .*level 2/);
    expect(status + run.stdout + run.stderr).toContain(second?.url ?? "no pull request");
  }, 600_000);

  it("AC: a rewritten branch blocks the stack, naming the pull request, and nothing is overwritten", async () => {
    const { gh, repo, origin, env } = await threeStack();
    const [, second] = gh.pullRequests();
    forcePushRewrite(origin, second?.head ?? "");
    const refs = git(origin, ["for-each-ref", "refs/heads/"]);
    const before = gh.pullRequests();

    const run = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(run.status).not.toBe(0);
    expect(run.stdout + run.stderr + runDelivery(["status"], { cwd: repo, env }).stdout).toContain(second?.url ?? "no pull request");
    expect(git(origin, ["for-each-ref", "refs/heads/"])).toBe(refs);
    expect(gh.pullRequests()).toEqual(before);
  }, 600_000);
});

describe("AC: not recorded here", () => {
  it.skip("AC: publishing never overwrites a commit pushed while the branch moved mid-publish (needs a push landing inside a run; covered by src/stack-pr-closer.test.ts)", () => {});
  it.skip("AC: an adopted level below a merged one, and a dropped level above a merged prefix, resolve in the order drop, adopt, move, merged prefix (covered by src/delivery-stack.test.ts and src/stack-branch.test.ts)", () => {});
});
