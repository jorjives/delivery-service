# Project Configuration — Slice 7: Let the Setup Wizard Ask About Your Project and Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 7 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** `delivery init` also asks for a skippable one-sentence project description and for tasks one at a time until the owner presses Enter on an empty answer, and writes them as `domain` and a `tasks` list in a `delivery.config.json` that `delivery validate` accepts and `delivery run` works through at once.

**Architecture:** Everything stays in the existing wizard (`src/cli/init.ts`) and its existing `Ask` seam over `@inquirer/prompts` (`src/cli/prompts.ts`). The one addition to the seam is an optional `validate` on `TextQuestion`, mapped straight onto `@inquirer/prompts`' own `validate` option (the library re-asks and shows the message inline), so a blank first task and a repeated task are refused at the prompt rather than crashing `DeliveryConfig.parse` afterwards. `configFrom` keeps parsing through `DeliveryConfig`, so the wizard still cannot write a file its own loader would refuse.

**Tech Stack:** Node ≥ 22, TypeScript strict, zod 4, `@inquirer/prompts` 8, vitest, changesets. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Extend the existing wizard and its existing prompt library; do not add another." So: no new prompt library, no new command file, no second wizard; repeated/blank-answer refusal uses `@inquirer/prompts`' built-in `validate` option, not a hand-written re-ask loop in `init.ts`.
- **Spec (verbatim):** "`delivery init` *(extended, SHOULD)* Asks for a domain description and first tasks alongside its existing questions."
- **Spec, schema:** `domain` is `Prose` (the schema's `Written`: whitespace-only is refused); `tasks` is `z.array(QueueEntry).min(1)`; two entries that structure to the same `TaskDef` are refused at load (`sameTask`); `task` and `tasks` are mutually exclusive. The wizard must write only files that satisfy all four.
- **Prose is kept as typed:** the description and each task are written exactly as the owner typed them (not trimmed), following `config.ts`'s "trimming it would edit the owner's words". Blankness and sameness are judged on the trimmed text, as `structureTask` does.
- **Vocabulary (slice AC):** no question or refusal the wizard shows may contain "domain", "queue", "intent", "gate", "closer", "worktree", "envelope", "surface", "case file", "role config" or "schema".
- **Unchanged behaviour:** the no-terminal refusal, the repository check, asking about an existing config file first, and "declining leaves it exactly as it was" all stay as they are.
- **Copy:** British English; no em-dashes in anything a person reads (questions, README, guides, changeset).
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the session's `Co-Authored-By` trailer.
- **Running a targeted test:** `src/` unit tests run directly (`npx vitest run <file>`); the Item 8 UAT test drives the compiled CLI, so `npm run build && npx vitest run <file>`.

### Decisions settled for this plan (unattended run)

- **Question order:** existing-file confirm (unchanged, first), description, check, closing action, tasks. Matches the UAT's order ("describe the project in a sentence, accept the suggested check and closing action, and enter two tasks").
- **Stopping the task list is an empty answer**, not a "another one?" yes/no after each task: one keystroke instead of two per task, and the question itself says "Press Enter when that's everything." The first task question refuses a blank answer (a file with no task has nothing to run).
- **Always `tasks`, never `task`:** one task is written as a one-entry list, per the AC. `task` stays the hand-written one-off form.
- **A repeated task is refused at the prompt** (`validate`) with a plain sentence, because the loader refuses duplicates and a wizard that crashes on its own output is worse than one that asks again.
- **A description of only spaces counts as skipped** and `domain` is left out, since the schema refuses whitespace-only prose.
- **`WRITTEN` is unchanged** ("Written … To start the run: delivery run"): it already says the configuration was written, and `delivery run` walks the list.
- **Key order in the written JSON** is the schema's shape order (`tasks`, `domain`, `gate`, `closer`), as `DeliveryConfig.parse` emits it. Reordering the schema for cosmetics is not worth it: the point of this slice is that the owner never opens the file.
- **The Item 8 slice 7 UAT test is updated in place**, not left failing: it pins the three-question wizard and the singular `task` key, which this slice deliberately replaces. Its intent (answers reach the next run with no flags) is kept.

## Scaffolding Impact

- **Reactive:** `README.md` "Set it up by answering a few questions" says "It asks three things … and the first thing you would like done" → Task 3.
- **Reactive:** `docs/getting-started.md` "Where to go next" and `docs/project-configuration.md` "Going further" each describe what `delivery init` asks → Task 3.
- **Reactive:** `delivery init --help` description in `src/cli/program.ts` lists the questions → Task 3.
- **Reactive:** `tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts` pins the old question order, count and `task` key → answers re-ordered in Task 2, count and list in Task 3.
- **Reactive:** changelog: new pending minor changeset `.changeset/describe-your-project-while-setting-up.md` → Task 3. (`tests/release.test.ts` already refuses any pending major entry; nothing to add there.)
- `docs/superpowers/specs/*` and `.changeset/set-up-by-answering-questions.md` are history and stay as written. No `CLAUDE.md` / `AGENTS.md` exists. No new command, env var, dependency or build step.

---

### Task 1: Let a typed answer be refused and asked again

**Files:**
- Modify: `src/cli/init.ts` (the `TextQuestion` interface only)
- Modify: `src/cli/prompts.ts` (pass `validate` through)
- Modify: `src/cli/init-fixtures.ts` (`scriptedAsk` honours `validate`, records refusals)
- Test: `src/cli/prompts.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `TextQuestion.validate?: (answer: string) => true | string` — `true` accepts; a string is what to tell the person, and the question is asked again.
  - `scriptedAsk(...)` returns `{ ask, asked, refused }`, where `refused: string[]` is every refusal message in order. A refused scripted answer moves on to the next scripted answer; if the refused answer was not scripted (the queue was already empty), `ask.text` rejects with an `Error` so a test cannot loop forever.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("asking with @inquirer/prompts", ...)` block of `src/cli/prompts.test.ts`:

```ts
  it("says why an answer was refused and asks again, keeping the one it accepts", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => (shown += chunk.toString()));

    const answer = inquirerAsk(false, { input, output }).text({
      message: "What else would you like done?",
      validate: (typed) => (typed === "the same again" ? "You've already listed that one." : true),
    });
    await untilShown(() => shown, "What else would you like done?");
    input.write("the same again\n");
    await untilShown(() => shown, "You've already listed that one.");
    // The library keeps a refused answer on the line to be edited; clear it first.
    input.write("\u0015something new\n");

    expect(await answer).toBe("something new");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/prompts.test.ts`
Expected: FAIL: TypeScript/vitest reports `validate` is not a known property of `TextQuestion`, or the test times out in `untilShown` because no refusal is shown.

If `\u0015` (Ctrl+U, clear line) does not clear the kept value in `@inquirer/core`'s readline, write the replacement as `"\b".repeat("the same again".length) + "something new\n"` instead; check which by running the test, not by guessing.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/init.ts`, replace the `TextQuestion` interface with:

```ts
/**
 * A question answered by typing. `default` is what pressing Enter means;
 * `required` refuses an empty answer rather than writing one; `validate`
 * refuses any other answer it returns a sentence for, and that sentence is
 * shown while the question is asked again.
 */
export interface TextQuestion {
  message: string;
  default?: string;
  required?: boolean;
  validate?: (answer: string) => true | string;
}
```

In `src/cli/prompts.ts`, change the `text` mapping to:

```ts
    text: (question) =>
      input(
        { message: question.message, default: question.default, required: question.required ?? false, validate: question.validate, theme },
        streams,
      ),
```

In `src/cli/init-fixtures.ts`, replace `scriptedAsk` with:

```ts
/**
 * A person answering the wizard's questions in the order they are asked,
 * recording each question so a test can assert on what was actually offered.
 * An answer left out is Enter: the question's own default. An answer the
 * question refuses is recorded in `refused` and the next scripted answer is
 * tried, as a person would type again; a refused answer with nothing scripted
 * after it fails the test rather than asking forever.
 */
export function scriptedAsk({ texts = [], choice, confirm }: { texts?: (string | undefined)[]; choice?: string; confirm?: boolean } = {}) {
  const asked: (TextQuestion | ChoiceQuestion | ConfirmQuestion)[] = [];
  const refused: string[] = [];
  const queue = [...texts];
  const ask: Ask = {
    text(question) {
      asked.push(question);
      for (;;) {
        const scripted = queue.length > 0;
        const answer = queue.shift() ?? question.default ?? "";
        const verdict = question.validate?.(answer) ?? true;
        if (verdict === true) return Promise.resolve(answer);
        refused.push(verdict);
        if (!scripted) return Promise.reject(new Error(`"${answer}" was refused (${verdict}) and no answer is scripted after it`));
      }
    },
    choose(question) {
      asked.push(question);
      return Promise.resolve(choice ?? question.default);
    },
    confirm(question) {
      asked.push(question);
      return Promise.resolve(confirm ?? question.default);
    },
  };
  return { ask, asked, refused };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/prompts.test.ts src/cli/init.test.ts && npx tsc --noEmit`
Expected: PASS (existing init tests unaffected: no current question has `validate`).

- [ ] **Step 5: Commit**

```bash
git add src/cli/init.ts src/cli/prompts.ts src/cli/init-fixtures.ts src/cli/prompts.test.ts
git commit -m "Let a wizard question refuse an answer and ask again

The task list the wizard is about to ask for must not hold a blank first
task or the same task twice, because the loader refuses both. The prompt
library already re-asks with a message through its validate option, so
the Ask seam passes that through rather than the wizard re-asking by hand."
```

---

### Task 2: Ask for a short, skippable project description

**Files:**
- Modify: `src/cli/init.ts` (`DESCRIPTION_QUESTION`, `configFrom`, `initCommand`)
- Test: `src/cli/init.test.ts`

**Interfaces:**
- Consumes: `TextQuestion` from Task 1 (no `validate` needed here).
- Produces:
  - `export const DESCRIPTION_QUESTION: TextQuestion` (no `default`, no `required`).
  - `configFrom({ description, check, closer, task }: { description: string; check: string; closer: string; task: string }): DeliveryConfig` — adds `domain: description` unless `description.trim() === ""`. (`task` becomes `tasks: string[]` in Task 3.)
  - Question order in `initCommand`: description, check, closing action, task.

- [ ] **Step 1: Re-index the existing tests for the new first question**

The description is now asked first, so in `src/cli/init.test.ts`:
- every `scriptedAsk({ texts: [undefined, TASK] })` becomes `scriptedAsk({ texts: [undefined, undefined, TASK] })`;
- `texts: ["make check", "build a greeting"]` becomes `texts: [undefined, "make check", "build a greeting"]`;
- `texts: ["npm test", TASK]` (four places) becomes `texts: [undefined, "npm test", TASK]`;
- `asked[0] as TextQuestion` (check) becomes `asked[1] as TextQuestion`; `asked[1] as ChoiceQuestion` (closer) becomes `asked[2] as ChoiceQuestion`;
- in "asks three questions and writes exactly those three answers": rename to "asks four questions and writes exactly those answers" and `toHaveLength(3)` becomes `toHaveLength(4)`;
- in "replaces it when told to, having asked first": `toHaveLength(4)` becomes `toHaveLength(5)`.

- [ ] **Step 2: Write the failing tests**

Add `DESCRIPTION_QUESTION` to the `./init.js` import in `src/cli/init.test.ts`, then add inside `describe("what \`delivery init\` asks", ...)`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/cli/init.test.ts`
Expected: FAIL: `DESCRIPTION_QUESTION` is not exported, and the re-indexed tests fail because the check is still the first question.

- [ ] **Step 4: Write minimal implementation**

In `src/cli/init.ts`, add above `checkQuestion`:

```ts
/**
 * What the project is, in the owner's words, told to the agent before every
 * task. Skippable: pressing Enter leaves it out of the file, which a project
 * can live without.
 */
export const DESCRIPTION_QUESTION: TextQuestion = {
  message:
    "Describe your project in a sentence or two: what it is and what it's built with. " +
    "The agent reads this before every task. Press Enter to skip.",
};
```

Replace `configFrom` with:

```ts
/**
 * The answers as the file a run reads. Parsed by the very schema `delivery
 * run` will parse it with, so this command can never write a file its own
 * loader would refuse. A blank description is left out rather than written
 * empty, which the loader would refuse. Limits are deliberately absent: the
 * defaults are better left implicit than frozen into a file nobody asked to set.
 */
export function configFrom({
  description,
  check,
  closer,
  task,
}: {
  description: string;
  check: string;
  closer: string;
  task: string;
}): DeliveryConfig {
  return DeliveryConfig.parse({
    ...(description.trim() === "" ? {} : { domain: description }),
    task: { intent: task },
    gate: { type: "command", command: check, parseMode: "exitcode" },
    closer: { type: closer },
  });
}
```

In `initCommand`, ask the description first and pass it through:

```ts
  const description = await ask.text(DESCRIPTION_QUESTION);
  const check = await ask.text(checkQuestion(await inferredCheck(repoPath)));
  const closer = await ask.choose(CLOSER_QUESTION);
  const task = await ask.text(TASK_QUESTION);

  await writeFile(file, `${JSON.stringify(configFrom({ description, check, closer, task }), null, 2)}\n`);
```

Update the comment "someone who is keeping the file they have should not have to answer three questions" to "…should not have to answer every question to find that out."

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/cli/init.test.ts`
Expected: PASS.

- [ ] **Step 6: Keep the Item 8 recorded test answering the questions in their new order**

`tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts` scripts answers by position, so the new first question shifts them. Keep this commit green:
- `scriptedAsk({ texts: [undefined, TASK] })` becomes `scriptedAsk({ texts: [undefined, undefined, TASK] })`;
- `expect(asked).toHaveLength(3);` becomes `expect(asked).toHaveLength(4);` and `const [checkAsked, closerAsked, taskAsked] = asked as [TextQuestion, ChoiceQuestion, TextQuestion];` becomes `const [, checkAsked, closerAsked, taskAsked] = asked as [TextQuestion, TextQuestion, ChoiceQuestion, TextQuestion];`;
- `texts: ["npm run check", TASK]` becomes `texts: [undefined, "npm run check", TASK]` and `const [checkAsked] = asked as [TextQuestion];` becomes `const [, checkAsked] = asked as [TextQuestion, TextQuestion];`.

Run: `npm run build && npx vitest run tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/init.ts src/cli/init.test.ts tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts
git commit -m "Ask what the project is when setting it up

A project owner should be able to give every agent the project's context
without opening the config file. The answer is written as the file's
description exactly as typed, and pressing Enter leaves it out, because
the description is optional and an empty one would be refused."
```

---

### Task 3: Ask for tasks one at a time and write them as a list

**Files:**
- Modify: `src/cli/init.ts` (`taskQuestion`, `NOTHING_TO_DO`, `ALREADY_LISTED`; remove `TASK_QUESTION`; `configFrom` takes `tasks`; `initCommand` loops)
- Modify: `src/cli/program.ts:144-147` (`init` help description)
- Modify: `tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts`
- Modify: `README.md` ("Set it up by answering a few questions")
- Modify: `docs/getting-started.md` ("Where to go next", the `delivery init` sentence)
- Modify: `docs/project-configuration.md` (last paragraph of "Going further")
- Create: `.changeset/describe-your-project-while-setting-up.md`
- Test: `src/cli/init.test.ts`

**Interfaces:**
- Consumes: `TextQuestion.validate` and `scriptedAsk(...).refused` (Task 1); `DESCRIPTION_QUESTION` and `configFrom`'s `description` (Task 2); `validateCommand`, `READY` from `./validate-command.js`; `queueTasks` from `./queue.js`; `resolveProject` from `./settings.js`.
- Produces:
  - `export const taskQuestion = (listed: string[]): TextQuestion`
  - `export const NOTHING_TO_DO: string`, `export const ALREADY_LISTED: string`
  - `configFrom({ description, check, closer, tasks }: { description: string; check: string; closer: string; tasks: string[] }): DeliveryConfig`
  - `TASK_QUESTION` is removed (no other importer: verified with grep).

- [ ] **Step 1: Write the failing tests**

In `src/cli/init.test.ts`:

Change the `./init.js` import to also bring in `ALREADY_LISTED`, `NOTHING_TO_DO`, `overwriteQuestion`, `CLOSER_QUESTION`, `checkQuestion` and `taskQuestion`; add imports:

```ts
import { queueTasks } from "./queue.js";
import { resolveProject } from "./settings.js";
import { READY, validateCommand } from "./validate-command.js";
```

(`resolveSettings` is no longer used once the last test is replaced; drop it from the `./settings.js` import, keeping `DEFAULT_CLOSER`.)

Every existing scripted run now needs the empty answer that ends the list, which `scriptedAsk` supplies by itself (no scripted answer left means Enter, and Enter on the second task question is accepted). So the re-indexed `texts` from Task 2 stay as they are. Update the expectations:

- "asks four questions and writes exactly those answers": rename to "asks each question once, and writes exactly the answers given", change `texts` to `["A greeting library.", "npm test", TASK]`, `toHaveLength(4)` to `toHaveLength(5)` (description, check, closing action, first task, "anything else"), and the `toEqual` to:

```ts
    expect(JSON.parse(written)).toEqual({
      domain: "A greeting library.",
      tasks: [TASK],
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back" },
    });
```

- "replaces it when told to, having asked first": `toHaveLength(5)` becomes `toHaveLength(6)`, and `task: { intent: TASK }` becomes `tasks: [TASK]`.

Add a new block:

```ts
describe("the things you'd like done", () => {
  it("asks one at a time until an empty answer, and writes every one as a list in the order given", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: [undefined, undefined, "add a hello", "add a goodbye", ""] });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked.slice(3)).toEqual([taskQuestion([]), taskQuestion(["add a hello"]), taskQuestion(["add a hello", "add a goodbye"])].map(
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
    ];

    for (const text of shown) {
      expect(text).not.toMatch(/domain|queue|intent|gate|closer|worktree|envelope|surface|case file|role config|schema/i);
    }
  });
});
```

Replace the whole `describe("the run that follows", ...)` block with:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/init.test.ts`
Expected: FAIL: `taskQuestion`, `NOTHING_TO_DO`, `ALREADY_LISTED` not exported; the file still carries `task`, not `tasks`.

- [ ] **Step 3: Write minimal implementation**

In `src/cli/init.ts`, replace `TASK_QUESTION` with:

```ts
export const NOTHING_TO_DO = "Say what you'd like done, in a sentence.";

export const ALREADY_LISTED = "You've already said that one. Say something different.";

/**
 * The next thing to do, given the ones already said. The first cannot be
 * blank: a file with nothing to do has nothing to run. After that, a blank
 * answer means that's everything. A task already said is refused, trimmed
 * as the loader compares them, because the loader refuses two the same.
 */
export const taskQuestion = (listed: string[]): TextQuestion => ({
  message:
    listed.length === 0
      ? "What's the first thing you'd like done? Say it the way you'd say it to a colleague."
      : "What else would you like done? Press Enter when that's everything.",
  validate: (answer) => {
    const said = answer.trim();
    if (said === "") return listed.length === 0 ? NOTHING_TO_DO : true;
    return listed.some((task) => task.trim() === said) ? ALREADY_LISTED : true;
  },
});

/** Everything the owner would like done, asked one at a time until a blank answer. */
async function askTasks(ask: Ask): Promise<string[]> {
  const tasks: string[] = [];
  for (;;) {
    const answer = await ask.text(taskQuestion(tasks));
    if (answer.trim() === "") return tasks;
    tasks.push(answer);
  }
}
```

In `configFrom`, change the parameter `task: string` to `tasks: string[]` (in both the destructuring and the type) and replace `task: { intent: task },` with `tasks,`. Update its doc comment's first sentence to: "The answers as the file a run reads: always a list of tasks, even of one, because `task` is the hand-written one-off form."

In `initCommand`, replace `const task = await ask.text(TASK_QUESTION);` with `const tasks = await askTasks(ask);` and pass `tasks` to `configFrom`. Update `initCommand`'s doc comment to: "`delivery init`: set a project up by answering questions instead of writing the file by hand. It asks what the project is, what checks the agent's work, what happens to work that passes, and what you'd like done, one thing at a time, and writes the answers where the next `delivery run` will find them with no flags at all."

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the Item 8 recorded test for the new question order and the list**

In `tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts`:

Add below the `// Recorded:` header line:

```ts
// Updated: Project Configuration slice 7 added the description question first
// and writes tasks as a list; the answers still reach the next run unflagged.
```

Add `import { queueTasks } from "../../src/cli/queue.js";`, change the settings import to `import { DEFAULT_CLOSER, resolveProject } from "../../src/cli/settings.js";`.

In the UAT test (answers already re-ordered in Task 2), replace the comment above `expect(asked).toHaveLength(4);` and that line with:

```ts
      // Plain-English questions: what the project is (skipped here), the check
      // (offering the project's own `npm test`), the three closing actions with
      // their one-line descriptions, defaulting to committing to a branch, then
      // the first task and "anything else", answered with Enter.
      expect(asked).toHaveLength(5);
```

(the destructuring and the lines asserting `checkAsked`, `closerAsked`, `taskAsked` stay), and `task: { intent: TASK },` in the file assertion becomes `tasks: [TASK],`.

In the last test, replace the `resolveSettings` lines with:

```ts
    const project = await resolveProject({}, { env: {}, repoPath: repo, config });
    expect(project.gateRef).toEqual({ type: "command", command: "npm run check", parseMode: "exitcode" });
    expect(project.closerRef).toEqual({ type: "merge-back" });
    expect(queueTasks(config)).toEqual([{ intent: TASK }]);
```

Run: `npm run build && npx vitest run tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts`
Expected: PASS (the real `delivery run` now walks a one-task list and still ends by naming its branch).

- [ ] **Step 6: Update the help text and the documents that describe what `delivery init` asks**

`src/cli/program.ts`, the `init` `.description(...)` string becomes:

```ts
      "set this project up by answering a few questions: what the project is, what command checks the agent's work, what happens to work that passes, and what you'd like done",
```

`README.md`, replace the paragraph beginning "It asks three things:" with:

```markdown
It asks a few things: a sentence or two about your project (press Enter to skip), what command
checks the agent's work (offering your project's own `npm test` when it has one), what should
happen to work that passes, and what you would like done, one thing at a time until you press
Enter on an empty answer. It writes the answers to a `delivery.config.json` at the top of the
repository, which `delivery validate` checks and the next `delivery run` works through with no
flags at all. If there is already a config file there, it asks before replacing it and leaves
it as it was if you say no.
```

`docs/getting-started.md`, in "Where to go next", replace "`delivery init` writes a `delivery.config.json` by asking what checks the work, what happens to work that passes, and what you would like done;" with:

```markdown
`delivery init` writes a `delivery.config.json` by asking what the project is, what checks the
work, what happens to work that passes, and what you would like done;
```

`docs/project-configuration.md`, replace the final paragraph of "Going further" with:

```markdown
To start a configuration for a project of your own, run `delivery init` in it: it asks what the
project is, what checks the work, what happens to work that passes, and what you would like
done, one thing at a time, and writes the file for you. The [readme](../README.md#configure-it-once)
lists every setting.
```

Create `.changeset/describe-your-project-while-setting-up.md`:

```markdown
---
"delivery-service": minor
---

`delivery init` now sets up a whole small project. Before its other questions it asks for a
sentence or two about the project, which can be skipped, and at the end it asks what you would
like done one thing at a time until you press Enter on an empty answer. The description is
written as the project's description and the answers as its list of tasks, even when there is
only one, so `delivery validate` accepts the file and `delivery run` works through the list
straight away. A blank first answer, or the same thing said twice, is asked again rather than
written.
```

Run: `npm run build && npx vitest run tests/getting-started-guide.test.ts tests/project-configuration-guide.test.ts tests/release.test.ts`
Expected: PASS (neither guide test compares the edited sentences; the release test accepts a minor entry).

- [ ] **Step 7: Commit**

```bash
git add src/cli/init.ts src/cli/init.test.ts src/cli/program.ts \
  tests/cli-and-configuration/7-set-up-a-project-by-answering-a-few-questions.test.ts \
  README.md docs/getting-started.md docs/project-configuration.md \
  .changeset/describe-your-project-while-setting-up.md
git commit -m "Ask for tasks one at a time and write them as a list

A project owner should be able to set up a whole small project by
answering questions. The wizard now asks for tasks until an empty answer
and writes them as the file's task list, which validate accepts and run
works through at once; a blank first task or a repeat is asked again
because the loader would refuse it. The help, readme, guides and the
earlier recorded test described the old three-question wizard."
```
