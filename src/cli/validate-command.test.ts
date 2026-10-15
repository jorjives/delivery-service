import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { cleanGitEnv } from "../git-env.js";
import type { CloserRef, GateRef } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, runsRoot, writeRunRecord } from "./command-fixtures.js";
import { BOTH_TASK_AND_TASKS, sameTask, type DeliveryConfig } from "./config.js";
import { EXIT } from "./failures.js";
import { NO_TEST_COMMAND, type GatePreset } from "./gate-presets.js";
import { NO_CHECK } from "./project.js";
import type { ProjectSettings } from "./settings.js";
import { checkedLines, NO_CONFIG, READY } from "./validate-command.js";
import { planConfig, writePlan } from "../packs/plan.js";
import { fixTaskFor } from "../packs/fix-task.js";
import { exampleRepo, sampleFinding, writeReview } from "../packs/review-fixtures.js";

// validate must work on a machine with no Claude Code runtime and no sign-in.
// Every test in this file runs with the one way into the agent runtime made to
// fail loudly, so a validate that reached for it would fail here, not in CI.
vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: () => {
    throw new Error("validate must never start an agent");
  },
}));

const NPM_TEST: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

function project(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return { gateRef: NPM_TEST, closerRef: { type: "commit-to-branch" }, budgets: DEFAULT_BUDGETS, concurrency: 1, ...overrides };
}

describe("what validate says a project is set up to do", () => {
  it("says the description is there, how many tasks are queued, what the check runs and what the closing action does", () => {
    const config: DeliveryConfig = { domain: "A tool.", tasks: ["add a page", "add a form", "add a test"] };
    expect(checkedLines(config, project({ domainPrompt: "A tool." }))).toEqual([
      "✓ domain description: present",
      "✓ 3 tasks queued",
      "✓ gate: runs `npm test`",
      "✓ closer: commits to a new branch",
    ]);
  });

  it("says a missing description is optional, rather than calling it a problem", () => {
    expect(checkedLines({}, project())[0]).toBe("✓ domain description: none (it's optional)");
  });

  it("counts one queued task in the singular", () => {
    expect(checkedLines({ tasks: ["add a page"] }, project())[1]).toBe("✓ 1 task queued");
  });

  it("says a single task set in `task` is there", () => {
    expect(checkedLines({ task: { intent: "add a page" } }, project())[1]).toBe("✓ 1 task, set in `task`");
  });

  it("says where to give a task when the file names none, which is still ready to run", () => {
    expect(checkedLines({}, project())[1]).toBe('✓ no tasks listed: name one when you run, with `delivery run --task "..."`');
  });

  it("names a custom check by the module it lives in", () => {
    const gateRef: GateRef = { type: "custom", modulePath: "./gates/mine.mjs" };
    expect(checkedLines({}, project({ gateRef }))[2]).toBe("✓ gate: your own check, in `./gates/mine.mjs`");
  });

  it.each<[CloserRef, string]>([
    [{ type: "commit-to-branch" }, "✓ closer: commits to a new branch"],
    [{ type: "merge-back" }, "✓ closer: merges into your base branch"],
    [{ type: "open-pr" }, "✓ closer: opens a pull request"],
    [{ type: "custom", modulePath: "./closers/mine.mjs" }, "✓ closer: your own closing action, in `./closers/mine.mjs`"],
  ])("says what the closing action %j does", (closerRef, line) => {
    expect(checkedLines({}, project({ closerRef }))[3]).toBe(line);
  });

  it.each<[GatePreset, string, string]>([
    [{ type: "test-runner" }, "npm test", "✓ gate: runs your tests with `npm test`"],
    [{ type: "file-exists", path: "CHANGES.md" }, "test -f 'CHANGES.md'", "✓ gate: checks that CHANGES.md exists"],
    [{ type: "command-succeeds", command: "npm run lint" }, "npm run lint", "✓ gate: checks that `npm run lint` succeeds"],
    [
      { type: "schema-validates", file: "data.json", schema: "data.schema.json" },
      "npx --yes ajv-cli@5.0.0 validate -s 'data.schema.json' -d 'data.json'",
      "✓ gate: checks that data.json matches the shape in data.schema.json",
    ],
  ])("describes the ready-made check %j by what it checks", (gatePreset, command, line) => {
    const gateRef: GateRef = { type: "command", command, parseMode: "exitcode" };
    expect(checkedLines({}, project({ gateRef, gatePreset }))[2]).toBe(line);
  });

  it("names the agent options the file sets", () => {
    expect(checkedLines({ agent: { model: "opus", append: "x" } }, project({ agent: { model: "opus", append: "x" } }))).toContain("✓ agent options: model, append");
  });

  it("says how many tasks run at once, with how many are queued, when more than one may", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => `task ${i + 1}`);
    expect(checkedLines({ tasks }, project({ concurrency: 3 }))[1]).toBe("✓ concurrency: up to 3 tasks at once (10 queued)");
  });

  it("says only how many are queued at one at a time, exactly as before", () => {
    expect(checkedLines({ tasks: ["a", "b"] }, project({ concurrency: 1 }))[1]).toBe("✓ 2 tasks queued");
  });
});

