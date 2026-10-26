// Slice 4: Choose how far a pack goes before it asks you
// Source: docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-slices.md
// Recorded: 2026-10-26 against commit 7afa24a
//
// Drives the shipped docs example pack (setting `hold-from`, a severity, default `high`, named as
// the hold of its `fix` act). `delivery packs inspect` runs as the compiled command; the scripted
// walkthrough (review, approve, run) runs through the command entry point in process, as the
// command tests do, because a run needs the scripted agent and a fence-free sandbox.
//
// SKIPPED AC: naming both a literal hold and a setting on one act is refused with a file-and-field message
//   (a pack-format rule; covered by the setting-rules unit tests).
// SKIPPED AC: a setting that is not a severity cannot be named as the hold
//   (a pack-format rule; covered by the setting-rules unit tests).
// SKIPPED AC: the inspection says the hold cannot be known when the configuration is code
//   (needs a JS config project; covered by the inspection unit tests).
// SKIPPED AC: the new pack format key is the only addition to the published keys
//   (pinned by the published-keys files and their unit tests).

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, git, runDelivery } from "../helpers.js";
import { ledgerPath, readItemLedger } from "../../src/item-ledger.js";
import type { MockScript } from "../../src/mock-script.js";
import { ideasScript, type ScriptedIdea } from "../../src/packs/review-fixtures.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { delivery, docsProject, RUN_TIMEOUT, scriptFile } from "../../src/cli/command-fixtures.js";
import { EXIT } from "../../src/cli/failures.js";

const PAGE = "docs/api.md";
const STALE_LINE = "Run the old build with `npm run legacy-build`.";

// One medium-severity change: held when the owner's hold is medium, lands under the default high.
const IDEA: ScriptedIdea = {
  file: "20261026T120000Z-old-build-line.md",
  title: "The API page still gives the old build command",
  severity: "medium",
  workflow: "docs:fix",
  check: { kind: "anchor-gone", path: PAGE, anchor: STALE_LINE },
  body: "The API page tells readers to run a build that no longer exists.",
};

const FIXES: MockScript = {
  expectations: [
    {
      when: { promptContains: IDEA.title },
      effects: [{ write: { path: PAGE, content: "# API\n\nCall `render()` to draw a page.\n" } }],
      json: { status: "completed", rationale: "removed the stale line" },
    },
  ],
};

/** The walkthrough: review, approve and run the docs pack's fix, with the owner's values when given. */
async function walkthrough(packSettings?: Record<string, unknown>) {
  const repo = docsProject(packSettings);
  const state = mkdtempSync(join(tmpdir(), "uat-adapt-slice-4-state-"));
  const env = async (script: MockScript) => ({ XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) });
  const step = async (args: string[], script: MockScript) => delivery(args, { cwd: repo, env: await env(script) });
  for (const [args, script] of [[["review", "docs"], ideasScript([IDEA])], [["approve", "--all"], FIXES]] as const) {
    const { exitCode, stdout, stderr } = await step([...args], script);
    expect(exitCode, stdout + stderr).toBe(EXIT.ok);
  }
  // A held idea ends the run needing a person, so the exit code is not asserted; the ledger says what happened.
  await step(["run", "--sources", "--max", "1"], FIXES);
  const ledger = await readItemLedger(ledgerPath(repo, await env(FIXES)));
  return { repo, entry: ledger.get(`backlog:${IDEA.file}`) };
}

/** A git-initialised scratch project that lists the docs example pack, for the compiled command. */
function inspectProject(packSettings?: object): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-adapt-slice-4-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  cpSync(join(REPO_ROOT, "examples", "docs-pack"), join(repo, "docs-pack"), { recursive: true });
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ packs: ["docs-pack"], ...(packSettings ? { packSettings } : {}) }));
  git(repo, ["init", "-q"]);
  return repo;
}

const inspect = (repo: string) => {
  const result = runDelivery(["packs", "inspect", "docs"], { cwd: repo });
  return { status: result.status, text: (result.stdout + result.stderr).replace(/\s+/g, " ") };
};

describe("UAT: make a shared pack ask for your sign-off sooner", () => {
  it("lands a medium change under the default threshold, then holds it once the owner lowers the threshold", async () => {
    const before = await walkthrough();
    expect(before.entry?.lastClass).toBe("delivered");
    expect(git(before.repo, ["show", `delivery/main:${PAGE}`])).not.toContain("legacy-build");

    const after = await walkthrough({ docs: { "hold-from": "medium" } });
    expect(after.entry).toMatchObject({ parked: "held" });
    expect(git(after.repo, ["show", `delivery/main:${PAGE}`])).toContain("legacy-build");
  }, RUN_TIMEOUT * 8);
});

describe("AC: inspection shows the hold in effect and its source", () => {
  it("names the severities held and the default, then the owner's configuration once changed", () => {
    const byDefault = inspect(inspectProject());
    expect(byDefault.status).toBe(0);
    expect(byDefault.text).toContain("Ideas rated critical or high wait for your sign-off before they land.");
    expect(byDefault.text).toContain("This is set by hold-from (default).");

    const lowered = inspect(inspectProject({ docs: { "hold-from": "medium" } }));
    expect(lowered.text).toContain("Ideas rated critical, high or medium wait for your sign-off before they land.");
    expect(lowered.text).toContain("This is set by hold-from (your configuration).");
  });

  it("carries the hold and where it comes from in the data form", () => {
    const repo = inspectProject({ docs: { "hold-from": "medium" } });
    const doc = JSON.parse(runDelivery(["packs", "inspect", "docs", "--json"], { cwd: repo }).stdout);
    expect(doc.workflows.find((w: { name: string }) => w.name === "docs:fix")).toMatchObject({ hold: "medium", holdSetting: "hold-from", holdKnown: true });
  });

  it("says the hold cannot be known when the setting is unset", () => {
    const repo = inspectProject();
    const packPath = join(repo, "docs-pack", "pack.json");
    const pack = JSON.parse(readFileSync(packPath, "utf-8"));
    delete pack.settings["hold-from"].default;
    writeFileSync(packPath, JSON.stringify(pack));
    const doc = JSON.parse(runDelivery(["packs", "inspect", "docs", "--json"], { cwd: repo }).stdout);
    expect(doc.workflows.find((w: { name: string }) => w.name === "docs:fix")).toMatchObject({ holdSetting: "hold-from", holdKnown: false });
  });
});
