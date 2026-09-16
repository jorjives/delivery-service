// Slice 4: See What Happened to a Run After the Fact
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-16 against commit 8405fa7
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in. Interruption (for the
// unfinished-run AC) is driven by actually spawning `delivery run` and sending
// it a real SIGINT, as slice 3's recording does.

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const RUN_TIMEOUT = 60_000;

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-4-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-4-state-"));
}

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-4-sample-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

/** The run id a starting or closing sentence names. */
function runIdIn(stdout: string): string {
  const match = /^Starting run (\S+?):/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no run id in:\n${stdout}`);
  return match[1];
}

const escalates: MockScript = {
  expectations: [{ json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } }],
};

function completes(path: string, content: string): MockScript {
  return { expectations: [{ effects: [{ write: { path, content } }], json: { status: "completed", rationale: `added ${path}` } }] };
}

describe("UAT: see what happened to an escalated run after the fact", () => {
  it(
    "delivery status --last leads with the decision, then the evidence, dead ends, why-now and references verbatim, then where the work was kept",
    async () => {
      const repo = sampleProjectCopy();
      const env = { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: await scriptFile(escalates) };
      const task = "delete the existing greeting function and everything that uses it";

      // Steps 1-2: run a task the agent cannot complete without a human decision, and let it end.
      const finished = runDelivery(["run", "--task", task], { cwd: repo, env });
      expect(finished.status).toBe(EXIT.escalated);
      const runId = runIdIn(finished.stdout);

      // Steps 3-4: open a new terminal (a fresh process, no state carried) and ask for the last run.
      const { stdout, status } = runDelivery(["status", "--last"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: env.XDG_STATE_HOME } });

      expect(status).toBe(EXIT.ok);
      expect(stdout).toContain(`Run ${runId}`);
      expect(stdout).toContain(task);

      const decision = stdout.indexOf("This needs your decision: The worker stopped because it judged it lacked authority.");
      const evidence = stdout.indexOf("the task asks me to delete files I was not given");
      const deadEnds = stdout.indexOf("No prior attempts were triaged.");
      const whyNow = stdout.indexOf("The worker reported that it lacks the authority to go on");
      const whereToLook = stdout.indexOf("Where to look:");

      // The decision leads, ahead of everything else the packet says.
      expect(decision).toBeGreaterThan(-1);
      expect(decision).toBeLessThan(evidence);
      // Then the evidence, quoted exactly as the worker wrote it, not paraphrased.
      expect(evidence).toBeGreaterThan(-1);
      expect(evidence).toBeLessThan(deadEnds);
      // Then what was already tried, and why it stopped when it did.
      expect(deadEnds).toBeGreaterThan(-1);
      expect(deadEnds).toBeLessThan(whyNow);
      expect(whyNow).toBeGreaterThan(-1);
      expect(whyNow).toBeLessThan(whereToLook);
      // Finally where the retained branch and working copy are.
      expect(whereToLook).toBeGreaterThan(-1);
      expect(stdout).toContain(`The branch surface/${runId} was kept.`);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: delivery status <run-id> reads a run without changing it", () => {
  it("leaves the run's record on disk exactly as it found it", async () => {
    const repo = sampleProjectCopy();
    const env = { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = () => 'hi';\n")) };

    const finished = runDelivery(["run", "--task", "add a function that says hi"], { cwd: repo, env });
    expect(finished.status).toBe(EXIT.ok);
    const runId = runIdIn(finished.stdout);
    const caseFile = join(repo, ".delivery", "runs", runId, "case.json");
    const before = readFileSync(caseFile, "utf-8");

    const first = runDelivery(["status", runId], { cwd: repo, env });
    const second = runDelivery(["status", runId], { cwd: repo, env });

    expect(readFileSync(caseFile, "utf-8")).toBe(before);
    expect(first.stdout).toBe(second.stdout);
  }, RUN_TIMEOUT);
});

describe("AC: a closed run's status names the outcome sentence, when it finished and the branch", () => {
  it("prints the closing sentence, the finish time and the branch", async () => {
    const repo = sampleProjectCopy();
    const env = { ...process.env, XDG_STATE_HOME: scratchState(), [TEST_MOCK_SCRIPT]: await scriptFile(completes("hello.js", "export const hello = () => 'hi';\n")) };

    const finished = runDelivery(["run", "--task", "add a function that says hi"], { cwd: repo, env });
    const runId = runIdIn(finished.stdout);

    const { stdout, status } = runDelivery(["status", runId], { cwd: repo, env });
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain(`Done: the change for "add a function that says hi" passed \`npm test\` and is committed on branch surface/${runId}.`);
    expect(stdout).toMatch(/It finished \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\./);
    expect(stdout).toContain(`git log surface/${runId}`);
  });
});

describe("AC: an unfinished run's status says in plain language what resuming it will do next", () => {
  it(
    "says the run hasn't finished and names what picking it up will carry on with",
    async () => {
      const repo = sampleProjectCopy();
      const state = scratchState();
      const held: MockScript = {
        expectations: [{ effects: [{ write: { path: "f.js", content: "export const f = () => 1;\n" } }], json: { status: "completed", rationale: "x" }, delayMs: 5000 }],
      };

      const heldScript = await scriptFile(held);
      const runId = await new Promise<string>((resolvePromise, reject) => {
        const child = spawn(process.execPath, [join(REPO_ROOT, "dist", "cli", "main.js"), "run", "--task", "add a function"], {
          cwd: repo,
          env: { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: heldScript },
        });
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
          else resolvePromise(runIdIn(stdout));
        });
      });

      const { stdout, status } = runDelivery(["status", "--last"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: state } });
      expect(status).toBe(EXIT.ok);
      expect(stdout).toContain(`Run ${runId}`);
      expect(stdout).toContain("This run hasn't finished. Picking it up will carry on with");
      expect(stdout).toContain(`To finish it: delivery resume ${runId}`);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: an aborted run's status prints the reason in plain language", () => {
  it("says why the run stopped, with no stack trace", () => {
    const repo = mkdtempSync(join(tmpdir(), "uat-slice-4-no-commits-"));
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }));

    const finished = runDelivery(["run", "--task", "add a function"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: scratchState() },
    });
    expect(finished.status).toBe(EXIT.aborted);

    const runId = /^Starting run (\S+?):/m.exec(finished.stdout)?.[1];
    if (runId === undefined) throw new Error(`no run id in:\n${finished.stdout}`);

    const { stdout, status } = runDelivery(["status", runId], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState() } });
    expect(status).toBe(EXIT.ok);
    expect(stdout).not.toContain("    at ");
    expect(stdout.split("\n").length).toBeGreaterThan(1);
  });
});

describe("AC: a run id that names nothing, or a repository with no runs, refuses with a plain-language suggestion", () => {
  it("says how to start a run when this repository has never had one", () => {
    const repo = sampleProjectCopy();
    const { stderr, status } = runDelivery(["status"], { cwd: repo, env: { ...process.env, XDG_STATE_HOME: scratchState() } });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain('delivery run --task "..."');
  });

  it("says how to start a run when the given run id names nothing", () => {
    const repo = sampleProjectCopy();
    const { stderr, status } = runDelivery(["status", "never-ran-20260101T000000Z"], {
      cwd: repo,
      env: { ...process.env, XDG_STATE_HOME: scratchState() },
    });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).toContain('delivery run --task "..."');
  });
});
