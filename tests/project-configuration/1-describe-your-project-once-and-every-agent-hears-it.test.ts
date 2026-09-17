// Slice 1: Describe Your Project Once and Every Agent Hears It
// Source: docs/superpowers/specs/2026-09-17-project-configuration-slices.md
// Recorded: 2026-09-17 against commit c1351a8
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (over the compiled dist/cli/main.js), against a copy of the shipped sample
// project, the agent routed to the vendored scripted agent through the
// contributor-only test seam so the UAT needs no network, no API key and no
// real Claude Code sign-in. What the scripted agent is told is not directly
// inspectable through claude-mock's journal (it only records the task-level
// turn, not the system prompt), so the mechanism the UAT depends on — the
// description reaching the agent's instructions — is checked the way the
// codebase already checks it: the run's own case.json, which is the one
// record `assemblePrompt` reads from (src/prompt-assembly.ts:103-107, itself
// covered for both roles by src/prompt-assembly.test.ts).

import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
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

interface CaseJson {
  header: { domainPrompt?: string };
}

function caseJsonFor(repo: string, runId: string): CaseJson {
  return JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as CaseJson;
}

/**
 * Step 1-2 of the interruption AC: start `delivery run` for real and send it
 * a real SIGINT the moment "the agent is working" reaches stdout, exactly as
 * a person pressing Ctrl-C at that point in the transcript would.
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

describe("UAT: describe the project once, and have every agent hear it", () => {
  it(
    "pins the description into the run, the finished work follows it, and an emptied description stops the command",
    async () => {
      const repo = sampleProjectCopy();
      const domain =
        "A small internal tool that tracks who's on call this week. All user-facing messages are written in French.";

      // Step 1: add a `domain` line to delivery.config.json.
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ domain }));
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      // Step 2-3: run a task; the finished work follows the distinctive instruction.
      const run = runDelivery(["run", "--task", "add a function that greets a user by name, with a test"], {
        cwd: repo,
        env: {
          ...process.env,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("greet.js", "export const greet = (name) => `Bonjour, ${name}`;\n")),
          XDG_STATE_HOME: scratchState(),
        },
      });
      expect(run.status).toBe(EXIT.ok);
      const runId = runIdIn(run.stdout);
      expect(git(repo, ["show", `surface/${runId}:greet.js`])).toContain("Bonjour");

      // The mechanism behind that instruction reaching the agent: the run's
      // own record pins the description, word for word.
      expect(caseJsonFor(repo, runId).header.domainPrompt).toBe(domain);

      // Step 4: empty the description; the command stops at once.
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ domain: "   " }));
      const emptied = runDelivery(["run", "--task", "add a function that says farewell, with a test"], { cwd: repo });
      expect(emptied.status).toBe(EXIT.configuration);
      expect(emptied.stdout).toBe("");
      expect(emptied.stderr).toBe(
        "I can't use " +
          join(repo, "delivery.config.json") +
          ": `domain` is empty. Describe your project in a sentence or two, or remove it.\n",
      );
    },
    RUN_TIMEOUT,
  );
});

describe("AC: resuming a run sends the same instructions as before, however the file is edited afterwards", () => {
  it(
    "keeps the description the run started with, even after the file it came from is rewritten mid-run",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratchState();
      const started = "A tool that tracks who's on call. All user-facing messages are written in French.";
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ domain: started }));
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-q", "-m", "configure"]);

      // Start a run, interrupt it mid-turn as a person hitting Ctrl-C would.
      const held = await scriptFile(heldOpen("wave.js", "export const wave = (name) => `Coucou, ${name}`;\n"));
      const started_stdout = await interruptWhileWorking(["run", "--task", "add a function that waves at a name, with a test"], {
        cwd: repo,
        env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: held },
      });
      const runId = /^Starting run (\S+):/m.exec(started_stdout)?.[1];
      if (!runId) throw new Error(`no run id in:\n${started_stdout}`);

      // The owner edits the project's description while the run is stopped.
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ domain: "Rewritten after the run began." }));

      const resumed = runDelivery(["run"], {
        cwd: repo,
        env: {
          ...process.env,
          XDG_STATE_HOME: state,
          [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("wave.js", "export const wave = (name) => `Coucou, ${name}`;\n")),
        },
      });
      expect(resumed.stdout).toContain(`Resuming run ${runId}`);
      expect(resumed.status).toBe(EXIT.ok);
      expect(caseJsonFor(repo, runId).header.domainPrompt).toBe(started);
    },
    RUN_TIMEOUT * 2,
  );
});

describe("AC: a configuration file with no project description behaves exactly as it did before this slice", () => {
  it("leaves domainPrompt unset in the run's record", async () => {
    const repo = sampleProjectCopy();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ budgets: { correction: 5 } }));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "configure"]);

    const run = runDelivery(["run", "--task", "add a function"], {
      cwd: repo,
      env: {
        ...process.env,
        [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
        XDG_STATE_HOME: scratchState(),
      },
    });
    expect(run.status).toBe(EXIT.ok);
    const runId = runIdIn(run.stdout);
    expect(caseJsonFor(repo, runId).header.domainPrompt).toBeUndefined();
  }, RUN_TIMEOUT);
});

describe("AC: a long description can be supplied through the .js/.mjs form of the config file", () => {
  it("reads a multi-line template literal, with no separate description file", async () => {
    const repo = sampleProjectCopy();
    const domain = "Two paragraphs.\n\nThe second one, about French user-facing messages.";
    writeFileSync(join(repo, "delivery.config.js"), `export default { domain: \`${domain}\` };\n`);

    const run = runDelivery(["run", "--task", "add a function"], {
      cwd: repo,
      env: {
        ...process.env,
        [TEST_MOCK_SCRIPT]: await scriptFile(completesWith("f.js", "export const f = () => 1;\n")),
        XDG_STATE_HOME: scratchState(),
      },
    });
    expect(run.status).toBe(EXIT.ok);
    const runId = runIdIn(run.stdout);
    expect(caseJsonFor(repo, runId).header.domainPrompt).toBe(domain);
  }, RUN_TIMEOUT);
});

// SKIPPED AC: "the agent's instructions for that run include it, for the worker and for
// gate maintenance alike" — the gate-maintenance half specifically. Driving that live
// needs a run to fail its gate and enter a correction turn, which this slice's UAT does
// not exercise and which would need its own scripted gate-maintenance session on top of
// the worker one above. It already has direct regression coverage:
// src/prompt-assembly.test.ts ("puts the role fragment and the domain prompt in %s's
// system prompt", covering both `workerRoleConfig` and `gateMaintenanceRoleConfig`) reads
// `assemblePrompt` straight from a case file's header, the same field this file's UAT
// above proves the CLI pins there.
it.skip("gate maintenance's instructions also carry the project's description", () => {});
