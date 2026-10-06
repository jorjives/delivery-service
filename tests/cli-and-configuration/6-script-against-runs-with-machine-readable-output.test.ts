// Slice 6: Script Against Runs With Machine-Readable Output
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-16 against commit ee9c87a
//
// Drives the compiled `delivery` command as a script would: a real subprocess
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in. Reuses slice 4's
// sample-project-copy and mock-script conventions rather than duplicating them.

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-6-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-6-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-6-sample-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

const completes = (path: string, content: string): MockScript => ({
  expectations: [{ effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } }],
});

const escalates: MockScript = {
  expectations: [
    { json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
  ],
};

/** Every line of a `--json` stdout stream, parsed as one JSON object each. */
function stepRecords(stdout: string): unknown[] {
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);
}

describe("UAT: see every run at a glance, then script against the latest and a new one", () => {
  it(
    "lists every run, reads the latest as one JSON document, then streams the new run as one JSON object per step",
    async () => {
      const repo = sampleProjectCopy();
      const env = { ...process.env, XDG_STATE_HOME: scratchState() };

      // Seed two prior runs, so `--all` has something to list.
      const first = runDelivery(["run", "--task", "add a function that says hi"], {
        cwd: repo,
        env: { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = () => 'hi';\n")) },
      });
      expect(first.status).toBe(EXIT.ok);

      const second = runDelivery(["run", "--task", "delete everything"], {
        cwd: repo,
        env: { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(escalates) },
      });
      expect(second.status).toBe(EXIT.escalated);

      // Step 1: type `delivery status --all`.
      const listing = runDelivery(["status", "--all"], { cwd: repo, env });
      expect(listing.status).toBe(EXIT.ok);

      // Step 2: read the list of runs and their outcomes, newest first.
      const lines = listing.stdout.trim().split("\n");
      expect(lines[0]).toContain("2 runs in this repository, newest first:");
      expect(lines[1]).toContain("delete everything");
      expect(lines[1]).toContain("(needs a decision from you)");
      expect(lines[2]).toContain("add a function that says hi");
      expect(lines[2]).toContain("(finished)");

      // Step 3: type `delivery status --last --json` and read the output.
      const statusJson = runDelivery(["status", "--last", "--json"], { cwd: repo, env });
      expect(statusJson.status).toBe(EXIT.ok);
      const doc = JSON.parse(statusJson.stdout) as Record<string, unknown>;
      expect(doc.outcome).toBe("escalated");
      expect(doc.task).toBe("delete everything");
      expect(doc.escalation).toMatchObject({
        evidence: "the task asks me to delete files I was not given",
        dead_ends: "No prior attempts were triaged.",
      });
      expect((doc.escalation as { decision: string }).decision).toContain("lacked authority");

      // Step 4: start a new run with `--json` added and watch the output.
      const third = runDelivery(
        ["run", "--json", "--task", "add a second function"],
        {
          cwd: repo,
          env: { ...env, [TEST_MOCK_SCRIPT]: await scriptFile(completes("second.js", "export const second = () => 2;\n")) },
        },
      );
      expect(third.status).toBe(EXIT.ok);
      const records = stepRecords(third.stdout) as Array<{ state: string; done: boolean; at: string }>;
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(typeof record.state).toBe("string");
        expect(typeof record.done).toBe("boolean");
        expect(record.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
      expect(records.at(-1)).toMatchObject({ state: "CLOSED", done: true });
      // The human-readable notes went to stderr, never mixed into the JSON stream.
      expect(third.stdout).not.toContain("Starting run");
      expect(third.stderr).toContain("Starting run");
    },
  );
});

describe("AC: delivery run --json prints one record per step with the same exit codes as plain output", () => {
  it("keeps the escalated exit code under --json", async () => {
    const repo = sampleProjectCopy();
    const env = { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: await scriptFile(escalates) };

    const plain = runDelivery(["run", "--task", "delete everything"], { cwd: repo, env });
    expect(plain.status).toBe(EXIT.escalated);

    const repo2 = sampleProjectCopy();
    const json = runDelivery(["run", "--json", "--task", "delete everything"], {
      cwd: repo2,
      env: { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: await scriptFile(escalates) },
    });
    expect(json.status).toBe(plain.status);
    const records = stepRecords(json.stdout) as Array<{ state: string; done: boolean }>;
    expect(records.at(-1)).toMatchObject({ state: "ESCALATED", done: true });
  });

  it("keeps the aborted exit code under --json, with no valid `git worktree add` step", async () => {
    const repo = mkdtempSync(join(tmpdir(), "uat-slice-6-noref-"));
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }));

    // The run aborts before any session starts; the scripted agent only keeps the real runtime out of it.
    const { stdout, status } = runDelivery(["run", "--json", "--task", "add a function"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [] }) },
    });
    expect(status).toBe(EXIT.aborted);
    const records = stepRecords(stdout) as Array<{ state: string; done: boolean }>;
    expect(records.at(-1)).toMatchObject({ state: "ABORTED", done: true });
  });
});

