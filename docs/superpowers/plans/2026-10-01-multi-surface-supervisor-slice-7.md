# Multi-Surface Supervisor — Slice 7: Be Offered a Sensible Number of Tasks at Once During Set-Up

> **Status:** ✅ Complete — 2026-10-01 — `1672989`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 7 of `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md`

**Goal:** When `delivery init` has been given more than one task, it asks whether to run some at the same time, says in one sentence what that costs, suggests 2, and writes `concurrency` into `delivery.config.json` only when the owner says yes; a number typed in place of the suggestion is held to the same rule `delivery validate` holds the file to.

**Architecture:** Two more questions at the end of the existing wizard (`src/cli/init.ts`), asked through the `Ask` seam it already has: a yes-or-no question whose default is no, then, only after a yes, a text question whose default is the suggestion. The typed answer is checked by one function, `concurrencyNamed` (`src/cli/settings.ts`), which is also what `--concurrency` and `DELIVERY_CONCURRENCY` go through, and which defers to the one zod schema (`Concurrency` in `src/cli/config.ts`) that the config file's own `concurrency` key uses. `configFrom` writes the key only when a number was chosen, and still parses through `DeliveryConfig`, so `init` cannot write a file its own loader refuses.

**Tech Stack:** TypeScript (Node ≥22, ES2024, `module: Node16`, `.js` import suffixes), zod v4, vitest, `@inquirer/prompts` (already a dependency, untouched). No new dependency.

## Global Constraints

- Node ≥22; `strict` and `noUncheckedIndexedAccess` are on; `tseslint.configs.strict` forbids the `!` non-null operator.
- No new dependency.
- The default stays 1 (design spec, "Why default 1"): `init` never writes `concurrency` unless the owner said yes. Pressing Enter at the yes-or-no question means no.
- `concurrency` is "a whole number, 1 or more": the rule lives once, in the zod schema, and `delivery validate` is what enforces it on a file (spec, Operability / DX, "Scaffolding").
- User-facing copy (questions, refusals, README, changeset): controlled British English, plain words, no em-dashes (colons, semicolons, commas instead). The wizard's questions never use the harness's own vocabulary; the existing test "says everything in everyday words" pins the list, and this slice adds `concurrency` to it. `concurrency` is the config key and may appear in the README and changeset, never in a question.
- Exit codes unchanged (`src/cli/failures.ts` `EXIT`).
- Tests are offline and in-process: the wizard is driven through `scriptedAsk` (`src/cli/init-fixtures.ts`); nothing draws a real prompt.
- Every path in a command is relative to the repository root; run every command from there. Never `cd` elsewhere. If `node_modules` is missing, run `npm ci` once before the first test command.
- Targeted verification only: each task runs its own test files with `npx vitest run` and `npx tsc --noEmit`. The full suite runs once in final review. The slice's UAT/e2e test is recorded by a later phase: do not write one.
- **Buy-vs-build:** reuse the `Ask` seam, `scriptedAsk`, `configFrom`'s parse-through-`DeliveryConfig`, and the existing `concurrency` rule. The prompt library keeps doing the drawing and the ask-again loop; nothing here re-implements it.
- **Operability/DX:** no new command, flag, environment variable or build step. The run/verify story is unchanged: `delivery init`, then `delivery validate`, which already prints `✓ concurrency: up to N tasks at once (M queued)`.
- Decisions taken for this slice (unattended run, right-vs-easy):
  - **Two questions, not one.** A single text question prefilled with 2 would make pressing Enter raise an owner's costs. A yes-or-no question defaulting to no comes first; the number is asked only after a yes, prefilled with the suggestion so Enter accepts it and typing replaces it.
  - **The suggestion is a fixed 2.** It is the smallest number that is "some at once" at all, and it can never exceed the list, because the question is only asked with two or more tasks. Not sized to the list or the machine: marked with a `ponytail:` comment naming that ceiling.
  - **One rule, in the schema.** The check for a number that arrives as text was a regex in `settings.ts` beside a zod rule in `config.ts`, and they disagreed on one input: a run of digits too large to be an exact whole number passed the regex and is refused by the schema. Typed into `init`, that would have crashed on `DeliveryConfig.parse`. `concurrencyNamed` now asks the schema, so the flag, the environment variable and the wizard all refuse it, as the file already does. The existing leading-digit regex is kept as the text-shape check so no other input changes meaning.
  - **A typed `1` is written as `1`.** After a yes, whatever valid number is typed is written; only a no leaves the key out. No special case.
  - **A typed number larger than the list is accepted,** because `delivery validate` accepts it (the pool is simply never full).
  - **"One task or none":** the wizard cannot produce an empty list (the first task is required), so "none" is covered by the same `listed < 2` guard and by the one-task test.

