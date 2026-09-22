# Project Configuration — Slice 5: Tune a Role's Instructions and Tools From the Configuration File

> **Status:** ✅ Complete — 2026-09-22 — `5bd1868`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-17-project-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-17-project-configuration-design.md`

**Goal:** A `roles` key in `delivery.config.json` overrides the worker's and gate maintenance's instructions (`systemPromptFragment`) and permitted tools (`allowedTools`), field by field over the shipped role configurations; `validate` refuses a malformed override in plain words, `preview` shows the overridden role, and every run started from the file uses it.

**Architecture:** The override shape (`RoleOverride`, `RoleOverrides`) is a zod schema in the library's `src/schema.ts`, composed by the config schema (as `TaskDef`, `GateRef` and `CloserRef` already are) and by `CaseFileHeader`, where a run pins the overrides it started with, beside `domainPrompt`. One function, `rolesFor(overrides)` in a new `src/cli/roles.ts`, merges an override over `workerRoleConfig` / `gateMaintenanceRoleConfig`, passes each merged role through the existing `validateRoleConfig`, and always returns the shipped `triageRoleConfig`. `resolveProject` calls it (so a bad role refuses before any record exists, for `run`, `validate` and `preview` alike); `driveToOutcome` calls it on the run's own header (replacing the static `RUN_ROLES`); `preview` calls it on its stand-in record's header. Tool enforcement is untouched: the merged `allowedTools` reach `createToolAuthority` through the existing `createAgentPort` → `invoke` path.

**Tech Stack:** Node ≥ 22, TypeScript strict (Node16 ESM, `noUncheckedIndexedAccess`), zod 4, commander 14, vitest, git, the vendored `claude-mock`. No new dependency.

## Global Constraints

- **Buy-vs-build (this slice's Build note, verbatim):** "Merge the file's overrides over the shipped role configurations and pass the result through the existing role-configuration validator; do not write a parallel validator, and do not invent a list of valid tool names. What a role can actually do remains bounded by the existing tool-authority enforcement whatever the file lists." So: `validateRoleConfig` (from `src/role-config.ts`) is called on every merged role, in `rolesFor`; no code anywhere in this slice names a tool to check it against a list; `createToolAuthority` is not modified.
- **Operability (this slice's Operational note, verbatim):** "A misspelled tool name is not caught by `validate`; it shows up during a run as that tool being refused. The role guide must say so plainly so extenders know where to look." Honoured in Task 3 (`docs/configuring-a-role.md`).
- **Schema (spec, verbatim):**
  ```ts
  const RoleOverride = z.object({
    systemPromptFragment: z.string().min(1).optional(),
    allowedTools: z.array(z.string().min(1)).min(1).optional(),
  }).strict();

  const RoleOverrides = z.object({
    worker: RoleOverride.optional(),
    gateMaintenance: RoleOverride.optional(),
  }).strict();
  ```
  "String checks treat whitespace-only as empty." This plan uses a whitespace-refusing string in place of `z.string().min(1)`, as `domain` already does.
- **Role overrides (spec, verbatim):** "An override merges field by field over `workerRoleConfig` or `gateMaintenanceRoleConfig`. The merged config passes through the existing `validateRoleConfig` at `validate` and `preview` time and again before the first dispatch of a run. The CLI's run composition passes the merged configs to `createAgentPort` instead of the static imports." and "`roles`: `worker` and `gateMaintenance` only … An omitted field keeps the built-in value, as `budgets` already behaves. Triage is absent: it stays a library-level choice."
- **Only the two plain-data fields are exposed (spec):** "`envelopeSchema` (a zod type) and the reserved `budgets` field stay programmatic."
- **Error model rows (spec, verbatim):** "Unknown key under `roles` | Named by the existing unrecognised-key path. | 2", "`roles.<role>.systemPromptFragment` empty | "roles.worker.systemPromptFragment is empty. Either give it a sentence, or remove the field to keep the built-in one." | 2", "`roles.<role>.allowedTools` empty | Named, with the same "remove the field to keep the built-in list" fix. | 2". The slice AC settles the wording: each message names the field and offers "remove it to keep the built-in one".
- **Accessibility (spec):** no "worktree", "envelope", "surface", "case file", "role config" or schema terms in any CLI output.
- **Error model:** every configuration problem exits `2` (`EXIT.configuration`).
- **Copy:** British English; no em-dashes in anything a person reads (CLI output, README, role guide, changeset).
- **Commits:** one line saying what changed, a blank line, then a paragraph saying why; end with the session's `Co-Authored-By` trailer.

### Decisions settled for this plan (unattended run)

- **A run pins its role overrides, as it pins its description.** `CaseFileHeader` gains an optional `roleOverrides`, written once by `create()`, and `driveToOutcome` builds the roles from the header, never from the file. Why this and not "read the file on resume": `delivery resume` and the resume branch of `delivery run` do not read the file today (`ignoredSettings` tells the user `--config` was ignored for exactly this reason), so an unpinned override would silently fall back to the shipped roles on resume, *widening* a run the owner had narrowed (Bash back in reach mid-run). Pinning also keeps Item 4's guarantee that the same record yields a byte-identical prompt. Only the plain-data overrides are pinned (not whole `RoleConfig`s, whose `envelopeSchema` is a zod type). The field is optional, so every existing record still loads.
- **Where the shape lives:** `RoleOverride` / `RoleOverrides` go in `src/schema.ts` because the header (library) needs them and the config schema composes library schemas rather than restating them.
- **Where the merge lives:** a new `src/cli/roles.ts` (`rolesFor`), not `drive.ts`, so `validate` and `settings.ts` can use it without importing the run driver. It imports `RoleConfigs` from `agent-invoke.ts` as a type only. This departs from the spec's Harness line ("`src/role-config.ts` gains the merge function") on purpose: `rolesFor` must return the shipped `triageRoleConfig`, and `src/triage-role-config.ts` already imports `src/role-config.ts`, so putting it there would create an import cycle. The merge is also only ever used by the command line.
- **The header gains one optional field.** The spec's "No existing export changes shape" is read as "no breaking change": `CaseFileHeader.roleOverrides` is optional and additive, so every existing record and every existing `create()` caller is unaffected. The library itself does not read the field; only the CLI's `rolesFor` gives it meaning, exactly as the CLI alone decides which roles a run is given.
- **What `validateRoleConfig` can still catch.** The config schema already refuses everything `validateRoleConfig` checks on these two fields (empty string, empty list, empty entry), so for a file-sourced override `rolesFor` never throws in practice. It is called anyway because the Build note requires the merged role to pass the library's own check; if it ever did throw, `InvalidRoleConfig` renders as an unexpected error (exit 1), which is correct: it would mean the schema and the library disagree, a harness bug rather than a configuration mistake.
- **Every merged role is validated, overridden or not.** Uniform and cheap; the shipped roles always pass.
- **Merge is by explicit field, not object spread** (`override.x ?? shipped.x`), so an override object carrying an explicit `undefined` can never blank a shipped value.
- **Refusal wording** (all end in the configuration exit code; `F` is the file name):
  - unknown role: ``I can't use F: `roles` has no role called `triage`. Only `worker` and `gateMaintenance` can be changed here, so remove it to keep the built-in one.``
  - unknown field: ``I can't use F: `roles.worker` has no setting called `tools`. It takes `systemPromptFragment` and `allowedTools`, so remove it to keep the built-in one.``
  - empty instructions: ``I can't use F: `roles.worker.systemPromptFragment`, the instructions for the worker, is empty. Write a sentence, or remove it to keep the built-in one.`` (gate maintenance: "the instructions for the agent that repairs your check")
  - empty tools list: ``I can't use F: `roles.worker.allowedTools`, the tools the worker may use, is empty. Name at least one, or remove it to keep the built-in one.``
  - empty entry in a tools list: ``I can't use F: `roles.worker.allowedTools` item 2 is empty. Name a tool, or remove it.``
  - anything else under `roles` (a value of the wrong kind) goes to the existing general sentence with a new `WHAT_IT_TAKES.roles`.
- **`validate` says what it read:** one extra line per role the file changes, after the closer line, e.g. `✓ worker: your own instructions and tool list`, `✓ gate maintenance: your own tool list`. No line for a role the file leaves alone, so a file with no overrides prints exactly what it printed before.
- **Where the run-level tests live:** in `src/cli/preview-matches-run.test.ts`, which already owns the wire recorder that reads the instructions a real session was sent; the new cases go in a second `describe` there rather than duplicating the recorder.
- **The tool-refusal AC is proven at the guard, not in a live session.** `claude-mock` models no tool permissions and makes no tool calls (`docs/testing-your-pipeline.md`, "What the scripted agent cannot prove"), so the test merges an override with `rolesFor` and drives `createToolAuthority`'s `canUseTool` with the out-of-list tool, the same method the tool-authority slice used. The run-level tests prove the merged roles are the ones a run is given.

## Scaffolding Impact

- `README.md`, "Configure it once" settings table: a new `roles` row (what it overrides, that anything left out keeps its built-in value, that a run keeps the roles it started with, link to the role guide) → Task 3.
- `README.md`, the refusal paragraph under that table ("An unknown setting, … all stop the command before it starts"): add a role override that is empty or names an unknown role → Task 3.
- `docs/configuring-a-role.md`: a new "From the configuration file" section documenting `roles.worker` / `roles.gateMaintenance`, `systemPromptFragment` / `allowedTools`, merge semantics, that triage cannot be changed from the file, that `validate` and `preview` read it, that a run keeps the roles it started with, and, plainly, that a misspelled tool name is not caught by `validate` and shows up during a run as that tool being refused (the Operational note) → Task 3.
- `.changeset/tune-a-role-from-the-config-file.md` (minor) for the changelog, following `.changeset/see-what-the-agent-will-be-told.md` → Task 3.
- The config refusal sentence that lists the keys a file takes (`CONFIG_KEYS`) gains `roles` → Task 1.
- `delivery --help`: unchanged (no new command or flag).
- `docs/agent-interface.md` describes the prompt template and says the project supplies "content, not structure"; still true (an override replaces the role fragment's content only), so no change.

---

### Task 1: Accept a `roles` section in the configuration file and name its mistakes ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/schema.ts` (add `RoleOverride`, `RoleOverrides` just above `CaseFileHeader`)
- Modify: `src/cli/config.ts` (compose `roles`, `CONFIG_KEYS`, `WHAT_IT_TAKES.roles`, a `roles` branch in `describeProblem`)
- Modify: `src/cli/validate-command.ts` (`checkedLines` adds one line per overridden role)
- Test: `src/cli/config.test.ts`, `src/cli/validate-command.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `src/schema.ts`: `export const RoleOverride` (zod, strict: `{ systemPromptFragment?: string; allowedTools?: string[] }`), `export type RoleOverride`; `export const RoleOverrides` (zod, strict: `{ worker?: RoleOverride; gateMaintenance?: RoleOverride }`), `export type RoleOverrides`.
  - `src/cli/config.ts`: `DeliveryConfig` gains `roles?: RoleOverrides`; `CONFIG_KEYS` becomes ``"`task`, `tasks`, `domain`, `roles`, `gate`, `closer` and `budgets`"``.

- [ ] **Step 1: Write the failing config tests**

In `src/cli/config.test.ts`, add to `describe("what a config file may contain", …)`:

```ts
  it("accepts instructions and tools for the worker and gate maintenance, each field on its own", () => {
    const config = {
      roles: {
        worker: { systemPromptFragment: "Never modify anything under the ops folder.", allowedTools: ["Read", "Glob", "Grep", "Edit"] },
        gateMaintenance: { allowedTools: ["Read", "Edit"] },
      },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });
```

Add to `describe("what it says about a file it can't use", …)`:

```ts
  it("names a role that can't be changed from the file, and the way out", () => {
    expect(problemFor({ roles: { triage: { allowedTools: ["Read"] } } })).toBe(
      "I can't use delivery.config.json: `roles` has no role called `triage`. " +
        "Only `worker` and `gateMaintenance` can be changed here, so remove it to keep the built-in one.",
    );
  });

  it("names a role setting that doesn't exist, what a role takes, and the way out", () => {
    expect(problemFor({ roles: { worker: { tools: ["Read"] } } })).toBe(
      "I can't use delivery.config.json: `roles.worker` has no setting called `tools`. " +
        "It takes `systemPromptFragment` and `allowedTools`, so remove it to keep the built-in one.",
    );
  });

  it.each([[""], ["   "], ["\n\t "]])("names the worker's empty instructions and the two ways out (%j)", (value) => {
    expect(problemFor({ roles: { worker: { systemPromptFragment: value } } })).toBe(
      "I can't use delivery.config.json: `roles.worker.systemPromptFragment`, the instructions for the worker, is empty. " +
        "Write a sentence, or remove it to keep the built-in one.",
    );
  });

  it("names gate maintenance's empty instructions in the owner's words", () => {
    expect(problemFor({ roles: { gateMaintenance: { systemPromptFragment: "" } } })).toBe(
      "I can't use delivery.config.json: `roles.gateMaintenance.systemPromptFragment`, the instructions for the agent that repairs your check, is empty. " +
        "Write a sentence, or remove it to keep the built-in one.",
    );
  });

  it("names an empty tools list and the two ways out", () => {
    expect(problemFor({ roles: { worker: { allowedTools: [] } } })).toBe(
      "I can't use delivery.config.json: `roles.worker.allowedTools`, the tools the worker may use, is empty. " +
        "Name at least one, or remove it to keep the built-in one.",
    );
  });

  it("names an empty entry in a tools list by its position", () => {
    expect(problemFor({ roles: { worker: { allowedTools: ["Read", " "] } } })).toBe(
      "I can't use delivery.config.json: `roles.worker.allowedTools` item 2 is empty. Name a tool, or remove it.",
    );
  });

  it("names roles given as something other than a set of roles", () => {
    expect(problemFor({ roles: "strict" })).toBe(
      'I can\'t use delivery.config.json: the setting `roles` is `"strict"`. ' +
        'It changes what the worker, or the agent that repairs your check, is told and which tools it may use, for example `{ "worker": { "allowedTools": ["Read", "Edit"] } }`: see docs/configuring-a-role.md.',
    );
  });
```

Update the two existing expectations that list the keys (the "names an unknown top-level key" test and the "names a file that holds something other than one object of settings" test) so the list reads `` `task`, `tasks`, `domain`, `roles`, `gate`, `closer` and `budgets` ``, and update the `readConfig` test near line 358 that asserts the same sentence. Rename the first test in the file to `"accepts exactly task, tasks, domain, roles, gate, closer and budgets, in the shapes the library already documents"` (body unchanged). Add these two entries to the `it.each` list in `"never repeats the schema's own wording back (%j)"`:

```ts
    [{ roles: "strict" }],
    [{ roles: { worker: { allowedTools: "Read" } } }],
```

- [ ] **Step 2: Run the config tests to verify they fail**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL. The new tests fail because `roles` is an unrecognised key; the key-list tests fail because the sentence lacks `roles`.

- [ ] **Step 3: Add the override shape to the library schema**

In `src/schema.ts`, immediately above `export const CaseFileHeader = z.object({`, add:

```ts
/**
 * Something written that says something. Whitespace alone is nothing written,
 * so it is refused rather than sent to an agent as a blank instruction.
 */
const Written = z.string().refine((text) => text.trim() !== "");

/**
 * What a project may change about one role, and nothing else: its
 * instructions and its permitted tools. The reply shape stays the harness's
 * own. Each field is optional, and an omitted one keeps the built-in value.
 * No list of valid tool names exists or is checked here: nothing could keep
 * one in step with the installed agent runtime, and what a role can reach is
 * bounded by the tool guard whatever is listed.
 */
export const RoleOverride = z
  .object({
    systemPromptFragment: Written.optional(),
    allowedTools: z.array(Written).min(1).optional(),
  })
  .strict();
export type RoleOverride = z.infer<typeof RoleOverride>;

/** The roles a project may change. Triage is absent on purpose: it stays a library-level choice. */
export const RoleOverrides = z
  .object({
    worker: RoleOverride.optional(),
    gateMaintenance: RoleOverride.optional(),
  })
  .strict();
export type RoleOverrides = z.infer<typeof RoleOverrides>;
```

- [ ] **Step 4: Compose `roles` into the config file and describe its mistakes**

In `src/cli/config.ts`:

Change the schema import to:

```ts
import { CloserRef, GateRef, RoleOverrides, TaskDef } from "../schema.js";
```

Replace the `CONFIG_KEYS` doc comment and value:

```ts
/** The seven keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `tasks`, `domain`, `roles`, `gate`, `closer` and `budgets`";
```

In `DeliveryConfig`, after the `domain: Prose.optional(),` line, add:

```ts
    // What this project changes about the worker and gate maintenance: their
    // instructions and the tools they may use, each field laid over the
    // built-in role. Triage is not here: it is the harness's own.
    roles: RoleOverrides.optional(),
```

In `WHAT_IT_TAKES`, after the `domain` entry, add:

```ts
  roles:
    'It changes what the worker, or the agent that repairs your check, is told and which tools it may use, for example `{ "worker": { "allowedTools": ["Read", "Edit"] } }`: see docs/configuring-a-role.md.',
```

Above `describeProblem`, add:

```ts
type Issue = z.ZodError["issues"][number];

/** Who each changeable role is, as the person reading a refusal knows it. */
const WHO_FOR: Record<keyof RoleOverrides, string> = {
  worker: "the worker",
  gateMaintenance: "the agent that repairs your check",
};

const KEEP_BUILT_IN = "remove it to keep the built-in one";

/**
 * The mistakes worth their own sentence under `roles`, each naming the field
 * and the way back to the built-in role. Anything else there is a value of the
 * wrong kind, left to the general sentence.
 */
function roleProblem(file: string, issue: Issue, raw: unknown): string | undefined {
  const [, role, field, item] = issue.path;
  if (issue.code === "unrecognized_keys") {
    return role === undefined
      ? `I can't use ${file}: \`roles\` has no role called \`${issue.keys[0]}\`. ` +
          `Only \`worker\` and \`gateMaintenance\` can be changed here, so ${KEEP_BUILT_IN}.`
      : `I can't use ${file}: \`roles.${String(role)}\` has no setting called \`${issue.keys[0]}\`. ` +
          `It takes \`systemPromptFragment\` and \`allowedTools\`, so ${KEEP_BUILT_IN}.`;
  }
  const where = issue.path.join(".");
  const whose = WHO_FOR[role as keyof RoleOverrides];
  const value = valueAt(raw, issue.path);
  if (field === "systemPromptFragment" && typeof value === "string") {
    return `I can't use ${file}: \`${where}\`, the instructions for ${whose}, is empty. Write a sentence, or ${KEEP_BUILT_IN}.`;
  }
  if (field === "allowedTools" && item === undefined && issue.code === "too_small") {
    return `I can't use ${file}: \`${where}\`, the tools ${whose} may use, is empty. Name at least one, or ${KEEP_BUILT_IN}.`;
  }
  if (field === "allowedTools" && typeof item === "number" && typeof value === "string") {
    return `I can't use ${file}: \`roles.${String(role)}.allowedTools\` item ${item + 1} is empty. Name a tool, or remove it.`;
  }
  return undefined;
}
```

In `describeProblem`, immediately after `const where = issue.path.join(".");` and before the `if (issue.code === "unrecognized_keys")` branch, add:

```ts
  if (issue.path[0] === "roles") {
    const said = roleProblem(file, issue, raw);
    if (said !== undefined) return said;
  }
```

- [ ] **Step 5: Run the config tests to verify they pass**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing validate tests**

In `src/cli/validate-command.test.ts`, add to `describe("what validate says a project is set up to do", …)`:

```ts
  it("says which role the file changes and what it changes, after what it already said", () => {
    const config: DeliveryConfig = {
      roles: { worker: { systemPromptFragment: "Never modify anything under the ops folder.", allowedTools: ["Read", "Edit"] }, gateMaintenance: { allowedTools: ["Read"] } },
    };
    expect(checkedLines(config, project()).slice(4)).toEqual(["✓ worker: your own instructions and tool list", "✓ gate maintenance: your own tool list"]);
  });

  it("says nothing about a role the file leaves as it is", () => {
    expect(checkedLines({ roles: { worker: {} } }, project())).toHaveLength(4);
    expect(checkedLines({}, project())).toHaveLength(4);
  });
```

Add four rows to the `it.each` table in `describe("delivery validate on a configuration with a problem", …)`:

```ts
    [
      "a role that can't be changed from the file",
      { ...COMPLETE, roles: { triage: { allowedTools: ["Read"] } } },
      "`roles` has no role called `triage`. Only `worker` and `gateMaintenance` can be changed here, so remove it to keep the built-in one.",
    ],
    [
      "a role setting that doesn't exist",
      { ...COMPLETE, roles: { worker: { instructions: "Be careful." } } },
      "`roles.worker` has no setting called `instructions`. It takes `systemPromptFragment` and `allowedTools`, so remove it to keep the built-in one.",
    ],
    [
      "empty instructions for the worker",
      { ...COMPLETE, roles: { worker: { systemPromptFragment: "" } } },
      "`roles.worker.systemPromptFragment`, the instructions for the worker, is empty. Write a sentence, or remove it to keep the built-in one.",
    ],
    [
      "an empty tools list",
      { ...COMPLETE, roles: { gateMaintenance: { allowedTools: [] } } },
      "`roles.gateMaintenance.allowedTools`, the tools the agent that repairs your check may use, is empty. Name at least one, or remove it to keep the built-in one.",
    ],
```

Add to `describe("delivery validate on a configuration that is ready", …)`:

```ts
  it("passes a file that changes the worker's instructions and tools, and says so", async () => {
    const repo = repoWith({ ...COMPLETE, roles: { worker: { systemPromptFragment: "Never modify anything under the ops folder.", allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"] } } });
    const { stdout, stderr, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stderr).toBe("");
    expect(stdout).toContain("✓ worker: your own instructions and tool list\n");
    expect(stdout.endsWith(`${READY}\n`)).toBe(true);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("does not check tool names against a list, so a misspelt one passes and is refused only when a run tries it", async () => {
    const repo = repoWith({ ...COMPLETE, roles: { worker: { allowedTools: ["Raed"] } } });
    const { stdout, exitCode } = await delivery(["validate"], { cwd: repo });
    expect(stdout).toContain(READY);
    expect(exitCode).toBe(EXIT.ok);
  });
```

- [ ] **Step 7: Run the validate tests to verify they fail**

Run: `npx vitest run src/cli/validate-command.test.ts`
Expected: FAIL on the two `checkedLines` role tests and the "says so" end-to-end test (no role line yet). The refusal rows and the misspelt-tool test already pass, because Task 1's schema and messages are in; that is expected.

- [ ] **Step 8: Add the role lines to `checkedLines`**

In `src/cli/validate-command.ts`, change the schema import to:

```ts
import type { CloserRef, GateRef, RoleOverrides } from "../schema.js";
```

Above `checkedLines`, add:

```ts
/** Each changeable role as `validate` names it, in the order it names them. */
const ROLE_LINES: Record<keyof RoleOverrides, string> = { worker: "worker", gateMaintenance: "gate maintenance" };

/** One line per role the file changes, saying which of its settings are the project's own; none for a role left as built. */
function roleLines(config: DeliveryConfig): string[] {
  return (Object.keys(ROLE_LINES) as (keyof RoleOverrides)[]).flatMap((role) => {
    const override = config.roles?.[role];
    const own: string[] = [];
    if (override?.systemPromptFragment !== undefined) own.push("instructions");
    if (override?.allowedTools !== undefined) own.push("tool list");
    return own.length === 0 ? [] : [`${ROLE_LINES[role]}: your own ${own.join(" and ")}`];
  });
}
```

In `checkedLines`, add `...roleLines(config),` after the `closer:` element of the array, and extend its doc comment's list: "the description, the tasks, what the check runs, what the closing action does, and which roles the file changes".

- [ ] **Step 9: Run the validate tests to verify they pass**

Run: `npx vitest run src/cli/validate-command.test.ts src/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/schema.ts src/cli/config.ts src/cli/config.test.ts src/cli/validate-command.ts src/cli/validate-command.test.ts
git commit -m "Accept a roles section in delivery.config.json and name its mistakes

An extender tunes the worker's and gate maintenance's instructions and tools
in the checked-in file rather than in code. The shape lives in the library
schema so a run's record can pin it next; validate names an unknown role, an
unknown field, empty instructions or an empty tools list in plain words, each
with the way back to the built-in role, and says which roles the file changes."
```

---

### Task 2: Merge overrides over the shipped roles and preview the result ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/roles.ts`
- Test: `src/cli/roles.test.ts`
- Modify: `src/schema.ts` (`CaseFileHeader.roleOverrides`)
- Test: `src/case-file.test.ts`
- Modify: `src/cli/settings.ts` (`ProjectSettings.roleOverrides`, `resolveProject`)
- Test: `src/cli/settings.test.ts`
- Modify: `src/cli/preview-command.ts` (roles from `rolesFor` on the stand-in's header)
- Test: `src/cli/preview-command.test.ts`

**Interfaces:**
- Consumes: `RoleOverride`, `RoleOverrides` from `src/schema.ts` (Task 1); `DeliveryConfig.roles` (Task 1); `validateRoleConfig`, `workerRoleConfig`, `gateMaintenanceRoleConfig`, `RoleConfig` from `src/role-config.ts`; `triageRoleConfig` from `src/triage-role-config.ts`; `type RoleConfigs` from `src/agent-invoke.ts`.
- Produces:
  - `src/cli/roles.ts`: `export function rolesFor(overrides: RoleOverrides | undefined): RoleConfigs`. Throws `InvalidRoleConfig` if a merged role fails `validateRoleConfig`.
  - `CaseFileHeader` (and so `CreateHeader`, accepted by `create()` and `initialCaseFile()`) gains `roleOverrides?: RoleOverrides`.
  - `ProjectSettings` gains `roleOverrides?: RoleOverrides`; `resolveProject` sets it from `config.roles` after checking `rolesFor(config.roles)`.

- [ ] **Step 1: Write the failing merge tests**

Create `src/cli/roles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { InvalidRoleConfig } from "../errors.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { createToolAuthority, refusalSentence } from "../tool-authority.js";
import { triageRoleConfig } from "../triage-role-config.js";
import { rolesFor } from "./roles.js";

const OPS_RULE = "Never modify anything under the ops folder.";

/** The options bag the SDK passes as `canUseTool`'s third argument. */
const sdkCallOptions = { signal: new AbortController().signal, toolUseID: "roles-test-tool-use", requestId: "roles-test-request" };

describe("the roles a run from the command line is given", () => {
  it("is the three built-in roles when the file changes nothing", () => {
    const shipped = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };
    expect(rolesFor(undefined)).toEqual(shipped);
    expect(rolesFor({})).toEqual(shipped);
    expect(rolesFor({ worker: {} })).toEqual(shipped);
  });

  it("takes the file's instructions for the worker and keeps its built-in tools", () => {
    expect(rolesFor({ worker: { systemPromptFragment: OPS_RULE } }).worker).toEqual({ ...workerRoleConfig, systemPromptFragment: OPS_RULE });
  });

  it("takes the file's tools for gate maintenance and keeps its built-in instructions", () => {
    expect(rolesFor({ gateMaintenance: { allowedTools: ["Read", "Edit"] } })["gate-maintenance"]).toEqual({
      ...gateMaintenanceRoleConfig,
      allowedTools: ["Read", "Edit"],
    });
  });

  it("changes one role without touching the other", () => {
    const roles = rolesFor({ worker: { systemPromptFragment: OPS_RULE, allowedTools: ["Read"] } });
    expect(roles["gate-maintenance"]).toEqual(gateMaintenanceRoleConfig);
  });

  it("never changes triage, whatever the file says about the other two", () => {
    const roles = rolesFor({ worker: { allowedTools: ["Read"] }, gateMaintenance: { systemPromptFragment: OPS_RULE } });
    expect(roles.triage).toBe(triageRoleConfig);
  });

  it("passes every merged role through the library's own role check", () => {
    expect(() => rolesFor({ worker: { allowedTools: [] } })).toThrow(InvalidRoleConfig);
    expect(() => rolesFor({ gateMaintenance: { systemPromptFragment: "" } })).toThrow(InvalidRoleConfig);
  });

  it("refuses the agent a tool the file leaves out, exactly as the built-in tool guard refuses one", async () => {
    const { worker } = rolesFor({ worker: { allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"] } });
    const authority = createToolAuthority(worker, "/runs/roles-test/tree");
    const decision = await authority.canUseTool("Bash", { command: "ls" }, sdkCallOptions);
    expect(decision).toEqual({ behavior: "deny", message: refusalSentence(worker, "Bash") });
    expect(authority.refusals).toEqual([refusalSentence(worker, "Bash")]);
  });
});
```

- [ ] **Step 2: Run the merge tests to verify they fail**

Run: `npx vitest run src/cli/roles.test.ts`
Expected: FAIL with "Cannot find module './roles.js'" (or the equivalent resolution error).

- [ ] **Step 3: Write `rolesFor`**

Create `src/cli/roles.ts`:

```ts
import type { RoleConfigs } from "../agent-invoke.js";
import { gateMaintenanceRoleConfig, validateRoleConfig, workerRoleConfig, type RoleConfig } from "../role-config.js";
import type { RoleOverride, RoleOverrides } from "../schema.js";
import { triageRoleConfig } from "../triage-role-config.js";

/**
 * A shipped role with whatever the project changed laid over it, field by
 * field: an omitted field keeps the built-in value, as `budgets` does. The
 * result goes through the library's own role check, so the command line
 * accepts exactly the roles `invoke` accepts and there is no second opinion.
 */
function withOverride(shipped: RoleConfig, override: RoleOverride | undefined): RoleConfig {
  const merged: RoleConfig = {
    ...shipped,
    systemPromptFragment: override?.systemPromptFragment ?? shipped.systemPromptFragment,
    allowedTools: override?.allowedTools ?? shipped.allowedTools,
  };
  validateRoleConfig(merged);
  return merged;
}

/**
 * The roles a run from the command line is given, from the overrides it was
 * started with. One function, used by the run itself, by `preview` and by the
 * check every command makes before a run exists, so what is previewed and
 * validated is what a run is told. Triage is always the harness's own.
 */
export function rolesFor(overrides: RoleOverrides | undefined): RoleConfigs {
  return {
    worker: withOverride(workerRoleConfig, overrides?.worker),
    "gate-maintenance": withOverride(gateMaintenanceRoleConfig, overrides?.gateMaintenance),
    triage: triageRoleConfig,
  };
}
```

- [ ] **Step 4: Run the merge tests to verify they pass**

Run: `npx vitest run src/cli/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pinning and settings tests**

In `src/case-file.test.ts`, inside `describe("create", …)` (its `beforeEach` sets `dir`; the file's top-level `budgetDefaults` and `gateRef` constants are already in scope), add:

```ts
  it("keeps the role overrides a run was started with, so reading it back tells its agents the same thing", async () => {
    const roleOverrides = { worker: { systemPromptFragment: "Never modify anything under the ops folder.", allowedTools: ["Read", "Edit"] } };
    await create(dir, { surfaceId: "surface-roles", taskDef: { intent: "add a page" }, gateRef, roleOverrides }, budgetDefaults);
    expect((await load(dir)).header.roleOverrides).toEqual(roleOverrides);
  });
```

In `src/cli/settings.test.ts`, add to `describe("what the run is told about the project", …)`:

```ts
  it("carries the file's role overrides through to the run's settings, unchanged", async () => {
    const roles = { worker: { systemPromptFragment: "Never modify anything under the ops folder." }, gateMaintenance: { allowedTools: ["Read"] } };
    expect((await settings({ task: TASK }, { config: { roles } })).roleOverrides).toEqual(roles);
  });

  it("leaves them unset when the file changes no role, so the run is exactly what it was before", async () => {
    expect((await settings({ task: TASK })).roleOverrides).toBeUndefined();
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/case-file.test.ts src/cli/settings.test.ts`
Expected: FAIL. The case-file test gets `undefined` (the header schema strips the unknown field on write); the settings test gets `undefined`. `npx tsc --noEmit` also reports `roleOverrides` is not in `CreateHeader`.

- [ ] **Step 7: Pin the overrides in the header and carry them in the settings**

In `src/schema.ts`, in `CaseFileHeader`, after `domainPrompt: z.string().optional(),`, add:

```ts
  // What the project changed about the worker and gate maintenance, pinned at
  // CREATE like domainPrompt so a resumed run is told what it was told before
  // and can never regain a tool its project had taken away. Only the plain
  // fields are kept: the full roles are rebuilt from the shipped ones.
  // Optional: records written before overrides existed stay valid.
  roleOverrides: RoleOverrides.optional(),
```

In `src/cli/settings.ts`:

Change the schema type import to:

```ts
import type { BudgetSet, CaseFileHeader, GateRef, RoleOverrides, TaskDef } from "../schema.js";
```

Add `import { rolesFor } from "./roles.js";` beside the other `./` imports.

In `ProjectSettings`, after `domainPrompt?: string;`, add:

```ts
  /** What the config file changes about the worker and gate maintenance, pinned into the run when it starts. Absent when it changes nothing. */
  roleOverrides?: RoleOverrides;
```

Replace the body of `resolveProject` with:

```ts
  // Merged over the built-in roles and checked now, so a role the harness
  // would refuse stops the command before any run's record exists.
  rolesFor(config.roles);
  return {
    gateRef: await gateFrom(flags, env, config, repoPath),
    closerRef: closerFrom(flags, env, config),
    budgets: budgetsFrom(config),
    // Only the file can say what the project is: it is prose about the
    // repository, not something a person retypes per run, so there is no flag
    // and no environment variable to lay over it.
    domainPrompt: config.domain,
    // Likewise for the roles: they are part of the project, reviewed with it.
    roleOverrides: config.roles,
  };
```

- [ ] **Step 8: Run them to verify they pass**

Run: `npx vitest run src/case-file.test.ts src/cli/settings.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing preview tests**

In `src/cli/preview-command.test.ts`, add to `describe("delivery preview", …)`:

```ts
  it("shows the worker's instructions and tools as the file changes them", async () => {
    const OPS_RULE = "Never modify anything under the ops folder.";
    const tools = ["Read", "Glob", "Grep", "Edit", "Write"];
    const repo = repoWith({ ...PROJECT, roles: { worker: { systemPromptFragment: OPS_RULE, allowedTools: tools } } });
    const { stdout, exitCode } = await delivery(["preview"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[4]).toBe(OPS_RULE);
    expect(stdout).toContain(`${OPS_RULE}\n\n${DOMAIN}\n\n## Task`);
    expect(stdout).not.toContain(workerRoleConfig.systemPromptFragment);
    expect(stdout.endsWith(`${RULE}\n${toolsLine(tools)}\n`)).toBe(true);
    expect(stdout).not.toContain("run commands");
  });

  it("shows gate maintenance as the file changes it, and leaves the worker as built", async () => {
    const repo = repoWith({ ...PROJECT, roles: { gateMaintenance: { allowedTools: ["Read"] } } });
    const repair = await delivery(["preview", "--role", "gate-maintenance"], { cwd: repo });
    expect(repair.stdout).toContain(`${gateMaintenanceRoleConfig.systemPromptFragment}\n\n${DOMAIN}`);
    expect(repair.stdout.endsWith(`${RULE}\nTools it can use: read files.\n`)).toBe(true);
    const worker = await delivery(["preview"], { cwd: repo });
    expect(worker.stdout.endsWith(`${RULE}\n${toolsLine(workerRoleConfig.allowedTools)}\n`)).toBe(true);
  });
```

Add to `describe("delivery preview on a configuration with a problem", …)`:

```ts
  it("refuses empty worker instructions in the words validate uses", async () => {
    const repo = repoWith({ ...PROJECT, roles: { worker: { systemPromptFragment: " " } } });
    const preview = await delivery(["preview"], { cwd: repo });
    const validate = await delivery(["validate"], { cwd: repo });
    expect(preview.exitCode).toBe(EXIT.configuration);
    expect(preview.stderr).toContain("`roles.worker.systemPromptFragment`, the instructions for the worker, is empty.");
    expect(preview.stderr).toBe(validate.stderr);
  });
```

- [ ] **Step 10: Run the preview tests to verify they fail**

Run: `npx vitest run src/cli/preview-command.test.ts`
Expected: FAIL on the two "as the file changes" tests (preview still shows the shipped roles from `RUN_ROLES`). The refusal test already passes (Task 1); that is expected.

- [ ] **Step 11: Preview the roles the stand-in record would be given**

In `src/cli/preview-command.ts`:

Replace `import { RUN_ROLES } from "./drive.js";` with `import { rolesFor } from "./roles.js";`.

In `previewCommand`, replace the block from `const roleCfg = RUN_ROLES[options.role];` through the `assemblePrompt` call with:

```ts
  const { gateRef, closerRef, domainPrompt, budgets, roleOverrides } = project;
  // The id is fixed rather than made from the clock, as a real run's is: it
  // is not part of what an agent is told, and a fixed one keeps two previews
  // of the same project identical.
  const standIn = initialCaseFile(
    { surfaceId: "preview", taskDef: chosen.taskDef, gateRef, closerRef, domainPrompt, roleOverrides },
    budgets,
  );
  // The roles from the record, as a run takes them, not from the file.
  const roleCfg = rolesFor(standIn.header.roleOverrides)[options.role];
  const { systemPrompt, prompt } = assemblePrompt(standIn, roleCfg, FIRST_DISPATCH);
```

In the `previewCommand` doc comment, replace "the role from `RUN_ROLES`" with "the roles from `rolesFor` on that record, as a run's driver takes them".

- [ ] **Step 12: Run the preview tests to verify they pass**

Run: `npx vitest run src/cli/preview-command.test.ts src/cli/preview-matches-run.test.ts`
Expected: PASS (the existing wire comparison still passes: its config has no `roles`, so both sides use the shipped roles).

- [ ] **Step 13: Commit**

```bash
git add src/cli/roles.ts src/cli/roles.test.ts src/schema.ts src/case-file.test.ts src/cli/settings.ts src/cli/settings.test.ts src/cli/preview-command.ts src/cli/preview-command.test.ts
git commit -m "Merge role overrides over the shipped roles and preview the result

One function lays the file's instructions and tools over the built-in worker
and gate-maintenance roles and puts each through the library's own role
check, so preview, validate and a run's start all see the same roles. The
overrides ride in the run's record beside the description, ready for the run
to be told what it started with."
```

---

### Task 3: Runs use the roles they started with; document the `roles` key ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/drive.ts` (`startRun` pins `roleOverrides`; `driveToOutcome` uses `rolesFor(header.roleOverrides)`; remove `RUN_ROLES`)
- Modify: `src/cli/command-fixtures.ts` (`interruptedRun` takes `roleOverrides`)
- Test: `src/cli/preview-matches-run.test.ts`
- Modify: `docs/configuring-a-role.md`, `README.md`
- Create: `.changeset/tune-a-role-from-the-config-file.md`

**Interfaces:**
- Consumes: `rolesFor` from `src/cli/roles.ts`; `ProjectSettings.roleOverrides`; `CaseFileHeader.roleOverrides` (Task 2).
- Produces: `RunStart` (extends `ProjectSettings`) now carries `roleOverrides` into `create()`; `RUN_ROLES` no longer exists. `interruptedRun(repo, state, { task, steps, worker, domain?, roleOverrides? })`.

- [ ] **Step 1: Let the interrupted-run fixture pin overrides**

In `src/cli/command-fixtures.ts`, change the `interruptedRun` signature and its `create` call to:

```ts
export async function interruptedRun(
  repo: string,
  state: string,
  {
    task,
    steps,
    worker,
    domain,
    roleOverrides,
  }: { task: string; steps: number; worker: (ctx: AgentContext) => Promise<Terminus>; domain?: string; roleOverrides?: RoleOverrides },
): Promise<string> {
  const runId = runIdFor(task, new Date());
  const { dir, location } = runPlace(repo, runId, { XDG_STATE_HOME: state });
  await prepareRunDir(repo, dir);
  await create(
    dir,
    { surfaceId: runId, taskDef: { intent: task }, gateRef: GATE, closerRef: DEFAULT_CLOSER, domainPrompt: domain, roleOverrides },
    DEFAULT_BUDGETS,
  );
```

(the rest of the function is unchanged) and extend the schema type import to `import type { CaseFileOutcome, GateRef, RoleOverrides } from "../schema.js";`.

- [ ] **Step 2: Write the failing run-level tests**

In `src/cli/preview-matches-run.test.ts`, add `interruptedRun` and `writesHello` to the `./command-fixtures.js` import, and append:

```ts
const OPS_RULE = "Never modify anything under the ops folder.";
const NARROW_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"];

describe("a run is told what the project's roles say", () => {
  it(
    "sends each queued task's worker the file's instructions, exactly as preview shows them",
    async () => {
      const repo = initTempRepo("roles-queue-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({
          domain: DOMAIN,
          tasks: [FIRST, SECOND],
          roles: { worker: { systemPromptFragment: OPS_RULE, allowedTools: NARROW_TOOLS } },
        }),
      });
      const next = await delivery(["preview"], { cwd: repo });
      expect(next.stdout).not.toContain("run commands");

      const capture = join(mkdtempSync(join(tmpdir(), "roles-capture-")), "wire.jsonl");
      wiring.session = recordingSession(await scriptFile(completes), capture);
      const run = await delivery(["run"], { cwd: repo });
      expect(run.exitCode).toBe(EXIT.ok);

      const sent = sessionsSent(capture);
      expect(sent).toHaveLength(2);
      for (const session of sent) expect(session.systemPrompt).toBe(`${OPS_RULE}\n\n${DOMAIN}`);
      const [toFirst] = sent as [Sent];
      expect(framed(next.stdout)).toBe(`${toFirst.systemPrompt}\n\n${toFirst.prompt}\n`);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "sends a single task's worker the file's instructions",
    async () => {
      const repo = initTempRepo("roles-single-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ roles: { worker: { systemPromptFragment: OPS_RULE } } }),
      });
      const capture = join(mkdtempSync(join(tmpdir(), "roles-capture-")), "wire.jsonl");
      wiring.session = recordingSession(await scriptFile(completes), capture);
      const run = await delivery(["run", "--task", FIRST], { cwd: repo });
      expect(run.exitCode).toBe(EXIT.ok);
      expect(sessionsSent(capture).map((session) => session.systemPrompt)).toEqual([OPS_RULE]);
    },
    RUN_TIMEOUT,
  );

  it(
    "keeps a resumed run on the roles it started with, whatever the file says now",
    async () => {
      const repo = initTempRepo("roles-resume-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ roles: { worker: { systemPromptFragment: "Rewritten since the run began." } } }),
      });
      const state = mkdtempSync(join(tmpdir(), "roles-state-"));
      // steps: 0 leaves the run before its first dispatch, so the worker the
      // resume sends goes through the recorded session rather than the
      // fixture's in-process fake (resume-command.test.ts uses 3, past it).
      await interruptedRun(repo, state, { task: FIRST, steps: 0, worker: writesHello, roleOverrides: { worker: { systemPromptFragment: OPS_RULE } } });

      const capture = join(mkdtempSync(join(tmpdir(), "roles-capture-")), "wire.jsonl");
      wiring.session = recordingSession(await scriptFile(completes), capture);
      const resumed = await delivery(["resume"], { cwd: repo, env: { XDG_STATE_HOME: state } });
      expect(resumed.exitCode).toBe(EXIT.ok);
      expect(sessionsSent(capture).map((session) => session.systemPrompt)).toEqual([OPS_RULE]);
    },
    RUN_TIMEOUT,
  );

  it(
    "sends the built-in instructions when the file changes no role, as before",
    async () => {
      const repo = initTempRepo("roles-none-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({}) });
      const capture = join(mkdtempSync(join(tmpdir(), "roles-capture-")), "wire.jsonl");
      wiring.session = recordingSession(await scriptFile(completes), capture);
      const run = await delivery(["run", "--task", FIRST], { cwd: repo });
      expect(run.exitCode).toBe(EXIT.ok);
      expect(sessionsSent(capture).map((session) => session.systemPrompt)).toEqual([workerRoleConfig.systemPromptFragment]);
    },
    RUN_TIMEOUT,
  );
});
```

Add `import { workerRoleConfig } from "../role-config.js";` to the file's imports.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/cli/preview-matches-run.test.ts`
Expected: FAIL on the first three new tests: each session's system prompt is the shipped worker fragment, because `driveToOutcome` still passes `RUN_ROLES`. The fourth passes (it pins the behaviour this task must not change).

- [ ] **Step 4: Pin the overrides at the start of a run and drive from them**

In `src/cli/drive.ts`:

Remove the imports of `gateMaintenanceRoleConfig, workerRoleConfig` (from `../role-config.js`), `triageRoleConfig` (from `../triage-role-config.js`) and the `RoleConfigs` type, and add `import { rolesFor } from "./roles.js";`.

Delete the `RUN_ROLES` constant and its doc comment.

In `startRun`, destructure `roleOverrides` and pass it to `create`:

```ts
export async function startRun(
  { repoPath, taskDef, gateRef, closerRef, budgets, domainPrompt, roleOverrides }: RunStart,
  session: SessionEnvironment,
  ctx: CommandContext,
): Promise<ExitCode> {
  const intent = taskIntent(taskDef);
  const runId = runIdFor(intent, new Date());
  const { dir } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  const caseFile = await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef, domainPrompt, roleOverrides }, budgets);
```

(the rest of `startRun` is unchanged). In `driveToOutcome`, replace `const agent = createAgentPort(RUN_ROLES, session);` with:

```ts
  // The roles come from the run's own record, as its check and closing action
  // do, so a resumed run is told what it was told before, whatever the file
  // says now, and never regains a tool its project took away.
  const agent = createAgentPort(rolesFor(header.roleOverrides), session);
```

Confirm nothing else referenced `RUN_ROLES`: `grep -rn RUN_ROLES src` prints nothing.

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run src/cli/preview-matches-run.test.ts src/cli/resume-command.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors.

- [ ] **Step 6: Document the `roles` key in the role guide**

In `docs/configuring-a-role.md`, insert this section immediately before `## Making your first invocation`:

````markdown
## From the configuration file

A project using the `delivery` command can change the worker's and gate
maintenance's instructions and tools in its `delivery.config.json`, with no code:

```json
{
  "roles": {
    "worker": {
      "systemPromptFragment": "You are the worker for the on-call service. Never modify anything under the ops folder.",
      "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"]
    },
    "gateMaintenance": { "allowedTools": ["Read", "Glob", "Grep", "Edit"] }
  }
}
```

| Key | What it changes |
|---|---|
| `roles.worker.systemPromptFragment` | The worker's instructions, in place of the reference sentences above |
| `roles.worker.allowedTools` | The tools the worker may use, in place of its reference list |
| `roles.gateMaintenance.systemPromptFragment` | Gate maintenance's instructions |
| `roles.gateMaintenance.allowedTools` | The tools gate maintenance may use |

Each field is optional. Anything you leave out keeps its built-in value, so
overriding only `allowedTools` keeps the reference instructions, and a project
with no `roles` runs exactly as before. The reply shape (`envelopeSchema`) is not
a setting: it stays the harness's own. Triage cannot be changed from the file: its
tools are read-only by design (see [Triage](#triage)), and it stays a choice made
in code.

A run keeps the roles it started with. Editing `roles` changes the next run, not
one already going, and resuming a run tells its agents what they were told before.

`delivery validate` refuses a role other than `worker` or `gateMaintenance`, a
setting other than those two, empty instructions and an empty tools list, each
with the field named and the fix: remove it to keep the built-in one.
`delivery preview` shows the instructions and the tools as your file sets them;
add `--role gate-maintenance` for gate maintenance.

**A misspelled tool name is not caught by `delivery validate`.** No list of valid
tool names is checked, because none could stay in step with the agent runtime you
have installed. A misspelling shows up during a run instead: the tool you meant is
refused to the agent as a tool outside its list (see "What a role cannot do"
below), and the run reports that refusal. If an agent says it was refused a tool
you thought you granted, check the spelling in `allowedTools` first.

Whatever the file lists, a role still works only inside its working tree: the
tool guard below applies to every role, overridden or not.
````

- [ ] **Step 7: Document the `roles` key in the README and record the change**

In `README.md`, in the "Configure it once" settings table, add this row after the `domain` row:

```markdown
| `roles` | Changes what the worker, or the agent that repairs your check, is told and which tools it may use: `{ "worker": { "systemPromptFragment": "...", "allowedTools": ["Read", "Edit"] } }`, and `gateMaintenance` the same way. Anything you leave out keeps its built-in value. A run keeps the roles it started with. `delivery preview` shows the result. See [Configuring a role](docs/configuring-a-role.md#from-the-configuration-file). |
```

In the paragraph below the flags table that begins "An unknown setting, a limit that is not a whole number,", replace its first sentence with:

```markdown
An unknown setting, a limit that is not a whole number, a closer type the harness doesn't know,
a role override that is empty or names a role that can't be changed, or a custom module it can't
load all stop the command before it starts, naming what to fix.
```

Create `.changeset/tune-a-role-from-the-config-file.md`:

```markdown
---
"delivery-service": minor
---

`delivery.config.json` takes a `roles` section that changes what the worker, or the agent that
repairs a check, is told (`systemPromptFragment`) and which tools it may use (`allowedTools`),
with no code. Anything left out keeps its built-in value, and triage cannot be changed from the
file. Every run started from the file uses the changed roles and keeps them if it is resumed.
`delivery preview` shows the changed instructions and tools, and `delivery validate` names an
unknown role or setting, empty instructions or an empty tools list, with the way back to the
built-in one. A misspelled tool name is not caught by `delivery validate`: it shows up during a
run as that tool being refused.
```

- [ ] **Step 8: Commit**

```bash
git add src/cli/drive.ts src/cli/command-fixtures.ts src/cli/preview-matches-run.test.ts docs/configuring-a-role.md README.md .changeset/tune-a-role-from-the-config-file.md
git commit -m "Tell each run's agents what its project's roles say, and keep it on resume

A run now builds its worker and gate-maintenance roles from the overrides
pinned in its own record instead of the static built-in set, so a single task
or a queued list uses the file's instructions and tools, and a resumed run can
neither drift to a newer file nor regain a tool its project took away. The
role guide and README document the roles key, including that a misspelled
tool name surfaces as a refusal during a run rather than in validate."
```
