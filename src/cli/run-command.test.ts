import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git } from "../../tests/helpers.js";
import { promptsSent, readJournal, type MockScript } from "../mock-script.js";
import { SurfaceState, type RunEntry, type GateRef, RepairChanges } from "../schema.js";
import { RECOVERED_REPAIR } from "../breaker.js";
import { loadRunFile, setRunOutcome } from "../run-file.js";
import { withoutAt } from "../without-at.js";
import { load, readRef } from "../case-file.js";
import { assemblePrompt } from "../prompt-assembly.js";
import { DEFAULT_ROLES } from "../agent-invoke.js";
import { stepView } from "../workflow-step.js";
import { initTempRepo } from "../temp-repo.js";
import { NOT_SIGNED_IN, TEST_MOCK_SCRIPT } from "./agent-session.js";
import { branchIn, completes, delivery, ESCALATION, PACKAGE, RUN_TIMEOUT, TASK, scriptFile, writeNeedyPack, writeRunRecord, runsRoot, interruptedRun, writesHello, writeSupervisedRun, rateLimited } from "./command-fixtures.js";
import { unknownCloser } from "./config.js";
import { EXIT, UNEXPECTED_FOOTER } from "./failures.js";
import { NO_CHECK, NOT_A_REPOSITORY, UNCOMMITTED_NOTE } from "./project.js";
import { allRuns, readRun } from "./runs.js";
import { BOTH_TASKS, unknownWorkflow, WORKFLOW_NEEDS_TASK } from "./settings.js";
import { NO_TASK } from "./run-command.js";
import { FENCE_ABSENT } from "./drive.js";
import { EVERY_TASK_DONE, taskEnded, runPickedUp, STOPPED_PART_WAY } from "./queue.js";
import { liveRunFound, SKIPPED_IDLE } from "./run-exclusion.js";
import { repoLocked, takeRepoLock } from "../repo-lock.js";
import { supervisedPlace, supervisorLockPath } from "../run-location.js";
import type { RunEventRecord, SurfaceStepRecord } from "./report.js";
import { SAVED_DATA, SAVED_TEXT } from "./saved-report.js";
import { withoutCredentials } from "../mock-session.js";

const ESC = "[";

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
  );

  it(
    "stops a run whose agent asks a question, and shows the question in the packet",
    async () => {
      const repo = initTempRepo("run-command-decision-", { "package.json": PACKAGE });
      const asks: MockScript = { expectations: [{ json: { status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the task does not say" } }] };
      const { exitCode, stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(asks) } });

      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain("It asked: Formal or casual greeting?");
      const [record] = await allRuns(repo);
      expect(record?.caseFile.outcome?.cause).toEqual({ kind: "decision", question: "Formal or casual greeting?" });
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
    const env = withoutCredentials(process.env);

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

  it(
    "pins the project's description into the run's record when the run starts",
    async () => {
      const domain = "A small internal tool that tracks who's on call. All user-facing messages are written in French.";
      const repo = initTempRepo("run-command-domain-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ domain }),
      });

      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      const runId = branchIn(stdout).replace("surface/", "");
      const caseJson = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as {
        header: { domainPrompt?: string };
      };
      expect(caseJson.header.domainPrompt).toBe(domain);
    },
  );

  it(
    "pins the project's agent options into the run's record when the run starts",
    async () => {
      const agent = { model: "opus", append: "Use British English." };
      const repo = initTempRepo("run-command-agent-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ agent }) });
      const { exitCode, stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(exitCode).toBe(EXIT.ok);
      const runId = branchIn(stdout).replace("surface/", "");
      const caseJson = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as { header: { agent?: unknown } };
      expect(caseJson.header.agent).toEqual(agent);
    },
    RUN_TIMEOUT,
  );

  it(
    "pins a digest of the project's own check module when the run starts",
    async () => {
      const gate = "export default { baseline: async () => ({ status: 'PASS', assertions: [] }), check: async () => ({ status: 'PASS', assertions: [] }) };\n";
      const repo = initTempRepo("run-command-digest-", { "package.json": PACKAGE, "gate.mjs": gate, "delivery.config.json": JSON.stringify({ gate: { type: "custom", modulePath: "./gate.mjs" } }) });
      const { stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      const runId = branchIn(stdout).replace("surface/", "");
      const caseJson = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as { header: { gateDigest?: string } };
      expect(caseJson.header.gateDigest).toMatch(/^[0-9a-f]{64}$/);
    },
    RUN_TIMEOUT,
  );
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
  });

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
  });

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

  it("lists --concurrency in `delivery run --help`", async () => {
    const repo = initTempRepo("run-command-help-concurrency-", { "package.json": PACKAGE });
    expect((await delivery(["run", "--help"], { cwd: repo })).stdout).toContain("--concurrency <n>");
  });
});

