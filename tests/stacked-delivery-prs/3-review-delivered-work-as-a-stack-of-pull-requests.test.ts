// Slice 3: Review Delivered Work as a Stack of Pull Requests
// Source: docs/superpowers/specs/2026-10-19-stacked-delivery-prs-slices.md
// Recorded: 2026-10-22 against commit bffd77a
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's runDelivery over
// dist/cli/main.js), in a scratch project with a local bare origin and the open-pr closer with
// stack mode on. The real `gh` is swapped for the contributor-only stand-in (src/gh-stand-in.ts)
// first on PATH, so there is no network and no GitHub account. The agent is routed to the vendored
// scripted agent through the contributor-only test seam.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import { createGhStandIn } from "../../src/gh-stand-in.js";
import type { MockScript } from "../../src/mock-script.js";
import { addLocalOrigin, initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const brief = (priority: number, text: string): string => `---\nstatus: open\npriority: ${priority}\n---\n${text}\n`;
const ITEMS: Record<string, string> = {
  ".delivery/backlog/20261016T090000Z-say-hello.md": brief(1, "Add a function that says hello to a name."),
  ".delivery/backlog/20261016T090100Z-say-goodbye.md": brief(2, "Add a function that says goodbye."),
  ".delivery/backlog/20261016T090200Z-say-thanks.md": brief(3, "Add a function that says thanks."),
};
const STACK = { closer: { type: "open-pr", stack: true } };
const ROLLING = { closer: { type: "open-pr" } };

const writes = (sentence: string, file: string): MockScript["expectations"][number] => ({
  when: { promptContains: sentence },
  effects: [{ write: { path: file, content: `export const ${file.split(".")[0]} = 1;\n` } }],
  json: { status: "completed", rationale: sentence },
});
const script: MockScript = { expectations: [writes("says hello", "hello.js"), writes("says goodbye", "goodbye.js"), writes("says thanks", "thanks.js")] };

async function project(config: object, items: Record<string, string> = ITEMS) {
  const gh = createGhStandIn();
  const repo = initTempRepo("uat-stack-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config), ...items });
  const origin = addLocalOrigin(repo);
  git(repo, ["remote", "set-head", "origin", "main"]);
  const env = {
    ...process.env,
    PATH: `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`,
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-stack-state-")),
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
  };
  return { gh, repo, origin, env };
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l !== "");
const ownFiles = (repo: string, parent: string, head: string): string[] =>
  lines(git(repo, ["diff", "--name-only", `${parent}..${head}`])).filter((f) => !f.startsWith(".delivery/"));

describe("UAT: turn on stack mode and get one pull request per delivered item", () => {
  it("UAT: three items give three pull requests, bottom on the base and each on the one below, each with only its own changes, and status lists them bottom up", async () => {
    const { gh, repo, env } = await project(STACK);

    const run = runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env });
    expect(run.status).toBe(0);

    const prs = gh.pullRequests();
    expect(prs).toHaveLength(3);
    expect(prs[0]?.base).toBe("main");
    expect(prs[1]?.base).toBe(prs[0]?.head);
    expect(prs[2]?.base).toBe(prs[1]?.head);

    expect(ownFiles(repo, "main", prs[0]?.head ?? "")).toEqual(["hello.js"]);
    expect(ownFiles(repo, prs[0]?.head ?? "", prs[1]?.head ?? "")).toEqual(["goodbye.js"]);
    expect(ownFiles(repo, prs[1]?.head ?? "", prs[2]?.head ?? "")).toEqual(["thanks.js"]);

    // The description is the task text; every level above the bottom names the pull requests below it.
    expect(prs[0]?.body).toContain("says hello");
    expect(prs[1]?.body).toContain("says goodbye");
    expect(prs[1]?.body).toContain(prs[0]?.url ?? "no pull request");
    expect(prs[2]?.body).toContain(prs[0]?.url ?? "no pull request");
    expect(prs[2]?.body).toContain(prs[1]?.url ?? "no pull request");
    expect(prs[0]?.body).not.toContain("merge first");
    expect(prs.every((pr) => pr.title.trim() !== "")).toBe(true);

    const status = runDelivery(["status"], { cwd: repo, env }).stdout;
    const at = prs.map((pr) => status.indexOf(pr.url));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  }, 300_000);

  it("AC: running again changes nothing that is already correct", async () => {
    const { gh, repo, env } = await project(STACK);
    runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env });
    const before = gh.pullRequests();

    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);

    expect(gh.pullRequests()).toEqual(before);
  }, 300_000);

  it("AC: the report's versioned data carries a stack list with a level per pull request", async () => {
    const { gh, repo, env } = await project(STACK);
    runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env });

    const report = runDelivery(["report", "--json"], { cwd: repo, env });

    expect(report.status).toBe(0);
    expect(JSON.parse(report.stdout).delivery.stack).toHaveLength(gh.pullRequests().length);
  }, 300_000);

  it("AC: turning stack mode on while a rolling pull request is open fails at start, naming it", async () => {
    const { gh, repo, env } = await project(ROLLING);
    expect(runDelivery(["run", "--sources", "--max", "1"], { cwd: repo, env }).status).toBe(0);
    const [rolling] = gh.pullRequests();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(STACK));

    const refused = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain(rolling?.url ?? "no pull request");
    expect(gh.pullRequests()).toHaveLength(1);
  }, 300_000);

  it("AC: the stack setting is rejected on any other closer", async () => {
    const { repo, env } = await project({ closer: { type: "merge-back", stack: true } });

    const result = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/stack/);
  }, 300_000);

  it("AC: rolling mode behaves as before, with one delivery pull request and an empty stack list", async () => {
    const { gh, repo, env } = await project(ROLLING);

    expect(runDelivery(["run", "--sources", "--max", "3"], { cwd: repo, env }).status).toBe(0);

    expect(gh.pullRequests().map((pr) => [pr.head, pr.base])).toEqual([["delivery/main", "main"]]);
    expect(JSON.parse(runDelivery(["report", "--json"], { cwd: repo, env }).stdout).delivery.stack).toEqual([]);
  }, 300_000);
});

describe("AC: not recorded here", () => {
  it.skip("AC: an older git than the stack needs fails at start, naming the version (needs a git stand-in; covered by src/cli/stack-setup.test.ts)", () => {});
  it.skip("AC: a closing line when the item closes an issue (needs the gh stand-in's issue listing; covered by src/task-list.test.ts and src/open-pr-closer.test.ts)", () => {});
  it.skip("AC: running the closer again repairs anything missing (covered by src/stack-branch.test.ts and src/cli/sources-run-stack.test.ts)", () => {});
});
