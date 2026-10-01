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
import { DEFAULT_CLOSER, resolveProject } from "./settings.js";
import { queueTasks } from "./queue.js";
import { READY, validateCommand } from "./validate-command.js";
import { ALREADY_LISTED, atOnceQuestion, CLOSER_QUESTION, CONFIG_FILE, DESCRIPTION_QUESTION, NOTHING_TO_DO, checkQuestion, initCommand, LEFT_ALONE, NEEDS_A_TERMINAL, SUGGESTED_AT_ONCE, WRITTEN, overwriteQuestion, taskQuestion, type ChoiceQuestion, type ConfirmQuestion, type TextQuestion } from "./init.js";

const TASK = "add a function that says hello to a name, with a test";

const sample = (files: Record<string, string> = { "package.json": PACKAGE }) => initTempRepo("init-", { "README.md": "hi\n", ...files });

describe("what `delivery init` asks", () => {
  it("offers the project's own check when it has one, so pressing Enter accepts it", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[1] as TextQuestion).default).toBe("npm test");
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
    });
  });

  it("asks for a check with nothing suggested when the project has no test script", async () => {
    const repo = sample({});
    const { ask, asked } = scriptedAsk({ texts: [undefined, "make check", "build a greeting"] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[1] as TextQuestion).default).toBeUndefined();
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({
      gate: { type: "command", command: "make check", parseMode: "exitcode" },
    });
  });

  it("offers every built-in closing action, each with a line saying what it does", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);
    const closerQuestion = asked[2] as ChoiceQuestion;

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
    const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked[2] as ChoiceQuestion).default).toBe(DEFAULT_CLOSER.type);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ closer: DEFAULT_CLOSER });
  });

  it("asks each question once, and writes exactly the answers given", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: ["A greeting library.", "npm test", TASK], choice: "merge-back" });
    const { ctx, lines } = context(repo);

    expect(await initCommand({}, ctx, ask)).toBe(EXIT.ok);

    expect(asked).toHaveLength(5);
    const written = readFileSync(CONFIG_FILE(repo), "utf-8");
    expect(JSON.parse(written)).toEqual({
      domain: "A greeting library.",
      tasks: [TASK],
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
    });
    expect(written.endsWith("\n")).toBe(true);
    expect(lines).toEqual([WRITTEN(CONFIG_FILE(repo))]);
  });

  it("writes the file at the top of the repository, where a run from any folder finds it", async () => {
    const repo = sample();
    const { ctx } = context(join(repo, "does-not-matter"));

    await initCommand({ repo }, ctx, scriptedAsk({ texts: [undefined, "npm test", TASK] }).ask);

    expect(existsSync(CONFIG_FILE(repo))).toBe(true);
  });

  it("asks first what the project is, and writes the description exactly as typed", async () => {
    const repo = sample();
    const description = "A tiny greeting library. Plain Node.js, tested with node:test.";
    const { ask, asked } = scriptedAsk({ texts: [description, undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked[0]).toEqual(DESCRIPTION_QUESTION);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ domain: description });
  });

  it("lets the description be skipped, leaving it out of the file rather than writing it empty", async () => {
    const repo = sample();
    const { ask } = scriptedAsk({ texts: ["   ", undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect(DESCRIPTION_QUESTION.required).toBeUndefined();
    expect(DESCRIPTION_QUESTION.default).toBeUndefined();
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).not.toHaveProperty("domain");
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
    const { ask, asked } = scriptedAsk({ texts: [undefined, "npm test", TASK], confirm: true });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked).toHaveLength(6);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ closer: DEFAULT_CLOSER, tasks: [TASK] });
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

describe("the things you'd like done", () => {
  it("asks one at a time until an empty answer, and writes every one as a list in the order given", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, "add a hello", "add a goodbye", ""] });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked.slice(3, 6)).toEqual([taskQuestion([]), taskQuestion(["add a hello"]), taskQuestion(["add a hello", "add a goodbye"])].map(
      (question) => ({ ...question, validate: expect.any(Function) }),
    ));
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ tasks: ["add a hello", "add a goodbye"] });
  });

  it("writes a single task as a list of one, never as a one-off", async () => {
    const repo = sample();
    const { ask } = scriptedAsk({ texts: [undefined, undefined, TASK] });

    await initCommand({}, context(repo).ctx, ask);

    const written = JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"));
    expect(written.tasks).toEqual([TASK]);
    expect(written).not.toHaveProperty("task");
  });

  it("won't take a blank first answer, because a file with nothing to do has nothing to run", async () => {
    const repo = sample();
    const { ask, refused } = scriptedAsk({ texts: [undefined, undefined, "", "   ", TASK] });

    await initCommand({}, context(repo).ctx, ask);

    expect(refused).toEqual([NOTHING_TO_DO, NOTHING_TO_DO]);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ tasks: [TASK] });
  });

  it("won't take the same task twice, even with different spacing, because the two could not be told apart", async () => {
    const repo = sample();
    const { ask, refused } = scriptedAsk({ texts: [undefined, undefined, "add a hello", "  add a hello ", "add a goodbye"] });

    await initCommand({}, context(repo).ctx, ask);

    expect(refused).toEqual([ALREADY_LISTED]);
    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ tasks: ["add a hello", "add a goodbye"] });
  });

  it("keeps each task exactly as typed", async () => {
    const repo = sample();
    const { ask } = scriptedAsk({ texts: [undefined, undefined, "add a hello, with a test "] });

    await initCommand({}, context(repo).ctx, ask);

    expect(JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"))).toMatchObject({ tasks: ["add a hello, with a test "] });
  });
});

