// Slice 1: Run a Task From the Command Line With Nothing Configured
// Source: docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md
// Recorded: 2026-09-15 against commit 38d3aa5
//
// Drives the compiled `delivery` command as a person would: a real subprocess
// (tests/helpers.ts's runDelivery, over the compiled dist/cli/main.js), against
// a copy of the shipped sample project, the agent routed to the vendored
// scripted agent through the contributor-only test seam so the UAT needs no
// network, no API key and no real Claude Code sign-in.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMockScript, type MockScript } from "../../src/mock-script.js";
import { TEST_MOCK_SCRIPT, NOT_SIGNED_IN } from "../../src/cli/agent-session.js";
import { EXIT, UNEXPECTED_FOOTER } from "../../src/cli/failures.js";
import { NOT_A_REPOSITORY, NO_CHECK, UNCOMMITTED_NOTE } from "../../src/cli/project.js";
import { REPO_ROOT, runDelivery, git } from "../helpers.js";

const TASK = "add a function that says hello to a name, with a test";
const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const RUN_TIMEOUT = 60_000;

async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "uat-slice-1-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

function scratchState(): string {
  return mkdtempSync(join(tmpdir(), "uat-slice-1-state-"));
}

/** The branch a closing or escalating run names in its closing sentence. */
function branchIn(stdout: string): string {
  const match = /branch (surface\/\S+?)\.?$/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no branch named in:\n${stdout}`);
  return match[1];
}

const completes: MockScript = {
  expectations: [
    {
      effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
      json: { status: "completed", rationale: "added hello.js" },
    },
  ],
};

const escalates: MockScript = {
  expectations: [
    { json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
  ],
};

/** A throwaway git-initialised copy of the sample project the harness ships, as a UAT walkthrough would set one up. */
function sampleProjectCopy(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-slice-1-sample-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

describe("UAT: run a task from the command line with nothing configured", () => {
  it(
    "hands the sample project a plain-English task and gets a finished, verified run on a branch, main left untouched",
    async () => {
      const repo = sampleProjectCopy();
      const mainBefore = git(repo, ["rev-parse", "main"]);

      const { stdout, stderr, status } = runDelivery(["run", "--task", TASK], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(completes), XDG_STATE_HOME: scratchState() },
      });

      expect(stderr).toBe("");
      expect(status).toBe(EXIT.ok);
      const branch = branchIn(stdout);
      expect(stdout).toContain(`Done: the change for "${TASK}" passed \`npm test\` and is committed on branch ${branch}.`);
      // The closing sentence's branch is really there and the work really on it.
      expect(git(repo, ["branch", "--list", branch])).not.toBe("");
      expect(git(repo, ["show", `${branch}:hello.js`])).toContain("hello");
      expect(git(repo, ["rev-parse", "main"])).toBe(mainBefore);
    },
    RUN_TIMEOUT,
  );

  it("from a folder that is not a git repository, explains what's missing with no stack trace", () => {
    const { stdout, stderr, status } = runDelivery(["run", "--task", TASK], { cwd: mkdtempSync(join(tmpdir(), "uat-slice-1-not-repo-")) });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NOT_A_REPOSITORY}\n`);
    expect(stderr).not.toContain("    at ");
    expect(stdout).toBe("");
  });
});

describe("AC: while running, the command prints one plain-language line per step, never a raw state name", () => {
  it(
    "prints setting up / checking the starting point / the agent is working / checking the agent's work / wrapping up / done",
    async () => {
      const repo = sampleProjectCopy();
      const { stdout } = runDelivery(["run", "--task", TASK], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(completes), XDG_STATE_HOME: scratchState() },
      });

      const steps = stdout.split("\n").filter((line) => line.startsWith("- "));
      expect(steps).toEqual([
        "- setting up",
        "- checking the starting point",
        "- the agent is working",
        "- checking the agent's work",
        "- wrapping up",
        "- done",
      ]);
      expect(stdout).not.toMatch(/\bPROVISIONING\b|\bGATING\b|\bCLOSED\b|\bAGENT_ACTIVE\b/);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: an escalated run leads with the plain-language decision, exiting escalated; an aborted run exits aborted", () => {
  it(
    "leads an escalated run with the decision asked of a person, and exits with the distinct escalated code",
    async () => {
      const repo = sampleProjectCopy();
      const { stdout, status } = runDelivery(["run", "--task", "delete everything the agent judges unnecessary"], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(escalates), XDG_STATE_HOME: scratchState() },
      });

      expect(status).toBe(EXIT.escalated);
      const decision = stdout.indexOf("This needs your decision: The worker stopped because it judged it lacked authority.");
      expect(decision).toBeGreaterThan(-1);
      expect(decision).toBeGreaterThan(stdout.indexOf("- stopped: this needs a person"));
      expect(stdout.indexOf("the task asks me to delete files I was not given")).toBeGreaterThan(decision);
    },
    RUN_TIMEOUT,
  );

  it(
    "exits with the distinct aborted code when the run cannot even set up, as in a repository with no commits",
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "uat-slice-1-no-commits-"));
      git(repo, ["init", "-q", "-b", "main"]);
      writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }));

      const { stdout, status } = runDelivery(["run", "--task", TASK], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [] }), XDG_STATE_HOME: scratchState() },
      });

      expect(status).toBe(EXIT.aborted);
      expect(stdout).toContain("The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit");
    },
    RUN_TIMEOUT,
  );
});

describe("AC: a missing sign-in stops the command before anything is set up, with the agent runtime code", () => {
  it("names being signed out and how to fix it, and leaves nothing behind in the repository", () => {
    const repo = sampleProjectCopy();
    const home = mkdtempSync(join(tmpdir(), "uat-slice-1-home-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.includes(name)));

    const { stderr, status } = runDelivery(["run", "--task", TASK], {
      cwd: repo,
      env: { ...env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), XDG_STATE_HOME: scratchState() },
    });

    expect(status).toBe(EXIT.agentRuntime);
    expect(stderr).toBe(`${NOT_SIGNED_IN}\n`);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
  });

  // SKIPPED AC: a missing Claude Code executable stops the command the same way. Driving this
  // through the compiled binary would mean removing @anthropic-ai/claude-agent-sdk's platform
  // package from node_modules mid-suite, breaking every other test that needs the real SDK. The
  // signed-out half of this AC is covered live above; the missing-binary half is covered by the
  // unit test for resolveRuntime() in src/cli/agent-session.test.ts.
  it.skip("stops with the agent runtime code when the Claude Code executable itself is missing", () => {});
});

describe("AC: running with no test script and no gate given stops with a plain-language message, the configuration code", () => {
  it("names the missing check", () => {
    const repo = mkdtempSync(join(tmpdir(), "uat-slice-1-no-check-"));
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "README.md"), "hi\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "seed"]);

    const { stderr, status } = runDelivery(["run", "--task", TASK], { cwd: repo });
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NO_CHECK}\n`);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });
});