describe("delivery run with a required pack setting unset", () => {
  /** A project with a check, the needy pack added, and the given config file. */
  const needyRepo = (config: unknown): string => {
    const repo = initTempRepo("run-command-needy-", { "package.json": PACKAGE });
    writeNeedyPack(repo);
    configIn(repo, config);
    return repo;
  };

  it("refuses a workflow of a different pack before any agent call, naming the pack, setting and lines to add", async () => {
    const repo = needyRepo({ packs: ["needy-pack"] });
    const script = await scriptFile(completes);
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: script } });
    expect(exitCode).toBe(EXIT.configuration);
    for (const line of ["Nothing can run yet: the pack needy needs a setting", "not only needy,", "  docs-folder: the folder that holds your documentation.", '  "packSettings": { "needy": { "docs-folder": "..." } }', "Nothing was run."]) expect(stderr).toContain(line);
    expect(promptsSent(await readJournal(`${script}.journal.jsonl`))).toEqual([]);
  });

  it("refuses a scheduled run the same way", async () => {
    // the arguments a schedule runs: runArgs(schedule) from src/cli/schedule/model.ts, i.e. run --sources --if-idle
    const repo = needyRepo({ packs: ["needy-pack"] });
    const script = await scriptFile(completes);
    const { exitCode, stderr } = await delivery(["run", "--sources", "--if-idle"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: script } });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("Nothing can run yet: the pack needy needs a setting");
    expect(promptsSent(await readJournal(`${script}.journal.jsonl`))).toEqual([]);
  });

  it(
    "runs once the suggested line is given",
    async () => {
      const repo = needyRepo({ packs: ["needy-pack"], packSettings: { needy: { "docs-folder": "docs" } } });
      const { exitCode, stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Done: the change for "${TASK}"`);
    },
    RUN_TIMEOUT,
  );

  it("refuses a mistyped setting name, listing the settings the pack has", async () => {
    const repo = needyRepo({ packs: ["needy-pack"], packSettings: { needy: { "docs-foler": "docs" } } });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain('  needy: "docs-foler" is not a setting of this pack.');
    expect(stderr).toContain("    Its settings are: docs-folder.");
  });
});

describe("delivery run with a list of tasks", () => {
  // Deliberately distinct in their first five words: `runIdFor` slugs only
  // those, over a stamp with one-second granularity, so two tasks that share
  // an opening would give two back-to-back runs the same id.
  const PAGE = "add a hello function that greets a name, with a test";
  const SWAP = "write a goodbye function that farewells a name, with a test";

  it(
    "works down the list, one ordinary run at a time, saying which task it is on",
    async () => {
      const repo = initTempRepo("run-command-queue-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Task 1 of 2: ${PAGE}`);
      expect(stdout).toContain(`Task 2 of 2: ${SWAP}`);
      expect(stdout).toContain(`Done: the change for "${PAGE}" passed \`npm test\``);
      expect(stdout).toContain(`Done: the change for "${SWAP}" passed \`npm test\``);
      expect(stdout).toContain(EVERY_TASK_DONE);
      expect(readdirSync(runsRoot(repo))).toHaveLength(2);
      // The list is the order of visiting: task 1 is announced before task 2.
      expect(stdout.indexOf("Task 1 of 2")).toBeLessThan(stdout.indexOf("Task 2 of 2"));
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "runs exactly the task the command line named and leaves the list alone",
    async () => {
      const repo = initTempRepo("run-command-queue-adhoc-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });

      const { exitCode, stdout } = await delivery(["run", "--task", "add a function that shouts, with a test"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).not.toContain("Task 1 of");
      expect(readdirSync(runsRoot(repo))).toHaveLength(1);
    },
  );

  it(
    "picks the unfinished task up where it stopped, then carries on down the list",
    async () => {
      const repo = initTempRepo("run-command-queue-resume-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello } = await import("./command-fixtures.js");
      const interrupted = await interruptedRun(repo, state, { task: PAGE, steps: 3, worker: writesHello });

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Task 1 of 2: ${PAGE}`);
      expect(stdout).toContain(`Resuming run ${interrupted}`);
      expect(stdout).toContain(`Task 2 of 2: ${SWAP}`);
      // One record for the task it picked up, one for the task it went on to.
      expect(readdirSync(runsRoot(repo))).toHaveLength(2);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "runs what an edit added and what an edit reworded, and nothing else, framed by the list as it is now",
    async () => {
      const repo = initTempRepo("run-command-queue-edited-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
      });
      const closed = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;
      await writeRunRecord(repo, { runId: "add-a-hello-20260917T090000Z", task: PAGE, outcome: closed });
      await writeRunRecord(repo, { runId: "add-a-goodbye-20260917T100000Z", task: SWAP, outcome: closed });

      // The edit a person makes between two invocations: one entry inserted at
      // the top, one reworded, the rest untouched.
      const FRESH = "create a shouting function that upper-cases a name, with a test";
      const REWORDED = `${SWAP}, politely`;
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ tasks: [FRESH, PAGE, REWORDED] }));

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(`Task 1 of 3: ${FRESH}`);
      expect(stdout).toContain(`Task 3 of 3: ${REWORDED}`);
      // The entry that was not edited keeps its finished run and is passed over.
      expect(stdout).not.toContain("Task 2 of 3");
      expect(stdout).toContain(EVERY_TASK_DONE);
      // The two runs that already existed, plus one for each entry that changed.
      expect(readdirSync(runsRoot(repo))).toHaveLength(4);
    },
    RUN_TIMEOUT * 2,
  );

  it("says every task is done, and starts nothing, when each one already has a finished run", async () => {
    const repo = initTempRepo("run-command-queue-done-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
    });
    const closed = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;
    await writeRunRecord(repo, { runId: "add-a-hello-20260917T090000Z", task: PAGE, outcome: closed });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260917T100000Z", task: SWAP, outcome: closed });

    // No scripted agent and no credential: a list with nothing left to do is an
    // answer this command can give without one.
    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(EVERY_TASK_DONE);
    expect(readdirSync(runsRoot(repo))).toHaveLength(2);
  });

  it("stops at a task that needs a decision, names it, and stops at the same one next time", async () => {
    const repo = initTempRepo("run-command-queue-escalated-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
    });
    await writeRunRecord(repo, {
      runId: "add-a-hello-20260917T090000Z",
      task: PAGE,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: "2026-09-17T09:05:00.000Z" },
      packet: ESCALATION,
    });

    const first = await delivery(["run"], { cwd: repo });
    const second = await delivery(["run"], { cwd: repo });

    for (const attempt of [first, second]) {
      expect(attempt.exitCode).toBe(EXIT.escalated);
      expect(attempt.stdout).toContain(`Task 1 of 2: ${PAGE}`);
      expect(attempt.stdout).toContain(`This needs your decision: ${ESCALATION.decision}`);
      expect(attempt.stdout).toContain("Task 1 of 2 needs your decision before I can go on, so I've left the rest of the list alone.");
      expect(attempt.stdout).not.toContain("Task 2 of 2");
    }
    // Nothing was started for the task behind it, either time.
    expect(readdirSync(runsRoot(repo))).toEqual(["add-a-hello-20260917T090000Z"]);
  });

  it("stops at a task whose run was stopped, with the exit code a stopped run already uses", async () => {
    const repo = initTempRepo("run-command-queue-aborted-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [PAGE, SWAP] }),
    });
    await writeRunRecord(repo, {
      runId: "add-a-hello-20260917T090000Z",
      task: PAGE,
      outcome: { kind: "aborted", source: "close", reason: "the closing action failed", at: "2026-09-17T09:05:00.000Z" },
    });

    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.aborted);
    expect(stdout).toContain("Task 1 of 2 stopped before it finished, so I've left the rest of the list alone.");
    expect(stdout).not.toContain("Task 2 of 2");
  });

  it("refuses a file that sets both one task and a list, before anything is set up", async () => {
    const repo = initTempRepo("run-command-queue-both-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ task: { intent: PAGE }, tasks: [PAGE] }),
    });

    const { exitCode, stderr } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("this project has both `task` and `tasks` set.");
    expect(existsSync(join(repo, ".delivery", "runs"))).toBe(false);
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

  it("stops when a different task is asked for, naming the run that didn't finish", async () => {
    const repo = initTempRepo("run-command-different-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    const { interruptedRun, writesHello, runsRoot } = await import("./command-fixtures.js");
    const { startedAt } = await import("./runs.js");
    const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

    const { exitCode, stdout, stderr } = await delivery(["run", "--task", "something different"], {
      cwd: repo,
      env: { XDG_STATE_HOME: state },
    });

    expect(stderr).toContain(`task: \`${TASK}\``);
    expect(stderr).toContain(startedAt(runId));
    expect(stderr).toContain("Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway.");
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
    expect(readdirSync(runsRoot(repo))).toEqual([runId]);
  });

  it(
    "starts the new task with --fresh and leaves the old run there to pick up",
    async () => {
      const repo = initTempRepo("run-command-fresh-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello, runsRoot } = await import("./command-fixtures.js");
      const interrupted = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { exitCode, stdout } = await delivery(["run", "--task", "add a goodbye function, with a test", "--fresh"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain("Starting run");
      expect(exitCode).toBe(EXIT.ok);
      expect(readdirSync(runsRoot(repo))).toContain(interrupted);
      expect(readdirSync(runsRoot(repo))).toHaveLength(2);
    },
  );

  it(
    "notes what it ignored when a flag asks a resumed run for something else",
    async () => {
      const repo = initTempRepo("run-command-ignored-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello } = await import("./command-fixtures.js");
      await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["run", "--closer", "merge-back"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain("Note: a run keeps the settings it started with, so --closer was ignored.");
      expect(stdout).toContain("is committed on branch");
      expect(exitCode).toBe(EXIT.ok);
    },
  );

  it(
    "keeps the description the run started with, even after the file it came from is rewritten",
    async () => {
      const started = "A tool that tracks who's on call. All user-facing messages are written in French.";
      const repo = initTempRepo("run-command-domain-pinned-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ domain: started }),
      });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello } = await import("./command-fixtures.js");
      const runId = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello, domain: started });

      // The owner edits the project's description while the run is stopped.
      writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ domain: "Rewritten after the run began." }));
      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(`Resuming run ${runId}`);
      expect(exitCode).toBe(EXIT.ok);
      const caseJson = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as {
        header: { domainPrompt?: string };
      };
      expect(caseJson.header.domainPrompt).toBe(started);
    },
  );

  it(
    "asks which run to pick up when more than one didn't finish",
    async () => {
      const repo = initTempRepo("run-command-several-", { "package.json": PACKAGE });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const { interruptedRun, writesHello } = await import("./command-fixtures.js");
      const older = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
      const newer = await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

      const { stdout, exitCode } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
        answers: ["2"],
      });

      expect(stdout).toContain(`  1. ${newer}`);
      expect(stdout).toContain(`  2. ${older}`);
      expect(stdout).toContain(`Resuming run ${older}`);
      expect(exitCode).toBe(EXIT.ok);
    },
  );

  it("prints the list and stops when more than one didn't finish and nobody can answer", async () => {
    const repo = initTempRepo("run-command-several-ci-", { "package.json": PACKAGE });
    const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
    const { interruptedRun, writesHello } = await import("./command-fixtures.js");
    const first = await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });
    const second = await interruptedRun(repo, state, { task: "add a goodbye function, with a test", steps: 3, worker: writesHello });

    const { stderr, exitCode } = await delivery(["run"], { cwd: repo, env: { XDG_STATE_HOME: state } });

    expect(stderr).toContain(first);
    expect(stderr).toContain(second);
    expect(stderr).toContain("delivery resume --last");
    expect(exitCode).toBe(EXIT.configuration);
  });
});

