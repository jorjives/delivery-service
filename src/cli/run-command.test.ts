import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import type { MockScript } from "../mock-script.js";
import { SurfaceState } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { NOT_SIGNED_IN, TEST_MOCK_SCRIPT } from "./agent-session.js";
import { branchIn, completes, delivery, PACKAGE, RUN_TIMEOUT, TASK, scriptFile } from "./command-fixtures.js";
import { unknownCloser } from "./config.js";
import { EXIT, UNEXPECTED_FOOTER } from "./failures.js";
import { NO_CHECK, NOT_A_REPOSITORY, UNCOMMITTED_NOTE } from "./project.js";
import { BOTH_TASKS } from "./settings.js";
import { NO_TASK } from "./run-command.js";

const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const ESC = "[";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

const escalates: MockScript = {
  expectations: [
    { json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
  ],
};

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

const configIn = (repo: string, config: unknown): void => writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config));

describe("delivery run with a config file", () => {
  it(
    "uses the closer and the limits the file asks for, merging the work into the base branch",
    async () => {
      const repo = initTempRepo("run-command-config-merge-", { "package.json": PACKAGE });
      configIn(repo, { closer: { type: "merge-back" }, budgets: { correction: 5 } });
      const mainBefore = git(repo, ["rev-parse", "main"]);

      const { exitCode, stdout, stderr } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stderr).toBe("");
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Done: the change for "${TASK}" passed \`npm test\` and is merged into main.`);
      expect(git(repo, ["rev-parse", "main"])).not.toBe(mainBefore);
      expect(git(repo, ["show", "main:hello.js"])).toContain("hello");

      const runId = /Starting run (\S+):/.exec(stdout)?.[1] ?? "";
      const caseJson = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as {
        header: { closerRef: unknown };
        cursor: { budgets: { correction: unknown; terminus: unknown } };
      };
      expect(caseJson.header.closerRef).toEqual({ type: "merge-back" });
      expect(caseJson.cursor.budgets.correction).toEqual({ used: 0, max: 5 });
      expect(caseJson.cursor.budgets.terminus).toEqual({ used: 0, max: 5 });
    },
    RUN_TIMEOUT,
  );

  it(
    "lets --closer beat the file, leaving the work on its own branch",
    async () => {
      const repo = initTempRepo("run-command-config-flag-", { "package.json": PACKAGE });
      configIn(repo, { closer: { type: "merge-back" } });
      const mainBefore = git(repo, ["rev-parse", "main"]);

      const { exitCode, stdout } = await delivery(["run", "--task", TASK, "--closer", "commit-to-branch"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      const branch = branchIn(stdout);
      expect(stdout).toContain(`is committed on branch ${branch}.`);
      expect(git(repo, ["rev-parse", "main"])).toBe(mainBefore);
    },
    RUN_TIMEOUT,
  );

  it(
    "finds the file from a folder inside the repository, and takes the task and the check from it",
    async () => {
      const repo = initTempRepo("run-command-config-walk-", { "package.json": PACKAGE });
      configIn(repo, { task: { intent: TASK }, gate: { type: "command", command: "npm test", parseMode: "exitcode" } });
      mkdirSync(join(repo, "packages", "web"), { recursive: true });

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: join(repo, "packages", "web"),
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Starting run ${branchIn(stdout).replace("surface/", "")}: ${TASK}`);
    },
    RUN_TIMEOUT,
  );

  it("stops at once on a closer type it doesn't know, listing the choices and leaving nothing behind", async () => {
    const repo = initTempRepo("run-command-config-bad-closer-", { "package.json": PACKAGE });
    configIn(repo, { closer: { type: "teleport" } });

    const { exitCode, stdout, stderr } = await delivery(["run", "--task", TASK], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${unknownCloser("teleport")}\n`);
    expect(stdout).toBe("");
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });

  it("stops on an unknown setting in the file, naming it", async () => {
    const repo = initTempRepo("run-command-config-bad-key-", { "package.json": PACKAGE });
    configIn(repo, { closr: { type: "merge-back" } });

    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("there's no setting called `closr`");
    expect(stderr).not.toContain("    at ");
  });

  it("stops on a custom gate it can't load, naming the module and the guide", async () => {
    const repo = initTempRepo("run-command-config-bad-gate-", { "package.json": PACKAGE });
    configIn(repo, { gate: { type: "custom", modulePath: "./gates/nope.mjs" } });

    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("Couldn't load the custom gate at `./gates/nope.mjs`");
    expect(stderr).toContain("docs/writing-a-gate.md");
    expect(stderr).not.toContain("    at ");
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });

  it("takes the task from a file and the check from a flag, in a project with no package.json at all", async () => {
    const repo = initTempRepo("run-command-task-file-", { "README.md": "hi\n" });
    writeFileSync(join(repo, "task.txt"), `${TASK}\n`);

    const { exitCode, stdout } = await delivery(["run", "--task-file", "task.txt", "--gate-command", "true"], {
      cwd: repo,
      env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
    });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(`Starting run ${branchIn(stdout).replace("surface/", "")}: ${TASK}`);
  }, RUN_TIMEOUT);

  it("refuses --task and --task-file together", async () => {
    const repo = initTempRepo("run-command-both-tasks-", { "package.json": PACKAGE });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK, "--task-file", "task.txt"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${BOTH_TASKS}\n`);
  });

  it("uses the config file --config names instead of the one beside the code", async () => {
    const repo = initTempRepo("run-command-config-flagfile-", { "package.json": PACKAGE });
    // A file the harness would refuse outright, so a run that finishes proves it was never read.
    configIn(repo, { closer: { type: "teleport" } });
    writeFileSync(join(repo, "ci.json"), JSON.stringify({ closer: { type: "commit-to-branch" } }));

    const { exitCode, stdout } = await delivery(["run", "--task", TASK, "--config", "ci.json"], {
      cwd: repo,
      env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
    });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(`is committed on branch ${branchIn(stdout)}.`);
  }, RUN_TIMEOUT);

  it("takes the environment's settings over the file's", async () => {
    const repo = initTempRepo("run-command-env-", { "package.json": PACKAGE });
    configIn(repo, { closer: { type: "merge-back" } });

    // The refusal names the environment's closer, not the file's, which is how we know
    // DELIVERY_CLOSER was the one that won; DELIVERY_TASK stands in for the missing --task.
    const { exitCode, stderr } = await delivery(["run"], {
      cwd: repo,
      env: { DELIVERY_TASK: TASK, DELIVERY_CLOSER: "flapjack" },
    });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${unknownCloser("flapjack")}\n`);
  });

  it("lists the new options in `delivery run --help`, and still never the contributor test seam", async () => {
    const { stdout } = await delivery(["run", "--help"], { cwd: mkdtempSync(join(tmpdir(), "run-command-help-")) });
    for (const option of ["--task-file", "--gate-command", "--closer", "--config"]) expect(stdout).toContain(option);
    expect(stdout).not.toContain(TEST_MOCK_SCRIPT);
  });
});

