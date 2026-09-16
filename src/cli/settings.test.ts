import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseFileHeader } from "../schema.js";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { unknownCloser, type DeliveryConfig } from "./config.js";
import { EXIT, Refusal, renderFailure } from "./failures.js";
import { NO_CHECK } from "./project.js";
import { BOTH_TASKS, checkCustomModules, ignoredNote, ignoredSettings, NO_TASK, NO_TASK_FILE, resolveSettings, taskIntent, type RunFlags } from "./settings.js";

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

const WORKING_GATE = "export default { baseline: async () => ({ status: 'PASS', assertions: [] }), check: async () => ({ status: 'PASS', assertions: [] }) };\n";
const WORKING_CLOSER = "export default { close: async () => ({ status: 'DONE', detail: 'closed' }) };\n";

/** What the user would see, and the code the command would exit with, for a module the harness can't use. */
async function failureFor(promise: Promise<unknown>) {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeDefined();
  return renderFailure(err);
}

describe("checking a custom gate or closer before the run starts", () => {
  it("accepts modules that export what their contracts need", async () => {
    const repoPath = project({ "gate.mjs": WORKING_GATE, "closer.mjs": WORKING_CLOSER });
    await expect(
      checkCustomModules({ type: "custom", modulePath: "./gate.mjs" }, { type: "custom", modulePath: "./closer.mjs" }, repoPath),
    ).resolves.toBeUndefined();
  });

  it("does nothing for the built-in gate and closer", async () => {
    await expect(checkCustomModules(NPM_TEST, { type: "commit-to-branch" }, project())).resolves.toBeUndefined();
  });

  it("stops on a gate module that isn't there, naming the path and the guide, with no stack trace", async () => {
    const failure = await failureFor(
      checkCustomModules({ type: "custom", modulePath: "./gates/nope.mjs" }, { type: "commit-to-branch" }, project()),
    );
    expect(failure.message).toContain("Couldn't load the custom gate at `./gates/nope.mjs`");
    expect(failure.message).toContain("docs/writing-a-gate.md");
    expect(failure.message).not.toContain("    at ");
    expect(failure.exitCode).toBe(EXIT.configuration);
  });

  it("stops on a gate module that doesn't export what a gate needs", async () => {
    const repoPath = project({ "half.mjs": "export default { baseline: async () => ({ status: 'PASS', assertions: [] }) };\n" });
    const failure = await failureFor(checkCustomModules({ type: "custom", modulePath: "./half.mjs" }, { type: "commit-to-branch" }, repoPath));
    expect(failure.message).toContain("Couldn't load the custom gate at `./half.mjs`");
    expect(failure.message).toContain('missing "check" method');
    expect(failure.exitCode).toBe(EXIT.configuration);
  });

  it("stops on a closer module that isn't there, naming the path and the closer guide", async () => {
    const failure = await failureFor(checkCustomModules(NPM_TEST, { type: "custom", modulePath: "./closers/nope.mjs" }, project()));
    expect(failure.message).toContain("Couldn't load the custom closer at `./closers/nope.mjs`");
    expect(failure.message).toContain("docs/writing-a-closer.md");
    expect(failure.exitCode).toBe(EXIT.configuration);
  });

  it("stops on a closer module that doesn't export a close method", async () => {
    const repoPath = project({ "empty.mjs": "export default {};\n" });
    const failure = await failureFor(checkCustomModules(NPM_TEST, { type: "custom", modulePath: "./empty.mjs" }, repoPath));
    expect(failure.message).toContain('missing "close" method');
    expect(failure.exitCode).toBe(EXIT.configuration);
  });
});

describe("what a resumed run cannot take from this invocation", () => {
  const PINNED: CaseFileHeader = {
    surfaceId: "reverse-a-word-20260915T213012Z",
    taskDef: { intent: "reverse a word" },
    gateRef: { type: "command", command: "npm test", parseMode: "exitcode" },
    closerRef: { type: "commit-to-branch" },
    baseline: null,
    baseBranch: null,
  };

  it("names a flag that asks for something the run did not start with", () => {
    expect(ignoredSettings({ gateCommand: "npm run verify" }, {}, PINNED)).toEqual(["--gate-command"]);
    expect(ignoredSettings({ closer: "merge-back" }, {}, PINNED)).toEqual(["--closer"]);
  });

  it("names the environment variable when that is where the setting came from", () => {
    expect(ignoredSettings({}, { DELIVERY_CLOSER: "merge-back" }, PINNED)).toEqual(["DELIVERY_CLOSER"]);
  });

  it("says nothing when the flag asks for what the run is already doing", () => {
    expect(ignoredSettings({ gateCommand: "npm test", closer: "commit-to-branch" }, {}, PINNED)).toEqual([]);
  });

  it("says nothing when no flag was given at all", () => {
    expect(ignoredSettings({}, { DELIVERY_CLOSER: "" }, PINNED)).toEqual([]);
  });

  it("names --config, which a run already under way never reads", () => {
    expect(ignoredSettings({ config: "delivery.config.json" }, {}, PINNED)).toEqual(["--config"]);
  });

  it("reads as one note, however many settings it names", () => {
    expect(ignoredNote(["--closer"])).toBe("Note: a run keeps the settings it started with, so --closer was ignored.");
    expect(ignoredNote(["--gate-command", "--closer"])).toBe(
      "Note: a run keeps the settings it started with, so --gate-command and --closer were ignored.",
    );
  });
});