describe("delivery run with several tasks at once", () => {
  // Distinct in their first five words, as in the list tests above.
  const PAGE = "add a hello function that greets a name, with a test";
  const SWAP = "write a goodbye function that farewells a name, with a test";
  const WAVE = "create a waving function that waves at a name, with a test";
  const closed = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;

  const listRepo = (prefix: string, config: object) =>
    initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config) });
  const supervisedRoot = (repo: string) => join(repo, ".delivery", "supervised");

  /** The one run of several at once this repository holds. */
  async function theRunFile(repo: string) {
    const [only, ...others] = readdirSync(supervisedRoot(repo));
    expect(others).toEqual([]);
    if (only === undefined) throw new Error("no run of several tasks was recorded");
    return loadRunFile(join(supervisedRoot(repo), only));
  }
  const fillsOf = (history: RunEntry[]) =>
    history.filter((entry): entry is Extract<RunEntry, { t: "slot_fill" }> => entry.t === "slot_fill");

  it(
    "runs up to that many at once, fills a freed slot with the next task, and starts every line with its task",
    async () => {
      const repo = listRepo("run-command-several-", { tasks: [PAGE, SWAP, WAVE], concurrency: 2 });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      const lines = stdout.trimEnd().split("\n");
      expect(lines[0]).toMatch(/^Starting run run-\d{8}T\d{6}Z: 3 tasks, up to 2 at once$/);
      expect(lines.at(-3)).toBe(EVERY_TASK_DONE);
      // The fence is absent on this machine (the fixture names a `bwrap` that doesn't exist), so one line among
      // the task lines warns about it, printed when the first task's slot starts rather than before "Starting run".
      expect(lines).toContain(FENCE_ABSENT);
      for (const line of lines.slice(1, -3)) expect(line === FENCE_ABSENT || /^\[[123]\/3\] /.test(line)).toBe(true);
      for (const [index, task] of [PAGE, SWAP, WAVE].entries()) {
        expect(stdout).toContain(`[${index + 1}/3] Done: the change for "${task}" passed \`npm test\``);
      }

      const runFile = await theRunFile(repo);
      expect(runFile.header).toMatchObject({ repoPath: repo, concurrency: 2, tasks: 3 });
      // Both slots are taken before either is freed: the two tasks ran at the same time.
      expect(runFile.history.slice(0, 2).map((entry) => entry.t)).toEqual(["slot_fill", "slot_fill"]);
      expect(fillsOf(runFile.history).map((fill) => fill.taskDef)).toEqual([{ intent: PAGE }, { intent: SWAP }, { intent: WAVE }]);
      expect(runFile.outcome?.kind).toBe("drained");
      // Each task's own record is where it always was, one per task.
      expect(readdirSync(runsRoot(repo))).toHaveLength(3);
      expect(git(repo, ["branch", "--list", "surface/*"]).split("\n")).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "describes tasks stopped by a usage limit as that, never as a broken shared environment, and counts none of it as evidence",
    async () => {
      // One try each: the point is the wording and the run file, not the retries.
      const repo = listRepo("run-command-rate-limited-", { tasks: [PAGE, SWAP], concurrency: 2, budgets: { terminus: 1 } });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(rateLimited) } });

      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain("the AI service is limiting requests");
      expect(stdout).not.toContain("shared environment");
      const { history } = await theRunFile(repo);
      expect(history.filter((entry) => entry.t === "gate_error_signal" || entry.t === "breaker_degraded")).toEqual([]);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "under --json prints only JSON, each line saying whether it is about the run or a task, and which task",
    async () => {
      const repo = listRepo("run-command-several-json-", { tasks: [PAGE, SWAP] });

      const { exitCode, stdout, stderr } = await delivery(["run", "--json", "--concurrency", "2"], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      const records = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as SurfaceStepRecord | RunEventRecord);
      expect(records[0]).toMatchObject({ scope: "run", state: "STARTED", done: false });
      expect(records.at(-1)).toMatchObject({ scope: "run", state: "DRAINED", done: true });
      const runId = records[0]?.runId;
      expect(runId).toMatch(/^run-\d{8}T\d{6}Z$/);

      const steps = records.filter((record): record is SurfaceStepRecord => record.scope === "surface");
      const taskIds = (await allRuns(repo)).map((record) => record.runId);
      for (const ordinal of [1, 2]) {
        const own = steps.filter((step) => step.surface.ordinal === ordinal);
        expect(own.length).toBeGreaterThan(0);
        for (const step of own) expect(step).toMatchObject({ runId, surface: { of: 2 } });
        const ids = new Set(own.map((step) => step.surface.id));
        expect(ids.size).toBe(1);
        expect(taskIds).toContain([...ids][0]);
        expect(own.at(-1)).toMatchObject({ state: "CLOSED", done: true });
      }
      expect(stderr).toMatch(/^Starting run run-\d{8}T\d{6}Z: 2 tasks, up to 2 at once$/m);
      expect(stderr).toMatch(/^\[1\/2\] Starting run /m);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "carries on past a task that needs a decision, filling its slot, and exits needing a decision",
    async () => {
      const repo = listRepo("run-command-several-escalated-", { tasks: [PAGE, SWAP, WAVE], concurrency: 2 });
      const swapEscalates: MockScript = {
        expectations: [
          { when: { promptContains: SWAP }, json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
          ...completes.expectations,
        ],
      };

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(swapEscalates) } });

      expect(exitCode).toBe(EXIT.escalated);
      expect(stdout).toContain(`[1/3] Done: the change for "${PAGE}"`);
      expect(stdout).toContain(`[3/3] Done: the change for "${WAVE}"`);
      expect(stdout).toContain("[2/3] This needs your decision:");
      expect(stdout.trimEnd().split("\n").at(-3)).toBe(taskEnded({ task: 2, of: 3 }, "escalated"));
      expect(stdout).not.toContain(EVERY_TASK_DONE);
      expect(fillsOf((await theRunFile(repo)).history)).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "passes over a task an earlier run delivered, and starts every other task exactly once",
    async () => {
      const repo = listRepo("run-command-several-skip-", { tasks: [PAGE, SWAP, WAVE], concurrency: 2 });
      await writeRunRecord(repo, { runId: "add-a-hello-20260917T090000Z", task: PAGE, outcome: closed });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).not.toContain("[1/3]");
      expect(fillsOf((await theRunFile(repo)).history).map((fill) => fill.taskDef)).toEqual([{ intent: SWAP }, { intent: WAVE }]);
      expect(readdirSync(runsRoot(repo))).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "merges one of two tasks that finish together and hands the other back through the close path, leaving the checkout sound",
    async () => {
      const repo = listRepo("run-command-several-merge-", { tasks: [PAGE, SWAP], concurrency: 2, closer: { type: "merge-back" } });
      // Slow agents: both tasks have their working copies before either merges, so the base moves under the second.
      const slow: MockScript = { ...completes, delayMs: 1000 };

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(slow) } });

      expect(exitCode).toBe(EXIT.escalated);
      const runs = await allRuns(repo);
      expect(runs.map((record) => record.caseFile.outcome?.kind).sort()).toEqual(["closed", "escalated"]);
      const refused = runs.find((record) => record.caseFile.outcome?.kind === "escalated");
      expect(refused?.caseFile.history.some((entry) => entry.t === "close" && entry.status === "FAIL")).toBe(true);
      expect(stdout).toContain("is merged into main");
      // The shared checkout is as a person would want it: on main, clean, and holding only its own working copy.
      expect(git(repo, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
      expect(git(repo, ["status", "--porcelain"])).toBe("");
      expect(git(repo, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "at concurrency 1, the default, keeps no record of its own and starts no line with a task tag",
    async () => {
      const repo = listRepo("run-command-several-default-", { tasks: [PAGE, SWAP] });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(existsSync(supervisedRoot(repo))).toBe(false);
      expect(stdout).not.toMatch(/^\[/m);
      expect(stdout).toContain(`Task 1 of 2: ${PAGE}`);
    },
    RUN_TIMEOUT * 2,
  );

  const SHOUT = "make a shouting function that shouts a name, with a test";
  const RUN = "run-20260930T090000Z";

  it(
    "picks a stopped run up at the shape it started with: each task carries on from its own last step, a delivered one is left alone, and the rest start once",
    async () => {
      // No concurrency in the file: the run carries on as it was started, two at once.
      const repo = listRepo("run-command-several-resume-", { tasks: [PAGE, SWAP, WAVE, SHOUT] });
      const state = mkdtempSync(join(tmpdir(), "run-command-state-"));
      const pageId = "add-a-hello-function-that-20260930T090000Z";
      await writeRunRecord(repo, { runId: pageId, task: PAGE, outcome: closed });
      const swapId = await interruptedRun(repo, state, { task: SWAP, steps: 3, worker: writesHello });
      const waveId = await interruptedRun(repo, state, { task: WAVE, steps: 1, worker: writesHello });
      const before: RunEntry[] = [
        { t: "slot_fill", slot: 1, surfaceId: pageId, taskDef: { intent: PAGE } },
        { t: "slot_fill", slot: 2, surfaceId: swapId, taskDef: { intent: SWAP } },
        { t: "slot_free", slot: 1, surfaceId: pageId, outcome: "closed" },
        { t: "slot_fill", slot: 1, surfaceId: waveId, taskDef: { intent: WAVE } },
      ];
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } }, before);

      const { exitCode, stdout } = await delivery(["run"], {
        cwd: repo,
        env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout.split("\n")[0]).toBe(runPickedUp(RUN, 4, 2));
      expect(stdout).toContain(`[2/4] Resuming run ${swapId}: ${SWAP}`);
      expect(stdout).toContain(`[3/4] Resuming run ${waveId}: ${WAVE}`);
      expect(stdout).toMatch(/^\[4\/4\] Starting run /m);
      expect(stdout).not.toContain("[1/4]");
      expect(stdout.trimEnd().split("\n").at(-3)).toBe(EVERY_TASK_DONE);

      // One record per task: nothing was started a second time.
      const ids = readdirSync(runsRoot(repo));
      expect(ids).toHaveLength(4);
      expect(ids).toEqual(expect.arrayContaining([pageId, swapId, waveId]));
      // The delivered task was not touched, and neither resumed task was begun again from its starting point.
      expect((await readRun(repo, pageId)).caseFile.outcome).toEqual(closed);
      for (const id of [swapId, waveId]) {
        const { caseFile } = await readRun(repo, id);
        expect(caseFile.outcome?.kind).toBe("closed");
        expect(caseFile.history.filter((entry) => entry.t === "baseline")).toHaveLength(1);
      }
      // The same run's record, carried on: what it held, then this invocation's slots, then its end.
      const runFile = await theRunFile(repo);
      expect(runFile.header.runId).toBe(RUN);
      expect(withoutAt(runFile.history.slice(0, 4))).toEqual(before);
      expect(fillsOf(runFile.history.slice(4)).map((fill) => fill.taskDef)).toEqual([{ intent: SWAP }, { intent: WAVE }, { intent: SHOUT }]);
      expect(runFile.outcome?.kind).toBe("drained");
      expect(git(repo, ["branch", "--list", "surface/*"]).split("\n")).toHaveLength(3);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "under --json says the run was picked up, not started",
    async () => {
      const repo = listRepo("run-command-several-resume-json-", { tasks: [PAGE] });
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } });

      const { exitCode, stdout } = await delivery(["run", "--json"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      const records = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as SurfaceStepRecord | RunEventRecord);
      expect(records[0]).toMatchObject({ scope: "run", runId: RUN, state: "RESUMED", done: false });
      expect(records.at(-1)).toMatchObject({ scope: "run", runId: RUN, state: "DRAINED", done: true });
    },
    RUN_TIMEOUT,
  );

  it("ends a stopped run whose tasks have all since been delivered, starting nothing", async () => {
    const repo = listRepo("run-command-several-resume-done-", { tasks: [PAGE], concurrency: 2 });
    await writeRunRecord(repo, { runId: "add-a-hello-function-that-20260930T090000Z", task: PAGE, outcome: closed });
    const dir = await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } });

    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe(EVERY_TASK_DONE);
    expect((await loadRunFile(dir)).outcome?.kind).toBe("drained");
  });

  it(
    "starts a new run, with its own id, when the last run of several at once finished",
    async () => {
      const repo = listRepo("run-command-several-after-finished-", { tasks: [PAGE], concurrency: 2 });
      const dir = await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } });
      await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T10:00:00.000Z" });

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout.split("\n")[0]).toMatch(/^Starting run run-\d{8}T\d{6}Z: 1 task, up to 2 at once$/);
      expect(stdout).not.toContain(RUN);
      expect(readdirSync(supervisedRoot(repo))).toHaveLength(2);
    },
    RUN_TIMEOUT,
  );

  it.each([
    ["a list of several at once", ["run"], { tasks: [PAGE, SWAP], concurrency: 2 }],
    ["a list one at a time", ["run"], { tasks: [PAGE, SWAP] }],
    ["a single task", ["run", "--task", TASK], {}],
    ["picking up a run", ["resume"], {}],
  ])("refuses %s while a run of several at once is going here, naming it, before anything starts", async (_, args, config) => {
    const repo = listRepo("run-command-live-", config);
    const header = { runId: RUN, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } };
    const dir = await writeSupervisedRun(repo, header);
    const release = await takeRepoLock(repo);
    try {
      const { exitCode, stdout, stderr } = await delivery(args, { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.configuration);
      expect(stderr.trimEnd()).toBe(liveRunFound(header));
      expect(stdout).toBe("");
      expect(existsSync(runsRoot(repo))).toBe(false);
      expect((await loadRunFile(dir)).history).toEqual([]);
    } finally {
      await release?.();
    }
  });

  it.each([
    ["a list worked one at a time", ["run"], { tasks: [PAGE, SWAP] }],
    ["a single task", ["run", "--task", TASK], {}],
  ])("refuses a second run while %s is going here, and the first carries on", async (_, args, config) => {
    const repo = listRepo("run-command-one-live-", config);
    const first = delivery(args, { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile({ ...completes, delayMs: 1000 }) } });
    await vi.waitFor(async () => expect(await repoLocked(repo)).toBe(true), { timeout: 30_000, interval: 50 });

    const second = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

    expect(second.exitCode).toBe(EXIT.configuration);
    expect(second.stderr.trimEnd()).toBe(liveRunFound(undefined));
    expect(second.stdout).toBe("");
    expect((await first).exitCode).toBe(EXIT.ok);
    expect(await repoLocked(repo)).toBe(false);
  }, RUN_TIMEOUT * 2);

  it("with --if-idle, skips quietly in one line while another run is going, running no notify and writing no report", async () => {
    const repo = listRepo("run-command-if-idle-busy-", { tasks: [PAGE], notify: "touch notified" });
    const release = await takeRepoLock(repo);
    try {
      const { exitCode, stdout, stderr } = await delivery(["run", "--if-idle"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toBe(`${SKIPPED_IDLE}\n`);
      expect(stderr).toBe("");
      expect(existsSync(runsRoot(repo))).toBe(false);
      expect(existsSync(join(repo, "notified"))).toBe(false);
      expect(existsSync(join(repo, SAVED_TEXT))).toBe(false);
      expect(existsSync(join(repo, SAVED_DATA))).toBe(false);
    } finally {
      await release?.();
    }
  });

  it("with --if-idle and no run going, runs exactly as without it", async () => {
    const repo = listRepo("run-command-if-idle-free-", { tasks: [PAGE] });
    const { exitCode, stdout } = await delivery(["run", "--if-idle"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).not.toContain(SKIPPED_IDLE);
    expect(stdout).toContain(EVERY_TASK_DONE);
    expect(await repoLocked(repo)).toBe(false);
  }, RUN_TIMEOUT);

  it("lets the lock go when it refuses for another reason after taking it", async () => {
    const repo = listRepo("run-command-lock-refused-", { tasks: [PAGE] });
    const { exitCode } = await delivery(["run", "--max", "2"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(await repoLocked(repo)).toBe(false);
  });

  it(
    "holds the repository's lock for as long as it runs, and lets it go at the end",
    async () => {
      const repo = listRepo("run-command-lock-held-", { tasks: [PAGE, SWAP], concurrency: 2 });
      const running = delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile({ ...completes, delayMs: 1000 }) } });

      await vi.waitFor(async () => expect(await repoLocked(repo)).toBe(true), { timeout: 30_000, interval: 50 });
      expect((await running).exitCode).toBe(EXIT.ok);
      expect(await repoLocked(repo)).toBe(false);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "takes over the lock a killed run left behind and carries that run on, with nothing to unlock by hand",
    async () => {
      const repo = listRepo("run-command-lock-stale-", { tasks: [PAGE], concurrency: 2 });
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } });
      // A run killed outright leaves its lock behind, no longer kept fresh by anyone.
      mkdirSync(supervisorLockPath(repo), { recursive: true });
      const aMinuteAgo = new Date(Date.now() - 60_000);
      utimesSync(supervisorLockPath(repo), aMinuteAgo, aMinuteAgo);

      const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout.split("\n")[0]).toBe(runPickedUp(RUN, 1, 2));
      expect(await repoLocked(repo)).toBe(false);
    },
    RUN_TIMEOUT,
  );

  /**
   * A check whose shared helper is missing until some task's repair leaves a
   * `.restored` marker in its copy; once any gate run sees one it stays
   * restored for the rest of the process, as a helper put back would. Custom
   * gates load from the repository root, outside every task's copy.
   */
  const RESTORABLE_GATE = [
    'import { existsSync, readdirSync } from "node:fs";',
    'import { dirname, join } from "node:path";',
    "let restored = false;",
    "const restoredIn = (copy) => readdirSync(dirname(copy)).some((other) => existsSync(join(dirname(copy), other, \".restored\")));",
    "const measure = async ({ worktreePath }) => {",
    "  restored ||= restoredIn(worktreePath);",
    '  return restored ? { status: "PASS", assertions: [{ id: "shared-helper", outcome: "PASS", detail: "answered" }] } : { status: "ERROR", assertions: [], detail: "the shared helper is missing" };',
    "};",
    "export default { baseline: measure, check: measure };",
  ].join("\n");
  const BROKEN_GATE = 'const measure = async () => ({ status: "ERROR", assertions: [], detail: "the shared helper is missing" });\nexport default { baseline: measure, check: measure };\n';
  const gateRef: GateRef = { type: "custom", modulePath: "./gates/shared.mjs" };

  const brokenRepo = (prefix: string, gate: string, tasks: string[]) => {
    const repo = initTempRepo(prefix, {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks, concurrency: 2, gate: gateRef }),
    });
    mkdirSync(join(repo, "gates"), { recursive: true });
    writeFileSync(join(repo, "gates/shared.mjs"), gate);
    return repo;
  };
  const ofType = <T extends RunEntry["t"]>(history: RunEntry[], t: T) => history.filter((entry): entry is Extract<RunEntry, { t: T }> => entry.t === t);

  describe("when the shared environment breaks", () => {
    /** Every session, worker or repair, writes the task's file; a repair's `.restored` is what puts the helper back. */
    const restores: MockScript = {
      expectations: [{
        effects: [
          { write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } },
          { write: { path: ".restored", content: "yes\n" } },
        ],
        json: { status: "completed", rationale: "did it" },
      }],
    };

    it(
      "holds the tasks, repairs once, says it is fixed, and finishes every task",
      async () => {
        const repo = brokenRepo("run-command-breaker-fixed-", RESTORABLE_GATE, [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(restores) } });

        expect(exitCode).toBe(EXIT.ok);
        const lines = stdout.split("\n");
        expect(lines.filter((line) => line.startsWith("! Something in the shared environment looks broken"))).toHaveLength(1);
        expect(lines.filter((line) => line === "  - repairing (attempt 1 of 2)")).toHaveLength(1);
        expect(lines.filter((line) => line === "✓ Fixed. Resuming.")).toHaveLength(1);
        expect(lines.at(-4)).toBe(EVERY_TASK_DONE);
        expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|GATE_MAINTENANCE/);

        const { history } = await theRunFile(repo);
        expect(ofType(history, "breaker_degraded")).toHaveLength(1);
        expect(ofType(history, "repair_dispatch")).toHaveLength(1);
        expect(ofType(history, "breaker_healthy")).toHaveLength(1);
        for (const record of await allRuns(repo)) {
          expect(record.caseFile.history.filter((entry) => entry.t === "dispatch" && entry.role === "gate-maintenance")).toEqual([]);
        }

        const repair = ofType(history, "repair_terminus")[0];
        expect(repair?.changesRef).toBe("repair-run-repair-1");
        const [runFolder] = readdirSync(join(repo, ".delivery", "supervised"));
        const changes = RepairChanges.parse(await readRef(join(repo, ".delivery", "supervised", runFolder ?? ""), "repair-run-repair-1"));
        // The repair's `.restored` is what put the helper back; the worker may already have written hello.js, so only `.restored` is certain.
        expect(changes.files).toContainEqual(expect.objectContaining({ path: ".restored", status: "added", added: 1, removed: 0, touchesCheck: false }));
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "stops the run when it cannot repair it, naming the environment as the cause, and exits needing a decision",
      async () => {
        const repo = brokenRepo("run-command-breaker-gave-up-", BROKEN_GATE, [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

        expect(exitCode).toBe(EXIT.escalated);
        expect(stdout.trimEnd().split("\n").at(-3)).toBe(
          "Couldn't fix it after 2 attempts. Stopping the run. 2 of 3 tasks were waiting on this and need your attention; 0 had already finished, 1 is still queued."
        );
        expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);

        const runFile = await theRunFile(repo);
        expect(runFile.outcome).toMatchObject({ kind: "escalated", cause: "shared_environment" });
        expect(ofType(runFile.history, "repair_dispatch")).toHaveLength(2);
        expect(fillsOf(runFile.history)).toHaveLength(2);
        // The held tasks stop where they are, with no outcome of their own: nothing they did caused this.
        for (const record of await allRuns(repo)) expect(record.caseFile.outcome).toBeUndefined();
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "stops the run naming the usage limit, not the environment, when a limit stops the repair",
      async () => {
        const repo = brokenRepo("run-command-breaker-limited-", BROKEN_GATE, [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(rateLimited) } });

        expect(exitCode).toBe(EXIT.escalated);
        expect(stdout.trimEnd().split("\n").at(-3)).toBe(
          "The repair could not run because the AI service is limiting requests. Stopping the run. 2 of 3 tasks were waiting on this and need your attention; 0 had already finished, 1 is still queued.",
        );
        expect(stdout).not.toContain("Couldn't fix it");

        const runFile = await theRunFile(repo);
        expect(runFile.outcome).toMatchObject({ kind: "escalated", cause: "usage_limit", reason: expect.stringContaining("the AI service is limiting requests") });
        expect(ofType(runFile.history, "repair_dispatch")).toHaveLength(1);
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "under --json writes a run-scope record for each change in the environment, with the tasks affected",
      async () => {
        const repo = brokenRepo("run-command-breaker-json-", BROKEN_GATE, [PAGE, SWAP]);

        const { exitCode, stdout } = await delivery(["run", "--json"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

        expect(exitCode).toBe(EXIT.escalated);
        const runRecords = stdout.trimEnd().split("\n").map((line) => JSON.parse(line) as RunEventRecord | SurfaceStepRecord).filter((record): record is RunEventRecord => record.scope === "run");
        expect(runRecords.map((record) => record.state)).toEqual([
          "STARTED", "DEGRADED", "REPAIRING", "HEALTHY", "DEGRADED", "REPAIRING", "HEALTHY", "DEGRADED", "ESCALATED",
        ]);
        const taskIds = (await allRuns(repo)).map((record) => record.runId);
        expect(runRecords[1]?.affected).toHaveLength(1);
        expect(taskIds).toContain(runRecords[1]?.affected?.[0]);
        expect(runRecords.at(-1)).toMatchObject({ done: true });
        expect(runRecords[0]?.affected).toBeNull();
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "picks a run stopped in the middle of a repair back up into that repair, in the same trip",
      async () => {
        const repo = brokenRepo("run-command-breaker-resume-", RESTORABLE_GATE, [PAGE]);
        const state = mkdtempSync(join(tmpdir(), "command-state-"));
        const taskId = "add-a-hello-function-20260930T090000Z";
        await writeRunRecord(repo, { runId: taskId, task: PAGE, gate: gateRef });
        await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
          { t: "slot_fill", slot: 1, surfaceId: taskId, taskDef: { intent: PAGE } },
          { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: taskId, reason: "the shared helper is missing" } },
          { t: "repair_request", surfaceId: taskId, key: null },
          { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: taskId },
        ]);

        const { exitCode } = await delivery(["run"], { cwd: repo, env: { XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(restores) } });

        expect(exitCode).toBe(EXIT.ok);
        const { history } = await loadRunFile(supervisedPlace(repo, RUN));
        expect(ofType(history, "breaker_degraded")).toHaveLength(1);
        expect(ofType(history, "repair_terminus")).toMatchObject([
          { attempt: 1, status: "incomplete", rationale: RECOVERED_REPAIR },
          { attempt: 2, status: "completed" },
        ]);
        expect(ofType(history, "breaker_healthy")).toHaveLength(1);
      },
      RUN_TIMEOUT * 2,
    );

    it("ends a run that gave up but was stopped before it could say so, then starts its held task in a new run", async () => {
      const repo = brokenRepo("run-command-breaker-resume-gave-up-", BROKEN_GATE, [PAGE]);
      const taskId = "add-a-hello-function-20260930T090000Z";
      await writeRunRecord(repo, { runId: taskId, task: PAGE, gate: gateRef });
      await writeSupervisedRun(repo, { runId: RUN, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: taskId, taskDef: { intent: PAGE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: taskId, reason: "the shared helper is missing" } },
        { t: "run_escalated", reason: "the shared environment could not be repaired after 2 attempts; no task caused this" },
      ]);

      const script = await scriptFile({ expectations: [] });
      const { stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: script } });

      expect(stdout).toContain("Stopping the run.");
      expect((await loadRunFile(supervisedPlace(repo, RUN))).outcome).toMatchObject({ kind: "escalated", cause: "shared_environment" });
      expect(promptsSent(await readJournal(`${script}.journal.jsonl`)).some((prompt) => prompt.includes(PAGE))).toBe(true);
    });

    it(
      "refuses a shared repair that deletes a task's test, naming it; the task's own record holds no repair_accepted",
      async () => {
        const repo = initTempRepo("run-command-breaker-deletes-", {
          "package.json": PACKAGE,
          "delivery.config.json": JSON.stringify({ tasks: [PAGE], concurrency: 2, gate: gateRef }),
          "sum.test.js": "import { test } from 'node:test';\ntest('adds', () => {});\n",
        });
        mkdirSync(join(repo, "gates"), { recursive: true });
        writeFileSync(join(repo, "gates/shared.mjs"), RESTORABLE_GATE);
        const deletesTest: MockScript = {
          expectations: [{
            effects: [
              { write: { path: ".restored", content: "yes\n" } },
              { delete: { path: "sum.test.js" } },
            ],
            json: { status: "completed", rationale: "fixed it" },
          }],
        };

        const { exitCode } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(deletesTest) } });

        expect(exitCode).toBe(EXIT.escalated);
        const runFile = await theRunFile(repo);
        expect(runFile.outcome).toMatchObject({ kind: "escalated", cause: "shared_environment", reason: expect.stringContaining("sum.test.js deleted") });
        for (const record of await allRuns(repo)) {
          expect(record.caseFile.history.some((entry) => entry.t === "repair_accepted")).toBe(false);
        }
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "accepts a shared repair that edits a file the check runs: it writes a repair_accepted into the task's own record before the run's repair_terminus",
      async () => {
        const repo = initTempRepo("run-command-breaker-accepts-", {
          "package.json": PACKAGE,
          "delivery.config.json": JSON.stringify({ tasks: [PAGE], concurrency: 2, gate: gateRef }),
          "vitest.config.js": "export default {};\n",
        });
        mkdirSync(join(repo, "gates"), { recursive: true });
        writeFileSync(join(repo, "gates/shared.mjs"), RESTORABLE_GATE);
        const editsConfig: MockScript = {
          expectations: [{
            effects: [
              { write: { path: ".restored", content: "yes\n" } },
              { write: { path: "vitest.config.js", content: "export default { test: { pool: 'forks' } };\n" } },
            ],
            json: { status: "completed", rationale: "fixed it" },
          }],
        };

        const { exitCode } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(editsConfig) } });

        expect(exitCode).toBe(EXIT.ok);
        const [record] = await allRuns(repo);
        expect(record?.caseFile.history).toContainEqual(
          expect.objectContaining({ t: "repair_accepted", settings: { "vitest.config.js": expect.any(String) } }),
        );
        const runFile = await theRunFile(repo);
        expect(ofType(runFile.history, "repair_terminus")).toMatchObject([{ status: "completed" }]);
      },
      RUN_TIMEOUT * 2,
    );
  });

  describe("when a check keeps erroring after a task has done its work", () => {
    /**
     * A check that runs at the start but, for the first `affected` copies to check their work, does not answer four
     * times each (a check and its three re-checks), then answers. Counted per copy, so which task reaches its check
     * first changes nothing.
     */
    const comesAndGoes = (affected: number) => [
      "const refused = new Map();",
      'const answered = { status: "PASS", assertions: [{ id: "shared-helper", outcome: "PASS", detail: "answered" }] };',
      "const check = async ({ worktreePath }) => {",
      "  const times = refused.get(worktreePath) ?? 0;",
      `  if (times >= 4 || (times === 0 && refused.size >= ${affected})) return answered;`,
      "  refused.set(worktreePath, times + 1);",
      '  return { status: "ERROR", assertions: [], detail: "the shared helper did not answer" };',
      "};",
      "export default { baseline: async () => answered, check };",
    ].join("\n");
    const ownRepairs = async (repo: string) =>
      (await allRuns(repo)).filter((record) => record.caseFile.history.some((entry) => entry.t === "dispatch" && entry.role === "gate-maintenance")).map((record) => record.runId);

    it(
      "leaves one task's errors to that task: no run-wide message, no hold, no run repair",
      async () => {
        const repo = brokenRepo("run-command-errors-alone-", comesAndGoes(1), [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

        expect(exitCode).toBe(EXIT.ok);
        expect(stdout).not.toContain("shared environment");
        const { history } = await theRunFile(repo);
        const signals = ofType(history, "gate_error_signal");
        expect(signals).toHaveLength(1);
        expect(ofType(history, "breaker_degraded")).toEqual([]);
        expect(ofType(history, "held")).toEqual([]);
        expect(ofType(history, "repair_dispatch")).toEqual([]);
        // That task repaired its own check, on its own limit.
        expect(await ownRepairs(repo)).toEqual([signals[0]?.surfaceId]);
      },
      RUN_TIMEOUT * 2,
    );

    it(
      "treats a second, different task hitting it as the shared environment: says so, repairs once, and finishes every task",
      async () => {
        const repo = brokenRepo("run-command-errors-shared-", comesAndGoes(2), [PAGE, SWAP, WAVE]);

        const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

        expect(exitCode).toBe(EXIT.ok);
        const lines = stdout.split("\n");
        expect(lines.filter((line) => line.startsWith("! Something in the shared environment looks broken"))).toHaveLength(1);
        expect(lines.filter((line) => line === "  - repairing (attempt 1 of 2)")).toHaveLength(1);
        expect(lines.filter((line) => line === "✓ Fixed. Resuming.")).toHaveLength(1);
        expect(lines.at(-4)).toBe(EVERY_TASK_DONE);
        expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|GATE_MAINTENANCE|gate_error/);

        const { history } = await theRunFile(repo);
        const reported = ofType(history, "gate_error_signal").map((entry) => entry.surfaceId);
        expect(new Set(reported).size).toBe(2);
        expect(ofType(history, "breaker_degraded").map((entry) => entry.cause)).toEqual([
          { kind: "gate_error_aggregate", surfaceId: reported[1], surfaceIds: reported },
        ]);
        expect(ofType(history, "repair_dispatch")).toMatchObject([{ attempt: 1, surfaceId: reported[1] }]);
        // The first to report was told it was alone and repaired its own check; the second was repaired by the run.
        expect(await ownRepairs(repo)).toEqual([reported[0]]);
      },
      RUN_TIMEOUT * 2,
    );
  });

  /** Records what the command arranged a stop to do, and whether it took that back by the end. */
  function stopRecorder() {
    const armed: { exitCode: number; farewell: string; disarmed: boolean }[] = [];
    const exitOnInterrupt = (exitCode: number, farewell: string) => {
      const arm = { exitCode, farewell, disarmed: false };
      armed.push(arm);
      return () => {
        arm.disarmed = true;
      };
    };
    return { armed, exitOnInterrupt };
  }

  it(
    "while it runs, has a stop end it at once with the stopped code and a line on how to carry on",
    async () => {
      const repo = listRepo("run-command-several-stop-", { tasks: [PAGE, SWAP], concurrency: 2 });
      const { armed, exitOnInterrupt } = stopRecorder();

      const { exitCode } = await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) }, exitOnInterrupt });

      expect(exitCode).toBe(EXIT.ok);
      expect(armed).toEqual([{ exitCode: EXIT.aborted, farewell: STOPPED_PART_WAY, disarmed: true }]);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "one at a time, leaves a stop to end the command as it always has",
    async () => {
      const repo = listRepo("run-command-single-stop-", { tasks: [PAGE] });
      const { armed, exitOnInterrupt } = stopRecorder();

      await delivery(["run"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) }, exitOnInterrupt });

      expect(armed).toEqual([]);
    },
    RUN_TIMEOUT,
  );
});

