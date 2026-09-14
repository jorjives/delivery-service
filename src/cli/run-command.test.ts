import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { writeMockScript, type MockScript } from "../mock-script.js";
import { SurfaceState } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { NOT_SIGNED_IN, TEST_MOCK_SCRIPT } from "./agent-session.js";
import { EXIT, UNEXPECTED_FOOTER } from "./failures.js";
import { runCli } from "./program.js";
import { NO_CHECK, NOT_A_REPOSITORY, UNCOMMITTED_NOTE } from "./project.js";
import { NO_TASK } from "./run-command.js";

const TASK = "add a function that says hello to a name, with a test";
const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });
const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const ESC = "[";
const RUN_TIMEOUT = 60_000;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** A claude-mock script file for the contributor test seam. */
async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "run-command-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
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

/** Run `delivery <args>` in-process, capturing what it prints. Working copies go under a scratch state folder. */
async function delivery(args: string[], { cwd, env = {}, isTTY = false }: { cwd: string; env?: NodeJS.ProcessEnv; isTTY?: boolean }) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv: args,
    cwd,
    env: { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "run-command-state-")), ...env },
    stdout: { write: (text: string) => (stdout += text), isTTY },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

/** The branch a closing or escalating run names. */
function branchIn(stdout: string): string {
  const match = /branch (surface\/\S+?)\.?$/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no branch named in:\n${stdout}`);
  return match[1];
}

describe("delivery run", () => {
  it(
    "runs a task with nothing configured: the test script checks it, the work lands on a branch, and the base branch is untouched",
    async () => {
      const repo = initTempRepo("run-command-closed-", { "package.json": PACKAGE });
      const mainBefore = git(repo, ["rev-parse", "main"]);

      const { exitCode, stdout, stderr } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stderr).toBe("");
      expect(exitCode).toBe(EXIT.ok);
      const branch = branchIn(stdout);
      expect(stdout).toContain(`Done: the change for "${TASK}" passed \`npm test\` and is committed on branch ${branch}.`);
      expect(git(repo, ["show", `${branch}:hello.js`])).toContain("hello");
      expect(git(repo, ["rev-parse", "main"])).toBe(mainBefore);
      expect(git(repo, ["status", "--porcelain"])).toBe("");
    },
    RUN_TIMEOUT,
  );

  it(
    "prints one plain-language line per step and never a raw state name",
    async () => {
      const repo = initTempRepo("run-command-progress-", { "package.json": PACKAGE });
      const { stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      const steps = stdout.split("\n").filter((line) => line.startsWith("- "));
      expect(steps).toEqual([
        "- setting up",
        "- checking the starting point",
        "- the agent is working",
        "- checking the agent's work",
        "- wrapping up",
        "- done",
      ]);
      for (const state of SurfaceState.options) expect(stdout).not.toContain(state);
    },
    RUN_TIMEOUT,
  );

  it(
    "keeps the run's record in a self-ignoring folder and its working copy outside the repository",
    async () => {
      const repo = initTempRepo("run-command-places-", { "package.json": PACKAGE });
      const { stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      const runId = branchIn(stdout).replace("surface/", "");
      expect(existsSync(join(repo, ".delivery", "runs", runId, "case.json"))).toBe(true);
      expect(git(repo, ["check-ignore", ".delivery/runs"])).toBe(".delivery/runs");
      expect(readdirSync(repo).sort()).toEqual([".delivery", ".git", "package.json"]);
    },
    RUN_TIMEOUT,
  );

  it(
    "leads an escalated run with the decision asked of a person, and exits escalated",
    async () => {
      const repo = initTempRepo("run-command-escalated-", { "package.json": PACKAGE });
      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(escalates) },
      });

      expect(exitCode).toBe(EXIT.escalated);
      const decision = stdout.indexOf("This needs your decision: The worker stopped because it judged it lacked authority.");
      expect(decision).toBeGreaterThan(stdout.indexOf("- stopped: this needs a person"));
      expect(stdout.indexOf("the task asks me to delete files I was not given")).toBeGreaterThan(decision);
    },
    RUN_TIMEOUT,
  );

  it(
    "exits aborted when the run cannot start, as in a repository with no commits",
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "run-command-aborted-"));
      git(repo, ["init", "-b", "main"]);
      writeFileSync(join(repo, "package.json"), PACKAGE);

      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [] }) },
      });

      expect(exitCode).toBe(EXIT.aborted);
      expect(stdout).toContain("The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit");
    },
    RUN_TIMEOUT,
  );

  it(
    "notes uncommitted changes, proceeds, and leaves git status as it found it",
    async () => {
      const repo = initTempRepo("run-command-dirty-", { "package.json": PACKAGE });
      writeFileSync(join(repo, "notes.txt"), "my own work in progress\n");
      const statusBefore = git(repo, ["status", "--porcelain"]);

      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(UNCOMMITTED_NOTE);
      expect(exitCode).toBe(EXIT.ok);
      expect(git(repo, ["status", "--porcelain"])).toBe(statusBefore);
    },
    RUN_TIMEOUT,
  );

  it(
    "prints colour on a terminal, and none when --no-color is passed",
    async () => {
      const coloured = await delivery(["run", "--task", TASK], {
        cwd: initTempRepo("run-command-colour-", { "package.json": PACKAGE }),
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes), NO_COLOR: "" },
        isTTY: true,
      });
      expect(coloured.stdout).toContain(ESC);

      const plain = await delivery(["run", "--task", TASK, "--no-color"], {
        cwd: initTempRepo("run-command-no-colour-", { "package.json": PACKAGE }),
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes), NO_COLOR: "" },
        isTTY: true,
      });
      expect(plain.exitCode).toBe(EXIT.ok);
      expect(plain.stdout).not.toContain(ESC);
    },
    RUN_TIMEOUT * 2,
  );

  it("refuses outside a git repository, naming the missing repository, with the configuration code", async () => {
    const { exitCode, stdout, stderr } = await delivery(["run", "--task", TASK], { cwd: mkdtempSync(join(tmpdir(), "run-command-not-repo-")) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NOT_A_REPOSITORY}\n`);
    expect(stdout).toBe("");
  });

  it("refuses a repository with no test script, naming the missing check, and writes nothing", async () => {
    const repo = initTempRepo("run-command-no-check-", { "README.md": "hi\n" });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NO_CHECK}\n`);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });

  it("refuses a run with no task, saying how to give one", async () => {
    const repo = initTempRepo("run-command-no-task-", { "package.json": PACKAGE });
    const { exitCode, stderr } = await delivery(["run"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NO_TASK}\n`);
  });

  it("stops before setting anything up when the agent runtime is not signed in, with the agent runtime code", async () => {
    const repo = initTempRepo("run-command-signed-out-", { "package.json": PACKAGE });
    const home = mkdtempSync(join(tmpdir(), "run-command-home-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.includes(name)));

    const { exitCode, stderr } = await delivery(["run", "--task", TASK], {
      cwd: repo,
      env: { ...env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") },
    });

    expect(exitCode).toBe(EXIT.agentRuntime);
    expect(stderr).toBe(`${NOT_SIGNED_IN}\n`);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
  });

  it("shows a failure it does not recognise by its message and the footer, never a stack trace", async () => {
    const repo = initTempRepo("run-command-unexpected-", { "package.json": PACKAGE, ".delivery": "a file where the run folder goes\n" });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], {
      cwd: repo,
      env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
    });
    expect(exitCode).toBe(EXIT.unexpected);
    expect(stderr).toContain(UNEXPECTED_FOOTER);
    expect(stderr).not.toContain("    at ");
  });

  it("lists the run command and --no-color in delivery --help", async () => {
    const { exitCode, stdout } = await delivery(["--help"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("run [options]");
    expect(stdout).toContain("--no-color");
  });

  it("describes itself with run --help, without mentioning the contributor test seam", async () => {
    const { exitCode, stdout } = await delivery(["run", "--help"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Usage: delivery run [options]");
    expect(stdout).toContain("--task <text>");
    expect(stdout).toContain("--no-color");
    expect(stdout).not.toContain(TEST_MOCK_SCRIPT);
  });

  it("treats an unknown option as a configuration mistake", async () => {
    const { exitCode, stderr } = await delivery(["run", "--bogus"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("unknown option '--bogus'");
  });
});
