# Project Configuration — Slice 1: Describe Your Project Once and Every Agent Hears It

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** Let a `delivery.config.json` carry one prose `domain` describing the project, pin it into each new run's record, and refuse a blank one with a plain-language message.

**Architecture:** Nothing new is built: the case file already has `domainPrompt` (`src/schema.ts:138`), `assemblePrompt` already prepends it to every role's own instructions (`src/prompt-assembly.ts:103-107`), and `create()` already writes it once at `PROVISIONING` and never again. The whole slice is the missing **producer**: one optional key on the existing `.strict()` `DeliveryConfig`, one branch in the existing `describeProblem`, one field on `Settings` carried by `resolveSettings`, and one extra property on the `create()` call in `startRun` (`src/cli/run-command.ts:68`). Because the header is written once and `resumeRun` never reads the config file at all, the "editing the file does not change a started run" criterion is structural, not new code.

**Tech Stack:** Node ≥ 22, TypeScript strict (Node16 ESM, `noUncheckedIndexedAccess`), zod 4, commander 14, vitest, git, the vendored `claude-mock` for run tests. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Reuse the domain-prompt field the case file and prompt assembly already carry; this slice adds only a producer for it from the configuration file. Do not add a second route for getting project context into a prompt. Extend the existing configuration schema and its existing plain-language problem describer rather than adding a loader or an error-formatting library." So: no new loader, no `zod-validation-error`, no second prompt-injection path, no file-reference form for `domain`, and `assemblePrompt` is not touched.
- **Operability / DX:** this slice carries no Operational note. It adds no command, no flag, no environment variable, no dependency and no build step. What changes for a reader is that a config file now takes a fifth setting, so the README's settings table and the sentence naming the settings a file takes are updated in the tasks that changed them (see Scaffolding Impact).
- **Spec, verbatim:** "`domain`: one plain prose string at both altitudes. It populates `CaseFileHeader.domainPrompt`. A long description uses the existing `delivery.config.js` / `.mjs` form with a template literal; no file-reference variant is added."
- **Spec, verbatim:** "String checks treat whitespace-only as empty." The blank check therefore lives in the schema, at load, so every command that reads the file inherits it — not inside one command.
- **Error model (spec):** every configuration problem exits `2` (`EXIT.configuration`, `src/cli/failures.ts:26-30`), with one problem named, the field named and the fix stated.
- **Accessibility (spec):** no harness vocabulary in any message — never "worktree", "envelope", "surface", "case file", "role config" or schema terms. The house sentence shape is `describeProblem`'s existing one: "I can't use `<file>`: …".
- **Backwards compatibility (spec):** "Every Item 8 config parses unchanged." A file with no `domain` produces exactly the behaviour it produced before this slice.

## Scaffolding Impact

- `CONFIG_KEYS` (`src/cli/config.ts:15`), the user-facing sentence naming the settings a config file takes, gains `domain` → updated in Task 1.
- `README.md` "Configure it once": the settings table and its example JSON → updated in Task 2.
- `.changeset/describe-your-project-once.md`, this slice's release note, following the per-slice changeset convention (`.changeset/set-up-by-answering-questions.md`) → added in Task 3.
- No other document needs changing: `README.md` is the only one that enumerates the config file's settings. `docs/getting-started.md` defers to it; `docs/writing-a-gate.md`, `docs/writing-a-closer.md` and `examples/sample-project/README.md` each describe one key or the wizard, none of which this slice alters; `docs/configuring-a-role.md` documents role configs in code, and role overrides are slice 5.
- No new command, environment variable, dependency or build/test/deploy step is introduced.

---

### Task 1: The `domain` setting, and what the command says when it is blank

**Files:**
- Modify: `src/cli/config.ts:14-15` (the `CONFIG_KEYS` sentence), `:56-64` (`DeliveryConfig`), `:82-99` (`describeProblem`)
- Test: `src/cli/config.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `DeliveryConfig` gains `domain?: string` (prose, never blank once parsed). `CONFIG_KEYS` becomes the five-setting sentence. `describeProblem` gains one branch for a blank `domain`.

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/config.test.ts`, inside the existing `describe("what a config file may contain")` block:

```ts
  it("accepts a project description as one plain prose value, beside the settings it already took", () => {
    const config = {
      domain: "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
      task: { intent: "add a function that says goodbye to a name, with a test" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back", deleteBranch: true },
      budgets: { correction: 5 },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

```

