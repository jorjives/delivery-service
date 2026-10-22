import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";
import { cleanGitEnv } from "./git-env.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";

const run = (bin: string, args: string[], cwd?: string) => spawnSync(bin, args, { encoding: "utf-8", ...(cwd === undefined ? {} : { cwd }) });

describe("the gh stand-in's issues", () => {
  it("answers the listing query with open issues carrying the label, oldest first, with their label and rename events", () => {
    const gh = createGhStandIn();
    const a = gh.openIssue({ title: "A", body: "a", labels: ["delivery"], at: "2026-10-18T09:00:00Z" });
    gh.openIssue({ title: "B", body: "b", at: "2026-10-18T08:00:00Z" });
    gh.editIssue(a, { title: "A2" }, "2026-10-18T10:00:00Z");
    const out = JSON.parse(execFileSync(gh.command, ["api", "graphql", "-f", "query=q", "-F", "owner={owner}", "-F", "name={repo}", "-f", "label=delivery"], { encoding: "utf-8" }));
    const nodes = out.data.repository.issues.nodes;
    expect(nodes.map((n: { number: number }) => n.number)).toEqual([a]);
    expect(nodes[0]).toMatchObject({ title: "A2", body: "a", lastEditedAt: null, labels: { nodes: [{ name: "delivery" }] } });
    expect(nodes[0].timelineItems.nodes).toEqual([
      { __typename: "LabeledEvent", createdAt: "2026-10-18T09:00:00Z", label: { name: "delivery" } },
      { __typename: "RenamedTitleEvent", createdAt: "2026-10-18T10:00:00Z" },
    ]);
  });

  it("creates, comments on, labels and closes issues, refusing a label the repository lacks", () => {
    const gh = createGhStandIn();
    const created = run(gh.command, ["issue", "create", "--title", "T", "--body", "B"]);
    expect(created.stdout.trim()).toBe("https://github.com/example/project/issues/1");
    expect(run(gh.command, ["issue", "edit", "1", "--add-label", "delivery:parked"]).status).toBe(1);
    expect(run(gh.command, ["label", "create", "delivery:parked", "--force"]).status).toBe(0);
    expect(run(gh.command, ["issue", "edit", "1", "--add-label", "delivery:parked"]).status).toBe(0);
    expect(run(gh.command, ["issue", "comment", "1", "--body", "why"]).status).toBe(0);
    expect(run(gh.command, ["issue", "edit", "1", "--remove-label", "delivery:parked"]).status).toBe(0);
    expect(run(gh.command, ["issue", "close", "1", "--comment", "done"]).status).toBe(0);
    expect(run(gh.command, ["issue", "close", "1", "--comment", "again"]).status).toBe(0);
    expect(gh.issues()[0]).toMatchObject({ state: "CLOSED", labels: [], comments: ["why", "done"] });
  });

  it("refuses every issue command when signed out, as gh does", () => {
    const gh = createGhStandIn();
    gh.setMode("signed-out");
    expect(run(gh.command, ["api", "graphql", "-f", "label=delivery"]).status).toBe(4);
  });

  it("can refuse label changes while still listing", () => {
    const gh = createGhStandIn();
    gh.openIssue({ title: "T", body: "B", labels: ["delivery"] });
    gh.refuseLabels();
    expect(run(gh.command, ["issue", "edit", "1", "--add-label", "delivery"]).stderr).toContain("HTTP 403");
    expect(run(gh.command, ["api", "graphql", "-f", "label=delivery"]).status).toBe(0);
  });
});

