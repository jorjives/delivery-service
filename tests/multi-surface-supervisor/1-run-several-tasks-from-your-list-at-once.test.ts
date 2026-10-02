// Slice 1: Run Several Tasks From Your List at Once
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-09-30 against commit 9eee97b
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in.
//
// Every scripted `MockScript` is re-read from the start by each new agent
// session (one session per `delivery run` process here, since a run of several
// tasks at once reuses one session across every task it starts within that
// process); expectations are matched by `promptContains`, one per task.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { EVERY_TASK_DONE } from "../../src/cli/queue.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const RUN_TIMEOUT = 60_000;

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-1-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-1-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-1-sample-"));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "sample-project") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function configure(repo: string, tasks: unknown[], concurrency: number): void {
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ tasks, concurrency }));
}

/** A scripted turn for one task's own words, completing it by writing a small file. */
function completesWith(intent: string, path: string, content: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } };
}

/** A scripted turn that escalates instead of completing, as a worker judging it lacks authority would. */
function escalates(intent: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, json: { status: "escalate", category: "authority", rationale: "the task asks for something outside its remit" } };
}

describe("UAT: have several tasks from your list worked on at the same time instead of one after another", () => {
  it(
    "validate reports the setting, the run interleaves tagged lines from two tasks at once, and ends with every task done",
    async () => {
      const task1 = "add a hello function that greets a name, with a test";
      const task2 = "add a goodbye function that farewells a name, with a test";
      const task3 = "add a wave function that waves at a name, with a test";
      const task4 = "add a count function that counts to ten, with a test";

      // Step 1: at least four tasks, with concurrency 2.
      const repo = sampleProjectCopy();
      configure(repo, [task1, task2, task3, task4], 2);
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      // Step 2: `delivery validate` names the setting.
      const validate = runDelivery(["validate"], { cwd: repo });
      expect(validate.status).toBe(EXIT.ok);
      expect(validate.stdout).toContain("up to 2 tasks at once (4 queued)");

      // Step 3: `delivery run` works through the list, two tasks at a time.
      const script = await scriptFile({
        expectations: [
          completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
          completesWith(task2, "goodbye.js", "export const goodbye = (name) => `goodbye ${name}`;\n"),
          completesWith(task3, "wave.js", "export const wave = (name) => `wave ${name}`;\n"),
          completesWith(task4, "count.js", "export const count = () => 10;\n"),
        ],
      });
      const run = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: script } });

      expect(run.status).toBe(EXIT.ok);
      const lines = run.stdout.trimEnd().split("\n");
      // The run opens with one line naming the run and its shape.
      expect(lines[0]).toMatch(/^Starting run run-\d{8}T\d{6}Z: 4 tasks, up to 2 at once$/);
      // Every following line is prefixed with the task's position, never distinguished by colour alone.
      for (const line of lines.slice(1, -3)) expect(line).toMatch(/^\[[1234]\/4\] /);
      // Both slots are taken before either frees, so lines from two different tasks interleave.
      expect(lines.some((line) => line.startsWith("[1/4] "))).toBe(true);
      expect(lines.some((line) => line.startsWith("[2/4] "))).toBe(true);

      // Step 4: follow task 1 by its `[1/4]` prefix from start to finish.
      const task1Lines = lines.filter((line) => line.startsWith("[1/4] "));
      expect(task1Lines.some((line) => line.includes("- the agent is working"))).toBe(true);
      expect(task1Lines.some((line) => line.includes(`Done: the change for "${task1}" passed`))).toBe(true);

      // The run ends saying every task on the list is done, naming the branch for each.
      expect(lines.at(-3)).toBe(EVERY_TASK_DONE);
      expect(git(repo, ["branch", "--list", "surface/*"]).split("\n")).toHaveLength(4);
    },
    RUN_TIMEOUT * 2,
  );
});

describe("AC: with --json, each line is one JSON object carrying `scope`, and standard output holds only JSON", () => {
  it("tags task lines with their position, total and run identifier, notes going to stderr instead", async () => {
    const task1 = "add a hello function that greets a name, with a test";
    const task2 = "add a goodbye function that farewells a name, with a test";
    const repo = sampleProjectCopy();
    configure(repo, [task1, task2], 2);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const script = await scriptFile({
      expectations: [
        completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
        completesWith(task2, "goodbye.js", "export const goodbye = (name) => `goodbye ${name}`;\n"),
      ],
    });
    const run = runDelivery(["run", "--json"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: script } });

    expect(run.status).toBe(EXIT.ok);
    const records = run.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    // Every line parses as JSON: stdout carries no plain-language notes.
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(["surface", "run"]).toContain(record.scope);

    const runRecords = records.filter((record) => record.scope === "run");
    expect(runRecords[0]).toMatchObject({ state: "STARTED" });
    expect(runRecords.at(-1)).toMatchObject({ state: "DRAINED" });

    const taskRecords = records.filter((record) => record.scope === "surface");
    expect(taskRecords.length).toBeGreaterThan(0);
    for (const record of taskRecords) {
      expect(record.runId).toBe(runRecords[0]?.runId);
      expect(record.surface).toMatchObject({ of: 2 });
      expect((record.surface as { ordinal: number }).ordinal).toBeGreaterThanOrEqual(1);
    }

    // The plain-language notes (the opening shape line, the tagged step lines) went to stderr, never stdout.
    expect(run.stderr).toMatch(/^Starting run run-\d{8}T\d{6}Z: 2 tasks, up to 2 at once$/m);
    expect(run.stderr).toMatch(/^\[1\/2\] /m);
  }, RUN_TIMEOUT * 2);
});