describe("AC: delivery status --json prints one JSON document with the same information as the plain report", () => {
  it("agrees with the plain report's headline and finish time for a closed run", async () => {
    const repo = sampleProjectCopy();
    const env = {
      ...process.env,
      XDG_STATE_HOME: scratchState(),
      [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = () => 'hi';\n")),
    };
    const finished = runDelivery(["run", "--task", "add a function that says hi"], { cwd: repo, env });
    expect(finished.status).toBe(EXIT.ok);

    const plain = runDelivery(["status", "--last"], { cwd: repo, env });
    const json = runDelivery(["status", "--last", "--json"], { cwd: repo, env });
    expect(json.status).toBe(EXIT.ok);
    const doc = JSON.parse(json.stdout) as Record<string, unknown>;

    expect(plain.stdout).toContain(doc.summary as string);
    expect(doc.outcome).toBe("closed");
    expect(doc.branch).toBe(`surface/${doc.run as string}`);
    expect(doc.escalation).toBeNull();
  });
});

describe("AC: delivery status --all lists every run in the repository with run id, task, start time and outcome, newest first", () => {
  it("lists a run's id, task, start time and outcome in both plain language and JSON", async () => {
    const repo = sampleProjectCopy();
    const env = {
      ...process.env,
      XDG_STATE_HOME: scratchState(),
      [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = () => 'hi';\n")),
    };
    const closed = runDelivery(["run", "--task", "add a function that says hi"], { cwd: repo, env });
    expect(closed.status).toBe(EXIT.ok);

    const listingJson = runDelivery(["status", "--all", "--json"], { cwd: repo, env });
    expect(listingJson.status).toBe(EXIT.ok);
    const summaries = JSON.parse(listingJson.stdout) as Array<{ run: string; task: string; startedAt: string | null; outcome: string }>;
    expect(summaries).toHaveLength(1);
    const [summary] = summaries;
    expect(summary).toMatchObject({ task: "add a function that says hi", outcome: "closed" });
    expect(summary?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const listingPlain = runDelivery(["status", "--all"], { cwd: repo, env });
    expect(listingPlain.stdout).toContain(summary?.run);
    expect(listingPlain.stdout).toContain("add a function that says hi");
    expect(listingPlain.stdout).toContain("(finished)");
  });
});

describe("AC: without --json, output stays plain-language even when piped, as a script that forgot the flag would see it", () => {
  it("never prints a JSON-parseable line on stdout for run or status", async () => {
    const repo = sampleProjectCopy();
    const env = {
      ...process.env,
      XDG_STATE_HOME: scratchState(),
      [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = () => 'hi';\n")),
    };
    // runDelivery always pipes (spawnSync with no tty), matching a CI runner.
    const run = runDelivery(["run", "--task", "add a function that says hi"], { cwd: repo, env });
    expect(run.status).toBe(EXIT.ok);
    for (const line of run.stdout.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).toThrow();
    }

    const status = runDelivery(["status", "--last"], { cwd: repo, env });
    for (const line of status.stdout.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});
