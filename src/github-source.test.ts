import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";
import { initTempRepo } from "./temp-repo.js";
import { issueItem, listGithub, machineFields, clearParked, closeIssue, githubIssueOf, markParked, raiseIssue, type Issue } from "./github-source.js";

const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 12, title: "Say hello", body: "Add a hello function.", createdAt: "2026-10-18T08:00:00Z", lastEditedAt: null,
  labels: ["delivery"], labelledAt: "2026-10-18T09:00:00Z", renamedAt: null, ...over,
});
const SOURCE = { type: "github" as const };

describe("reading an issue as a work item", () => {
  it("takes the title as the intent and the title and body as the brief, keyed by the issue number", () => {
    expect(issueItem(issue(), SOURCE, "github")).toEqual({
      item: {
        key: "github:12", source: "github", kind: "github", id: "12", fallback: false, raise: true,
        issue: { number: 12, parked: false },
        taskDef: { intent: "Say hello", body: "Say hello\n\nAdd a hello function." },
      },
    });
  });

  it("chooses the workflow from a workflow: label, else the delivery block, else the source's default", () => {
    const pick = (over: Partial<Issue>, source: Parameters<typeof issueItem>[1] = { ...SOURCE, workflow: "fix" }) => {
      const read = issueItem(issue(over), source, "github");
      return "item" in read ? read.item.workflow : read.skip;
    };
    expect(pick({ labels: ["delivery", "workflow:build"] })).toBe("build");
    expect(pick({ body: "Do it.\n\n```delivery\nworkflow: plan\n```\n" })).toBe("plan");
    expect(pick({})).toBe("fix");
    expect(pick({}, SOURCE)).toBeUndefined();
    expect(pick({ labels: ["delivery", "workflow:a", "workflow:b"] })).toBe("Left GitHub issue #12 alone: it has more than one workflow: label (workflow:a, workflow:b), so I can't tell which workflow delivers it.");
  });

  it("carries the delivery block's fields into the task and out of the brief", () => {
    const read = issueItem(issue({ body: "Remove eval.\n\n```delivery\nseverity: high\ncheck:\n  kind: pattern-absent\n  pattern: eval\n```\n" }), SOURCE, "github");
    expect(read).toMatchObject({ item: { taskDef: { intent: "Say hello", body: "Say hello\n\nRemove eval.", severity: "high", check: { kind: "pattern-absent", pattern: "eval" } } } });
  });

  it("lets a delivery block set only severity and check, never guards or authorisation", () => {
    const read = issueItem(issue({ body: "Do it.\n\n```delivery\nseverity: high\nguards:\n  off: [no-skips]\nauthorisation: yes\nfinding: {}\n```\n" }), SOURCE, "github");
    expect(read).toMatchObject({ item: { taskDef: { severity: "high" } } });
    for (const key of ["guards", "authorisation", "finding"]) expect((read as { item: { taskDef: object } }).item.taskDef).not.toHaveProperty(key);
  });

  it("skips an issue whose text changed after its label was added, until the label is added again", () => {
    const edited = issueItem(issue({ lastEditedAt: "2026-10-18T10:00:00Z" }), SOURCE, "github");
    expect(edited).toEqual({ skip: "Left GitHub issue #12 alone: its text was changed after it was labelled delivery, so it is not approved as it reads now. Remove the label and add it again to approve it." });
    expect(issueItem(issue({ renamedAt: "2026-10-18T10:00:00Z" }), SOURCE, "github")).toHaveProperty("skip");
    expect(issueItem(issue({ lastEditedAt: "2026-10-18T10:00:00Z", labelledAt: "2026-10-18T11:00:00Z" }), SOURCE, "github")).toHaveProperty("item");
  });

  it("fails closed: an edit in the same instant as the label, or no label event at all, is not approved", () => {
    expect(issueItem(issue({ lastEditedAt: "2026-10-18T09:00:00Z" }), SOURCE, "github")).toHaveProperty("skip");
    expect(issueItem(issue({ renamedAt: "2026-10-18T09:00:00Z" }), SOURCE, "github")).toHaveProperty("skip");
    expect(issueItem(issue({ labelledAt: null }), SOURCE, "github")).toEqual({ skip: "Left GitHub issue #12 alone: no record of when it was labelled delivery, so it is not approved. Remove the label and add it again to approve it." });
  });

  it("notes a parked label, and refuses a delivery block that is not YAML", () => {
    expect(issueItem(issue({ labels: ["delivery", "delivery:parked"] }), SOURCE, "github")).toMatchObject({ item: { issue: { number: 12, parked: true } } });
    expect(machineFields("x\n\n```delivery\n: : :\n```\n")).toEqual({ error: "its delivery block is not valid YAML" });
    expect(machineFields("plain text")).toEqual({ text: "plain text", fields: {} });
  });
});

