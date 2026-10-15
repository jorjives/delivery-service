import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";
import { cleanGitEnv } from "./git-env.js";
import { pullRequestFinder } from "./landed-outside.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";

const BRANCH = "surface/add-a-page";

/** A repository whose origin is on GitHub, as gh would see it; nothing is fetched from it. */
function onGitHub(): string {
  const repo = initTempRepo("landed-", { "a.txt": "a\n" });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example/project.git"], { cwd: repo, env: cleanGitEnv() });
  return repo;
}

/** A stand-in with one pull request open from `head`, opened the way the agent would have. */
function withPullRequestFrom(head: string) {
  const gh = createGhStandIn();
  spawnSync(gh.command, ["pr", "create", "--base=main", `--head=${head}`, "--title=t", "--body=b"], { encoding: "utf-8" });
  return gh;
}

describe("looking for a pull request the agent opened itself", () => {
  it("finds the one open for the task's branch", async () => {
    const gh = withPullRequestFrom(BRANCH);
    expect(await pullRequestFinder(onGitHub(), gh.command)(BRANCH)).toBe("https://github.com/example/project/pull/1");
  });

  it("finds none when only another branch has one", async () => {
    const gh = withPullRequestFrom("someone-else");
    expect(await pullRequestFinder(onGitHub(), gh.command)(BRANCH)).toBeNull();
  });

  it("finds none, without asking gh, when there is no origin or it is a folder on this machine", async () => {
    const gh = withPullRequestFrom(BRANCH);
    const local = initTempRepo("landed-", { "a.txt": "a\n" });
    expect(await pullRequestFinder(local, gh.command)(BRANCH)).toBeNull();
    addLocalOrigin(local);
    expect(await pullRequestFinder(local, gh.command)(BRANCH)).toBeNull();
  });

  it("finds none when gh cannot answer, rather than stopping the task", async () => {
    const gh = withPullRequestFrom(BRANCH);
    gh.setMode("offline");
    expect(await pullRequestFinder(onGitHub(), gh.command)(BRANCH)).toBeNull();
    expect(await pullRequestFinder(onGitHub(), "/no/such/gh")(BRANCH)).toBeNull();
  });
});
