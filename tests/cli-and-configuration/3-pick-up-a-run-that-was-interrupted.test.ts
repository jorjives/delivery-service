// Slice 3: Pick Up a Run That Was Interrupted
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-16 against commit baedef8
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js), against a copy of the shipped sample
// project, the agent routed to the vendored scripted agent through the
// contributor-only test seam so the UAT needs no network, no API key and no
// real Claude Code sign-in. Steps 1-2 of the UAT script (start a run, Ctrl-C
// it once the agent is working) are driven by actually spawning the command
// and sending it a real SIGINT, not by faking an interrupted run's files on
// disk: that is the one part of this slice a person's own experience of it
// hinges on, and it is what killing a terminal actually does.

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

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-3-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-3-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-3-sample-"));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "sample-project") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

function completesWith(path: string, content: string): MockScript {
  return { expectations: [{ effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } }] };
}

/** A scripted turn held open, so a real Ctrl-C always lands mid-turn rather than racing a session that already finished. */
function heldOpen(path: string, content: string): MockScript {
  const [expectation] = completesWith(path, content).expectations;
  return { expectations: [{ ...expectation, delayMs: 5000 }] };
}

/** The run id a closing sentence's branch names, once the branch is stripped back to it. */
function runIdIn(stdout: string): string {
  const match = /branch (surface\/(\S+?))\.?$/m.exec(stdout);
  if (!match?.[2]) throw new Error(`no branch named in:\n${stdout}`);
  return match[2];
}

/**
 * Step 1-2 of the UAT: start `delivery run` for real and send it a real
 * SIGINT the moment "the agent is working" reaches stdout, exactly as a
 * person pressing Ctrl-C at that point in the transcript would. The agent
 * turn itself is held open with `delayMs` so the interrupt always lands
 * mid-turn rather than racing a session that has already finished.
 */
function interruptWhileWorking(args: string[], { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, "dist", "cli", "main.js"), ...args], { cwd, env });
    let stdout = "";
    let interrupted = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!interrupted && stdout.includes("- the agent is working")) {
        interrupted = true;
        child.kill("SIGINT");
      }
    });
    child.on("error", reject);
    child.on("exit", () => {
      if (!interrupted) reject(new Error(`process exited before it started working:\n${stdout}`));
      else resolvePromise(stdout);
    });
  });
}

describe("UAT: pick up a run that was interrupted", () => {
  it(
    "resumes the interrupted run on a bare re-run, then refuses a different task naming the unfinished run",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratchState();

      // Steps 1-2: start a run, Ctrl-C it as soon as the agent is working.
      const held = await scriptFile(heldOpen("reverse.js", "export const reverse = (w) => [...w].reverse().join('');\n"));
      await interruptWhileWorking(["run", "--task", "add a function that reverses a word, with a test"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: held },
      });

      // Step 3-4: re-run with no task at all; it picks the interrupted run up.
      const resumed = runDelivery(["run"], {
        cwd: repo,
        env: {
          ...process.env,
          XDG_STATE_HOME: state,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("reverse.js", "export const reverse = (w) => [...w].reverse().join('');\n")),
        },
      });
      expect(resumed.status).toBe(EXIT.ok);
      expect(resumed.stdout.split("\n")[0]).toMatch(/^Resuming run \S+: add a function that reverses a word, with a test$/);
      expect(resumed.stdout).not.toContain("Starting run");
      const runId = runIdIn(resumed.stdout);
      expect(git(repo, ["show", `surface/${runId}:reverse.js`])).toContain("reverse");

      // Step 5: start a new task, interrupt it the same way, then ask for a different one.
      const held2 = await scriptFile(heldOpen("double.js", "export const double = (n) => n * 2;\n"));
      await interruptWhileWorking(["run", "--task", "add a function that doubles a number, with a test"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: held2 },
      });
      const refused = runDelivery(["run", "--task", "something different"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state } });
      expect(refused.status).toBe(EXIT.configuration);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toContain("task: `add a function that doubles a number, with a test`");
      expect(refused.stderr).toContain("Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway.");
    },
    RUN_TIMEOUT * 2,
  );
});

