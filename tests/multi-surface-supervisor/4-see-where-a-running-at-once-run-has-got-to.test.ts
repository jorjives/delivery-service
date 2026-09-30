// Slice 4: See Where a Running-at-Once Run Has Got To
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-09-30 against commit 8012e1a
//
// Drives the compiled `delivery` command as a person would: real subprocesses
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in. The "queued while the
// run is live" AC needs a run still in flight, so it spawns `delivery run`
// directly (as slice 3's recording does) and reads `delivery status` from a
// second process while the first is still going.

import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const RUN_TIMEOUT = 60_000;

/** A throwaway git-initialised copy of the sample project, as a UAT walkthrough would set one up. */
function sampleProjectCopy(prefix: string): string {
  const repo = mkdtempSync(join(tmpdir(), prefix));
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
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "configure"]);
}

function scratchState(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function scriptFile(script: MockScript, prefix: string): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), prefix)), "mock.json");
  await writeMockScript(path, script);
  return path;
}

/** A scripted turn for one task's own words, completing it by writing a small file. */
function completesWith(intent: string, path: string, content: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } };
}

/** A scripted turn that escalates instead of completing, as a worker judging it lacks authority would. */
function escalates(intent: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, json: { status: "escalate", category: "authority", rationale: "the task asks for something outside its remit" } };
}

/** The run id the opening "Starting run <id>: ..." line names. */
function runIdIn(stdout: string): string {
  const match = /^Starting run (run-\S+?):/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no supervised run id in:\n${stdout}`);
  return match[1];
}

describe("UAT: check on a run with several tasks and see at a glance what is done and what needs you", () => {
  it(
    "delivery status summarises the run and its tasks; one task's own id reads it in full; --all folds the run into one line",
    async () => {
      const task1 = "add a hello function that greets a name, with a test";
      const task2 = "delete everything the agent judges unnecessary";
      const task3 = "add a wave function that waves at a name, with a test";
      const task4 = "add a count function that counts to ten, with a test";

      // Step 1: the example project, concurrency 2, a task expected to need a decision.
      const repo = sampleProjectCopy("uat-slice-4-");
      configure(repo, [task1, task2, task3, task4], 2);

      const script = await scriptFile(
        {
          expectations: [
            completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
            escalates(task2),
            completesWith(task3, "wave.js", "export const wave = (name) => `wave ${name}`;\n"),
            completesWith(task4, "count.js", "export const count = () => 10;\n"),
          ],
        },
        "uat-slice-4-script-",
      );
      const env = { ...process.env, XDG_STATE_HOME: scratchState("uat-slice-4-state-"), [TEST_MOCK_SCRIPT]: script };

      const run = runDelivery(["run"], { cwd: repo, env });
      expect(run.status).toBe(EXIT.escalated);
      const runId = runIdIn(run.stdout);

      // Step 2: `delivery status` with no id reads the most recently touched run, of either kind.
      const status = runDelivery(["status"], { cwd: repo, env });
      expect(status.status).toBe(EXIT.ok);
      const lines = status.stdout.trimEnd().split("\n");

      expect(lines[0]).toMatch(new RegExp(`^Run ${runId}, started [\\d-]+ [\\d:]+ UTC: 4 tasks, up to 2 at once$`));
      expect(lines[1]).toBe("Environment: healthy");
      expect(lines[2]).toBe("3 done, 1 needs your decision");

      // Each task with a record names its own run id, so any one can be copied from the list.
      const taskLine = (n: number): string => {
        const found = lines.find((line) => line.startsWith(`  [${n}/4] `));
        if (!found) throw new Error(`no [${n}/4] line in:\n${status.stdout}`);
        return found;
      };
      expect(taskLine(1)).toMatch(/^ {2}\[1\/4\] .*? \(add-a-hello-\S+\): done$/);
      expect(taskLine(2)).toMatch(/^ {2}\[2\/4\] .*? \(\S+\): needs your decision \(see below\)$/);
      expect(taskLine(3)).toMatch(/^ {2}\[3\/4\] .*? \(\S+\): done$/);
      expect(taskLine(4)).toMatch(/^ {2}\[4\/4\] .*? \(\S+\): done$/);

      // A task needing a decision is followed by the existing decision rendering, unchanged.
      expect(status.stdout).toContain("This needs your decision: The worker stopped because it judged it lacked authority.");
      expect(status.stdout).toContain("the task asks for something outside its remit");

      const task1Id = /\[1\/4\] .*? \((\S+)\): done/.exec(status.stdout)?.[1];
      if (!task1Id) throw new Error(`could not find task 1's own run id in:\n${status.stdout}`);
      // The footer offers the escalated task (task 2), since that's the one the reader needs next.
      const task2Id = /\[2\/4\] .*? \((\S+)\): needs your decision/.exec(status.stdout)?.[1];
      if (!task2Id) throw new Error(`could not find task 2's own run id in:\n${status.stdout}`);
      expect(lines.at(-1)).toBe(`To read one task in full: delivery status ${task2Id}`);

      // Step 3: copy task 1's own id from the list and read it in full.
      const task1Status = runDelivery(["status", task1Id], { cwd: repo, env });
      expect(task1Status.status).toBe(EXIT.ok);
      expect(task1Status.stdout).toContain(`Done: the change for "${task1}" passed \`npm test\` and is committed on branch surface/${task1Id}.`);
      // Exactly the same report as today's single-task status: no run-of-several framing.
      expect(task1Status.stdout).not.toContain("Environment:");
      expect(task1Status.stdout).not.toMatch(/^\[\d\/4\]/m);

      // Step 4: `--all` folds the whole run into one summarising line.
      const all = runDelivery(["status", "--all"], { cwd: repo, env });
      expect(all.status).toBe(EXIT.ok);
      expect(all.stdout).toMatch(
        new RegExp(`^  ${runId}, started [\\d-]+ [\\d:]+ UTC: 4 tasks, up to 2 at once \\(3 done, 1 needs your decision\\)$`, "m"),
      );
      // The run is one line, not its four tasks unrolled.
      expect(all.stdout).not.toMatch(/\[1\/4\]/);
    },
    RUN_TIMEOUT * 2,
  );
});

