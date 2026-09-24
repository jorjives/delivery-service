// Slice 2: Queue Several Tasks in Plain Words and Run Them in Order
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-17 against commit 24bcc49
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in.
//
// Every scripted `MockScript` is re-read from the start by each new agent
// session (one session per `delivery run` process here, since a queue reuses
// one session across the tasks it starts within that process); consecutive
// expectations with no `when` clause are matched in order, one per task's turn.

import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
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
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-2-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-2-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-2-sample-"));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "sample-project") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function configure(repo: string, tasks: unknown[]): void {
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ tasks }));
}

/**
 * A scripted turn for one task's own words. Each task's agent invocation is a
 * fresh session that re-reads the script from the start (mock-script.ts), so a
 * queue's shared script file needs `promptContains` naming each task, rather
 * than relying on expectations being consumed in order across tasks.
 */
function completesWith(intent: string, path: string, content: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } };
}

/** A scripted turn held open, so a real Ctrl-C always lands mid-turn rather than racing a session that already finished. */
function heldOpen(intent: string, path: string, content: string): MockScript["expectations"][number] {
  return { ...completesWith(intent, path, content), delayMs: 5000 };
}

/** The run id a closing sentence's branch names, once the branch is stripped back to it. */
function runIdsIn(stdout: string): string[] {
  return [...stdout.matchAll(/Starting run (\S+?):/g)].flatMap(([, runId]) => (runId === undefined ? [] : [runId]));
}

/**
 * Start `delivery run` for real and send it a real SIGINT the moment the
 * `occurrence`-th "the agent is working" line reaches stdout, exactly as a
 * person pressing Ctrl-C on the second task's turn would.
 */
function interruptOnOccurrence(
  args: string[],
  { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv },
  occurrence: number,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, "dist", "cli", "main.js"), ...args], { cwd, env });
    let stdout = "";
    let interrupted = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const count = stdout.split("- the agent is working").length - 1;
      if (!interrupted && count >= occurrence) {
        interrupted = true;
        child.kill("SIGINT");
      }
    });
    child.on("error", reject);
    child.on("exit", () => {
      if (!interrupted) reject(new Error(`process exited before reaching occurrence ${occurrence}:\n${stdout}`));
      else resolvePromise(stdout);
    });
  });
}

describe("UAT: write a short to-do list in plain English and have the harness work through it", () => {
  it(
    "runs each task in order, resumes where an interruption left off, and reflects list edits on the next run",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratchState();
      const task1 = "add a function that greets a user by name, with a test";
      const task2 = "add a function that waves at a name, with a test";
      const task3 = "add a function that says goodnight, with a test";

      // Step 1: three short sentences under `tasks`.
      configure(repo, [task1, task2, task3]);
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      // Step 2: `delivery run`; interrupt while the second task is working.
      const script1 = await scriptFile({
        expectations: [completesWith(task1, "greet.js", "export const greet = (name) => `hi ${name}`;\n"), heldOpen(task2, "wave.js", "export const wave = (name) => `wave ${name}`;\n")],
      });
      const firstRun = await interruptOnOccurrence(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script1 } }, 2);

      expect(firstRun).toContain(`Task 1 of 3: ${task1}`);
      expect(firstRun).toContain(`Task 2 of 3: ${task2}`);
      const [runId1, runId2] = runIdsIn(firstRun);
      expect(runId1).toBeTruthy();
      expect(runId2).toBeTruthy();
      // Task 1 finished for real before the interruption landed on task 2.
      expect(git(repo, ["show", `surface/${runId1}:greet.js`])).toContain("hi ");

      // Step 3: `delivery run` again resumes task 2, then continues to task 3.
      const script2 = await scriptFile({
        expectations: [completesWith(task2, "wave.js", "export const wave = (name) => `wave ${name}`;\n"), completesWith(task3, "goodnight.js", "export const goodnight = () => `goodnight`;\n")],
      });
      const secondRun = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script2 } });
      expect(secondRun.stdout).toContain(`Resuming run ${runId2}`);
      expect(secondRun.stdout).not.toMatch(/Starting run \S+: add a function that greets/); // task 1 was not redone
      expect(secondRun.stdout).toContain(`Task 3 of 3: ${task3}`);
      expect(secondRun.stdout).toContain(EVERY_TASK_DONE);
      expect(secondRun.status).toBe(EXIT.ok);
      expect(git(repo, ["show", `surface/${runId2}:wave.js`])).toContain("wave ");

      // Step 4: add a new sentence at the top, reword the last one slightly.
      // (Distinct opening words from every other task's sentence: a run id is
      // derived from a task's first few words plus the second it started, and
      // two tasks starting in the same second must not collide on that id.)
      const newTop = "add a function that counts down from three, with a test";
      const reworded = "add a function that whispers goodnight, with a test";
      configure(repo, [newTop, task1, task2, reworded]);
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "edit the list"]);

      const script3 = await scriptFile({
        expectations: [
          completesWith(newTop, "countdown.js", "export const countdown = () => [3, 2, 1];\n"),
          completesWith(reworded, "goodnight2.js", "export const goodnight2 = () => `goodnight (whispered)`;\n"),
        ],
      });
      const thirdRun = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script3 } });
      // Only the new top entry and the reworded entry run, framed as tasks "of 4".
      expect(thirdRun.stdout).toContain(`Task 1 of 4: ${newTop}`);
      expect(thirdRun.stdout).toContain(`Task 4 of 4: ${reworded}`);
      expect(thirdRun.stdout).not.toMatch(/Task 2 of 4/);
      expect(thirdRun.stdout).not.toMatch(/Task 3 of 4/);
      expect(thirdRun.stdout).toContain(EVERY_TASK_DONE);
      expect(thirdRun.status).toBe(EXIT.ok);

      // Step 5: a final `delivery run` says every queued task is done, with no agent needed.
      const fourthRun = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state } });
      expect(fourthRun.stdout.trim()).toBe(EVERY_TASK_DONE);
      expect(fourthRun.status).toBe(EXIT.ok);
    },
    RUN_TIMEOUT * 4,
  );
});