## Scaffolding Impact

- **Reactive:**
  - `README.md` "Set it up by answering a few questions": the paragraph listing what `init` asks → Task 2 (the offer), amended in Task 3 (typing another number).
  - `src/cli/init-fixtures.ts` `scriptedAsk`: one `confirm` answer for every yes-or-no question cannot say yes to "replace the file?" and no to "some at once?" → gains a `confirms` queue in Task 2.
  - `src/cli/init.ts` `configFrom` doc comment ("Limits are deliberately absent…") → Task 2.
- **Proactive:** `.changeset/be-offered-tasks-at-once-while-setting-up.md` (every user-visible change gets a changeset here) → created in Task 2, extended in Task 3. A second sentence for the flag's tightened bound → Task 1 creates the file with it.
- **Inherited:** none; the slice carries no Operational or Build note.
- Checked and unchanged: `delivery init --help` text in `src/cli/program.ts`, `docs/getting-started.md` and `docs/project-configuration.md` (each summarises what `init` asks as "what the project is, what checks the work, what happens to work that passes, and what you would like done", which stays true; the README holds the detail); README "Work through a list of tasks" and the settings table (the `concurrency` key itself is unchanged); `tests/cli-and-configuration/7-*.test.ts` and `tests/project-configuration/7-*.test.ts` (their two-task runs take the new question's default, no, and write the same file as before); `vendor/` (never edited). No `CLAUDE.md` in this repo.

---

### Task 1: One rule for a number of tasks at once, however it arrives

**Files:**
- Modify: `src/cli/config.ts` (new exported `Concurrency`; `DeliveryConfig.concurrency` uses it)
- Modify: `src/cli/settings.ts` (new exported `concurrencyNamed`; `concurrencyFrom` uses it)
- Create: `.changeset/be-offered-tasks-at-once-while-setting-up.md`
- Test: `src/cli/settings.test.ts`

**Interfaces:**
- Produces (in `src/cli/config.ts`): `export const Concurrency: z.ZodNumber` (`z.number().int().positive()`).
- Produces (in `src/cli/settings.ts`): `export function concurrencyNamed(typed: string): number | undefined`. The number the text names, or `undefined` when it names none. Task 3 uses it to check a typed answer.

- [ ] **Step 1: Write the failing tests**

In `src/cli/settings.test.ts`, change the config import so the schema is a value, and add `concurrencyNamed` to the settings import:

```ts
import { DeliveryConfig, unknownCloser } from "./config.js";
```

```ts
import {
  BOTH_TASKS,
  checkCustomModules,
  concurrencyNamed,
  explicitIntent,
  ignoredNote,
  ignoredSettings,
  NOT_A_CONCURRENCY,
  NO_TASK,
  NO_TASK_FILE,
  resolveSettings,
  taskIntent,
  type RunFlags,
} from "./settings.js";
```

Inside the existing `describe("how many tasks from the list may run at once", …)`, after its last test, add:

```ts
  it("refuses a --concurrency too large to be an exact whole number, as the config file's own setting is refused", async () => {
    const tooLarge = "99999999999999999999";
    expect(DeliveryConfig.safeParse({ concurrency: Number(tooLarge) }).success).toBe(false);
    await expect(settings({ task: TASK, concurrency: tooLarge })).rejects.toThrow(NOT_A_CONCURRENCY("--concurrency", tooLarge));
  });
```

Directly after that `describe` block, add:

```ts
describe("a number of tasks at once that arrives as text", () => {
  it.each([
    { typed: "1", count: 1 },
    { typed: "3", count: 3 },
    { typed: " 12 ", count: 12 },
  ])("reads $typed as a number", ({ typed, count }) => {
    expect(concurrencyNamed(typed)).toBe(count);
  });

  it.each(["", "   ", "0", "-2", "1.5", "three", "1e2", "0x10", "99999999999999999999"])("finds no number in %j", (typed) => {
    expect(concurrencyNamed(typed)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/settings.test.ts -t "at once"`
Expected: FAIL. The `concurrencyNamed` cases fail with `concurrencyNamed is not a function`; the "too large" case fails because the promise resolves (today it yields `1e20`) instead of rejecting.

- [ ] **Step 3: Name the rule in the schema**

In `src/cli/config.ts`, immediately above the doc comment that begins "The whole of a `delivery.config.json`", add:

```ts
/**
 * How many tasks may run at once: a whole number, 1 or more. Named so that a
 * number arriving as text (a flag, an environment variable, an answer typed
 * into `delivery init`) is held to this rule itself, not to a second copy of it.
 */
export const Concurrency = z.number().int().positive();
```

and in `DeliveryConfig` replace

```ts
    concurrency: z.number().int().positive().optional(),
```

with

```ts
    concurrency: Concurrency.optional(),
```

- [ ] **Step 4: Hold text to it**

In `src/cli/settings.ts`, change the config import to:

```ts
import { Concurrency, unknownCloser, type DeliveryConfig } from "./config.js";
```

and replace the whole of `concurrencyFrom` with:

```ts
/**
 * The number of tasks at once that a piece of text names, or nothing when it
 * names none. The text must be digits not starting with 0; the number is then
 * held to the config file's own rule, so text and file can never disagree
 * about what counts (a run of digits too long to be an exact whole number is
 * refused by both).
 */
export function concurrencyNamed(typed: string): number | undefined {
  const text = typed.trim();
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const count = Number(text);
  return Concurrency.safeParse(count).success ? count : undefined;
}

function concurrencyFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig): number {
  const named = flags.concurrency ?? fromEnv(env.DELIVERY_CONCURRENCY);
  if (named === undefined) return config.concurrency ?? DEFAULT_CONCURRENCY;
  const count = concurrencyNamed(named);
  if (count === undefined) {
    const source = flags.concurrency !== undefined ? "--concurrency" : "DELIVERY_CONCURRENCY";
    throw new Refusal(NOT_A_CONCURRENCY(source, named), EXIT.configuration, "concurrency");
  }
  return count;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/settings.test.ts src/cli/config.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (`config.test.ts` is included because the schema it tests now reads `Concurrency`.)

- [ ] **Step 6: Record the change**

Create `.changeset/be-offered-tasks-at-once-while-setting-up.md`:

```markdown
---
"delivery-service": minor
---

`--concurrency` and `DELIVERY_CONCURRENCY` are now held to exactly the rule the config file's
`concurrency` is: a number too large to be an exact whole number is refused in the same words as
any other value that is not a whole number of 1 or more, instead of being accepted.
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/config.ts src/cli/settings.ts src/cli/settings.test.ts .changeset/be-offered-tasks-at-once-while-setting-up.md
git commit -m "Hold a typed number of tasks at once to the config file's own rule" -m "The flag and environment variable were checked by a regex beside the schema's rule, and the two disagreed on a number too large to be exact. delivery init is about to take the same kind of typed answer, so the rule is named once in the schema and text is checked against it."
```

---

### Task 2: Ask whether to run some at the same time, and write the suggestion only on a yes

**Files:**
- Modify: `src/cli/init-fixtures.ts` (`scriptedAsk` gains `confirms`)
- Modify: `src/cli/init.ts` (new `SUGGESTED_AT_ONCE`, `atOnceQuestion`, `askAtOnce`; `configFrom` gains `atOnce`; `initCommand` asks)
- Modify: `README.md` ("Set it up by answering a few questions")
- Modify: `.changeset/be-offered-tasks-at-once-while-setting-up.md`
- Test: `src/cli/init.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (in `src/cli/init-fixtures.ts`): `scriptedAsk({ texts?, choice?, confirm?, confirms?: boolean[] })`. `confirms` answers the yes-or-no questions in the order asked; when it runs out, `confirm` answers, then the question's own default.
- Produces (in `src/cli/init.ts`):
  - `export const SUGGESTED_AT_ONCE = 2`
  - `export const atOnceQuestion: (listed: number) => ConfirmQuestion`
  - `configFrom({ description, check, closer, tasks, atOnce }: { description: string; check: string; closer: string; tasks: string[]; atOnce?: number }): DeliveryConfig`
  - `async function askAtOnce(ask: Ask, listed: number): Promise<number | undefined>` (module-private; Task 3 changes its last line)

- [ ] **Step 1: Write the failing tests**

In `src/cli/init.test.ts`, extend the `./init.js` import with `atOnceQuestion`, `SUGGESTED_AT_ONCE` and `type ConfirmQuestion`:

```ts
import { ALREADY_LISTED, atOnceQuestion, CLOSER_QUESTION, CONFIG_FILE, DESCRIPTION_QUESTION, NOTHING_TO_DO, checkQuestion, initCommand, LEFT_ALONE, NEEDS_A_TERMINAL, SUGGESTED_AT_ONCE, WRITTEN, overwriteQuestion, taskQuestion, type ChoiceQuestion, type ConfirmQuestion, type TextQuestion } from "./init.js";
```

Add this block after `describe("the things you'd like done", …)`:

```ts
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
```

In the same file, two edits to existing tests:

1. In "asks one at a time until an empty answer, and writes every one as a list in the order given", two things are listed, so the new question is now asked after the three task questions. Change `asked.slice(3)` to `asked.slice(3, 6)`.

2. In "says everything in everyday words, with none of the harness's own vocabulary", add the new question to `shown` and the config key to the forbidden words:

```ts
      overwriteQuestion("delivery.config.json").message,
      overwriteQuestion("delivery.config.js").message,
      atOnceQuestion(3).message,
    ];

    for (const text of shown) {
      expect(text).not.toMatch(/domain|queue|intent|gate|closer|worktree|envelope|surface|case file|role config|schema|concurrency/i);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/init.test.ts`
Expected: FAIL. Every test in "running some at the same time" that calls `atOnceQuestion` fails with `atOnceQuestion is not a function`; "writes the suggested number when told yes" fails because no `concurrency` is written; "suggests two" fails with `expected undefined to be 2`. "does not ask when only one thing is listed" already passes (nothing asks yet): it is there to hold the line once the question exists.

- [ ] **Step 3: Let a test answer yes-or-no questions one at a time**

In `src/cli/init-fixtures.ts`, replace the doc comment and signature of `scriptedAsk`, and its `confirm` method:

```ts
/**
 * A person answering the wizard's questions in the order they are asked,
 * recording each question so a test can assert on what was actually offered.
 * An answer left out is Enter: the question's own default. An answer the
 * question refuses is recorded in `refused` and the next scripted answer is
 * tried, as a person would type again; a refused answer with nothing scripted
 * after it fails the test rather than asking forever. `confirms` answers the
 * yes-or-no questions in the order they are asked; once it runs out, `confirm`
 * answers every one, and with neither it is the question's own default.
 */
export function scriptedAsk({
  texts = [],
  choice,
  confirm,
  confirms = [],
}: { texts?: (string | undefined)[]; choice?: string; confirm?: boolean; confirms?: boolean[] } = {}) {
  const asked: (TextQuestion | ChoiceQuestion | ConfirmQuestion)[] = [];
  const refused: string[] = [];
  const queue = [...texts];
  const yesOrNo = [...confirms];
```

```ts
    confirm(question) {
      asked.push(question);
      return Promise.resolve(yesOrNo.shift() ?? confirm ?? question.default);
    },
```

The `text` and `choose` methods and the `return` stay exactly as they are.

- [ ] **Step 4: Ask, and write the answer**

In `src/cli/init.ts`, add after `taskQuestion`/`askTasks` (before `overwriteQuestion`):

```ts
/**
 * How many to suggest running at the same time: the smallest number that is
 * "some at once" at all, so saying yes at most doubles what is being spent at
 * any moment and adds one working copy. It can never be more than the list,
 * because the question is only asked with two or more things listed.
 * ponytail: a fixed suggestion, not sized to the list or the machine. Revisit
 * if owners routinely type a larger number in its place.
 */
export const SUGGESTED_AT_ONCE = 2;

/**
 * Whether to work on some of the list at the same time. Enter means no: one at
 * a time is what every project gets unless its owner says otherwise, and
 * nobody's costs should change because they pressed Enter.
 */
export const atOnceQuestion = (listed: number): ConfirmQuestion => ({
  message:
    `You've listed ${listed} things to do. Shall I work on some of them at the same time? ` +
    "That costs more at the same time and uses a working copy of your project for each one. " +
    `I'd suggest ${SUGGESTED_AT_ONCE} at once; say no and they are done one at a time.`,
  default: false,
});