describe("picking up a run that didn't finish", () => {
  it(
    "carries on from where it stopped instead of starting over, and says so",
    async () => {
      const repo = initTempRepo("run-command-resume-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello, runsRoot } = await import("./command-fixtures.js");
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { exitCode, stdout, stderr } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stderr).toBe("");
      expect(stdout).toContain(`Resuming run ${runId}: ${TASK}`);
      expect(stdout).toContain("Picking up where it left off: checking the agent's work.");
      expect(stdout).not.toContain("Starting run");
      expect(exitCode).toBe(EXIT.ok);
      expect(branchIn(stdout)).toBe(`surface/${runId}`);
      expect(readdirSync(runsRoot(repo))).toEqual([runId]);
    },
    RUN_TIMEOUT,
  );

  it(
    "picks the same run up when it is given the task that run is already doing",
    async () => {
      const repo = initTempRepo("run-command-resume-same-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello } = await import("./command-fixtures.js");
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${runId}`);
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it(
    "says what it had to put right when the run was stopped in the middle of something",
    async () => {
      const repo = initTempRepo("run-command-recovery-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun } = await import("./command-fixtures.js");
      await interruptedRun(repo, state, {
        task: TASK,
        steps: 3,
        worker: () => Promise.reject(new Error("the machine was switched off")),
      });

      const { stdout, exitCode } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain("Had to put something right: recorded a missing terminus for worker attempt 1");
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it(
    "starts a new run when the only run for that task already finished",
    async () => {
      const repo = initTempRepo("run-command-finished-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const first = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(first.exitCode).toBe(EXIT.ok);

      // Delay to ensure different timestamps (runIdFor strips milliseconds)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const second = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(second.stdout).toContain("Starting run");
      expect(second.stdout).not.toContain("Picking up");
      expect(branchIn(second.stdout)).not.toBe(branchIn(first.stdout));
    },
    RUN_TIMEOUT * 2 + 2000,
  );

  it("stops with the folder named when a run's record cannot be read back", async () => {
    const repo = initTempRepo("run-command-corrupt-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    const { interruptedRun, writesHello, runsRoot } = await import("./command-fixtures.js");
    const runId = await interruptedRun(repo, state, { task: TASK, steps: 1, worker: writesHello });
    writeFileSync(join(runsRoot(repo), runId, "case.json"), "{ this is not json");

    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo, env: { XDG_STATE_HOME: state } });

    expect(stderr).toContain(join(runsRoot(repo), runId));
    expect(stderr).toContain("Remove that folder to start afresh.");
    expect(stderr).not.toContain("at Object.");
    expect(exitCode).toBe(EXIT.unexpected);
  });
});
