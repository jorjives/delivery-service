// Slice 4: Find a Saved Report After a Run Ends
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-02 against commit ebee7a8
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project with a list of three
// tasks, the agent routed to the vendored scripted agent through the
// contributor-only test seam: no network, no API key, no sign-in.
// Acceptance criteria needing a crash mid-save or a resumed run are recorded as
// skipped below, each with its reason.

import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { git, runDelivery } from "../helpers.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";
const PURGE = "Remove every page under the old news section";
const SAID = "This would delete 14 published pages. I need the owner to confirm before I remove them.";

const writes = (path: string, said: string) => ({
  effects: [{ write: { path, content: `${said}\n` } }],
  json: { status: "completed", rationale: said },
});

const AGENT: MockScript = {
  expectations: [
    { when: { promptContains: PURGE }, json: { status: "escalate", category: "authority", rationale: SAID } },
    { when: { promptContains: FORM }, ...writes("contact.html", "added the contact form") },
    { when: { promptContains: PRICES }, ...writes("prices.html", "updated the prices page") },
  ],
};

async function project(tasks: string[]) {
  const repo = initTempRepo("uat-saved-", {
    "package.json": PACKAGE,
    ".gitignore": ".delivery/\n",
    "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" }, tasks }, null, 2),
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(AGENT),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-saved-state-")),
  };
  return { repo, env };
}

const TEXT = ".delivery/last-report.txt";
const DATA = ".delivery/last-report.json";
const read = (repo: string, file: string) => readFileSync(join(repo, file), "utf-8");

describe("UAT: find the report of the last run waiting as a file", () => {
  it("ends the run on its headline and a pointer to `delivery report`, and leaves the same plain report as a file", async () => {
    const { repo, env } = await project([FORM, PRICES]);

    // Step 1: run a short list and read its final lines.
    const run = runDelivery(["run"], { cwd: repo, env });
    expect(run.status).toBe(0);
    const closing = run.stdout.trimEnd().split("\n").slice(-4).join("\n");
    expect(closing).toContain("2 of 2 tasks completed and merged.");
    expect(closing).toContain("delivery report");

    // Steps 2-3: the text file in `.delivery` is what `delivery report` prints.
    const printed = runDelivery(["report"], { cwd: repo, env });
    expect(printed.status).toBe(0);
    const saved = read(repo, TEXT);
    expect(saved).toContain("2 of 2 tasks completed and merged.");
    // `delivery report` may add a line saying where the copy is; apart from that the two are one report.
    expect(printed.stdout.split("\n").filter((l) => !l.includes("Saved to:"))).toEqual(saved.split("\n").filter((l) => !l.includes("Saved to:")));

    // Step 4: it can be pasted into a message: no colour codes, no patches.
    expect(saved).not.toContain(String.fromCharCode(27));
    expect(saved).not.toMatch(/^(diff --git|@@ |\+\+\+ |--- )/m);
    expect(() => JSON.parse(read(repo, DATA))).not.toThrow();
  });

  it("AC: the pair is saved owner-only, replaced by the next run, kept out of version control, and the report names it", async () => {
    const { repo, env } = await project([FORM, PURGE]);
    runDelivery(["run"], { cwd: repo, env });
    const first = read(repo, TEXT);
    for (const file of [TEXT, DATA]) expect(statSync(join(repo, file)).mode & 0o777).toBe(0o600);
    expect(first).toContain("1 needs your decision");
    // "For whoever tunes this" names where the files were saved.
    expect(first).toContain("FOR WHOEVER TUNES THIS");
    expect(first).toContain("Saved to: .delivery/last-report.txt and .delivery/last-report.json");

    // The next run replaces the pair, rather than adding to it.
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ closer: { type: "merge-back" }, tasks: [PRICES] }));
    git(repo, ["commit", "-qam", "a different list"]);
    runDelivery(["run"], { cwd: repo, env });
    expect(read(repo, TEXT)).not.toBe(first);
    expect(read(repo, TEXT)).toContain("1 of 1 task completed and merged.");

    // Never committed with the project's work.
    expect(git(repo, ["status", "--porcelain"])).not.toContain("last-report");
    expect(git(repo, ["ls-files", ".delivery"])).toBe("");
  });

  it("AC: `delivery report --write` saves the pair, with or without a run named", async () => {
    const { repo, env } = await project([FORM, PRICES]);
    runDelivery(["run"], { cwd: repo, env });
    rmSync(join(repo, ".delivery", "last-report.txt"));
    rmSync(join(repo, ".delivery", "last-report.json"));

    const written = runDelivery(["report", "--write"], { cwd: repo, env });
    expect(written.status).toBe(0);
    expect(written.stdout).toContain("Saved to: .delivery/last-report.txt and .delivery/last-report.json");
    expect(read(repo, TEXT)).toContain("2 of 2 tasks completed and merged.");

    const [runId] = readdirSync(join(repo, ".delivery", "runs"));
    if (!runId) throw new Error("the run left no record");
    rmSync(join(repo, TEXT));
    expect(runDelivery(["report", runId, "--write"], { cwd: repo, env }).status).toBe(0);
    // A named run is reported on its own: this one task, not the list.
    expect(read(repo, TEXT)).toContain("This run: 1 of 1 task completed and merged.");
  });

  it("AC: when the files cannot be written, the run's outcome and exit code are unaffected and one line says so", async () => {
    const { repo, env } = await project([FORM, PRICES]);
    // A directory where the text file should go makes the save fail whoever runs it.
    mkdirSync(join(repo, ".delivery", "last-report.txt"), { recursive: true });
    chmodSync(join(repo, ".delivery", "last-report.txt"), 0o500);

    const run = runDelivery(["run"], { cwd: repo, env });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("2 of 2 tasks completed and merged.");
    expect(`${run.stdout}${run.stderr}`.split("\n").filter((l) => l.includes("could not be saved"))).toHaveLength(1);

    const report = runDelivery(["report"], { cwd: repo, env });
    expect(report.status).toBe(0);
    expect(report.stdout).toContain("2 of 2 tasks completed and merged.");
    chmodSync(join(repo, ".delivery", "last-report.txt"), 0o700);
  });

  it.skip("AC: `delivery resume` ends on the same headline and pointer and saves the pair (needs an interrupted run to resume; covered by src/cli/run-command.test.ts)", () => {});
  it.skip("AC: a run that crashes before saving leaves no partial file (needs a process killed mid-write; covered by src/cli/saved-report.test.ts)", () => {});
});