describe("what delivery run leaves behind when it ends", () => {
  const PAGE = "add a hello function that greets a name, with a test";
  const SWAP = "write a goodbye function that farewells a name, with a test";
  const closed = { kind: "closed", source: "close", reason: "the work was committed", at: "2026-09-17T09:00:00.000Z" } as const;
  const savedText = (repo: string): string => readFileSync(join(repo, SAVED_TEXT), "utf-8");
  const savedData = (repo: string): Record<string, unknown> => JSON.parse(readFileSync(join(repo, SAVED_DATA), "utf-8")) as Record<string, unknown>;

  /** A project whose list is `tasks`, with PAGE already delivered and SWAP stopped short. */
  async function listRepo(prefix: string, tasks: string[]): Promise<string> {
    const repo = initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks }) });
    await writeRunRecord(repo, { runId: "add-a-hello-20260917T090000Z", task: PAGE, outcome: closed });
    await writeRunRecord(repo, {
      runId: "write-a-goodbye-20260917T100000Z",
      task: SWAP,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: "2026-09-17T10:05:00.000Z" },
      packet: ESCALATION,
    });
    return repo;
  }

  it(
    "ends one task's run with the report's opening sentence and where to read the rest, and saves that report for the run",
    async () => {
      const repo = initTempRepo("run-command-saved-", { "package.json": PACKAGE });

      const { exitCode, stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      const runId = branchIn(stdout).replace("surface/", "");

      expect(stdout.trimEnd().split("\n").slice(-2)).toEqual([
        "This run: 1 of 1 task completed and committed to its own branch.",
        `Run \`delivery report ${runId}\` for what to do.`,
      ]);
      const report = await delivery(["report", runId], { cwd: repo });
      expect(savedText(repo)).toBe(report.stdout);
      expect(savedText(repo)).toContain("  Saved to: .delivery/last-report.txt and .delivery/last-report.json");
      expect(savedData(repo)).toMatchObject({ schema: "delivery.report/1", kind: "task" });
      expect([SAVED_TEXT, SAVED_DATA].map((file) => statSync(join(repo, file)).mode & 0o777)).toEqual([0o600, 0o600]);
      expect(git(repo, ["status", "--porcelain"])).toBe("");
      expect(exitCode).toBe(EXIT.ok);
    },
    RUN_TIMEOUT,
  );

  it("ends a run of the list with the list's sentence, and saves the report `delivery report` prints", async () => {
    const repo = await listRepo("run-command-saved-list-", [PAGE, SWAP]);

    const { exitCode, stdout } = await delivery(["run"], { cwd: repo });

    expect(stdout.trimEnd().split("\n").slice(-2)).toEqual([
      "Your task list: 1 of 2 tasks completed and committed to its own branch; 1 stopped, for your engineers.",
      "Run `delivery report` for what to do.",
    ]);
    expect(savedText(repo)).toBe((await delivery(["report"], { cwd: repo })).stdout);
    expect(savedData(repo)).toMatchObject({ kind: "list", counts: { closed: 1, escalated: 1 } });
    expect(exitCode).toBe(EXIT.escalated);
  });

  it("replaces the pair the run before left", async () => {
    const repo = await listRepo("run-command-saved-again-", [PAGE, SWAP]);
    await delivery(["run"], { cwd: repo });
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ tasks: [PAGE] }));

    await delivery(["run"], { cwd: repo });

    expect(savedText(repo).split("\n")[0]).toBe("Your task list: 1 of 1 task completed and committed to its own branch.");
    expect(savedData(repo)).toMatchObject({ counts: { closed: 1, escalated: 0 } });
    expect(readdirSync(join(repo, ".delivery")).sort()).toEqual([".gitignore", "last-report.json", "last-report.txt", "runs"]);
  });

  it("ends as it would have, saying in one line that the report was not saved and why, when the files cannot be written", async () => {
    const repo = await listRepo("run-command-unsaved-", [PAGE, SWAP]);
    // A folder where the data file belongs: nothing can be written over it.
    mkdirSync(join(repo, SAVED_DATA), { recursive: true });

    const { exitCode, stdout, stderr } = await delivery(["run"], { cwd: repo });
    const lines = stdout.trimEnd().split("\n");

    expect(exitCode).toBe(EXIT.escalated);
    expect(lines.slice(-3, -1)).toEqual([
      "Your task list: 1 of 2 tasks completed and committed to its own branch; 1 stopped, for your engineers.",
      "Run `delivery report` for what to do.",
    ]);
    expect(lines.at(-1)).toMatch(/^This report could not be saved to \.delivery\/last-report\.txt and \.delivery\/last-report\.json\. The system said: "E[A-Z]+: /);
    expect(existsSync(join(repo, SAVED_TEXT))).toBe(false);
    expect(stderr).toBe("");
    expect((await delivery(["report"], { cwd: repo })).stdout.split("\n")[0]).toBe(lines.at(-3));
  });

  it("keeps the closing lines off the data stream under --json, and still saves the report", async () => {
    const repo = await listRepo("run-command-saved-json-", [PAGE, SWAP]);

    const { stdout, stderr } = await delivery(["run", "--json"], { cwd: repo });

    expect(stdout).not.toContain("Your task list");
    expect(stderr.trimEnd().split("\n").slice(-2)).toEqual([
      "Your task list: 1 of 2 tasks completed and committed to its own branch; 1 stopped, for your engineers.",
      "Run `delivery report` for what to do.",
    ]);
    expect(existsSync(join(repo, SAVED_TEXT))).toBe(true);
  });
});