Add to the existing `describe("reading a config file")` block, which exercises `loadConfig` itself — this is where the exit code and the script form of the file are held:

```ts
  it("refuses an empty project description as it loads the file, with the configuration exit code", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ domain: "   " }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("takes a long description from a .js module, which is where a template literal goes", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.js", "export default { domain: `Two paragraphs.\n\nThe second one.` };\n");
    expect(await found(repo, repo)).toEqual({ domain: "Two paragraphs.\n\nThe second one." });
  });
```

And inside the existing `describe("what it says about a file it can't use")` block:

```ts
  it.each([[""], ["   "], ["\n\t "]])("names an empty project description and the two ways out (%j)", (value) => {
    expect(problemFor({ domain: value })).toBe(
      "I can't use delivery.config.json: `domain` is empty. Describe your project in a sentence or two, or remove it.",
    );
  });

  it("still names a description given the wrong kind of value altogether, rather than calling it empty", () => {
    expect(problemFor({ domain: 42 })).toContain("I can't use delivery.config.json: the setting `domain` is `42`");
  });
```

Then update the three existing assertions that spell out the settings a file takes:

```ts
  // was: "accepts exactly task, gate, closer and budgets, …"
  it("accepts exactly task, domain, gate, closer and budgets, in the shapes the library already documents", () => {
```

```ts
  it("names an unknown top-level key, and what the file does take", () => {
    expect(problemFor({ closr: { type: "merge-back" } })).toBe(
      "I can't use delivery.config.json: there's no setting called `closr`. A config file takes only `task`, `domain`, `gate`, `closer` and `budgets`.",
    );
  });
```

```ts
  // in describe("reading a config file")
  it("refuses a file whose contents the harness can't use, naming the setting", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ closr: 1 }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: there's no setting called \`closr\`. A config file takes only \`task\`, \`domain\`, \`gate\`, \`closer\` and \`budgets\`.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL — the `domain` acceptance tests fail with an unrecognised-key complaint, the blank-description tests fail because `{ domain: "" }` parses, and the two unknown-key tests fail on the old four-setting sentence.

- [ ] **Step 3: Write the implementation**

In `src/cli/config.ts`, change the settings sentence (line 14-15) to name the new key:

```ts
/** The five keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `domain`, `gate`, `closer` and `budgets`";
```

Add the prose type above `DeliveryConfig`, and the key inside it:

```ts
/**
 * Something a person wrote, in their own words. Whitespace alone is nothing
 * written, so it is refused here rather than pinned into a run and sent to an
 * agent as a blank line. The text is kept exactly as typed: it is prose, and
 * trimming it would edit the owner's words.
 */
const Prose = z.string().refine((text) => text.trim() !== "");

export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),
    // What this project is, in the owner's own words, sent to every agent on
    // every run of it. One string at both altitudes: a long one is written in
    // the `.js` form with a template literal, not in a file of its own.
    domain: Prose.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
  })
  .strict();
```

In `describeProblem`, add the branch after the `closer.type` line and before the `budgets` one:

```ts
  // A string that is there but says nothing is the one mistake worth its own
  // sentence; anything else at this key is a value of the wrong kind, and the
  // general sentence below quotes it back.
  if (where === "domain" && typeof valueAt(raw, issue.path) === "string") {
    return `I can't use ${file}: \`domain\` is empty. Describe your project in a sentence or two, or remove it.`;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Check the types still hold**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts
git commit -m "$(cat <<'EOF'
Let a config file carry a plain-prose project description

The case file and prompt assembly have carried a domain prompt since Item 4,
but nothing could author one. A `domain` setting is the authoring end of that
field. Whitespace alone is refused at load, where every command that reads the
file inherits the check, and it is named in the same plain sentence shape the
other settings use.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: A new run pins the description, and every role's instructions carry it

**Files:**
- Modify: `src/cli/settings.ts:33-39` (`Settings`), `:141-157` (`resolveSettings`); `src/cli/run-command.ts:54-68` (the `create()` call); `README.md` (the "Configure it once" table and example)
- Test: `src/cli/settings.test.ts`, `src/cli/run-command.test.ts`, `src/prompt-assembly.test.ts`

**Interfaces:**
- Consumes: `DeliveryConfig.domain?: string` from Task 1.
- Produces: `Settings` gains `domainPrompt?: string`, the value `create()` receives as `CreateHeader.domainPrompt`. No other shape changes; `assemblePrompt` is untouched.

- [ ] **Step 1: Write the failing resolver test**

Add to `src/cli/settings.test.ts`, as its own block after `describe("what the run is asked to do")`:

```ts
describe("what the run is told about the project", () => {
  it("carries the project's description through to the run's settings, word for word", async () => {
    const domain = "A small internal tool that tracks who's on call this week. All user-facing messages are written in French.";
    expect((await settings({ task: TASK }, { config: { domain } })).domainPrompt).toBe(domain);
  });

  it("leaves it unset when the project didn't describe itself, so the run is exactly what it was before", async () => {
    expect((await settings({ task: TASK })).domainPrompt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing run test**

Add to `src/cli/run-command.test.ts`, inside the top-level `describe("delivery run")` block:

```ts
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
    RUN_TIMEOUT,
  );