const COMPLETE = {
  domain: "A small tool that greets people by name.",
  tasks: ["add a function that says hello", "add a function that says goodbye", "add a function that waves"],
  gate: { type: "command", command: "npm test", parseMode: "exitcode" },
  closer: { type: "commit-to-branch" },
};

const WORKING_GATE =
  "export default { baseline: async () => ({ status: 'PASS', assertions: [] }), check: async () => ({ status: 'PASS', assertions: [] }) };\n";

/** A committed repository with a test script and, unless `config` is undefined, a delivery.config.json holding it. */
function repoWith(config: unknown, files: Record<string, string> = {}): string {
  const baseFiles: Record<string, string> = { "package.json": PACKAGE };
  if (config !== undefined) {
    baseFiles["delivery.config.json"] = JSON.stringify(config);
  }
  return initTempRepo("validate-", { ...baseFiles, ...files });
}

describe("delivery validate on a configuration that is ready", () => {
  it("names the file, says what it checked, ends ready to run, and needs no agent to do it", async () => {
    const repo = repoWith(COMPLETE);
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe("");
    expect(stdout).toBe(
      [
        "Checking delivery.config.json…",
        "✓ domain description: present",
        "✓ 3 tasks queued",
        "✓ gate: runs `npm test`",
        "✓ closer: commits to a new branch",
        READY,
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(EXIT.ok);
  });

  it("reports the concurrency the file sets", async () => {
    const { exitCode, stdout } = await delivery(["validate"], { cwd: repoWith({ ...COMPLETE, concurrency: 2 }) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("✓ concurrency: up to 2 tasks at once (3 queued)");
    expect(stdout).not.toContain("✓ 3 tasks queued");
  });

  it("passes an existing four-setting file from before descriptions and lists", async () => {
    const repo = repoWith({
      task: { intent: "add a function that says hello" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
      budgets: { correction: 5 },
    });
    const { stdout, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stdout).toContain("✓ domain description: none (it's optional)");
    expect(stdout).toContain("✓ 1 task, set in `task`");
    expect(stdout).toContain("✓ closer: merges into your base branch");
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("describes a ready-made check in the file by what it checks", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "file-exists", path: "CHANGES.md" } });
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe("");
    expect(stdout).toContain("✓ gate: checks that CHANGES.md exists\n");
    expect(exitCode).toBe(EXIT.ok);
  });

  it("loads a custom check without running it", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "custom", modulePath: "./gate.mjs" } }, { "gate.mjs": WORKING_GATE });
    const { stdout, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stdout).toContain("✓ gate: your own check, in `./gate.mjs`");
    expect(exitCode).toBe(EXIT.ok);
  });

  it("checks the repository --repo names, from anywhere", async () => {
    const repo = repoWith(COMPLETE);
    const elsewhere = mkdtempSync(join(tmpdir(), "validate-elsewhere-"));
    const { stdout, exitCode } = await delivery(["validate", "--repo", repo], { cwd: elsewhere });
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("checks the file --config names", async () => {
    const repo = repoWith(undefined, { "elsewhere.json": JSON.stringify(COMPLETE) });
    const { stdout, exitCode } = await delivery(["validate", "--config", "elsewhere.json"], { cwd: repo });
    expect(stdout.split("\n")[0]).toBe("Checking elsewhere.json…");
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("names the agent options a file sets, and says so", async () => {
    const repo = repoWith({ ...COMPLETE, agent: { append: "Never modify anything under the ops folder." } });
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe("");
    expect(stdout).toContain("✓ agent options: append\n");
    expect(stdout.endsWith(`${READY}\n`)).toBe(true);
    expect(exitCode).toBe(EXIT.ok);
  });
});

describe("delivery validate on a configuration with a problem", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["an empty description", { ...COMPLETE, domain: "  " }, "`domain` is empty. Describe your project in a sentence or two, or remove it."],
    ["an empty list", { ...COMPLETE, tasks: [] }, "`tasks` is empty. Add at least one sentence describing what you want done"],
    [
      "an empty entry",
      { ...COMPLETE, tasks: ["add a function that says hello", "", "add a function that waves"] },
      "`tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.",
    ],
    [
      "two entries that are the same task",
      { ...COMPLETE, tasks: ["add a function that says hello", "add a function that says goodbye", "add a function that says hello"] },
      sameTask(1, 3),
    ],
    ["both a single task and a list", { ...COMPLETE, task: { intent: "add a page" } }, BOTH_TASK_AND_TASKS],
    [
      "a tool list set from the file",
      { ...COMPLETE, roles: { worker: { allowedTools: ["Read"] } } },
      "`roles.worker.allowedTools` is no longer used. The agent now has the tools your own Claude Code setup gives it; to keep it from one, add it to `permissions.deny` in your Claude settings.",
    ],
    [
      "instructions set from the file",
      { ...COMPLETE, roles: { gateMaintenance: { systemPromptFragment: "Be careful." } } },
      "`roles` is no longer used. Put any instructions for the agent in `agent.append` instead.",
    ],
    [
      "a misspelt ready-made check",
      { ...COMPLETE, gate: { type: "file-exist", path: "CHANGES.md" } },
      "I don't know the check `file-exist`. The ready-made checks are `test-runner`, `file-exists`, `command-succeeds` and `schema-validates`. To write one out in full, see docs/writing-a-gate.md.",
    ],
    [
      "a ready-made check missing its detail",
      { ...COMPLETE, gate: { type: "file-exists" } },
      "the ready-made check `file-exists` needs `path`, the file that should exist.",
    ],
  ])("names %s in one plain line, with the configuration exit code", async (_, config, message) => {
    const repo = repoWith(config);
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toContain(message);
    expect(stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(stdout).not.toContain(READY);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("names a custom check that can't be loaded", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "custom", modulePath: "./gates/nope.mjs" } });
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toContain("Couldn't load the custom gate at `./gates/nope.mjs`");
    expect(stdout).not.toContain(READY);
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("names a custom closing action that can't be loaded", async () => {
    const repo = repoWith({ ...COMPLETE, closer: { type: "custom", modulePath: "./closers/nope.mjs" } });
    const { stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toContain("Couldn't load the custom closer at `./closers/nope.mjs`");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("says there is no config file, and where to get one", async () => {
    const repo = repoWith(undefined);
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe(`${NO_CONFIG}\n`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it.each([0, -1, 1.5])("refuses a concurrency of %j with the configuration code and one thing to fix", async (value) => {
    const { exitCode, stderr } = await delivery(["validate"], { cwd: repoWith({ ...COMPLETE, concurrency: value }) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(`the setting \`concurrency\` is \`${JSON.stringify(value)}\`. It says how many tasks from your list may run at once`);
  });
});

describe("delivery validate after delivery fix, in a project with no configuration of its own", () => {
  it("checks the fix's plan", async () => {
    const repo = exampleRepo("validate-plan-");
    const dir = await writeReview(repo, { findings: [sampleFinding()] });
    await writePlan(dir, planConfig([fixTaskFor("code", sampleFinding(), NPM_TEST)], project({ closerRef: { type: "merge-back" } }), {}, undefined));
    const { exitCode, stdout } = await delivery(["validate"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("plan.config.json");
    expect(stdout).toContain(READY);
  });
});

describe("delivery validate changes nothing", () => {
  /** Everything validate could have touched: git's view of the repository, every byte of every run record, and the state folder. */
  function snapshot(repo: string, state: string) {
    const records = readdirSync(runsRoot(repo), { recursive: true, encoding: "utf-8" })
      .sort()
      .map((path) => {
        const full = join(runsRoot(repo), path);
        return statSync(full).isFile() ? `${path}\n${readFileSync(full, "utf-8")}` : path;
      });
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() });
    return { status, records, state: readdirSync(state) };
  }

  it("leaves the repository, a run's record and the state folder exactly as they were", async () => {
    const repo = repoWith(COMPLETE);
    await writeRunRecord(repo, { runId: "add-a-function-that-says-hello-20260914T210309Z", task: "add a function that says hello" });
    const state = mkdtempSync(join(tmpdir(), "validate-state-"));
    const before = snapshot(repo, state);

    const { exitCode } = await delivery(["validate"], { cwd: repo, env: { XDG_STATE_HOME: state } });

    expect(exitCode).toBe(EXIT.ok);
    expect(snapshot(repo, state)).toEqual(before);
    expect(before.state).toEqual([]);
  });
});

/** What `delivery validate --json` printed, parsed, beside what the plain form printed for the same project. */
async function bothForms(repo: string, env: Record<string, string> = {}) {
  const json = await delivery(["validate", "--json"], { cwd: repo, env });
  const plain = await delivery(["validate"], { cwd: repo, env });
  return { json: { ...json, result: JSON.parse(json.stdout) as unknown }, plain };
}

describe("delivery validate --json", () => {
  it("says a clean configuration is ready with no problems, as the only thing on standard output", async () => {
    const { json, plain } = await bothForms(repoWith(COMPLETE));
    expect(json.result).toEqual({ ready: true, problems: [] });
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(EXIT.ok);
    expect(plain.exitCode).toBe(EXIT.ok);
  });

  it("lists every problem at once, each naming its field, the first in exactly the plain form's words", async () => {
    const repo = repoWith({ ...COMPLETE, domain: "", tasks: ["add a function that says hello", ""] });
    const { json, plain } = await bothForms(repo);
    expect(json.result).toEqual({
      ready: false,
      problems: [
        { field: "tasks.1", message: expect.stringContaining("`tasks` item 2 is empty. Add a sentence describing what you want done, or remove it.") },
        { field: "domain", message: expect.stringContaining("`domain` is empty. Describe your project in a sentence or two, or remove it.") },
      ],
    });
    const { problems } = json.result as { problems: { message: string }[] };
    expect(plain.stderr).toBe(`${problems[0]?.message}\n`);
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(plain.exitCode).toBe(EXIT.configuration);
  });

  it("uses the plain form's words for a problem found after the shape is right", async () => {
    const repo = repoWith({ ...COMPLETE, gate: { type: "custom", modulePath: "./gates/nope.mjs" } });
    const { json, plain } = await bothForms(repo);
    const { problems } = json.result as { problems: { message: string }[] };
    expect(problems).toHaveLength(1);
    expect(plain.stderr).toBe(`${problems[0]?.message}\n`);
    expect(json.exitCode).toBe(plain.exitCode);
  });

  it.each<[string, string, string]>([
    ["no config file at all", "", NO_CONFIG],
    ["a config file that is not valid JSON", "{ nope", "isn't valid JSON"],
  ])("lists %s as a problem with no field, with the configuration exit code", async (_, text, message) => {
    const repo = repoWith(undefined, text === "" ? {} : { "delivery.config.json": text });
    const { json, plain } = await bothForms(repo);
    expect(json.result).toEqual({ ready: false, problems: [{ field: null, message: expect.stringContaining(message) }] });
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(plain.exitCode).toBe(EXIT.configuration);
  });

  it.each<[string, Record<string, unknown>, Record<string, string>, Record<string, string>, string, string]>([
    ["a custom check that can't be loaded", { ...COMPLETE, gate: { type: "custom", modulePath: "./gates/nope.mjs" } }, {}, {}, "gate", "Couldn't load the custom gate at `./gates/nope.mjs`"],
    ["a custom closing action that can't be loaded", { ...COMPLETE, closer: { type: "custom", modulePath: "./closers/nope.mjs" } }, {}, {}, "closer", "Couldn't load the custom closer at `./closers/nope.mjs`"],
    ["a test-runner check with no tests to run", { ...COMPLETE, gate: { type: "test-runner" } }, { "package.json": "{}" }, {}, "gate", NO_TEST_COMMAND],
    ["no check and no tests to run", { domain: COMPLETE.domain, tasks: COMPLETE.tasks }, { "package.json": "{}" }, {}, "gate", NO_CHECK],
  ])("names the setting for %s", async (_, config, files, env, field, message) => {
    const { json, plain } = await bothForms(repoWith(config, files), env);
    expect(json.result).toEqual({ ready: false, problems: [{ field, message: expect.stringContaining(message) }] });
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(plain.exitCode).toBe(EXIT.configuration);
  });

  it("names the closer setting for a closing action the environment names that doesn't exist", async () => {
    const { json } = await bothForms(repoWith(COMPLETE), { DELIVERY_CLOSER: "teleport" });
    const result = json.result as { ready: boolean; problems: Array<{ field?: string; message: string }> };
    expect(result.ready).toBe(false);
    expect(result.problems).toHaveLength(1);
    const problem = result.problems[0];
    expect(problem?.field).toBe("closer");
    expect(problem?.message).toMatch(/teleport/);
    expect(problem?.message).toMatch(/built-in choices/);
  });

  it("names the concurrency setting for a DELIVERY_CONCURRENCY that is not a whole number", async () => {
    const { json } = await bothForms(repoWith(COMPLETE), { DELIVERY_CONCURRENCY: "0" });
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(json.result).toMatchObject({ ready: false, problems: [{ field: "concurrency" }] });
  });
});