/** How many to run at the same time, or nothing when there is only one thing to do or the owner said no. */
async function askAtOnce(ask: Ask, listed: number): Promise<number | undefined> {
  if (listed < 2 || !(await ask.confirm(atOnceQuestion(listed)))) return undefined;
  return SUGGESTED_AT_ONCE;
}
```

Replace `configFrom` and its doc comment with:

```ts
/**
 * The answers as the file a run reads: always a list of tasks, even of one,
 * because `task` is the hand-written one-off form. Parsed by the very schema
 * `delivery run` will parse it with, so this command can never write a file
 * its own loader would refuse. A blank description is left out rather than
 * written empty, which the loader would refuse. How many run at the same time
 * is written only when the owner chose a number; left out, one at a time
 * applies. Limits are deliberately absent: the defaults are better left
 * implicit than frozen into a file nobody asked to set.
 */
export function configFrom({
  description,
  check,
  closer,
  tasks,
  atOnce,
}: {
  description: string;
  check: string;
  closer: string;
  tasks: string[];
  atOnce?: number;
}): DeliveryConfig {
  return DeliveryConfig.parse({
    ...(description.trim() === "" ? {} : { domain: description }),
    tasks,
    gate: { type: "command", command: check, parseMode: "exitcode" },
    closer: { type: closer },
    ...(atOnce === undefined ? {} : { concurrency: atOnce }),
  });
}
```

In `initCommand`, replace

```ts
  const tasks = await askTasks(ask);

  await writeFile(file, `${JSON.stringify(configFrom({ description, check, closer, tasks }), null, 2)}\n`);