describe("AC: uncommitted changes produce a plain-language note, and the run proceeds", () => {
  it(
    "notes the uncommitted work, still finishes the run, and leaves git status exactly as it found it otherwise",
    async () => {
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, "notes.txt"), "my own work in progress\n");
      const statusBefore = git(repo, ["status", "--porcelain"]);

      const { stdout, status } = runDelivery(["run", "--task", TASK], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(completes), XDG_STATE_HOME: scratchState() },
      });

      expect(stdout).toContain(UNCOMMITTED_NOTE);
      expect(status).toBe(EXIT.ok);
      expect(git(repo, ["status", "--porcelain"])).toBe(statusBefore);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: starting a run changes nothing the user's git status reports", () => {
  it(
    "keeps the run's record in a self-ignoring folder and its working copy outside the repository",
    async () => {
      const repo = sampleProjectCopy();
      const { stdout } = runDelivery(["run", "--task", TASK], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(completes), XDG_STATE_HOME: scratchState() },
      });

      const branch = branchIn(stdout);
      const runId = branch.replace("surface/", "");
      expect(existsSync(join(repo, ".delivery", "runs", runId, "case.json"))).toBe(true);
      expect(git(repo, ["check-ignore", ".delivery/runs"])).toBe(".delivery/runs");
      // Only the sample project's own files plus .delivery and .git sit at the repository root.
      expect(readdirSync(repo).sort()).toEqual([".delivery", ".git", "README.md", "add.js", "add.test.js", "package.json"]);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: every known harness error reaches the terminal as its plain-language rendering, never a stack trace", () => {
  it(
    "shows a failure it does not recognise by its message and the honest footer",
    async () => {
      // A file where the run's record folder needs to go: a failure no known error class covers.
      const repo = sampleProjectCopy();
      writeFileSync(join(repo, ".delivery"), "a file where the run folder goes\n");

      const { stderr, status } = runDelivery(["run", "--task", TASK], {
        cwd: repo,
        env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(completes), XDG_STATE_HOME: scratchState() },
      });

      expect(status).toBe(EXIT.unexpected);
      expect(stderr).toContain(UNEXPECTED_FOOTER);
      expect(stderr).not.toContain("    at ");
    },
    RUN_TIMEOUT,
  );
});

describe("AC: colour is never the only carrier of meaning, and is off when NO_COLOR, --no-color, or not a terminal", () => {
  it("prints the same plain-language wording whether or not colour is on", async () => {
    const repo = sampleProjectCopy();
    const { stdout, status } = runDelivery(["run", "--task", TASK, "--no-color"], {
      cwd: repo,
      env: { ...process.env, [TEST_MOCK_SCRIPT]: await scriptFile(completes), XDG_STATE_HOME: scratchState(), NO_COLOR: "" },
    });
    expect(status).toBe(EXIT.ok);
    expect(stdout).not.toContain("[");
    expect(stdout).toContain("Done: the change for");
  }, RUN_TIMEOUT);
});

describe("AC: delivery --help and delivery run --help describe the command; delivery --version prints the package version", () => {
  it("prints the package version with --version", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as { version: string };
    expect(runDelivery(["--version"])).toEqual({ stdout: `${pkg.version}\n`, stderr: "", status: EXIT.ok });
  });

  it("describes the command and lists run in --help", () => {
    const { stdout, status } = runDelivery(["--help"]);
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain("run [options]");
    expect(stdout).toContain("--no-color");
  });

  it("describes run --help without mentioning the contributor test seam", () => {
    const { stdout, status } = runDelivery(["run", "--help"]);
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain("Usage: delivery run [options]");
    expect(stdout).toContain("--task <text>");
    expect(stdout).not.toContain(TEST_MOCK_SCRIPT);
  });
});

describe("AC: a sample project ships with the harness, ready for a first run", () => {
  it("has only its source checked in, with a test script the harness picks up and that passes as shipped", () => {
    const sample = join(REPO_ROOT, "examples", "sample-project");
    expect(readdirSync(sample).sort()).toEqual(["README.md", "add.js", "add.test.js", "package.json"]);
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: sample, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });
});