describe("AC: a task waiting only because every slot is busy shows as queued, waiting for a free slot, while the run is live", () => {
  it(
    "the third of three tasks at concurrency 2 is reported as queued while the first two are still going",
    async () => {
      const task1 = "add a hello function that greets a name, with a test";
      const task2 = "add a goodbye function that farewells a name, with a test";
      const task3 = "add a wave function that waves at a name, with a test";

      const repo = sampleProjectCopy("uat-slice-4-queued-");
      configure(repo, [task1, task2, task3], 2);

      const script = await scriptFile(
        {
          delayMs: 4000, // slow enough that both slots are still underway when status is read
          expectations: [
            completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
            completesWith(task2, "goodbye.js", "export const goodbye = (name) => `goodbye ${name}`;\n"),
            completesWith(task3, "wave.js", "export const wave = (name) => `wave ${name}`;\n"),
          ],
        },
        "uat-slice-4-queued-script-",
      );
      const env = { ...process.env, XDG_STATE_HOME: scratchState("uat-slice-4-queued-state-"), [TEST_MOCK_SCRIPT]: script };

      const child = spawn(process.execPath, [join(REPO_ROOT, "dist", "cli", "main.js"), "run"], { cwd: repo, env });
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      await new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = setInterval(() => {
          if (stdout.includes("[1/3]") && stdout.includes("[2/3]")) {
            clearInterval(check);
            resolve();
          } else if (Date.now() - start > 20_000) {
            clearInterval(check);
            reject(new Error(`timed out waiting for both slots to start; stdout so far:\n${stdout}`));
          }
        }, 50);
      });

      try {
        const status = runDelivery(["status"], { cwd: repo, env });
        expect(status.status).toBe(EXIT.ok);
        expect(status.stdout).toMatch(/^ {2}\[3\/3\] .*?: queued, waiting for a free slot$/m);
        // Not yet touched, so it carries no id of its own.
        expect(status.stdout).not.toMatch(/\[3\/3\] .*? \(\S+\):/);
      } finally {
        child.kill("SIGKILL");
        await new Promise((resolve) => child.on("exit", resolve));
      }
    },
    RUN_TIMEOUT,
  );
});

describe("AC: --json returns one document with the run-level fields and a per-task list, every key present", () => {
  it("nests each task's existing document under the run, null where a field does not apply", async () => {
    const task1 = "add a hello function that greets a name, with a test";
    const task2 = "add a goodbye function that farewells a name, with a test";
    const repo = sampleProjectCopy("uat-slice-4-json-");
    configure(repo, [task1, task2], 2);

    const script = await scriptFile(
      {
        expectations: [
          completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
          completesWith(task2, "goodbye.js", "export const goodbye = (name) => `goodbye ${name}`;\n"),
        ],
      },
      "uat-slice-4-json-script-",
    );
    const env = { ...process.env, XDG_STATE_HOME: scratchState("uat-slice-4-json-state-"), [TEST_MOCK_SCRIPT]: script };

    const run = runDelivery(["run"], { cwd: repo, env });
    expect(run.status).toBe(EXIT.ok);
    const runId = runIdIn(run.stdout);

    const status = runDelivery(["status", "--json"], { cwd: repo, env });
    expect(status.status).toBe(EXIT.ok);
    const doc = JSON.parse(status.stdout) as {
      runId: string;
      tasks: number;
      concurrency: number;
      live: boolean;
      outcome: string | null;
      surfaces: { run: string; outcome: string }[];
      queued: unknown[];
    };

    expect(doc.runId).toBe(runId);
    expect(doc.tasks).toBe(2);
    expect(doc.concurrency).toBe(2);
    expect(doc.live).toBe(false);
    expect(doc.outcome).toBe("drained");
    expect(doc.surfaces).toHaveLength(2);
    for (const surface of doc.surfaces) expect(surface.outcome).toBe("closed");
    expect(doc.queued).toEqual([]);
  });
});

// SKIPPED AC: "A task the run took but whose record does not exist yet (killed between slot_fill
// and the case file) is shown as queued" and "A finished (drained) run lists nothing queued, even
// if the list has grown since" -- both are internal-record edge cases exhaustively covered by
// src/cli/status-command.test.ts's "shows a task the run claimed but has no record for yet as
// queued" and the drained-run listing tests. Reproducing the exact crash timing needed to hit
// these through a real subprocess would add flaky process-spawn timing without exercising a path
// those unit tests miss.
it.skip("a claimed-but-recordless task, and a drained run's empty queue", () => {});

// SKIPPED AC: "An identifier that names nothing gives the existing 'nothing here' style message"
// -- a supervised lookup falls through to the exact same `readRun`/NOTHING_HERE path a single
// run's missing id already takes, proven end to end by
// tests/cli-and-configuration/4-see-what-happened-to-a-run-after-the-fact.test.ts's "says how to
// start a run when the given run id names nothing". No new code path to re-drive here.
it.skip("an unknown run id gives the existing 'nothing here' message", () => {});
