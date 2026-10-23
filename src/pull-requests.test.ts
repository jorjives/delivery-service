import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ghAccess } from "./gh.js";
import { createGhStandIn } from "./gh-stand-in.js";
import { cleanGitEnv } from "./git-env.js";
import { listPullRequests } from "./pull-requests.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";

const git = (cwd: string, args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A repository on `main` whose origin is a bare repository on this machine. */
function repoWithOrigin(): { repo: string; origin: string } {
  const repo = initTempRepo("pull-requests-", { "a.txt": "a\n" });
  const origin = addLocalOrigin(repo);
  return { repo, origin };
}

/** Push `main` to origin as `head`, so that head exists there at the same commit. */
function pushHead(repo: string, head: string): string {
  git(repo, ["push", "origin", `main:refs/heads/${head}`]);
  return git(repo, ["rev-parse", "main"]);
}

const create = (gh: { command: string }, cwd: string, head: string): string =>
  execFileSync(gh.command, ["pr", "create", "--base=main", `--head=${head}`, "--title=T", "--body=B"], { cwd, encoding: "utf-8" }).trim();

describe("listPullRequests", () => {
  it("lists the pull requests for one head, in the state asked for, with url, state, head, head commit and base", async () => {
    const { repo, origin } = repoWithOrigin();
    const gh = createGhStandIn();
    const url = create(gh, repo, "a");
    const headOid = pushHead(repo, "a");
    expect(git(origin, ["rev-parse", "refs/heads/a"])).toBe(headOid);

    expect(await listPullRequests(repo, { heads: ["a"] }, { command: gh.command })).toEqual({
      ok: true,
      pullRequests: [{ url, state: "OPEN", headRefName: "a", headRefOid: headOid, baseRefName: "main", mergeCommit: null }],
    });
    expect(await listPullRequests(repo, { heads: ["a"] }, { state: "merged", command: gh.command })).toEqual({ ok: true, pullRequests: [] });
  });

  it("lists every state for several exact heads in one request, and nothing else", async () => {
    const { repo } = repoWithOrigin();
    const gh = createGhStandIn();
    const url1 = create(gh, repo, "delivery-stack/main/r1");
    const r1Oid = pushHead(repo, "delivery-stack/main/r1");
    const url2 = create(gh, repo, "delivery-stack/main/r2");
    gh.mergePullRequest(url2, "bbb");
    create(gh, repo, "delivery-stack/main/r1x");
    create(gh, repo, "other");

    const before = gh.calls().length;
    const listing = await listPullRequests(repo, { heads: ["delivery-stack/main/r1", "delivery-stack/main/r2", "delivery-stack/main/r3"] }, { state: "all", command: gh.command });
    expect(listing).toEqual({
      ok: true,
      pullRequests: [
        { url: url1, state: "OPEN", headRefName: "delivery-stack/main/r1", headRefOid: r1Oid, baseRefName: "main", mergeCommit: null },
        { url: url2, state: "MERGED", headRefName: "delivery-stack/main/r2", headRefOid: "bbb", baseRefName: "main", mergeCommit: null },
      ],
    });
    expect(gh.calls().length - before).toBe(1);
  });

  it("ignores a pull request from a fork whose branch has the same name", async () => {
    const { repo } = repoWithOrigin();
    const gh = createGhStandIn();
    gh.openFromFork("a", "main");
    const own = create(gh, repo, "a");
    const listing = await listPullRequests(repo, { heads: ["a"] }, { state: "all", command: gh.command });
    expect(listing).toMatchObject({ ok: true, pullRequests: [{ url: own }] });
    expect(listing.ok && listing.pullRequests).toHaveLength(1);
  });

  it("asks gh nothing for no heads", async () => {
    const { repo } = repoWithOrigin();
    const gh = createGhStandIn();
    expect(await listPullRequests(repo, { heads: [] }, { command: gh.command })).toEqual({ ok: true, pullRequests: [] });
    expect(gh.calls()).toEqual([]);
  });

  it("sees a pull request the instant it is created", async () => {
    const { repo } = repoWithOrigin();
    const gh = createGhStandIn();
    const url = create(gh, repo, "a");
    const listing = await listPullRequests(repo, { heads: ["a"] }, { command: gh.command });
    expect(listing).toMatchObject({ ok: true, pullRequests: [{ url, state: "OPEN" }] });
  });

  it("reports the merged head commits a squash or rebase left, as mergedPullRequestTips did", async () => {
    const { repo } = repoWithOrigin();
    const gh = createGhStandIn();
    create(gh, repo, "delivery/main");
    expect(await mergedTips(repo, gh.command, "delivery/main")).toEqual(new Set());
    gh.mergePullRequest(create(gh, repo, "delivery/main"), "aaa");
    gh.mergePullRequest(create(gh, repo, "delivery/main"), "bbb");
    gh.mergePullRequest(create(gh, repo, "delivery/other"), "ccc");
    expect(await mergedTips(repo, gh.command, "delivery/main")).toEqual(new Set(["aaa", "bbb"]));
  });

  it("reports the merge commit of a pull request merged by the stand-in, and none for one still open", async () => {
    const { repo, origin } = repoWithOrigin();
    const gh = createGhStandIn();
    git(repo, ["checkout", "-q", "-b", "a"]);
    writeFileSync(join(repo, "a2.txt"), "a2\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "a2"]);
    git(repo, ["push", "-q", "origin", "a"]);
    git(repo, ["checkout", "-q", "main"]);
    const merged = create(gh, repo, "a");
    const open = create(gh, repo, "b");
    const mergeCommit = gh.merge(merged, "merge", origin);

    const listing = await listPullRequests(repo, { heads: ["a", "b"] }, { state: "all", command: gh.command });
    expect(listing).toMatchObject({
      ok: true,
      pullRequests: [
        { url: merged, state: "MERGED", mergeCommit: { oid: mergeCommit } },
        { url: open, state: "OPEN", mergeCommit: null },
      ],
    });
  });

  it("says it could not ask, never throws, when gh is offline", async () => {
    const { repo } = repoWithOrigin();
    const gh = createGhStandIn();
    create(gh, repo, "a");
    gh.setMode("offline");
    const listing = await listPullRequests(repo, { heads: ["a"] }, { command: gh.command });
    if (listing.ok) expect.fail("a listing made offline should not succeed");
    expect(ghAccess(listing.failure)).toBe("offline");
  });
});

/** The merged head commits of `head`, as the rebase-or-squash check reads them. */
async function mergedTips(repo: string, command: string, head: string): Promise<Set<string>> {
  const listing = await listPullRequests(repo, { heads: [head] }, { state: "merged", command });
  if (!listing.ok) expect.fail("the listing should answer");
  return new Set(listing.pullRequests.map((pr) => pr.headRefOid));
}