```

with

```ts
  const tasks = await askTasks(ask);
  const atOnce = await askAtOnce(ask, tasks.length);

  await writeFile(file, `${JSON.stringify(configFrom({ description, check, closer, tasks, atOnce }), null, 2)}\n`);
```

and in `initCommand`'s doc comment change "and what you'd like done, one thing at a time, and writes the answers" to "what you'd like done, one thing at a time, and, when that is more than one thing, whether to work on some at the same time, and writes the answers".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/init.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Say so in the README and the changeset**

In `README.md`, under "## Set it up by answering a few questions", replace the paragraph that begins "It asks a few things:" with:

```markdown
It asks a few things: a sentence or two about your project (press Enter to skip), what command
checks the agent's work (offering your project's own `npm test` when it has one), what should
happen to work that passes, and what you would like done, one thing at a time until you press
Enter on an empty answer. When you list more than one thing, it also asks whether to work on
some of them at the same time, saying what that costs and suggesting 2. Say yes and it writes
`"concurrency": 2`; say no, or press Enter, and it writes nothing about it, so the list is
worked through one at a time. It writes the answers to a `delivery.config.json` at the top of
the repository, which `delivery validate` checks and the next `delivery run` works through with
no flags at all. If there is already a config file there, it asks before replacing it and leaves
it as it was if you say no.
```

In `.changeset/be-offered-tasks-at-once-while-setting-up.md`, insert this paragraph between the front matter and the existing paragraph (leave a blank line between the two paragraphs):

```markdown
`delivery init` now offers to run tasks at the same time. When you list more than one thing to
do, it asks whether to work on some of them at once, says in a sentence that this costs more at
the same time and uses a working copy of your project for each, and suggests 2. Saying yes
writes `concurrency` into `delivery.config.json`; saying no, or pressing Enter, writes nothing,
so the list is still worked through one at a time. With one thing listed it does not ask.
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/init.ts src/cli/init-fixtures.ts src/cli/init.test.ts README.md .changeset/be-offered-tasks-at-once-while-setting-up.md
git commit -m "Offer to run some tasks at the same time during delivery init" -m "An owner who lists several tasks meets the feature at the moment it is useful, instead of having to find the setting. The answer defaults to no and nothing is written unless they say yes, so nobody's costs change by pressing Enter."
```

---

### Task 3: Take a number typed in place of the suggestion, checked by the rule `validate` uses

**Files:**
- Modify: `src/cli/init.ts` (new `NOT_A_NUMBER_AT_ONCE`, `HOW_MANY_AT_ONCE_QUESTION`; `askAtOnce` asks it)
- Modify: `README.md` ("Set it up by answering a few questions")
- Modify: `.changeset/be-offered-tasks-at-once-while-setting-up.md`
- Test: `src/cli/init.test.ts`

**Interfaces:**
- Consumes: `concurrencyNamed(typed: string): number | undefined` from `src/cli/settings.ts` (Task 1); `askAtOnce`, `SUGGESTED_AT_ONCE`, `atOnceQuestion` in `src/cli/init.ts` and `scriptedAsk({ confirms })` (Task 2).
- Produces (in `src/cli/init.ts`):
  - `export const NOT_A_NUMBER_AT_ONCE: string`
  - `export const HOW_MANY_AT_ONCE_QUESTION: TextQuestion` (default `String(SUGGESTED_AT_ONCE)`, with a `validate`)

- [ ] **Step 1: Write the failing tests**

In `src/cli/init.test.ts`, add `HOW_MANY_AT_ONCE_QUESTION` and `NOT_A_NUMBER_AT_ONCE` to the `./init.js` import:

```ts
import { ALREADY_LISTED, atOnceQuestion, CLOSER_QUESTION, CONFIG_FILE, DESCRIPTION_QUESTION, HOW_MANY_AT_ONCE_QUESTION, NOTHING_TO_DO, NOT_A_NUMBER_AT_ONCE, checkQuestion, initCommand, LEFT_ALONE, NEEDS_A_TERMINAL, SUGGESTED_AT_ONCE, WRITTEN, overwriteQuestion, taskQuestion, type ChoiceQuestion, type ConfirmQuestion, type TextQuestion } from "./init.js";
```

Inside `describe("running some at the same time", …)`, after its last test, add (`THREE` and `written` are the helpers Task 2 put at the top of that block; the `""` after `THREE` is Enter on "What else?", which ends the list so the next answer goes to the new question):

```ts
  it("asks how many once told yes, offering the suggestion as what Enter means", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: THREE, confirms: [true] });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked.at(-2)).toEqual(atOnceQuestion(3));
    expect(asked.at(-1)).toBe(HOW_MANY_AT_ONCE_QUESTION);
    expect(HOW_MANY_AT_ONCE_QUESTION.default).toBe(String(SUGGESTED_AT_ONCE));
    expect(written(repo)).toMatchObject({ concurrency: SUGGESTED_AT_ONCE });
  });

  it("does not ask how many when told no", async () => {
    const repo = sample();
    const { ask, asked } = scriptedAsk({ texts: THREE, confirms: [false] });

    await initCommand({}, context(repo).ctx, ask);

    expect(asked).not.toContain(HOW_MANY_AT_ONCE_QUESTION);
  });

  it("writes a number typed in place of the suggestion", async () => {
    const repo = sample();
    const { ask, refused } = scriptedAsk({ texts: [...THREE, "", "3"], confirms: [true] });

    await initCommand({}, context(repo).ctx, ask);

    expect(refused).toEqual([]);
    expect(written(repo)).toMatchObject({ concurrency: 3 });
  });

  it.each(["0", "-1", "1.5", "two", "99999999999999999999"])("asks again when %j is typed, saying what is wanted", async (typed) => {
    const repo = sample();
    const { ask, refused } = scriptedAsk({ texts: [...THREE, "", typed, "4"], confirms: [true] });

    await initCommand({}, context(repo).ctx, ask);

    expect(refused).toEqual([NOT_A_NUMBER_AT_ONCE]);
    expect(written(repo)).toMatchObject({ concurrency: 4 });
  });

  it.each(["1", "2", "7", "0", "-1", "1.5", "99999999999999999999"])(
    "takes %j exactly when `delivery validate` would take a file saying it",
    async (typed) => {
      const repo = sample();
      writeFileSync(CONFIG_FILE(repo), `${JSON.stringify({ tasks: ["a", "b"], concurrency: Number(typed) })}\n`);

      const taken = HOW_MANY_AT_ONCE_QUESTION.validate?.(typed) === true;
      const validated = await validateCommand({}, context(repo).ctx).then(
        (exitCode) => exitCode === EXIT.ok,
        () => false,
      );

      expect(taken).toBe(validated);
    },
  );