describe("the gh stand-in's pull requests", () => {
  it("answers gh api graphql with each aliased head's pull requests, reporting each head commit from origin, and refuses a search query", () => {
    const repo = initTempRepo("stand-in-", { "a.txt": "a\n" });
    const origin = addLocalOrigin(repo);
    const gh = createGhStandIn();
    const urlA = run(gh.command, ["pr", "create", "--base=main", "--head=a", "--title=T", "--body=B"], repo).stdout.trim();
    const urlB = run(gh.command, ["pr", "create", "--base=main", "--head=b", "--title=T", "--body=B"], repo).stdout.trim();
    gh.mergePullRequest(urlB, "bbb");
    run("git", ["push", "origin", "main:refs/heads/a"], repo);
    const headA = execFileSync("git", ["rev-parse", "refs/heads/a"], { cwd: origin, encoding: "utf-8" }).trim();

    const query = "query($owner:String!,$name:String!,$h0:String!,$h1:String!){repository(owner:$owner,name:$name){p0:pullRequests(headRefName:$h0,states:[OPEN,MERGED,CLOSED],first:100){nodes{url state headRefName headRefOid baseRefName mergeCommit{oid}}} p1:pullRequests(headRefName:$h1,states:[OPEN,MERGED,CLOSED],first:100){nodes{url state headRefName headRefOid baseRefName mergeCommit{oid}}}}}";
    const answer = run(gh.command, ["api", "graphql", "-f", `query=${query}`, "-F", "owner={owner}", "-F", "name={repo}", "-f", "h0=a", "-f", "h1=b"], repo);
    expect(answer.status).toBe(0);
    expect(JSON.parse(answer.stdout)).toEqual({
      data: {
        repository: {
          p0: { nodes: [{ url: urlA, state: "OPEN", headRefName: "a", headRefOid: headA, baseRefName: "main", isCrossRepository: false, mergeCommit: null }] },
          p1: { nodes: [{ url: urlB, state: "MERGED", headRefName: "b", headRefOid: "bbb", baseRefName: "main", isCrossRepository: false, mergeCommit: null }] },
        },
      },
    });

    const search = run(gh.command, ["api", "graphql", "-f", 'query=query{search(query:"a",type:ISSUE,first:1){nodeCount}}'], repo);
    expect(search.status).not.toBe(0);
  });

  it("sets a pull request's base with pr edit --base", () => {
    const repo = initTempRepo("stand-in-edit-", { "a.txt": "a\n" });
    addLocalOrigin(repo);
    const gh = createGhStandIn();
    const url = run(gh.command, ["pr", "create", "--base=main", "--head=a", "--title=T", "--body=B"], repo).stdout.trim();

    expect(run(gh.command, ["pr", "edit", url, "--base=other"], repo).status).toBe(0);

    expect(gh.pullRequests()[0]).toMatchObject({ url, base: "other" });
  });

  it("closes a pull request with a comment through pr close, and says so when it was closed already", () => {
    const repo = initTempRepo("stand-in-close-", { "a.txt": "a\n" });
    addLocalOrigin(repo);
    const gh = createGhStandIn();
    const url = run(gh.command, ["pr", "create", "--base=main", "--head=a", "--title=T", "--body=B"], repo).stdout.trim();

    expect(run(gh.command, ["pr", "close", url, "--comment", "Built on a closed one."], repo).status).toBe(0);
    expect(gh.pullRequests()[0]).toMatchObject({ url, state: "CLOSED", comments: ["Built on a closed one."] });

    const again = run(gh.command, ["pr", "close", url, "--comment", "Again."], repo);
    expect(again.status).toBe(0);
    expect(again.stderr).toContain("already closed");
    expect(gh.pullRequests()[0]?.comments).toEqual(["Built on a closed one."]);
  });

  it("lets a test close a pull request as the owner would", () => {
    const repo = initTempRepo("stand-in-owner-close-", { "a.txt": "a\n" });
    addLocalOrigin(repo);
    const gh = createGhStandIn();
    const url = run(gh.command, ["pr", "create", "--base=main", "--head=a", "--title=T", "--body=B"], repo).stdout.trim();
    gh.closePullRequest(url);
    expect(gh.pullRequests()[0]).toMatchObject({ state: "CLOSED" });
  });

  it("refuses to create a pull request whose head has no commits beyond its base", () => {
    const repo = initTempRepo("stand-in-empty-", { "a.txt": "a\n" });
    addLocalOrigin(repo);
    const gh = createGhStandIn();
    run("git", ["push", "origin", "main:refs/heads/empty"], repo);
    const refused = run(gh.command, ["pr", "create", "--base=main", "--head=empty", "--title=T", "--body=B"], repo);

    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("No commits between main and empty");
    expect(gh.pullRequests()).toEqual([]);

    writeFileSync(join(repo, "b.txt"), "b\n");
    run("git", ["add", "-A"], repo);
    run("git", ["commit", "-m", "b"], repo);
    run("git", ["push", "origin", "HEAD:refs/heads/ahead"], repo);
    expect(run(gh.command, ["pr", "create", "--base=main", "--head=ahead", "--title=T", "--body=B"], repo).status).toBe(0);
  });
});