describe("the write fence", () => {
  it(
    "goes ahead without it, warning first, and records it was absent",
    async () => {
      const repo = initTempRepo("run-command-fence-", { "package.json": PACKAGE });
      const { exitCode, stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain(FENCE_ABSENT);
      expect(stdout.indexOf(FENCE_ABSENT)).toBeLessThan(stdout.indexOf("Starting run"));
      const runId = branchIn(stdout).replace("surface/", "");
      const caseJson = JSON.parse(readFileSync(join(repo, ".delivery", "runs", runId, "case.json"), "utf-8")) as { header: { fence?: unknown } };
      expect(caseJson.header.fence).toEqual({ mode: "preferred", devices: [], state: { present: false, reason: "bubblewrap (bwrap) is not installed" } });
    },
    RUN_TIMEOUT,
  );

  it("refuses to start when the file requires it and it is absent, naming why", async () => {
    const repo = initTempRepo("run-command-fence-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ fence: "required" }) });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("bubblewrap (bwrap) is not installed");
    expect(stderr).toContain('`fence` is "required"');
  });

  it(
    "says nothing of it when the file turns it off",
    async () => {
      const repo = initTempRepo("run-command-fence-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ fence: "off" }) });
      const { stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      expect(stdout).not.toContain(FENCE_ABSENT);
    },
    RUN_TIMEOUT,
  );
});

describe("delivery run --workflow", () => {
  const ok = { type: "command-succeeds", command: "true" };
  const WORKFLOWS = {
    "plan-then-build": { steps: [{ name: "plan", prompt: "Write PLAN.md.", gate: ok }, { name: "build", prompt: "Carry out PLAN.md.", gate: ok }] },
  };
  const writes = (path: string): MockScript["expectations"][number] => ({
    effects: [{ write: { path, content: "done\n" } }],
    json: { status: "completed", rationale: `wrote ${path}` },
  });

  it(
    "runs a task through a named workflow, step by step, and lands it once",
    async () => {
      const repo = initTempRepo("run-command-workflow-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ workflows: WORKFLOWS }) });
      const script = await scriptFile({ expectations: [writes("PLAN.md"), writes("BUILT.md")] });

      const { exitCode } = await delivery(["run", "--task", "plan then build", "--workflow", "plan-then-build"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: script } });

      expect(exitCode).toBe(EXIT.ok);
      const [record] = await allRuns(repo);
      expect(record?.caseFile.header.workflow?.name).toBe("plan-then-build");
      expect(record?.caseFile.history.filter((e) => e.t === "step")).toHaveLength(1);
    },
    RUN_TIMEOUT * 2,
  );

  it("refuses an unknown workflow before anything starts", async () => {
    const repo = initTempRepo("run-command-workflow-unknown-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ workflows: WORKFLOWS }) });
    const { exitCode, stderr } = await delivery(["run", "--task", "x", "--workflow", "nope"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(unknownWorkflow("nope", ["plan-then-build", "code:scan", "code:fix", "deprecations:scan", "deprecations:code", "deprecations:tests", "security:scan", "security:fix"]));
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });

  it("refuses --workflow for a list of tasks with no task named", async () => {
    const repo = initTempRepo("run-command-workflow-list-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: ["add a hello function, with a test"], workflows: WORKFLOWS }) });
    const { exitCode, stderr } = await delivery(["run", "--workflow", "plan-then-build"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(WORKFLOW_NEEDS_TASK);
  });
});

describe("delivery run with pack settings", () => {
  const SHELL = "$(touch pwned-a); touch pwned-b `touch pwned-c` | touch pwned-d && touch pwned-e";

  /** A repository using a pack `docs` from `docs-pack/`: a find `look` offering an act `fix`, with two settings, `note` given `value`. */
  function settingsProject(value: string): string {
    const repo = initTempRepo("run-command-pack-settings-", { "package.json": PACKAGE });
    mkdirSync(join(repo, "docs-pack"));
    writeFileSync(
      join(repo, "docs-pack", "pack.json"),
      JSON.stringify({
        schema: "delivery.pack/3",
        name: "docs",
        version: "1.0.0",
        title: "Docs",
        summary: "Keeps documents true.",
        settings: {
          "docs-folder": { type: "path", summary: "The folder.", default: "docs" },
          note: { type: "text", summary: "A note.", default: "none" },
        },
        workflows: { look: { kind: "find", prompt: "look.md", ideasFor: ["fix"] }, fix: { kind: "act", prompt: "fix.md" } },
      }),
    );
    writeFileSync(join(repo, "docs-pack", "look.md"), "Look in {{settings.docs-folder}}.");
    writeFileSync(join(repo, "docs-pack", "fix.md"), "Fix the page in {{settings.docs-folder}}.\nNote: {{settings.note}}");
    configIn(repo, { packs: ["docs-pack"], packSettings: { docs: { note: value } } });
    return repo;
  }

  it(
    "pins the bound pack prompt into the run's record, and a resume reads the pin, not the configuration",
    async () => {
      const repo = settingsProject("first value");
      const { stdout } = await delivery(["run", "--task", TASK, "--workflow", "docs:fix"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });
      const caseFile = join(repo, ".delivery", "runs", branchIn(stdout).replace("surface/", ""), "case.json");
      configIn(repo, { packs: ["docs-pack"], packSettings: { docs: { note: "second value" } } });

      const record = JSON.parse(readFileSync(caseFile, "utf-8")) as { header: { workflow: { steps: { prompt: string }[] } } };
      expect(record.header.workflow.steps[0]?.prompt).toContain("Note: first value");
      // What a resumed dispatch is told is assembled from the record alone.
      const { prompt } = assemblePrompt(stepView(await load(dirname(caseFile))), DEFAULT_ROLES.worker, { brief: null, newFailures: [], setback: null });
      expect(prompt).toContain("Note: first value");
      expect(prompt).not.toContain("second value");
    },
    RUN_TIMEOUT,
  );

  it(
    "sends a value of shell characters to the agent as text and runs nothing from it",
    async () => {
      const repo = settingsProject(SHELL);
      const [first] = completes.expectations;
      if (first === undefined) throw new Error("no scripted answer");
      const script: MockScript = { expectations: [{ when: { promptContains: `Note: ${SHELL}` }, ...first }] };
      const { exitCode, stdout } = await delivery(["run", "--task", TASK, "--workflow", "docs:fix"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(script) } });

      // The scripted agent answers only when the prompt holds the value byte for byte.
      expect(exitCode).toBe(EXIT.ok);
      const branch = branchIn(stdout);
      for (const marker of ["pwned-a", "pwned-b", "pwned-c", "pwned-d", "pwned-e"]) {
        expect(existsSync(join(repo, marker))).toBe(false);
        expect(git(repo, ["ls-tree", "-r", "--name-only", branch]).split("\n")).not.toContain(marker);
      }
    },
    RUN_TIMEOUT,
  );
});