```

In "says everything in everyday words, with none of the harness's own vocabulary", add the two new texts to `shown`, after `atOnceQuestion(3).message`:

```ts
      atOnceQuestion(3).message,
      HOW_MANY_AT_ONCE_QUESTION.message,
      NOT_A_NUMBER_AT_ONCE,
    ];
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/init.test.ts -t "running some at the same time"`
Expected: FAIL. "asks how many once told yes" fails because the last question is still the yes-or-no one; "writes a number typed in place of the suggestion" fails with `concurrency` 2 instead of 3; the "asks again" cases fail with `refused` empty; every "exactly when `delivery validate` would" case fails with `Cannot read properties of undefined (reading 'validate')`, because `HOW_MANY_AT_ONCE_QUESTION` does not exist yet. "does not ask how many when told no" already passes (nothing asks it yet): it holds the line once the question exists. The words test is outside this filter and is run in Step 4.

- [ ] **Step 3: Ask how many, and check the answer with the shared rule**

In `src/cli/init.ts`, change the settings import to:

```ts
import { concurrencyNamed, DEFAULT_CLOSER } from "./settings.js";
```

Add directly after `atOnceQuestion`:

```ts
export const NOT_A_NUMBER_AT_ONCE = "That needs to be a whole number, 1 or more, such as 3.";

