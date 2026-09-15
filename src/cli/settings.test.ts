import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { unknownCloser, type DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { NO_CHECK } from "./project.js";
import { BOTH_TASKS, NO_TASK, NO_TASK_FILE, resolveSettings, taskIntent, type RunFlags } from "./settings.js";

const TASK = "add a function that says goodbye to a name, with a test";
const NPM_TEST = { type: "command", command: "npm test", parseMode: "exitcode" } as const;

/** A folder standing in for a repository, with or without a test script to infer a check from. */
function project(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "settings-"));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(dir, name), contents);
  return dir;
}

const withTestScript = { "package.json": JSON.stringify({ name: "scratch", scripts: { test: "node --test" } }) };

function settings(
  flags: RunFlags,
  { env = {}, config = {}, repoPath = project(withTestScript) }: { env?: NodeJS.ProcessEnv; config?: DeliveryConfig; repoPath?: string } = {},
) {
  return resolveSettings(flags, { env, cwd: repoPath, repoPath, config });
}

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("what the run is asked to do", () => {
  it("takes the task from --task", async () => {
    expect((await settings({ task: TASK })).taskDef).toEqual({ intent: TASK });
  });

  it("reads the task from the file --task-file names, resolved against the folder the command was run from", async () => {
    const repoPath = project({ ...withTestScript, "task.txt": `${TASK}\n` });
    expect((await settings({ taskFile: "task.txt" }, { repoPath })).taskDef).toEqual({ intent: TASK });
  });

  it("refuses --task and --task-file together, rather than guessing", async () => {
    const refusal = await refusalOf(settings({ task: TASK, taskFile: "task.txt" }));
    expect(refusal.message).toBe(BOTH_TASKS);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses a task file that isn't there, naming it", async () => {
    const refusal = await refusalOf(settings({ taskFile: "missing.txt" }));
    expect(refusal.message).toBe(NO_TASK_FILE("missing.txt"));
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("falls back to DELIVERY_TASK, then to the config file", async () => {
    expect((await settings({}, { env: { DELIVERY_TASK: "from the environment" } })).taskDef).toEqual({ intent: "from the environment" });
    expect((await settings({}, { config: { task: { intent: "from the file" } } })).taskDef).toEqual({ intent: "from the file" });
  });

  it("lets a flag beat the environment, which beats the file", async () => {
    const env = { DELIVERY_TASK: "from the environment" };
    const config: DeliveryConfig = { task: { intent: "from the file" } };
    expect((await settings({ task: TASK }, { env, config })).taskDef).toEqual({ intent: TASK });
    expect((await settings({}, { env, config })).taskDef).toEqual({ intent: "from the environment" });
  });

  it("refuses when nothing says what to do", async () => {
    const refusal = await refusalOf(settings({}));
    expect(refusal.message).toBe(NO_TASK);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("keeps a task with fields the harness doesn't read, because a task is the project's to shape", async () => {
    const taskDef = { intent: TASK, acceptance: ["greets by name"] };
    expect((await settings({}, { config: { task: taskDef } })).taskDef).toEqual(taskDef);
  });
});

describe("what checks the work", () => {
  it("turns --gate-command into a check that passes when the command exits 0", async () => {
    expect((await settings({ task: TASK, gateCommand: "make check" })).gateRef).toEqual({
      type: "command",
      command: "make check",
      parseMode: "exitcode",
    });
  });

  it("falls back to DELIVERY_GATE_COMMAND, then to the config file, then to the project's test script", async () => {
    expect((await settings({ task: TASK }, { env: { DELIVERY_GATE_COMMAND: "make check" } })).gateRef).toEqual({
      type: "command",
      command: "make check",
      parseMode: "exitcode",
    });
    expect((await settings({ task: TASK }, { config: { gate: { type: "custom", modulePath: "./gates/mine.mjs" } } })).gateRef).toEqual({
      type: "custom",
      modulePath: "./gates/mine.mjs",
    });
    expect((await settings({ task: TASK })).gateRef).toEqual(NPM_TEST);
  });

  it("lets --gate-command beat the environment, which beats the file", async () => {
    const env = { DELIVERY_GATE_COMMAND: "make check" };
    const config: DeliveryConfig = { gate: NPM_TEST };
    expect((await settings({ task: TASK, gateCommand: "npx vitest run" }, { env, config })).gateRef).toEqual({
      type: "command",
      command: "npx vitest run",
      parseMode: "exitcode",
    });
    expect((await settings({ task: TASK }, { env, config })).gateRef).toEqual({ type: "command", command: "make check", parseMode: "exitcode" });
  });

  it("refuses when there is nothing to check with, naming both ways to say so", async () => {
    const refusal = await refusalOf(settings({ task: TASK }, { repoPath: project() }));
    expect(refusal.message).toBe(NO_CHECK);
    expect(NO_CHECK).toContain("--gate-command");
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});

describe("what happens to accepted work", () => {
  it("commits to a branch when nothing says otherwise", async () => {
    expect((await settings({ task: TASK })).closerRef).toEqual({ type: "commit-to-branch" });
  });

  it.each(["commit-to-branch", "merge-back", "open-pr"])("takes the built-in closer %s from --closer", async (type) => {
    expect((await settings({ task: TASK, closer: type })).closerRef).toEqual({ type });
  });

  it("falls back to DELIVERY_CLOSER, then to the config file, keeping the file's own options", async () => {
    expect((await settings({ task: TASK }, { env: { DELIVERY_CLOSER: "merge-back" } })).closerRef).toEqual({ type: "merge-back" });
    expect((await settings({ task: TASK }, { config: { closer: { type: "merge-back", deleteBranch: true } } })).closerRef).toEqual({
      type: "merge-back",
      deleteBranch: true,
    });
  });

  it("lets --closer beat the environment, which beats the file", async () => {
    const env = { DELIVERY_CLOSER: "open-pr" };
    const config: DeliveryConfig = { closer: { type: "merge-back" } };
    expect((await settings({ task: TASK, closer: "commit-to-branch" }, { env, config })).closerRef).toEqual({ type: "commit-to-branch" });
    expect((await settings({ task: TASK }, { env, config })).closerRef).toEqual({ type: "open-pr" });
  });

  it("treats an environment variable set to nothing as not set, so CI's empty input doesn't beat the file", async () => {
    const config: DeliveryConfig = { closer: { type: "merge-back" }, gate: NPM_TEST };
    const env = { DELIVERY_CLOSER: "", DELIVERY_GATE_COMMAND: "" };
    expect((await settings({ task: TASK }, { env, config })).closerRef).toEqual({ type: "merge-back" });
    expect((await settings({ task: TASK }, { env, config })).gateRef).toEqual(NPM_TEST);
  });

  it("refuses a closer type it doesn't know, listing the choices", async () => {
    const refusal = await refusalOf(settings({ task: TASK, closer: "teleport" }));
    expect(refusal.message).toBe(unknownCloser("teleport"));
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses --closer custom, because a custom closer needs a module path the file has room for", async () => {
    expect((await refusalOf(settings({ task: TASK, closer: "custom" }))).message).toBe(unknownCloser("custom"));
  });
});

describe("how many attempts each setback gets", () => {
  it("uses the default caps when the file sets none", async () => {
    expect((await settings({ task: TASK })).budgets).toEqual(DEFAULT_BUDGETS);
  });

  it("takes a cap from the file and leaves the rest at their defaults, with nothing used", async () => {
    expect((await settings({ task: TASK }, { config: { budgets: { correction: 5 } } })).budgets).toEqual({
      ...DEFAULT_BUDGETS,
      correction: { used: 0, max: 5 },
    });
  });

  it("takes every cap when the file sets them all", async () => {
    const budgets = { correction: 5, gateError: 4, gateMaintenance: 3, terminus: 9, close: 2 };
    expect((await settings({ task: TASK }, { config: { budgets } })).budgets).toEqual({
      correction: { used: 0, max: 5 },
      gateError: { used: 0, max: 4 },
      gateMaintenance: { used: 0, max: 3 },
      terminus: { used: 0, max: 9 },
      close: { used: 0, max: 2 },
    });
  });

  it("does not change the shared default set", async () => {
    await settings({ task: TASK }, { config: { budgets: { correction: 5 } } });
    expect(DEFAULT_BUDGETS.correction).toEqual({ used: 0, max: 3 });
  });
});

describe("taskIntent", () => {
  it("is the task's own words", () => {
    expect(taskIntent({ intent: TASK })).toBe(TASK);
  });

  it("falls back to a plain word for a task shaped some other way, so a run still gets a name", () => {
    expect(taskIntent({ goal: "something else" })).toBe("run");
  });
});