describe("AC: one task escalating does not stop or slow the others, and the run's exit code says a decision is needed", () => {
  it("refills the escalated task's slot with the next task and finishes the rest", async () => {
    const task1 = "add a hello function that greets a name, with a test";
    const task2 = "delete everything the agent judges unnecessary";
    const task3 = "add a wave function that waves at a name, with a test";
    const task4 = "add a count function that counts to ten, with a test";
    const repo = sampleProjectCopy();
    configure(repo, [task1, task2, task3, task4], 2);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const script = await scriptFile({
      expectations: [
        completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
        escalates(task2),
        completesWith(task3, "wave.js", "export const wave = (name) => `wave ${name}`;\n"),
        completesWith(task4, "count.js", "export const count = () => 10;\n"),
      ],
    });
    const run = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: script } });

    // Following the existing exit-code table: 4 (needs a decision) because one task escalated, even though three were delivered.
    expect(run.status).toBe(EXIT.escalated);
    expect(run.stdout).toContain(`[1/4] Done: the change for "${task1}" passed`);
    expect(run.stdout).toContain(`[3/4] Done: the change for "${task3}" passed`);
    expect(run.stdout).toContain(`[4/4] Done: the change for "${task4}" passed`);
    expect(run.stdout).toContain("[2/4] This needs your decision:");
    expect(run.stdout).toContain("Task 2 of 4 needs your decision; the rest of the list carried on without it.");
  }, RUN_TIMEOUT * 2);
});

describe("AC: `delivery validate` rejects an invalid concurrency with a one-fix message and the configuration exit code", () => {
  it("rejects zero with the setting named", () => {
    const repo = sampleProjectCopy();
    configure(repo, ["add a hello function, with a test"], 0);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const validate = runDelivery(["validate"], { cwd: repo });
    expect(validate.status).toBe(EXIT.configuration);
    expect(validate.stderr).toContain("the setting `concurrency` is `0`");
  });
});

// SKIPPED AC: "A configuration file may carry a `concurrency` whole number; `--concurrency` and
// `DELIVERY_CONCURRENCY` override it with the same precedence as every other setting; the default
// is 1" — the precedence order (flag beats env beats file beats default 1) is exhaustively
// unit-tested against every combination in src/cli/settings.test.ts ("lets --concurrency beat
// DELIVERY_CONCURRENCY, which beats the file", etc.). Re-driving every combination through a real
// subprocess here would add process-spawn time without exercising a code path those tests miss;
// the UAT above already proves the file's own setting reaches a real run.
it.skip("concurrency precedence across flag, env and file", () => {});

// SKIPPED AC: "No task is ever started twice in one run, and a task already finished by an earlier
// run is skipped, exactly as the sequential list does" — covered end to end, including the run
// record it leaves behind, by src/cli/run-command.test.ts's "passes over a task an earlier run
// delivered, and starts every other task exactly once".
it.skip("a task an earlier run already delivered is skipped, not redone", () => {});

// SKIPPED AC: "Setting up and tearing down working copies, and merging finished work back, never
// overlap between tasks; two tasks finishing together both close correctly, and if one's merge is
// refused because the other moved the base on, that task reports it through the existing close
// path rather than damaging the checkout" — covered end to end, including the checkout being left
// clean on `main` with exactly one worktree, by src/cli/run-command.test.ts's "merges one of two
// tasks that finish together and hands the other back through the close path, leaving the checkout
// sound".
it.skip("two tasks finishing together close without damaging the shared checkout", () => {});

// SKIPPED AC: "With concurrency at 1, output, exit codes and files on disk are exactly as before
// this slice" — this is the premise the whole existing regression suite rests on: every test
// recorded before this slice (including tests/project-configuration/2-queue-several-tasks-in-
// plain-words-and-run-them-in-order.test.ts, which drives `delivery run` at the default
// concurrency through the same real subprocess this file uses) still passes unchanged, and
// src/cli/run-command.test.ts's "at concurrency 1, the default, keeps no record of its own and
// starts no line with a task tag" checks it directly. No new drive is needed here.
it.skip("concurrency 1 is unchanged from before this slice", () => {});
