// Slice 3: Pick Up a Running-at-Once Run After a Crash, and Refuse a Second One
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-09-30 against commit 46d0895
//
// Drives the compiled `delivery` command as a person would, exactly as the UAT script
// says: an example project with four tasks and concurrency 2, a second terminal
// started while the first is going, Ctrl-C on the first, then `delivery run` again to
// let it finish. Real subprocesses (spawn, not spawnSync, for the one that must be
// interrupted mid-flight), a real git checkout, the vendored scripted agent standing
// in for a real one through the contributor-only test seam, no network and no API key.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { EVERY_TASK_DONE, STOPPED_PART_WAY } from "../../src/cli/queue.js";
import { DELIVERY_BIN, REPO_ROOT, runDelivery, git } from "../helpers.js";

const RUN_TIMEOUT = 90_000;

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

/** A scripted turn for one task's own words, completing it by writing a small file. */
function completesWith(intent: string, path: string, content: string): MockScript["expectations"][number] {
  return { when: { promptContains: intent }, effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } };
}

async function scriptFile(script: MockScript, dir: string): Promise<string> {
  const path = join(dir, "mock.json");
  await writeMockScript(path, script);
  return path;
}

/** Start `delivery run` as a live subprocess, so a signal can be sent to it mid-flight. */
function startDelivery(repo: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [DELIVERY_BIN, "run"], { cwd: repo, env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const waitUntil = (predicate: () => boolean, timeoutMs: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (predicate()) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(check);
          reject(new Error(`timed out waiting; stdout so far:\n${stdout}`));
        }
      }, 50);
    });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, waitUntil, exit, stdout: () => stdout, stderr: () => stderr };
}

describe("UAT: stop a run that has several tasks going, start it again, and have it carry on; be told plainly about a second run on top of a live one", () => {
  it(
    "a second terminal is refused straight away naming the live run; after Ctrl-C, the restarted run says which tasks it is picking up, carries on, and ends with every task done once, each on its own branch",
    async () => {
      const task1 = "add a hello function that greets a name, with a test";
      const task2 = "add a goodbye function that farewells a name, with a test";
      const task3 = "add a wave function that waves at a name, with a test";
      const task4 = "add a count function that counts to ten, with a test";

      // Step 1: the example project, four tasks, concurrency 2.
      const repo = sampleProjectCopy("uat-slice-3-");
      configure(repo, [task1, task2, task3, task4], 2);

      const scriptDir = mkdtempSync(join(tmpdir(), "uat-slice-3-script-"));
      const script: MockScript = {
        delayMs: 4000, // slow enough that both slots are still underway when the refusal and the interrupt are tried
        expectations: [
          completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
          completesWith(task2, "goodbye.js", "export const goodbye = (name) => `goodbye ${name}`;\n"),
          completesWith(task3, "wave.js", "export const wave = (name) => `wave ${name}`;\n"),
          completesWith(task4, "count.js", "export const count = () => 10;\n"),
        ],
      };
      const scriptPath = await scriptFile(script, scriptDir);
      const state = mkdtempSync(join(tmpdir(), "uat-slice-3-state-"));
      const env = { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: scriptPath };

      // `delivery run` in the first terminal.
      const first = startDelivery(repo, env);
      await first.waitUntil(() => first.stdout().includes("[1/4]") && first.stdout().includes("[2/4]"), 20_000);

      // Step 2: a second terminal, same folder, while two tasks are going.
      const second = spawnSync(process.execPath, [DELIVERY_BIN, "run"], { cwd: repo, env, encoding: "utf-8" });
      expect(second.status).toBe(EXIT.configuration);
      expect(second.stdout).toBe("");
      expect(second.stderr).toContain("Another run is already going here");
      expect(second.stderr).toMatch(/started `[\d-]+ [\d:]+ UTC`/);
      expect(second.stderr).toContain("4 tasks, up to 2 at once");
      expect(second.stderr).toContain("Run `delivery status`");

      // Step 3: Ctrl-C in the first terminal.
      first.child.kill("SIGINT");
      const exitCode = await first.exit;

      expect(exitCode).toBe(EXIT.aborted);
      expect(first.stderr().trimEnd()).toBe(STOPPED_PART_WAY);

      // Step 4: `delivery run` again, and let it finish. No delay needed this time.
      const resumeScriptPath = await scriptFile({ ...script, delayMs: 0 }, scriptDir);
      const resumed = runDelivery(["run"], { cwd: repo, env: { ...env, [TEST_MOCK_SCRIPT]: resumeScriptPath } });

      expect(resumed.status).toBe(EXIT.ok);
      const lines = resumed.stdout.trimEnd().split("\n");
      // The restarted run says which run it is picking up, at the shape it started with.
      expect(lines[0]).toMatch(/^Picking up run run-\d{8}T\d{6}Z: 4 tasks, up to 2 at once$/);
      // Both tasks that were under way are resumed, not started over; the rest start once.
      expect(resumed.stdout).toContain("[1/4] Resuming run");
      expect(resumed.stdout).toContain("[2/4] Resuming run");
      expect(resumed.stdout).toMatch(/^\[3\/4\] Starting run /m);
      expect(resumed.stdout).toMatch(/^\[4\/4\] Starting run /m);
      expect(lines.at(-3)).toBe(EVERY_TASK_DONE);

      // Every task ends up done exactly once, each on its own branch: no working copy set up
      // twice and no finished work merged twice.
      const branches = git(repo, ["branch", "--list", "surface/*"]).split("\n").filter(Boolean);
      expect(branches).toHaveLength(4);
      expect(new Set(branches).size).toBe(4);
      expect(git(repo, ["status", "--porcelain"])).toBe("");
      expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
    },
    RUN_TIMEOUT,
  );
});

