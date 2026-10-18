// Slice 5: Run Something After Work Lands, and Be Told What Happened
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-18 against commit 35d8408
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project holding one backlog item,
// the agent routed to the vendored scripted agent through the contributor-only test
// seam: no network, no API key. After-steps are plain commands writing marker files;
// the notify command copies the run's report from its standard input.
// Acceptance criteria needing an agent after-pass, a tracker source, a retry on the
// next scheduled run, or a workflow-level override are recorded as skipped below.

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { runDelivery } from "../helpers.js";

const BRIEF = "Add the release page.";
const ITEM = `---\nstatus: open\npriority: 1\n---\n${BRIEF}\n`;

const script = (): MockScript => ({
  expectations: [
    { when: { promptContains: BRIEF }, effects: [{ write: { path: "release.html", content: "<p>release</p>\n" } }], json: { status: "completed", rationale: "done" } },
  ],
});

async function project(config: object) {
  const repo = initTempRepo("uat-after-", {
    "package.json": PACKAGE,
    "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" }, ...config }),
    ".delivery/backlog/20261018T090000Z-release.md": ITEM,
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(script()),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-after-state-")),
  };
  return { repo, env };
}

describe("UAT: after-landing step runs and the notify command is told", () => {
  it("runs the step once the work has landed, notifies with the report, and records the step in report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uat-after-marks-"));
    const marker = join(dir, "release-notes.txt");
    const notified = join(dir, "notified.json");
    const { repo, env } = await project({
      after: [{ name: "release notes", run: `echo release-notes-ready > ${marker}` }],
      notify: `cat > ${notified}`,
    });

    const run = runDelivery(["run", "--sources", "--max", "1"], { cwd: repo, env });
    expect(run.status).toBe(0);

    expect(readFileSync(marker, "utf8")).toContain("release-notes-ready");
    expect(existsSync(notified)).toBe(true);
    expect(readFileSync(notified, "utf8")).toContain("release notes");

    for (const command of ["status", "report"]) {
      const shown = runDelivery([command], { cwd: repo, env });
      expect(shown.status).toBe(0);
      expect(shown.stdout).toContain("release notes");
    }
  }, 240_000);
});

describe("AC: a step whose confirming check fails stops the remaining steps", () => {
  it("runs the first step, fails its check, and never runs the second", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uat-after-marks-"));
    const first = join(dir, "first.txt");
    const second = join(dir, "second.txt");
    const { repo, env } = await project({
      after: [
        { name: "deploy", run: `echo x > ${first}`, check: "false" },
        { name: "announce", run: `echo x > ${second}` },
      ],
    });

    runDelivery(["run", "--sources", "--max", "1"], { cwd: repo, env });

    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(false);
    const report = runDelivery(["report"], { cwd: repo, env });
    expect(report.stdout).toContain("announce");
  }, 240_000);
});

describe("AC: not recorded here", () => {
  it.skip("an agent after-pass can add backlog items and its other changes are discarded (needs a scripted after-pass; covered in src/after-agent.test.ts)", () => {});
  it.skip("the next scheduled run tries pending steps first, from the one that failed (needs a second run; covered in src/cli/after-landing.test.ts)", () => {});
  it.skip("a tracker source's held-back follow-ups are raised once after the closer succeeds (needs a tracker; covered in src/cli/after-landing.test.ts)", () => {});
  it.skip("a workflow's own after list replaces the project's (covered in src/cli/config.test.ts and src/cli/after-landing.test.ts)", () => {});
});