describe("running some at the same time", () => {
  /** Enter for the description and the check, then three things to do. */
  const THREE = [undefined, undefined, "add a hello", "add a goodbye", "add a welcome"];
  const written = (repo: string) => JSON.parse(readFileSync(CONFIG_FILE(repo), "utf-8"));
  const yesOrNo = (question: unknown): question is ConfirmQuestion =>
    typeof (question as ConfirmQuestion).default === "boolean";

  it("asks once more than one thing is listed, saying how many there are and suggesting a number", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: THREE });

    await initCommand({}, context(repo).ctx, ask);

    const question = asked.at(-1) as ConfirmQuestion;
    expect(question).toEqual(atOnceQuestion(3));
    expect(question.message).toContain("3 things to do");
    expect(question.message).toContain(`${SUGGESTED_AT_ONCE} at once`);
  });

  it("says in one sentence that it costs more at the same time and uses a working copy for each", () => {
    const sentences = atOnceQuestion(3).message.split(/(?<=[.?])\s+/);
    const explaining = sentences.filter((sentence) => /costs more|working copy/.test(sentence));

    expect(explaining).toHaveLength(1);
    expect(explaining[0]).toMatch(/costs more at the same time.*working copy/);
  });

  it("suggests two: the smallest number that is more than one at a time", () => {
    expect(SUGGESTED_AT_ONCE).toBe(2);
  });

  it("writes the suggested number when told yes, and `delivery validate` reports it", async () => {
    const repo = sample();
    const { ask } = scriptedAsk({ texts: THREE, confirms: [true] });

    await initCommand({}, context(repo).ctx, ask);

    expect(written(repo)).toMatchObject({ concurrency: SUGGESTED_AT_ONCE });
    const { ctx, lines } = context(repo);
    expect(await validateCommand({}, ctx)).toBe(EXIT.ok);
    expect(lines).toContain(`✓ concurrency: up to ${SUGGESTED_AT_ONCE} tasks at once (3 queued)`);
  });

  it.each([
    { answer: "Enter", confirms: [] as boolean[] },
    { answer: "no", confirms: [false] },
  ])("writes nothing about it on $answer, leaving one at a time", async ({ confirms }) => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: THREE, confirms });

    await initCommand({}, context(repo).ctx, ask);

    expect((asked.at(-1) as ConfirmQuestion).default).toBe(false);
    expect(written(repo)).toMatchObject({ tasks: ["add a hello", "add a goodbye", "add a welcome"] });
    expect(written(repo)).not.toHaveProperty("concurrency");
  });

  it("does not ask when only one thing is listed", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, TASK], confirms: [true] });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked.some(yesOrNo)).toBe(false);
    expect(written(repo)).not.toHaveProperty("concurrency");
  });

  it("leaves the setting out on a second run that says no, though the file being replaced had it", async () => {
    const repo = sample();
    writeFileSync(CONFIG_FILE(repo), `${JSON.stringify({ tasks: ["a", "b"], concurrency: 2 })}\n`);
    const { ask } = scriptedAsk({ texts: THREE, confirms: [true, false] });

    await initCommand({}, context(repo).ctx, ask);

    expect(written(repo)).toMatchObject({ tasks: ["add a hello", "add a goodbye", "add a welcome"] });
    expect(written(repo)).not.toHaveProperty("concurrency");
  });
});

describe("the words it uses", () => {
  it("says everything in everyday words, with none of the harness's own vocabulary", () => {
    const shown = [
      DESCRIPTION_QUESTION.message,
      checkQuestion("npm test").message,
      CLOSER_QUESTION.message,
      ...CLOSER_QUESTION.choices.flatMap((choice) => [choice.name, choice.description]),
      taskQuestion([]).message,
      taskQuestion(["add a hello"]).message,
      NOTHING_TO_DO,
      ALREADY_LISTED,
      overwriteQuestion("delivery.config.json").message,
      overwriteQuestion("delivery.config.js").message,
      atOnceQuestion(3).message,
    ];

    for (const text of shown) {
      expect(text).not.toMatch(/domain|queue|intent|gate|closer|worktree|envelope|surface|case file|role config|schema|concurrency/i);
    }
  });
});

describe("the run that follows", () => {
  it("passes `delivery validate` and reads back as the answers given, with no flags at all", async () => {
    const repo = sample();
    const description = "A tiny greeting library.";
    const { ask } = scriptedAsk({ texts: [description, "npm test", "add a hello", "add a goodbye"], choice: "merge-back" });
    await initCommand({}, context(repo).ctx, ask);

    const { ctx, lines } = context(repo);
    expect(await validateCommand({}, ctx)).toBe(EXIT.ok);
    expect(lines).toContain("✓ domain description: present");
    expect(lines).toContain("✓ 2 tasks queued");
    expect(lines.at(-1)).toBe(READY);

    const config = await loadConfig({ startDir: repo, repoPath: repo, flag: undefined, env: {} });
    const project = await resolveProject({}, { env: {}, repoPath: repo, config });
    expect(queueTasks(config)).toEqual([{ intent: "add a hello" }, { intent: "add a goodbye" }]);
    expect(project.domainPrompt).toBe(description);
    expect(project.gateRef).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
    expect(project.closerRef).toEqual({ type: "merge-back" });
  });
});
