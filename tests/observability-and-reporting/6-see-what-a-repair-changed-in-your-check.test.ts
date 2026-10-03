// Slice 6: See What a Repair Changed in Your Check
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-03 against commit c9fe9ca
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), against a copy of the shipped
// `examples/shared-environment-example` with its shared helper deleted, the
// agent routed to the vendored scripted agent through the contributor-only test
// seam: no network, no API key, no sign-in. The scripted repair edits the
// check's own file (check.mjs) and adds a notes file in its copy.
// Acceptance criteria needing a patch past the size limit, a binary file, a
// run recorded before this slice, or a task stopped and cleared away are
// recorded as skipped below, each with its reason.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { REPO_ROOT, git, runDelivery } from "../helpers.js";

const RUN_TIMEOUT = 60_000;

// The repair is briefed exactly as a task's worker is, so one scripted turn serves both:
// every session edits the check's file and adds a notes file in its own copy.
const AGENT: MockScript = {
  expectations: [
    {
      effects: [
        { write: { path: "check.mjs", content: "// repaired by the scripted agent\n" } },
        { write: { path: "notes.txt", content: "restored the helper\n" } },
      ],
      json: { status: "completed", rationale: "repaired" },
    },
  ],
};

async function brokenProject() {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-6-"));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "shared-environment-example") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  const script = join(mkdtempSync(join(tmpdir(), "uat-slice-6-script-")), "mock.json");
  await writeMockScript(script, AGENT);
  const env = { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-slice-6-state-")), [TEST_MOCK_SCRIPT]: script };
  // Break the shared helper every task's check reads, outside every task's own copy.
  rmSync(join(repo, "shared", "helper.json"));
  return { repo, env };
}

const runIdIn = (stdout: string): string => {
  const match = /^Starting run (run-\S+?):/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no supervised run id in:\n${stdout}`);
  return match[1];
};

describe("UAT: see which file a repair of the check changed, and read the patch", () => {
  it(
    "reports a repair that changed a file the check runs under 'Worth a look', and `status --repairs` shows the files and patch it names",
    async () => {
      const { repo, env } = await brokenProject();

      // Step 1: `delivery run` with the shared helper broken, so a repair is needed.
      const run = runDelivery(["run"], { cwd: repo, env });
      const runId = runIdIn(run.stdout);
      expect(run.stdout).toContain("repairing (attempt 1 of 2)");

      // Step 2: `delivery report` and its "Worth a look" section.
      const report = runDelivery(["report"], { cwd: repo, env });
      expect(report.status).toBe(0);
      expect(report.stdout).toContain("WORTH A LOOK");
      expect(report.stdout).toContain("check.mjs");
      expect(report.stdout).toContain("cannot tell you whether the change was safe");
      const named = /delivery status \S+ --repairs/.exec(report.stdout);
      expect(named, "the report names the command that shows the change").not.toBeNull();
      // The saved text report carries no patch.
      expect(readFileSync(join(repo, ".delivery", "last-report.txt"), "utf-8")).not.toMatch(/^(diff --git|@@ )/m);

      // Step 3: run the command it names.
      const repairs = runDelivery((named?.[0] ?? "").split(" ").slice(1), { cwd: repo, env });
      expect(repairs.status).toBe(0);

      // Step 4: the changed files, the check-file marker, and the exact lines added and removed.
      expect(repairs.stdout).toContain("(the check runs this file)");
      expect(repairs.stdout).toMatch(/Repair 1 .*changed 2 files/);
      expect(repairs.stdout).toContain("check.mjs");
      expect(repairs.stdout).toContain("+// repaired by the scripted agent");
      // A file the repair added is shown in full.
      expect(repairs.stdout).toContain("notes.txt: added");
      expect(repairs.stdout).toContain("+restored the helper");

      // AC: the data document carries each repair's files, counts, marker and patch.
      const json = runDelivery(["status", runId, "--json"], { cwd: repo, env });
      expect(json.status).toBe(0);
      const document = JSON.stringify(JSON.parse(json.stdout));
      expect(document).toContain('"path":"check.mjs"');
      expect(document).toContain('"touchesCheck":true');
      expect(document).toContain('+// repaired by the scripted agent');
    },
    RUN_TIMEOUT,
  );

  it.skip("AC: a patch past the fixed limit, or a binary file, is listed with name and counts and 'too large to keep' (needs a repair writing over 256 KiB; covered by src/repair-changes.test.ts)", () => {});
  it.skip("AC: a repair that changed nothing reads 'changed no files'; one recorded before this slice reads 'not recorded' (needs a hand-built older record; covered by src/report/detail.test.ts)", () => {});
  it.skip("AC: a repair's changes are still shown for a task that stopped and whose working copy was cleared (covered by src/cli/status-command.test.ts)", () => {});
  it.skip("AC: a task's delivered work is exactly what it would have been without the capture (needs a with/without comparison build; covered by src/repair-changes.test.ts)", () => {});
});