```

`readFileSync`, `join`, `initTempRepo`, `delivery`, `scriptFile`, `completes`, `branchIn`, `PACKAGE`, `TASK`, `RUN_TIMEOUT`, `TEST_MOCK_SCRIPT` and `EXIT` are all already imported at the top of that file.

- [ ] **Step 3: Write the failing both-roles prompt test**

In `src/prompt-assembly.test.ts`, replace the existing worker-only assertion with one that covers both shipped roles, so the criterion "for the worker and for gate maintenance alike" is held by a test:

```ts
  it.each([
    ["worker", workerRoleConfig, "You are the worker on a gated delivery harness."],
    ["gate maintenance", gateMaintenanceRoleConfig, "You are gate maintenance on a gated delivery harness."],
  ])("puts the role fragment and the domain prompt in %s's system prompt", async (_role, roleCfg, opening) => {
    const caseFile = await load(dir);
    const { systemPrompt } = assemblePrompt(caseFile, roleCfg, await resolveEvidence(dir, caseFile));
    expect(systemPrompt).toContain(opening);
    expect(systemPrompt).toContain("This is a Python service.");
  });
```

`gateMaintenanceRoleConfig` is already imported there (line 8).

- [ ] **Step 4: Run the three tests to verify they fail**

Run: `npx vitest run src/cli/settings.test.ts -t "what the run is told about the project"`
Then: `npx vitest run src/cli/run-command.test.ts -t "pins the project's description"`
Then: `npx vitest run src/prompt-assembly.test.ts -t "system prompt"`
Expected: FAIL — `domainPrompt` is not a property of `Settings` (a type error as well as a failing assertion), and the run's `case.json` has no `domainPrompt`. The gate-maintenance prompt case is expected to PASS already: `assemblePrompt` is role-agnostic, and this is the test that stops that staying true by accident.

- [ ] **Step 5: Write the implementation**

In `src/cli/settings.ts`, add the field to `Settings`:

```ts
/** Everything a run needs to be created, once every source of settings has had its say. */
export interface Settings {
  taskDef: TaskDef;
  gateRef: GateRef;
  closerRef: CloserRef;
  budgets: BudgetSet;
  /** What this project is, from the config file, pinned into the run when it starts. Absent when the project didn't say. */
  domainPrompt?: string;
}
```

and return it from `resolveSettings`:

```ts
  return {
    taskDef: taskFrom(intent, config),
    gateRef,
    closerRef: closerFrom(flags, env, config),
    budgets: budgetsFrom(config),
    // Only the file can say what the project is: it is prose about the
    // repository, not something a person retypes per run, so there is no flag
    // and no environment variable to lay over it.
    domainPrompt: config.domain,
  };
```

In `src/cli/run-command.ts`, take it from the resolved settings and hand it to `create()`:

```ts
  const { taskDef, gateRef, closerRef, budgets, domainPrompt } = await resolveSettings(options, {
    env: ctx.env,
    intent,
    repoPath,
    config,
  });