describe("AC: delivery resume finishes the interrupted run without ever starting a new one", () => {
  it("says plainly when there is nothing to resume, and never starts a run", async () => {
    const repo = sampleProjectCopy();
    const nothing = runDelivery(["resume"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState() } });
    expect(nothing.status).toBe(EXIT.configuration);
    expect(nothing.stderr).toContain("there is nothing to pick up");
  });

  it(
    "picks up the one unfinished run",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratchState();

      const held = await scriptFile(heldOpen("f.js", "export const f = () => 1;\n"));
      await interruptWhileWorking(["run", "--task", "add a function"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: held },
      });

      const resumed = runDelivery(["resume"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")) },
      });
      expect(resumed.status).toBe(EXIT.ok);
      expect(resumed.stdout).toMatch(/^Resuming run \S+: add a function$/m);
      expect(resumed.stdout).not.toContain("Starting run");
    },
  );

  it("--last picks the most recently touched of several unfinished runs, without asking", async () => {
    const repo = sampleProjectCopy();
    const state = scratchState();

    const older = await scriptFile(heldOpen("older.js", "export const older = () => 1;\n"));
    await interruptWhileWorking(["run", "--task", "add an older function"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: older },
    });
    const newer = await scriptFile(heldOpen("newer.js", "export const newer = () => 1;\n"));
    // --fresh: an unfinished run already exists, so a different task needs it to start a second one alongside.
    await interruptWhileWorking(["run", "--task", "add a newer function", "--fresh"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: newer },
    });

    const resumed = runDelivery(["resume", "--last"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("newer.js", "export const newer = () => 1;\n")) },
    });
    expect(resumed.status).toBe(EXIT.ok);
    expect(resumed.stdout).toMatch(/^Resuming run \S+: add a newer function$/m);
  });
});

describe("AC: a resumed run keeps the settings it started with", () => {
  it("notes a conflicting --closer was ignored, and finishes with the closer it was pinned to", async () => {
    const repo = sampleProjectCopy();
    const state = scratchState();

    const held = await scriptFile(heldOpen("f.js", "export const f = () => 1;\n"));
    await interruptWhileWorking(["run", "--task", "add a function", "--closer", "commit-to-branch"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: held },
    });

    const resumed = runDelivery(["run", "--closer", "merge-back"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")) },
    });
    expect(resumed.status).toBe(EXIT.ok);
    expect(resumed.stdout).toContain("Note: a run keeps the settings it started with, so --closer was ignored.");
    expect(resumed.stdout).toContain("is committed on branch surface/"); // pinned to commit-to-branch, not merge-back's "merged into main"
  });
});

describe("AC: re-running a task whose earlier run already finished starts a new run", () => {
  it("does not reopen the finished run", async () => {
    const repo = sampleProjectCopy();
    const state = scratchState();
    const task = "add a function that greets someone, with a test";

    const first = runDelivery(["run", "--task", task], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("greet.js", "export const greet = () => 'hi';\n")) },
    });
    expect(first.status).toBe(EXIT.ok);

    const second = runDelivery(["run", "--task", task], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("greet.js", "export const greet = () => 'hi';\n")) },
    });
    expect(second.status).toBe(EXIT.ok);
    expect(second.stdout).toContain("Starting run");
    expect(runIdIn(second.stdout)).not.toBe(runIdIn(first.stdout));
  }, RUN_TIMEOUT * 2);
});

describe("AC: a run record that cannot be read back names the folder and how to start afresh", () => {
  it("stops with a plain-language message rather than a stack trace", async () => {
    const repo = sampleProjectCopy();
    const state = scratchState();

    const held = await scriptFile(heldOpen("f.js", "export const f = () => 1;\n"));
    const stdout = await interruptWhileWorking(["run", "--task", "add a function"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: held },
    });
    const runId = /^Starting run (\S+):/m.exec(stdout)?.[1];
    if (!runId) throw new Error(`no run id in:\n${stdout}`);
    const runDir = join(repo, ".delivery", "runs", runId);
    writeFileSync(join(runDir, "case.json"), "{ this is not json");

    const { stderr, status } = runDelivery(["resume", runId], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state } });
    expect(status).toBe(EXIT.unexpected);
    expect(stderr).toContain(runDir);
    expect(stderr).toContain("Remove that folder to start afresh.");
    expect(stderr).not.toContain("at Object.");
  });
});
