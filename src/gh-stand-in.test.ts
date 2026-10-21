import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";

const run = (bin: string, args: string[]) => spawnSync(bin, args, { encoding: "utf-8" });

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
  it("lists only open pull requests for a head by default, as gh does, others by --state, and reports a merged head", () => {
    const gh = createGhStandIn();
    const first = run(gh.command, ["pr", "create", "--base=main", "--head=delivery/main", "--title=T", "--body=B"]).stdout.trim();
    expect(gh.pullRequests()[0]?.state).toBe("OPEN");
    gh.mergePullRequest(first, "abc123");

    const list = (args: string[]) => JSON.parse(run(gh.command, ["pr", "list", "--head=delivery/main", "--json=url,headRefOid", ...args]).stdout) as { url: string; headRefOid?: string }[];
    expect(list([])).toEqual([]);
    expect(list(["--state=open"])).toEqual([]);
    expect(list(["--state=merged"])).toEqual([{ url: first, headRefOid: "abc123" }]);
    expect(list(["--state=all"])).toEqual([{ url: first, headRefOid: "abc123" }]);

    const second = run(gh.command, ["pr", "create", "--base=main", "--head=delivery/main", "--title=T2", "--body=B2"]).stdout.trim();
    expect(second).not.toBe(first);
    expect(list(["--state=open"])).toEqual([{ url: second }]);
  });
});