```

```ts
  const caseFile = await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef, domainPrompt }, budgets);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/cli/settings.test.ts src/prompt-assembly.test.ts`
Then: `npx vitest run src/cli/run-command.test.ts -t "pins the project's description"`
Expected: PASS.

- [ ] **Step 7: Describe the setting in the README**

In `README.md`, under "Configure it once", add `domain` to the example and to the settings table, so the file's documented shape matches what it now takes:

```json
{
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "merge-back" },
  "budgets": { "correction": 5 }
}
```

and, as the row directly below `task`:

```markdown
| `domain` | What your project is, in your own words: every agent on every run of it is told this before its own instructions. A run keeps the description it started with, so editing it changes the next run, not one already going. A long one is easiest in a `delivery.config.js` with a template literal. |
```

- [ ] **Step 8: Check the types and the lint still hold**

Run: `npx tsc --noEmit && npx eslint src/cli/settings.ts src/cli/run-command.ts`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/cli/settings.ts src/cli/run-command.ts src/cli/settings.test.ts src/cli/run-command.test.ts src/prompt-assembly.test.ts README.md
git commit -m "$(cat <<'EOF'
Tell every agent what the project is, from the config file

The description is resolved with the rest of a run's settings and pinned into
the run's record when it is created, which is the one place a case file's
header is written. Prompt assembly already puts that text ahead of each role's
own instructions, so the worker and gate maintenance both hear it with no
further plumbing; the test now says so for both roles rather than the worker
alone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: A run keeps the description it started with

**Files:**
- Modify: `src/cli/command-fixtures.ts:112-133` (`interruptedRun`)
- Test: `src/cli/run-command.test.ts`
- Create: `.changeset/describe-your-project-once.md`

**Interfaces:**
- Consumes: `Settings.domainPrompt` and the `create()` call from Task 2; the `domain` key from Task 1.
- Produces: `interruptedRun(repo, state, { task, steps, worker, domain? })` — one more optional field on the existing fixture, so a test can leave behind an unfinished run that was started with a description.

- [ ] **Step 1: Give the interrupted-run fixture a description**

In `src/cli/command-fixtures.ts`, add the optional field and pass it to `create()`:

```ts
export async function interruptedRun(
  repo: string,
  state: string,
  { task, steps, worker, domain }: { task: string; steps: number; worker: (ctx: AgentContext) => Promise<Terminus>; domain?: string },
): Promise<string> {
```

```ts
  await create(dir, { surfaceId: runId, taskDef: { intent: task }, gateRef: GATE, closerRef: DEFAULT_CLOSER, domainPrompt: domain }, DEFAULT_BUDGETS);
```

- [ ] **Step 2: Write the guard test**

Add to `src/cli/run-command.test.ts`, inside `describe("picking up a run that didn't finish")`:

```ts
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
    RUN_TIMEOUT,
  );
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/cli/run-command.test.ts -t "keeps the description the run started with"`
Expected: PASS, and this is the one test in the plan with no red step, deliberately. The guarantee is structural — `runCommand` resolves the config file only on the way to a *new* run (`src/cli/run-command.ts:44-53`), and `resumeRun` reads the run's own record — so there is no version of this code where the test is red and the feature is right. It is here to keep that structure from being undone later. Sanity-check that the assertion is wired to the right value by temporarily changing `started` in the `interruptedRun` call to `"something else"`: the test must fail. Put it back.

- [ ] **Step 4: Write the changeset**

Create `.changeset/describe-your-project-once.md`:

```markdown
---
"delivery-service": minor
---

A project can now describe itself once, in its own words, and have every agent hear it. A
`domain` setting in `delivery.config.json` holds a sentence or two about the project: what it
is, what it is built with, anything an agent should know before it starts. Every run started
from that file keeps the description as it was written when the run began, and puts it ahead of
each agent's own instructions, for the worker and for gate maintenance alike. Editing the
description changes the next run, never one already going. A description that is there but
empty stops the command at once, saying so and offering the two ways out. A file with no
`domain` behaves exactly as it did before.
```

- [ ] **Step 5: Check the types and the lint still hold**

Run: `npx tsc --noEmit && npx eslint src/cli/command-fixtures.ts src/cli/run-command.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/command-fixtures.ts src/cli/run-command.test.ts .changeset/describe-your-project-once.md
git commit -m "$(cat <<'EOF'
Hold a run to the description it started with

A case file's header is written once and the resume path never reads the
config file, so a run already going cannot be redirected by an edit. That is
worth a test rather than a comment: it is the property that makes the
description safe to edit at any time, and nothing else in the code says so.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **Do not touch `src/prompt-assembly.ts`, `src/case-file.ts` or `src/schema.ts`.** Everything downstream of `create()` already does the right thing with `domainPrompt`; a change there means the plan has been misread.
- **Whitespace is not trimmed from an accepted description.** It is prose, and `"  "` is already refused, so there is nothing left for trimming to fix.
- **The `domain` key has no flag and no environment variable.** Precedence (flag beats environment beats file) exists for settings a person varies per run; what the project *is* is not one of those, and adding a lever would be a second route into the prompt, which the Build note forbids.
