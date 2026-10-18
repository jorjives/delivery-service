// Slice 7: Use a GitHub Issue Tracker as Your Backlog
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-18 against commit 3c9119f
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project whose only source is
// `github`, with the real `gh` swapped for the contributor-only stand-in
// (src/gh-stand-in.ts) first on PATH: no network, no GitHub account. The agent
// is routed to the vendored scripted agent through the contributor-only test seam.
// Acceptance criteria that need a real remote and pull request are recorded as
// skipped below, with their reason.

import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import { createGhStandIn } from "../../src/gh-stand-in.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const BRIEF = "Add a function that says hello to a name";

const completes = (path: string, extra: MockScript["expectations"][number]["effects"] = []): MockScript => ({
  expectations: [{ effects: [{ write: { path, content: "export const done = true;\n" } }, ...(extra ?? [])], json: { status: "completed", rationale: "done" } }],
});
const asks: MockScript = { expectations: [{ json: { status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the issue does not say" } }] };

async function project(script: MockScript, config: object = { sources: [{ type: "github" }] }) {
  const gh = createGhStandIn();
  const repo = initTempRepo("uat-github-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config) });
  const env = {
    ...process.env,
    PATH: `${gh.binDir}:${process.env.PATH ?? ""}`,
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-github-state-")),
    [TEST_MOCK_SCRIPT]: await scriptFile(script),
  };
  return { gh, repo, env };
}

describe("UAT: approve and track a piece of work entirely from GitHub issues", () => {
  it("works a labelled issue, closes it with a comment pointing at the work, and ignores an unlabelled one", async () => {
    const { gh, repo, env } = await project(completes("hello.js"));
    gh.openIssue({ title: BRIEF, body: "Please.", labels: ["delivery"] });
    gh.openIssue({ title: "Not approved yet", body: "Leave me." });

    const run = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(run.status).toBe(0);

    const tip = git(repo, ["rev-parse", "delivery/main"]);
    expect(git(repo, ["ls-tree", "-r", "--name-only", "delivery/main"]).split("\n")).toContain("hello.js");
    const [worked, unlabelled] = gh.issues();
    expect(worked).toMatchObject({ state: "CLOSED" });
    expect(worked?.comments.join("\n")).toContain(tip);
    expect(unlabelled).toMatchObject({ state: "OPEN", comments: [], labels: [] });
  }, 180_000);

  it("shows a question on the issue with a parked label, and clears the label once answered", async () => {
    const { gh, repo, env } = await project(asks);
    gh.openIssue({ title: BRIEF, body: "Please.", labels: ["delivery"] });

    runDelivery(["run", "--sources"], { cwd: repo, env });
    const [parked] = gh.issues();
    expect(parked?.state).toBe("OPEN");
    expect(parked?.labels).toContain("delivery:parked");
    expect(parked?.comments.join("\n")).toContain("Formal or casual greeting?");
    const status = runDelivery(["status"], { cwd: repo, env });
    expect(status.stdout).toContain("github:1");
    expect(status.stdout).toContain("Formal or casual greeting?");

    expect(runDelivery(["answer", "github:1", "Formal, please."], { cwd: repo, env: { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js")) } }).status).toBe(0);
    runDelivery(["run", "--sources"], { cwd: repo, env: { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js")) } });
    expect(gh.issues()[0]?.labels).not.toContain("delivery:parked");
  }, 180_000);
});

describe("AC: a workflow label chooses the workflow, and the label's issues are the backlog", () => {
  it("delivers an issue through the workflow its workflow: label names", async () => {
    const { gh, repo, env } = await project(completes("quiet.js"), {
      sources: [{ type: "github" }],
      workflows: { quiet: { steps: [{ name: "do", prompt: "do it" }] } },
    });
    gh.openIssue({ title: BRIEF, body: "Please.", labels: ["delivery", "workflow:quiet"] });
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    expect(git(repo, ["ls-tree", "-r", "--name-only", "delivery/main"]).split("\n")).toContain("quiet.js");
    expect(gh.issues()[0]?.state).toBe("CLOSED");
  }, 180_000);
});

describe("AC: a follow-up is raised as a new unlabelled issue once the work has landed", () => {
  it("opens it on GitHub and leaves it out of the delivered branch", async () => {
    const followUp = ".delivery/backlog/20261018T100000Z-say-goodbye.md";
    const { gh, repo, env } = await project(
      completes("hello.js", [{ write: { path: followUp, content: "---\nstatus: open\n---\nAdd a goodbye function too.\n" } }]),
    );
    gh.openIssue({ title: BRIEF, body: "Please.", labels: ["delivery"] });
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    expect(gh.issues()).toHaveLength(2);
    expect(gh.issues()[1]).toMatchObject({ title: "Add a goodbye function too.", labels: [], state: "OPEN" });
    expect(git(repo, ["ls-tree", "-r", "--name-only", "delivery/main", "--", ".delivery/backlog/"])).toBe("");
  }, 180_000);
});

describe("AC: an issue whose text changes after it was labelled is left alone and reported", () => {
  it("skips it with a reason, until the label is added again", async () => {
    const { gh, repo, env } = await project(completes("hello.js"));
    const n = gh.openIssue({ title: BRIEF, body: "Please.", labels: ["delivery"], at: "2026-10-18T08:00:00Z" });
    gh.editIssue(n, { body: "Actually do something else." }, "2026-10-18T09:00:00Z");

    const skipped = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(skipped.stdout + skipped.stderr).toContain(`Left GitHub issue #${n} alone`);
    expect(gh.issues()[0]?.state).toBe("OPEN");
    expect(git(repo, ["branch", "--list", "delivery/*"])).toBe("");

    gh.labelIssue(n, "delivery", "2026-10-18T10:00:00Z");
    expect(runDelivery(["run", "--sources"], { cwd: repo, env }).status).toBe(0);
    expect(gh.issues()[0]?.state).toBe("CLOSED");
  }, 180_000);
});

describe("AC: a missing or signed-out gh skips that source with a plain reason; other sources still run", () => {
  it("delivers the backlog item and says why GitHub was skipped", async () => {
    const item = ".delivery/backlog/20261018T090000Z-say-hello.md";
    const { gh, env } = await project(completes("hello.js"));
    gh.setMode("signed-out");
    const repo = initTempRepo("uat-github-signedout-", {
      "package.json": PACKAGE,
      [item]: `---\nstatus: open\n---\n${BRIEF}.\n`,
      "delivery.config.json": JSON.stringify({ sources: [{ type: "github" }, { type: "backlog" }] }),
    });
    const run = runDelivery(["run", "--sources"], { cwd: repo, env });
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).toContain("gh is not signed in");
    expect(git(repo, ["ls-tree", "-r", "--name-only", "delivery/main"]).split("\n")).toContain("hello.js");
  }, 180_000);
});

describe("AC: not recorded here", () => {
  it.skip("a project that opens pull requests has the merged pull request close the issue (needs a real remote and GitHub pull request; asserted in src/cli/after-landing.test.ts and src/open-pr-closer.test.ts)", () => {});
});
