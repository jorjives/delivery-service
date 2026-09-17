import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { PACKAGE } from "./command-fixtures.js";
import { BUILT_IN_CLOSERS, loadConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { NOT_A_REPOSITORY } from "./project.js";
import { DEFAULT_CLOSER, resolveSettings } from "./settings.js";
import { CONFIG_FILE, initCommand, LEFT_ALONE, NEEDS_A_TERMINAL, WRITTEN, type ChoiceQuestion, type TextQuestion } from "./init.js";

const TASK = "add a function that says hello to a name, with a test";

const sample = (files: Record<string, string> = { "package.json": PACKAGE }) => initTempRepo("init-", { "README.md": "hi\n", ...files });

describe("what `delivery init` asks", () => {
  it("offers the project's own check when it has one, so pressing Enter accepts it", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[0] as TextQuestion).default).toBe("npm test");
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
    });
  });

  it("asks for a check with nothing suggested when the project has no test script", async () => {
    const repo = sample({});
    const { ask, asked } = scriptedAsk({ texts: ["make check", "build a greeting"] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[0] as TextQuestion).default).toBeUndefined();
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({
      gate: { type: "command", command: "make check", parseMode: "exitcode" },
    });
  });

  it("offers every built-in closing action, each with a line saying what it does", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);
    const closerQuestion = asked[1] as ChoiceQuestion;

    // Sorted on both sides: the menu leads with the default, because that is
    // what a person should see first, and the schema's own order is arbitrary.
    // What must not drift is which closers are offered at all.
    expect(closerQuestion.choices.map((choice) => choice.value).sort()).toEqual([...BUILT_IN_CLOSERS].sort());
    for (const choice of closerQuestion.choices) {
      expect(choice.name.length, choice.value).toBeGreaterThan(0);
      expect(choice.description.length, choice.value).toBeGreaterThan(0);
    }
  });

  it("commits to a branch unless told otherwise, as a run with no config file does", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[1] as ChoiceQuestion).default).toBe(DEFAULT_CLOSER.type);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ closer: DEFAULT_CLOSER });
  });

  it("asks three questions and writes exactly those three answers", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: ["npm test", TASK], choice: "merge-back" });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(asked).toHaveLength(3);
    const written = readFileSync(CONFIG_FILE(repo), "utf-8");
    expect(JSON.parse(written)).toEqual({
      task: { intent: TASK },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
    });
    expect(written.endsWith("\n")).toBe(true);
    expect(lines).toEqual([WRITTEN(CONFIG_FILE(repo))]);
  });

  it("writes the file at the top of the repository, where a run from any folder finds it", async () => {
    const repo = sample();
    const { ctx } = context(join(repo, "does-not-matter"));

    await initCommand({ repo }, ctx, scriptedAsk({ texts: ["npm test", TASK] }).ask);

    expect(existsSync(CONFIG_FILE(repo))).toBe(true);
  });
});

describe("a config file that is already there", () => {
  it("asks before replacing it, and leaves it exactly as it was when told not to", async () => {
    const repo = sample();
    writeFileSync(CONFIG_FILE(repo), '{ "closer": { "type": "open-pr" } }\n');
    const { ask, asked } = scriptedAsk({ confirm: false });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(readFileSync(CONFIG_FILE(repo), "utf-8")).toBe('{ "closer": { "type": "open-pr" } }\n');
    expect(asked).toHaveLength(1);
    expect(lines).toEqual([LEFT_ALONE(CONFIG_FILE(repo))]);
  });

  it("replaces it when told to, having asked first", async () => {
    const repo = sample();
    writeFileSync(CONFIG_FILE(repo), '{ "closer": { "type": "open-pr" } }\n');
    const { ask, asked } = scriptedAsk({ texts: ["npm test", TASK], confirm: true });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked).toHaveLength(4);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ closer: DEFAULT_CLOSER, task: { intent: TASK } });
  });

  it("asks about a computed config file too, because the file it writes would be used instead of it", async () => {
    const repo = sample();
    const computed = join(repo, "delivery.config.js");
    writeFileSync(computed, "export default {};\n");
    const { ask, asked } = scriptedAsk({ confirm: false });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(existsSync(CONFIG_FILE(repo))).toBe(false);
    expect(asked).toHaveLength(1);
    expect(lines).toEqual([LEFT_ALONE(computed)]);
  });
});

describe("when there is nobody to answer", () => {
  it("stops and says it needs a terminal, without writing anything", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk();

    const err = await initCommand({}, context(repo, { interactive: false }).ctx, ask).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Refusal);
    expect((err as Refusal).message).toBe(NEEDS_A_TERMINAL);
    expect((err as Refusal).exitCode).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(existsSync(CONFIG_FILE(repo))).toBe(false);
  });

  it("says so before complaining about the folder, because that is the mistake to fix first", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "init-not-repo-"));

    const err = await initCommand({}, context(notARepo, { interactive: false }).ctx, scriptedAsk().ask).catch((e: unknown) => e);

    expect((err as Refusal).message).toBe(NEEDS_A_TERMINAL);
  });
});

describe("a folder that isn't a repository", () => {
  it("says so in the same words every other command uses, with the configuration exit code", async () => {
    const notARepo = mkdtempSync(join(tmpdir(), "init-not-repo-"));
    const { ask, asked } = scriptedAsk();

    const err = await initCommand({}, context(notARepo).ctx, ask).catch((e: unknown) => e);

    expect((err as Refusal).message).toBe(NOT_A_REPOSITORY);
    expect((err as Refusal).exitCode).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
  });
});

describe("the run that follows", () => {
  it("reads back as the check, closing action and task that were answered, with no flags at all", async () => {
    const repo = sample();
    const { ask } = scriptedAsk({ texts: ["npm test", TASK], choice: "merge-back" });
    await initCommand({}, context(repo).ctx, ask);

    const config = await loadConfig({ startDir: repo, repoPath: repo, flag: undefined, env: {} });
    const settings = await resolveSettings({}, { env: {}, intent: undefined, repoPath: repo, config });

    expect(settings.taskDef).toEqual({ intent: TASK });
    expect(settings.gateRef).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
    expect(settings.closerRef).toEqual({ type: "merge-back" });
  });
});
