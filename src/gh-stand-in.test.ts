import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";
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

    const query = "query($owner:String!,$name:String!,$h0:String!,$h1:String!){repository(owner:$owner,name:$name){p0:pullRequests(headRefName:$h0,states:[OPEN,MERGED,CLOSED],first:100){nodes{url state headRefName headRefOid baseRefName}} p1:pullRequests(headRefName:$h1,states:[OPEN,MERGED,CLOSED],first:100){nodes{url state headRefName headRefOid baseRefName}}}}";
    const answer = run(gh.command, ["api", "graphql", "-f", `query=${query}`, "-F", "owner={owner}", "-F", "name={repo}", "-f", "h0=a", "-f", "h1=b"], repo);
    expect(answer.status).toBe(0);
    expect(JSON.parse(answer.stdout)).toEqual({
      data: {
        repository: {
          p0: { nodes: [{ url: urlA, state: "OPEN", headRefName: "a", headRefOid: headA, baseRefName: "main" }] },
          p1: { nodes: [{ url: urlB, state: "MERGED", headRefName: "b", headRefOid: "bbb", baseRefName: "main" }] },
        },
      },
    });

    const search = run(gh.command, ["api", "graphql", "-f", 'query=query{search(query:"a",type:ISSUE,first:1){nodeCount}}'], repo);
    expect(search.status).not.toBe(0);
  });
});