describe("listing a github source", () => {
  const listWith = async (gh: ReturnType<typeof createGhStandIn>, source: Parameters<typeof listGithub>[0] = SOURCE) =>
    listGithub(source, "github", { repoPath: initTempRepo("github-", { "package.json": "{}" }), env: { ...process.env, PATH: `${gh.binDir}:${process.env.PATH ?? ""}` } });

  it("lists open issues with the label only, by priority: label then oldest first", async () => {
    const gh = createGhStandIn();
    gh.openIssue({ title: "Old", body: "o", labels: ["delivery"], at: "2026-10-18T08:00:00Z" });
    gh.openIssue({ title: "Unlabelled", body: "u", at: "2026-10-18T08:30:00Z" });
    gh.openIssue({ title: "Urgent", body: "n", labels: ["delivery", "priority:1"], at: "2026-10-18T09:00:00Z" });
    gh.openIssue({ title: "Other label", body: "x", labels: ["triage"], at: "2026-10-18T09:30:00Z" });
    const { items, notes } = await listWith(gh);
    expect(items.map((i) => i.taskDef.intent)).toEqual(["Urgent", "Old"]);
    expect(notes).toEqual([]);
  });

  it("uses the source's own label", async () => {
    const gh = createGhStandIn();
    gh.openIssue({ title: "Mine", body: "m", labels: ["ship-it"] });
    expect((await listWith(gh, { type: "github", label: "ship-it" })).items.map((i) => i.taskDef.intent)).toEqual(["Mine"]);
  });

  it("reports an issue edited after labelling as skipped, and lists it again once relabelled", async () => {
    const gh = createGhStandIn();
    const n = gh.openIssue({ title: "Edit me", body: "first", labels: ["delivery"], at: "2026-10-18T08:00:00Z" });
    gh.editIssue(n, { body: "rm -rf everything" }, "2026-10-18T09:00:00Z");
    expect(await listWith(gh)).toMatchObject({ items: [], notes: [expect.stringContaining(`GitHub issue #${n}`)] });
    gh.labelIssue(n, "delivery", "2026-10-18T10:00:00Z");
    expect((await listWith(gh)).items.map((i) => i.taskDef.body)).toEqual(["Edit me\n\nrm -rf everything"]);
  });

  it.each([
    ["signed out", (gh: ReturnType<typeof createGhStandIn>) => gh.setMode("signed-out"), "gh is not signed in, or its sign-in has expired. Run gh auth login as the account the harness runs as."],
    ["offline", (gh: ReturnType<typeof createGhStandIn>) => gh.setMode("offline"), "gh could not reach GitHub. Check the network."],
  ])("skips the source with a plain reason when gh is %s", async (_what, setUp, reason) => {
    const gh = createGhStandIn();
    setUp(gh);
    expect(await listWith(gh)).toEqual({ items: [], notes: [`Skipped the github source for this run: ${reason}`] });
  });

  it("skips the source with a plain reason when gh is not installed", async () => {
    const listed = await listGithub(SOURCE, "github", { repoPath: initTempRepo("github-", { "package.json": "{}" }), env: { PATH: "/nonexistent" } });
    expect(listed).toEqual({ items: [], notes: ["Skipped the github source for this run: the GitHub command-line tool (gh) is not installed, or not on the PATH the harness runs with. Install it from https://cli.github.com and run gh auth login."] });
  });
});