/**
 * How many at the same time, asked only after a yes. Enter takes the
 * suggestion; anything typed in its place is held to the rule the file's own
 * setting is held to, so this question cannot take a number that `delivery
 * validate` would then refuse.
 */
export const HOW_MANY_AT_ONCE_QUESTION: TextQuestion = {
  message: "How many at the same time?",
  default: String(SUGGESTED_AT_ONCE),
  validate: (answer) => (concurrencyNamed(answer) === undefined ? NOT_A_NUMBER_AT_ONCE : true),
};
```

and replace `askAtOnce` with:

```ts
/** How many to run at the same time, or nothing when there is only one thing to do or the owner said no. */
async function askAtOnce(ask: Ask, listed: number): Promise<number | undefined> {
  if (listed < 2 || !(await ask.confirm(atOnceQuestion(listed)))) return undefined;
  return concurrencyNamed(await ask.text(HOW_MANY_AT_ONCE_QUESTION));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/init.test.ts src/cli/prompts.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (`prompts.test.ts` proves the real prompt library asks again with the refusal's words; it needs no change, because the new question uses the `default` and `validate` fields `inquirerAsk` already maps.)

- [ ] **Step 5: Say so in the README and the changeset**

In `README.md`, in the paragraph Task 2 rewrote, replace

```markdown
Say yes and it writes
`"concurrency": 2`; say no, or press Enter, and it writes nothing about it, so the list is
worked through one at a time.
```

with

```markdown
Say yes and it asks how many: press Enter for 2 or type another whole number of 1 or more, and it
writes that as `concurrency`. Say no, or press Enter, and it writes nothing about it, so the
list is worked through one at a time.
```

(The sentence is wrapped across lines in the file; match it by its words, and re-wrap the paragraph at about 100 columns as the rest of the README is.)

In `.changeset/be-offered-tasks-at-once-while-setting-up.md`, append to the end of the `delivery init` paragraph:

```markdown
After a yes it asks how many, offering 2: a number typed in its place is checked by the same
rule `delivery validate` uses, and asked for again if it is not a whole number of 1 or more.
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/init.ts src/cli/init.test.ts README.md .changeset/be-offered-tasks-at-once-while-setting-up.md
git commit -m "Take a number typed in place of the suggested tasks at once" -m "An owner who wants more than the suggestion should not have to edit the file afterwards. The typed answer goes through the one rule the config file is held to, so init cannot accept a number that validate would then refuse."
```