describe("AC: a lock left behind by a killed process does not block the resume that follows it", () => {
  it(
    "an outright kill (no graceful signal, no chance to release the lock by hand) is followed by a `delivery run` that reclaims it and carries the run on",
    async () => {
      const task1 = "add a hello function that greets a name, with a test";
      const task2 = "add a goodbye function that farewells a name, with a test";

      const repo = sampleProjectCopy("uat-slice-3-kill-");
      configure(repo, [task1, task2], 2);

      const scriptDir = mkdtempSync(join(tmpdir(), "uat-slice-3-kill-script-"));
      const script: MockScript = {
        delayMs: 4000,
        expectations: [
          completesWith(task1, "hello.js", "export const hello = (name) => `hello ${name}`;\n"),
          completesWith(task2, "goodbye.js", "export const goodbye = (name) => `goodbye ${name}`;\n"),
        ],
      };
      const scriptPath = await scriptFile(script, scriptDir);
      const state = mkdtempSync(join(tmpdir(), "uat-slice-3-kill-state-"));
      const env = { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: scriptPath };

      const first = startDelivery(repo, env);
      await first.waitUntil(() => first.stdout().includes("[1/2]") && first.stdout().includes("[2/2]"), 20_000);

      // An outright kill: no signal handler runs, so `proper-lockfile`'s own exit hook never
      // fires and the lock file is left on disk exactly as a crashed machine would leave it.
      first.child.kill("SIGKILL");
      await first.exit;

      // `proper-lockfile`'s own staleness window (src/cli/repo-lock.ts's STALE_MS): a run
      // started within it is refused as though the old one were live, so the live drive
      // waits it out rather than asserting against internal lock state.
      await new Promise((resolve) => setTimeout(resolve, 11_000));

      const resumeScriptPath = await scriptFile({ ...script, delayMs: 0 }, scriptDir);
      const resumed = runDelivery(["run"], { cwd: repo, env: { ...env, [TEST_MOCK_SCRIPT]: resumeScriptPath } });

      expect(resumed.status).toBe(EXIT.ok);
      expect(resumed.stdout).toMatch(/^Picking up run run-\d{8}T\d{6}Z: 2 tasks, up to 2 at once$/m);
      expect(resumed.stdout.trimEnd().split("\n").at(-3)).toBe(EVERY_TASK_DONE);
      expect(git(repo, ["branch", "--list", "surface/*"]).split("\n").filter(Boolean)).toHaveLength(2);
    },
    RUN_TIMEOUT,
  );
});

// SKIPPED AC: "Starting `delivery run` while a supervised run is live ... at any concurrency,
// is refused" for entry points other than a plain `delivery run` (a single-task `delivery run
// --task`, `delivery resume`, a one-at-a-time list) -- exhaustively covered, with the same
// refusal message and exit code, by src/cli/run-command.test.ts's parametrised "refuses %s
// while a run of several at once is going here, naming it, before anything starts". Re-driving
// every entry point through a real subprocess here would add process-spawn time without
// exercising a code path that test misses; the UAT above already proves the plain `delivery
// run` case through the real binary.
it.skip("every entry point is refused while a supervised run is live, not only `delivery run`", () => {});
