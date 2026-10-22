// Slice 4: Merge the Bottom Pull Request and the Rest Follow
// Source: docs/superpowers/specs/2026-10-19-stacked-delivery-prs-slices.md
// Recorded: 2026-10-22 against commit 773579b
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's runDelivery over
// dist/cli/main.js), in a scratch project with a local bare origin and the open-pr closer with
// stack mode on. The real `gh` is swapped for the contributor-only stand-in (src/gh-stand-in.ts)
// first on PATH; the operator's "merge on GitHub" is the stand-in's `merge`. The agent is routed to
// the vendored scripted agent through the contributor-only test seam.

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
  const repo = initTempRepo("uat-merge-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config), ...items, ...extra });
  const origin = addLocalOrigin(repo);
  git(repo, ["remote", "set-head", "origin", "main"]);
  const env = {
    ...process.env,
    PATH: `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`,
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-merge-state-")),
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
  };
  return { gh, repo, origin, env };
}

/** A stack of three published, ready to be merged from the bottom. */
async function threeStack(config: object = STACK, extra: Record<string, string> = {}) {
  const p = await project(THREE, config, extra);
  expect(runDelivery(["run", "--sources", "--max", "3"], { cwd: p.repo, env: p.env }).status).toBe(0);
  expect(p.gh.pullRequests()).toHaveLength(3);
  return p;
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const levelsIn = (status: string): string[] => lines(status).filter((l) => /- \d+\. /.test(l));

/** The repository owner lands a commit on the base directly, as someone else would on GitHub. */
function ownerPushes(origin: string, file: string, text: string): void {
  const clone = mkdtempSync(join(tmpdir(), "uat-merge-owner-"));
  try {
    git(tmpdir(), ["clone", "-q", origin, clone]);
    git(clone, ["config", "user.name", "Owner"]);
    git(clone, ["config", "user.email", "owner@example.invalid"]);
    writeFileSync(join(clone, file), text);
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", `owner: ${file}`]);
    git(clone, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

describe("UAT: merge the bottom pull request and the rest follow", () => {
  it("UAT: after a squash merge of the bottom, the second targets the base with only its own changes, the third still targets the second, a fourth opens on top, and status lists three levels with no block", async () => {
    const { gh, repo, origin, env } = await project(FOUR);
    expect(runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env }).status).toBe(0);
    const [first] = gh.pullRequests();
    gh.merge(first?.url ?? "", "squash", origin);

    const run = runDelivery(["run", "--sources", "--max", "1"], { cwd: repo, env });
    expect(run.status).toBe(0);

    const [, pr2, pr3, pr4] = gh.pullRequests();
    expect(pr2?.base).toBe("main");
    expect(pr3?.base).toBe(pr2?.head);
    expect(pr4?.base).toBe(pr3?.head);
    expect(lines(git(origin, ["diff", "--name-only", `main..${pr2?.head ?? ""}`])).filter((f) => !f.startsWith(".delivery/"))).toEqual(["goodbye.js"]);

    const status = runDelivery(["status"], { cwd: repo, env }).stdout;
    expect(levelsIn(status).map((l) => /goodbye|thanks|farewell/.exec(l)?.[0])).toEqual(["goodbye", "thanks", "farewell"]);
    expect(status).not.toContain("Blocked");
  }, 600_000);

  for (const method of ["squash", "rebase", "merge"] as const) {
    it(`AC: a ${method} merge of the bottom is recognised, the rest are moved and the bottom remaining is retargeted to the base`, async () => {
      const { gh, repo, origin, env } = await threeStack();
      const [first] = gh.pullRequests();
      gh.merge(first?.url ?? "", method, origin);

      expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);

      const [, pr2, pr3] = gh.pullRequests();
      expect(pr2?.base).toBe("main");
      expect(pr3?.base).toBe(pr2?.head);
      expect(lines(git(origin, ["diff", "--name-only", `main..${pr2?.head ?? ""}`])).filter((f) => !f.startsWith(".delivery/"))).toEqual(["goodbye.js"]);
      expect(levelsIn(runDelivery(["status"], { cwd: repo, env }).stdout)).toHaveLength(2);
    }, 600_000);
  }

  it("AC: when every level has merged the stack is empty", async () => {
    const { gh, repo, origin, env } = await threeStack();
    for (const pr of gh.pullRequests()) {
      gh.merge(pr.url, "squash", origin);
      expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    }

    expect(JSON.parse(runDelivery(["report", "--json"], { cwd: repo, env }).stdout).delivery.stack).toEqual([]);
  }, 600_000);

  it("AC: new commits on the base with nothing merged cause no rewrite", async () => {
    const { gh, repo, origin, env } = await threeStack();
    ownerPushes(origin, "owner.txt", "owner\n");
    const before = gh.pullRequests();
    const refs = git(origin, ["for-each-ref", "refs/heads/"]);

    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);

    expect(gh.pullRequests()).toEqual(before);
    expect(git(origin, ["for-each-ref", "refs/heads/"])).toBe(refs);
  }, 600_000);

  it("AC: a level that fails its check after a merge changes nothing, starts no task, and the block shows in status and the report", async () => {
    const strict = 'echo "1..2"\necho "ok 1 - base"\nif [ -f strict.txt ] && [ -f thanks.js ]; then echo "not ok 2 - thanks"; else echo "ok 2 - thanks"; fi\n';
    const config = { ...STACK, gate: { type: "command", command: "sh check.sh", parseMode: "tap" } };
    const { gh, repo, origin, env } = await threeStack(config, { "check.sh": strict });
    gh.merge(gh.pullRequests()[0]?.url ?? "", "squash", origin);
    ownerPushes(origin, "strict.txt", "strict\n");
    const bases = gh.pullRequests().map((pr) => pr.base);
    const refs = git(origin, ["for-each-ref", "refs/heads/"]);

    const run = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(run.status).not.toBe(0);
    expect(gh.pullRequests().map((pr) => pr.base)).toEqual(bases);
    expect(git(origin, ["for-each-ref", "refs/heads/"])).toBe(refs);
    expect(runDelivery(["status"], { cwd: repo, env }).stdout).toMatch(/Blocked, .*level 3/);
    expect(JSON.parse(runDelivery(["report", "--json"], { cwd: repo, env }).stdout).delivery.blocked.reason).toContain("level 3");
  }, 600_000);

  it("AC: if GitHub cannot be asked, the stack is left alone and the run stops with a message about access", async () => {
    const { gh, repo, origin, env } = await threeStack();
    gh.merge(gh.pullRequests()[0]?.url ?? "", "squash", origin);
    const before = gh.pullRequests();
    gh.setMode("signed-out");

    const run = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(run.status).not.toBe(0);
    expect(run.stdout + run.stderr).toMatch(/gh auth login|sign|access/i);
    expect(gh.pullRequests()).toEqual(before);
  }, 600_000);
});

describe("AC: not recorded here", () => {
  it.skip("AC: a level that edits lines introduced by a squash-merged level moves cleanly (covered by src/stack-branch.test.ts)", () => {});
  it.skip("AC: a merged level already in the base's history is only retargeted, no rewrite (covered by src/stack-branch.test.ts and src/cli/sources-run-stack.test.ts)", () => {});
  it.skip("AC: a merge into a pull request still open below it is reported blocked until the one below merges (covered by src/stack-plan.test.ts)", () => {});
  it.skip("AC: a blocked stack does not repeat the same attempt until something changes (covered by src/cli/sources-run-stack.test.ts)", () => {});
  it.skip("AC: merged items no longer count as awaiting merge and the rest are updated to their new commits (covered by src/cli/sources-run-stack.test.ts)", () => {});
  it.skip("AC: a restack interrupted before being recorded is simply done again (covered by src/cli/sources-run-stack.test.ts)", () => {});
});