describe("raising a follow-up as an issue", () => {
  const ITEM = { file: "20261018T090000Z-tidy.md", text: "---\nstatus: open\nworkflow: fix\nseverity: low\n---\nTidy the README.\n\nIt repeats itself.\n" };
  const envFor = (gh: ReturnType<typeof createGhStandIn>) => ({ ...process.env, PATH: `${gh.binDir}:${process.env.PATH ?? ""}` });

  it("opens an unlabelled issue titled by the brief's first line, with its fields in a delivery block, and takes its number", async () => {
    const gh = createGhStandIn();
    const repo = initTempRepo("raise-gh-", { "package.json": "{}" });
    expect(await raiseIssue(ITEM, { repoPath: repo, env: envFor(gh) })).toEqual({ id: "1" });
    const [raised] = gh.issues();
    expect(raised).toMatchObject({ title: "Tidy the README.", labels: [] });
    expect(raised?.body).toBe("Tidy the README.\n\nIt repeats itself.\n\n```delivery\nworkflow: fix\nseverity: low\n```\n");
  });

  it("is read back by listing once labelled, with its workflow and fields", async () => {
    const gh = createGhStandIn();
    const repo = initTempRepo("raise-gh-", { "package.json": "{}" });
    await raiseIssue(ITEM, { repoPath: repo, env: envFor(gh) });
    gh.labelIssue(1, "delivery", new Date(Date.now() + 60_000).toISOString());
    const { items } = await listGithub({ type: "github" }, "github", { repoPath: repo, env: envFor(gh) });
    expect(items[0]).toMatchObject({ workflow: "fix", taskDef: { intent: "Tidy the README.", severity: "low" } });
  });

  it("says why when gh cannot open it", async () => {
    const gh = createGhStandIn();
    gh.setMode("signed-out");
    expect(await raiseIssue(ITEM, { repoPath: initTempRepo("raise-gh-", { "package.json": "{}" }), env: envFor(gh) })).toEqual({ error: "gh is not signed in, or its sign-in has expired. Run gh auth login as the account the harness runs as." });
  });
});

describe("which landed item is a GitHub issue", () => {
  it("reads the issue number from a key of a github source, by the source's name", () => {
    const sources = [{ type: "github" as const, name: "issues" }, { type: "backlog" as const }];
    expect(githubIssueOf("issues:12", sources)).toBe(12);
    expect(githubIssueOf("backlog:20261018T090000Z-a.md", sources)).toBeUndefined();
    expect(githubIssueOf("github:12", sources)).toBeUndefined();
  });
});

describe("closing a delivered issue", () => {
  it("closes it with the comment, and says why when gh cannot", async () => {
    const gh = createGhStandIn();
    const n = gh.openIssue({ title: "Say hello", body: "b", labels: ["delivery"] });
    const repo = initTempRepo("close-gh-", { "package.json": "{}" });
    const env = { ...process.env, PATH: `${gh.binDir}:${process.env.PATH ?? ""}` };
    expect(await closeIssue(n, "Delivered.", { repoPath: repo, env })).toBeUndefined();
    expect(gh.issues()[0]).toMatchObject({ state: "CLOSED", comments: ["Delivered."] });
    gh.setMode("offline");
    expect(await closeIssue(n, "Delivered.", { repoPath: repo, env })).toBe("gh could not reach GitHub. Check the network.");
  });
});

describe("mirroring a park onto the issue", () => {
  it("labels the issue parked, creating the label if the repository lacks it, says why in a comment, and clears the label", async () => {
    const gh = createGhStandIn();
    const n = gh.openIssue({ title: "Greet", body: "b", labels: ["delivery"] });
    const repo = initTempRepo("park-gh-", { "package.json": "{}" });
    const env = { ...process.env, PATH: `${gh.binDir}:${process.env.PATH ?? ""}` };
    expect(gh.repoLabels()).not.toContain("delivery:parked");
    expect(await markParked(n, "It needs your answer.", { repoPath: repo, env })).toBeUndefined();
    expect(gh.issues()[0]).toMatchObject({ labels: ["delivery", "delivery:parked"], comments: ["It needs your answer."] });
    expect(await markParked(n, "Again.", { repoPath: repo, env })).toBeUndefined();
    expect(await clearParked(n, { repoPath: repo, env })).toBeUndefined();
    expect(gh.issues()[0]?.labels).toEqual(["delivery"]);
  });

  it("says why when gh cannot mirror the park", async () => {
    const gh = createGhStandIn();
    const n = gh.openIssue({ title: "Greet", body: "b", labels: ["delivery"] });
    gh.setMode("offline");
    expect(await markParked(n, "why", { repoPath: initTempRepo("park-gh-", { "package.json": "{}" }), env: { ...process.env, PATH: `${gh.binDir}:${process.env.PATH ?? ""}` } })).toBe("gh could not reach GitHub. Check the network.");
  });
});
