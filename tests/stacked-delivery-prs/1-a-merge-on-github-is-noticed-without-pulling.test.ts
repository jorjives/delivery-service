// Slice 1: A Merge on GitHub Is Noticed Without Pulling
// Source: docs/superpowers/specs/2026-10-19-stacked-delivery-prs-slices.md
// Recorded: 2026-10-21 against commit 563f8e4
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's runDelivery over
// dist/cli/main.js), in a scratch project with a local bare origin and the open-pr closer. The
// real `gh` is swapped for the contributor-only stand-in (src/gh-stand-in.ts) first on PATH, so
// there is no network and no GitHub account; "merging on GitHub" is done in a separate clone of
// origin plus the stand-in's mergePullRequest, leaving the project's own checkout untouched.
// The agent is routed to the vendored scripted agent through the contributor-only test seam.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import { createGhStandIn } from "../../src/gh-stand-in.js";
import type { MockScript } from "../../src/mock-script.js";
import { addLocalOrigin, initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const FIRST = ".delivery/backlog/20261016T090000Z-say-hello.md";
const SECOND = ".delivery/backlog/20261016T090100Z-say-goodbye.md";
const brief = (priority: number, text: string): string => `---\nstatus: open\npriority: ${priority}\n---\n${text}\n`;

const script: MockScript = {
  expectations: [
    { when: { promptContains: "says hello" }, effects: [{ write: { path: "hello.js", content: "export const hello = 1;\n" } }], json: { status: "completed", rationale: "hello" } },
    { when: { promptContains: "says goodbye" }, effects: [{ write: { path: "goodbye.js", content: "export const goodbye = 1;\n" } }], json: { status: "completed", rationale: "goodbye" } },
  ],
};

/** Merge the delivery pull request "on GitHub": in a clone of origin, then push origin's main. Returns the delivery head at merge time. */
function mergeOnGitHub(origin: string, extra: Record<string, string> = {}): string {
  const head = git(origin, ["rev-parse", "delivery/main"]);
  const clone = join(mkdtempSync(join(tmpdir(), "uat-github-")), "clone");
  git(tmpdir(), ["clone", "-q", origin, clone]);
  git(clone, ["config", "user.email", "owner@example.invalid"]);
  git(clone, ["config", "user.name", "Owner"]);
  git(clone, ["merge", "-q", "--no-ff", "-m", "Merge pull request #1", "origin/delivery/main"]);
  for (const [path, content] of Object.entries(extra)) {
    mkdirSync(dirname(join(clone, path)), { recursive: true });
    writeFileSync(join(clone, path), content);
  }
  if (Object.keys(extra).length > 0) {
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", "the owner's next item"]);
  }
  git(clone, ["push", "-q", "origin", "main"]);
  return head;
}

async function project(config: object, files: Record<string, string> = {}) {
  const gh = createGhStandIn();
  const repo = initTempRepo("uat-stacked-", {
    "package.json": PACKAGE,
    [FIRST]: brief(1, "Add a function that says hello to a name."),
    "delivery.config.json": JSON.stringify(config),
    ...files,
  });
  const origin = addLocalOrigin(repo);
  git(repo, ["remote", "set-head", "origin", "main"]);
  const env = {
    ...process.env,
    PATH: `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`,
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-stacked-state-")),
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
  };
  return { gh, repo, origin, env };
}

describe("UAT: a merge on GitHub is noticed without pulling", () => {
  it("UAT: after the pull request is merged on GitHub, the next run starts again from the base, status no longer lists the merged item, and a new item opens a fresh pull request", async () => {
    const { gh, repo, origin, env } = await project({ closer: { type: "open-pr" } });
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    const [first] = gh.pullRequests();
    expect(first).toMatchObject({ head: "delivery/main", base: "main", state: "OPEN" });
    const localMain = git(repo, ["rev-parse", "main"]);
    expect(runDelivery(["status"], { cwd: repo, env }).stdout).toContain("say-hello");

    gh.mergePullRequest(first?.url ?? "", mergeOnGitHub(origin, { [SECOND]: brief(2, "Add a function that says goodbye.") }));
    const second = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(second.status).toBe(0);
    // AC: the base was fetched, without the operator touching the checkout.
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(git(origin, ["rev-parse", "main"]));
    expect(git(repo, ["rev-parse", "main"])).toBe(localMain);
    // AC: the delivery branch started again from the base; the merged item is not carried on it.
    expect(git(repo, ["merge-base", "--is-ancestor", "origin/main", "delivery/main"])).toBe("");
    expect(git(repo, ["show", "delivery/main:goodbye.js"])).toContain("goodbye");
    const status = runDelivery(["status"], { cwd: repo, env }).stdout;
    expect(status).toContain("say-goodbye");
    expect(status).not.toContain("say-hello");
    // A fresh pull request, not more work on the merged one.
    expect(gh.pullRequests().map((pr) => pr.state)).toEqual(["MERGED", "OPEN"]);
    expect(gh.pullRequests()[1]?.body).toContain("says goodbye");
    expect(gh.pullRequests()[1]?.body).not.toContain("says hello");
  }, 180_000);

  it("AC: with nothing left to claim, the next run still starts the delivery branch again from the base", async () => {
    const { gh, repo, origin, env } = await project({ closer: { type: "open-pr" } });
    runDelivery(["run", "--sources"], { cwd: repo, env });
    gh.mergePullRequest(gh.pullRequests()[0]?.url ?? "", mergeOnGitHub(origin));

    runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(git(repo, ["rev-parse", "delivery/main"])).toBe(git(repo, ["rev-parse", "origin/main"]));
    expect(runDelivery(["status"], { cwd: repo, env }).stdout).toContain("nothing has landed on it yet");
    expect(gh.pullRequests()).toHaveLength(1);
  }, 180_000);

  it("AC: if the fetch fails, the run carries on with what it has and says it could not fetch", async () => {
    const { repo, env } = await project({ closer: { type: "open-pr" } });
    git(repo, ["remote", "set-url", "origin", join(tmpdir(), "uat-stacked-no-such-origin")]);

    const { stdout } = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(stdout).toContain("Could not fetch main from origin");
    expect(git(repo, ["show", "delivery/main:hello.js"])).toContain("hello");
  }, 120_000);

  it("AC: other closers do not fetch", async () => {
    const { repo, origin, env } = await project({});
    const tracked = git(repo, ["rev-parse", "origin/main"]);
    git(repo, ["push", "-q", "origin", "main:refs/heads/delivery/main"]);
    mergeOnGitHub(origin, { "owner.txt": "the owner's\n" });
    expect(git(origin, ["rev-parse", "main"])).not.toBe(tracked);

    const { stdout } = runDelivery(["run", "--sources"], { cwd: repo, env });

    expect(git(repo, ["rev-parse", "origin/main"])).toBe(tracked);
    expect(stdout).not.toContain("Could not fetch");
    expect(stdout).not.toContain("Could not ask GitHub");
  }, 120_000);
});
