// Slice 1: A Second Run on the Same Repository Is Refused, or Quietly Skipped
// Source: docs/superpowers/specs/2026-10-21-named-schedules-slices.md
// Recorded: 2026-10-22 against commit 525adcc
//
// Drives the compiled `delivery` command as an operator would: a first run is
// really started over the compiled dist/cli/main.js against a copy of the
// shipped sample project and held mid-turn (the scripted agent is delayed, via
// the contributor-only test seam, so no network or sign-in is needed), and the
// second terminal's commands are real subprocesses on the same repository.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const TIMEOUT = 60_000;
const STALE_WINDOW_MS = 10_000; // src/repo-lock.ts STALE_MS: the existing stale window

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), `uat-ns-1-${prefix}-`));

function sampleProjectCopy(): string {
  const repo = scratch("sample");
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "sample-project") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(scratch("script"), "mock.json");
  await writeMockScript(path, script);
  return path;
}

/** A scripted turn held open for `delayMs`, so the first run is reliably still going when the second starts. */
async function heldOpen(delayMs: number): Promise<string> {
  const content = "export const f = () => 1;\n";
  return scriptFile({
    expectations: [{ delayMs, effects: [{ write: { path: "f.js", content } }], json: { status: "completed", rationale: "added f.js" } }],
  });
}

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

/** Step 1: start a run for real and resolve once the agent is working, i.e. the run is going and holds the repository. */
function startRunAndLeaveGoing(repo: string, state: string, script: string): Promise<ChildProcess> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, "dist", "cli", "main.js"), "run", "--task", "add a function"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script },
    });
    children.push(child);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes("- the agent is working")) resolvePromise(child);
    });
    child.on("error", reject);
    child.on("exit", () => reject(new Error(`first run ended before it was going:\n${stdout}`)));
  });
}

const second = (repo: string, state: string, args: string[]) =>
  runDelivery(args, { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state } });

describe("UAT: two runs on one project never work on the same item at once", () => {
  it(
    "refuses the second run, and the idle-option run prints one line and ends without an error",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratch("state");
      const first = await startRunAndLeaveGoing(repo, state, await heldOpen(20_000));

      // Step 2: a second run on the same project is refused with a clear message.
      const refused = second(repo, state, ["run", "--task", "add another function"]);
      expect(refused.status).toBe(EXIT.configuration);
      expect(refused.stderr).toContain("Another run is already going here");
      expect(refused.stderr).toContain("delivery status");

      // Step 3: with the idle option it skips quietly and succeeds.
      const idle = second(repo, state, ["run", "--task", "add another function", "--if-idle"]);
      expect(idle.status).toBe(EXIT.ok);
      expect(idle.stdout.trim()).toBe("Skipped: another run is going here");
      expect(idle.stderr).toBe("");

      expect(first.exitCode).toBeNull(); // the first run carried on throughout
    },
    TIMEOUT,
  );
});

describe("AC: --if-idle on a repository with no run going behaves like a normal run", () => {
  it(
    "runs the task exactly as without the flag",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratch("state");
      const script = await scriptFile({
        expectations: [
          { effects: [{ write: { path: "f.js", content: "export const f = () => 1;\n" } }], json: { status: "completed", rationale: "added f.js" } },
        ],
      });
      const result = runDelivery(["run", "--task", "add a function", "--if-idle"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script },
      });
      expect(result.status).toBe(EXIT.ok);
      expect(result.stdout).not.toContain("Skipped: another run is going here");
      expect(result.stdout).toMatch(/Starting run \S+/);
    },
    TIMEOUT,
  );
});

describe("AC: a run on a different repository is never blocked by a run here", () => {
  it(
    "lets a run on another project start while this one is going",
    async () => {
      const state = scratch("state");
      await startRunAndLeaveGoing(sampleProjectCopy(), state, await heldOpen(20_000));

      const otherRepo = sampleProjectCopy();
      const script = await scriptFile({
        expectations: [
          { effects: [{ write: { path: "f.js", content: "export const f = () => 1;\n" } }], json: { status: "completed", rationale: "added f.js" } },
        ],
      });
      const other = runDelivery(["run", "--task", "add a function"], {
        cwd: otherRepo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script },
      });
      expect(other.status).toBe(EXIT.ok);
      expect(other.stderr).not.toContain("Another run is already going here");
    },
    TIMEOUT,
  );
});

describe("AC: after a run is killed, the next run takes over once the stale window has passed", () => {
  it(
    "runs normally once the stale window has passed, rather than being skipped or refused",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratch("state");
      const first = await startRunAndLeaveGoing(repo, state, await heldOpen(60_000));
      first.kill("SIGKILL"); // no chance to release the lock, as when a machine dies
      await new Promise((resolvePromise) => first.once("exit", resolvePromise));

      await new Promise((resolvePromise) => setTimeout(resolvePromise, STALE_WINDOW_MS + 2_000));

      const script = await scriptFile({
        expectations: [
          { effects: [{ write: { path: "f.js", content: "export const f = () => 1;\n" } }], json: { status: "completed", rationale: "added f.js" } },
        ],
      });
      const next = runDelivery(["run", "--task", "add a function", "--if-idle"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: script },
      });
      expect(next.stdout).not.toContain("Skipped: another run is going here");
      expect(next.stderr).not.toContain("Another run is already going here");
    },
    TIMEOUT,
  );
});

describe("AC: --if-idle is described in the CLI reference as a general flag", () => {
  it("lists it for any run nobody is watching, not only schedules", () => {
    const reference = readFileSync(join(REPO_ROOT, "docs", "cli-reference.md"), "utf-8");
    const row = reference.split("\n").find((line) => line.startsWith("| `--if-idle`"));
    expect(row).toBeDefined();
    expect(row).toContain("Skipped: another run is going here");
    expect(row).toMatch(/timer, cron or CI/);
    expect(row).not.toMatch(/schedule-only|only (for|by) schedules?/i);
  });
});