describe("AC: an explicit task flag still runs exactly one ad-hoc task and ignores the list", () => {
  it("does not print a queue heading and does not disturb the list's own runs", async () => {
    const repo = sampleProjectCopy();
    configure(repo, ["add a function that greets a user by name, with a test", "add a function that waves at a name, with a test"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const adHoc = "add a function that counts to ten, with a test";
    const run = runDelivery(["run", "--task", adHoc], {
      cwd: repo,
      env: {
        ...process.env,
        [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [completesWith(adHoc, "count.js", "export const count = () => 10;\n")] }),
        XDG_STATE_HOME: scratchState(),
      },
    });

    expect(run.status).toBe(EXIT.ok);
    expect(run.stdout).not.toMatch(/Task \d+ of \d+/);
    expect(run.stdout).toMatch(/^Starting run \S+: add a function that counts to ten/m);
  });
});

describe("AC: an escalated task stops the list, names the task, and running again stops at the same task", () => {
  it("leaves the rest of the list alone and does not skip past the stopped task on the next run", async () => {
    const repo = sampleProjectCopy();
    const task1 = "add a function that greets a user by name, with a test";
    const task2 = "delete everything the agent judges unnecessary";
    configure(repo, [task1, task2]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const script = await scriptFile({
      expectations: [
        completesWith(task1, "greet.js", "export const greet = (name) => `hi ${name}`;\n"),
        { when: { promptContains: task2 }, json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
      ],
    });
    const first = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: script } });
    expect(first.status).toBe(EXIT.escalated);
    expect(first.stdout).toContain(`Task 2 of 2: ${task2}`);
    expect(first.stdout).toContain("This needs your decision: The worker stopped because it judged it lacked authority.");
    expect(first.stdout).toContain("Task 2 of 2 needs your decision before I can go on, so I've left the rest of the list alone.");

    // Running again re-reports the same stopped task rather than skipping it or redoing task 1.
    const second = runDelivery(["run"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState() } });
    expect(second.status).toBe(EXIT.escalated);
    expect(second.stdout).toContain(`Task 2 of 2: ${task2}`);
    expect(second.stdout).not.toMatch(/Starting run \S+: add a function that greets/); // task 1 was not redone
    expect(second.stdout).toContain("This needs your decision: The worker stopped because it judged it lacked authority.");
  }, RUN_TIMEOUT * 2);
});

describe("AC: a configuration with both a single task and a task list is refused before anything runs", () => {
  it("names the field and the fix with the configuration-problem exit code", () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ task: { intent: "one thing" }, tasks: ["another thing"] }));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const run = runDelivery(["run"], { cwd: repo });
    expect(run.status).toBe(EXIT.configuration);
    expect(run.stderr).toContain(
      "this project has both `task` and `tasks` set. Use `tasks` for a list of things to do, or `task` for a single one-off, not both.",
    );
  });

  // SKIPPED AC: the empty-list, empty-entry and duplicate-entry refusals share the same
  // load-time refinement as the both-task-and-tasks case above, and their exact wording is
  // already driven directly against the schema in src/cli/config.test.ts (e.g. "`tasks` is
  // empty...", "`tasks` item 2 is empty...", `sameTask`). Re-driving each one through a real
  // subprocess here would add process-spawn time without exercising any code path this file's
  // representative case does not already reach.
  it.skip("also refuses an empty list, an empty entry, and two identical entries", () => {});
});

describe("AC: `delivery status` for a run answering a queue entry says which task of how many it is", () => {
  it("reports the position from the list as currently written", async () => {
    const repo = sampleProjectCopy();
    const task1 = "add a function that greets a user by name, with a test";
    const task2 = "add a function that waves at a name, with a test";
    configure(repo, [task1, task2]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const run = runDelivery(["run"], {
      cwd: repo,
      env: {
        ...process.env,
        [TEST_MOCK_SCRIPT]: await scriptFile({
          expectations: [
            completesWith(task1, "greet.js", "export const greet = (name) => `hi ${name}`;\n"),
            completesWith(task2, "wave.js", "export const wave = (name) => `wave ${name}`;\n"),
          ],
        }),
        XDG_STATE_HOME: scratchState(),
      },
    });
    expect(run.status).toBe(EXIT.ok);
    const [runId1 = ""] = runIdsIn(run.stdout);

    const status = runDelivery(["status", runId1], { cwd: repo });
    expect(status.status).toBe(EXIT.ok);
    expect(status.stdout).toContain("It is task 1 of 2 on your list.");
  });
});

// SKIPPED AC: "Inserting a new entry anywhere runs it in its place and does not disturb the
// others; reordering changes only the order of visiting; deleting a finished entry leaves its
// run in history" — the UAT above already drives an insertion at the top live. Reordering and
// deletion are pure consequences of the same content-identity mechanism (findQueueRun /
// queuePositionOf compare the task's own words, never list position), which is already
// covered directly, including reordering and deletion, by src/cli/queue.test.ts. Re-driving
// them through a full subprocess here would duplicate that coverage without a new code path.
it.skip("reordering and deleting entries behave as the queue's content-identity mechanism already guarantees", () => {});