/** A repository on `main` with a bare origin, a head branch `feature` one commit ahead, and a pull request for it. */
function featureOnOrigin(): { repo: string; origin: string; gh: ReturnType<typeof createGhStandIn>; url: string } {
  const repo = initTempRepo("stand-in-merge-", { "a.txt": "a\n" });
  const origin = addLocalOrigin(repo);
  run("git", ["checkout", "-q", "-b", "feature"], repo);
  writeFileSync(join(repo, "feature.txt"), "feature\n");
  run("git", ["add", "-A"], repo);
  run("git", ["commit", "-q", "-m", "feature"], repo);
  run("git", ["push", "-q", "origin", "feature"], repo);
  run("git", ["checkout", "-q", "main"], repo);
  const gh = createGhStandIn();
  const url = run(gh.command, ["pr", "create", "--base=main", "--head=feature", "--title=T", "--body=B"], repo).stdout.trim();
  return { repo, origin, gh, url };
}

const originGit = (origin: string, args: string[]): string => execFileSync("git", args, { cwd: origin, encoding: "utf-8", env: cleanGitEnv() }).trim();
const isAncestor = (origin: string, ancestor: string, descendant: string): boolean =>
  spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: origin, env: cleanGitEnv() }).status === 0;

describe("the gh stand-in's merges", () => {
  it.each(["squash", "rebase", "merge"] as const)("merges %s on origin and reports the pull request merged at its head", (method) => {
    const { origin, gh, url } = featureOnOrigin();
    const headSha = originGit(origin, ["rev-parse", "refs/heads/feature"]);

    const mergeCommit = gh.merge(url, method, origin);

    expect(originGit(origin, ["show", "refs/heads/main:feature.txt"])).toBe("feature");
    expect(gh.pullRequests()[0]).toMatchObject({ state: "MERGED", headRefOid: headSha, mergeCommit });
    expect(originGit(origin, ["rev-parse", "refs/heads/main"])).toBe(mergeCommit);
    expect(isAncestor(origin, mergeCommit, "refs/heads/main")).toBe(true);
    expect(isAncestor(origin, headSha, "refs/heads/main")).toBe(method === "merge");
    expect(originGit(origin, ["rev-parse", "refs/pull/1/head"])).toBe(headSha);
  });

  it("merges a pull request at the head origin holds at that moment, so a stacked merge carries the one below", () => {
    const repo = initTempRepo("stand-in-stack-", { "a.txt": "a\n" });
    const origin = addLocalOrigin(repo);
    run("git", ["checkout", "-q", "-b", "r1"], repo);
    writeFileSync(join(repo, "r1.txt"), "r1\n");
    run("git", ["add", "-A"], repo);
    run("git", ["commit", "-q", "-m", "r1"], repo);
    run("git", ["push", "-q", "origin", "r1"], repo);
    run("git", ["checkout", "-q", "-b", "r2", "r1"], repo);
    writeFileSync(join(repo, "r2.txt"), "r2\n");
    run("git", ["add", "-A"], repo);
    run("git", ["commit", "-q", "-m", "r2"], repo);
    run("git", ["push", "-q", "origin", "r2"], repo);
    run("git", ["checkout", "-q", "main"], repo);
    const gh = createGhStandIn();
    const url1 = run(gh.command, ["pr", "create", "--base=main", "--head=r1", "--title=T", "--body=B"], repo).stdout.trim();
    const url2 = run(gh.command, ["pr", "create", "--base=r1", "--head=r2", "--title=T", "--body=B"], repo).stdout.trim();

    const r2Merge = gh.merge(url2, "merge", origin);
    const r1Tip = originGit(origin, ["rev-parse", "refs/heads/r1"]);
    expect(r1Tip).toBe(r2Merge);
    gh.merge(url1, "squash", origin);

    const [pr1, pr2] = gh.pullRequests();
    if (pr1 === undefined || pr2 === undefined) expect.fail("both pull requests should exist");
    expect(pr1).toMatchObject({ url: url1, headRefOid: r1Tip });
    expect(pr2).toMatchObject({ url: url2, mergeCommit: r2Merge });
    expect(isAncestor(origin, r2Merge, pr1.headRefOid as string)).toBe(true);
  });
});
