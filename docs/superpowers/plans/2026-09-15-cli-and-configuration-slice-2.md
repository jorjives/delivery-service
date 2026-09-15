# CLI and Configuration — Slice 2: Choose Your Own Check, Closing Action and Limits

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Let a project name its own check, closing action and attempt limits once in a `delivery.config.json` that `delivery run` finds by itself, and override any of them for a single run with a flag or an environment variable, with every mistake in that configuration stopping the command in plain language before anything is provisioned.

**Architecture:** Two new small modules in the existing thin CLI layer, no library change. `src/cli/config.ts` owns the file: where it is (walk up from the working folder to the repository root), how it is read (`.json` parsed, `.js`/`.mjs` imported for their default export), what it may contain (one `zod` object composing the library's own `TaskDef`, `GateRef` and `CloserRef`, `.strict()`), and what the command says about a file it cannot use. `src/cli/settings.ts` owns precedence: flag, then environment variable, then file, then default, producing the `taskDef`, `gateRef`, `closerRef` and `BudgetSet` that `create()` needs, and loading a custom gate or closer eagerly so a wrong module path stops the command rather than surfacing as a gate ERROR mid-run. `run-command.ts` loses its hard-wired defaults and asks those two modules instead; `outcome.ts` learns to say where the work actually went, which differs per closer.

**Tech Stack:** Node ≥ 22, TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), commander 14, zod 4, vitest 5, git, the vendored `@jorj/claude-mock` through the contributor test seam. No new dependency: `zod` and `commander` are already runtime dependencies.

## Global Constraints

- **Buy-vs-build (Build note, verbatim):** "Validate the configuration with the zod schemas the library already defines for tasks, gates and closers, composed rather than re-described. Find and load the config file with the standard library (walk up to the repository root); do not add a multi-format config loader." In practice: `DeliveryConfig` composes `TaskDef`, `GateRef` and `CloserRef` from `src/schema.ts` and adds nothing of its own beyond `budgets`; discovery is `node:fs` `existsSync` plus `node:path` `dirname`; loading is `readFile` + `JSON.parse` for `.json` and dynamic `import()` for `.js`/`.mjs`. No `cosmiconfig`, `lilconfig` or `c12`. No YAML or TOML.
- **Operability / DX:** this slice carries no Operational note. It adds no new command, build step, dependency or environment of its own; the harness, local-run story and CI from slice 1 cover it unchanged. What it does change is what the command accepts and what it prints, so the README and the two extender guides that describe those things are updated with the tasks that change them (see Scaffolding Impact).
- **The four keys, and only those four (spec, verbatim):** "`task`, `gate`, `closer` are the library's existing `TaskDef`, `GateRef` and `CloserRef` shapes verbatim... `budgets` sets caps only, as integers per population (`correction`, `gateError`, `gateMaintenance`, `terminus`, `close`), each optional and merged over the default budget set. The `used` counter is harness state and is never configurable."
- **Precedence (spec, verbatim):** "flag, then environment variable, then config file, then built-in default. Environment variables mirror the flags: `DELIVERY_TASK`, `DELIVERY_GATE_COMMAND`, `DELIVERY_CLOSER`, `DELIVERY_CONFIG`."
- **Discovery (spec, verbatim):** "`--config`/`DELIVERY_CONFIG` if given; otherwise walk upward from `--repo` (default cwd) for `delivery.config.{json,js,mjs}`, stopping at the directory containing `.git` or the filesystem root. No file is not an error." Here the repository root is already known (`findRepository` ran first), so the walk stops there; both ends of the walk are put through `realpathSync` so a symlinked temp directory cannot make the walk miss its stop.
- **Flags this slice adds (spec's command surface, verbatim):** `--task-file <path>`, `--gate-command <cmd>`, `--closer <type>`, `--config <file>`. `--gate-command` is shorthand for `{ type: "command", command: <cmd>, parseMode: "exitcode" }`; `--closer` takes a built-in type with no required fields. "A `custom` gate or closer, a non-default `parseMode`, or closer options such as `merge-back`'s `deleteBranch` are expressed in the config file only."
- **Exit codes (slice 1, unchanged):** `EXIT = { ok: 0, unexpected: 1, configuration: 2, agentRuntime: 3, escalated: 4, aborted: 5 }` in `src/cli/failures.ts`. Every refusal this slice adds is `EXIT.configuration`.
- **Copy:** "Every message names the problem and the fix without harness vocabulary ('worktree', 'envelope', 'surface', a state name)." British English, no em-dashes in any user-facing string or document. The command speaks in the first person ("I can't use...", "I couldn't find..."), matching slice 1's existing messages.
- **Deliberate differences from the spec's error table, and why:** the unknown-closer message ends "To use your own, put `{ "type": "custom", "modulePath": "./closers/mine.js" }` in delivery.config.json." rather than the spec's bare fragment, because a reader on the command line needs to be told *where* that object goes. The custom gate and closer load failures keep slice 1's existing wording in `src/cli/failures.ts` verbatim, which already names the module path, the detail and the guide; this slice only makes them reachable before a run starts. The built-in closers are listed in the order the library's own `CloserRef` union declares them (`merge-back`, `commit-to-branch`, `open-pr`), not the spec's prose order, because deriving the list from the schema is what stops the two disagreeing when a closer is added; the AC asks for the choices, not an order.
- **Which folder a relative path is relative to:** `--task-file` resolves against the folder the command was run in (`ctx.cwd`); `--config`, and the upward walk that finds an unnamed file, resolve against `--repo` (which defaults to that same folder). The two differ only when someone passes `--repo` and a relative `--config` together, and the README describes `--config` as a path to a config file without promising a base. Leave it; do not add a second cwd parameter to `loadConfig` for it.
- **Exact user-facing strings are constants the tests import,** as in slice 1: `CONFIG_KEYS`, `NO_SUCH_CONFIG`, `unknownCloser`, `describeProblem` (`src/cli/config.ts`); `NO_TASK`, `BOTH_TASKS`, `NO_TASK_FILE` (`src/cli/settings.ts`); `NO_CHECK`, `NOT_A_REPOSITORY`, `UNCOMMITTED_NOTE` (`src/cli/project.ts`).
- **Refusal ordering (slice 1's rule, extended):** repository, then the config file (found, read, valid), then the task, then the check, then the closer, then any custom module, then the agent runtime preflight, then the uncommitted-changes note, and only then is anything written. A refusal leaves the repository exactly as it was.
- **Resume is not in this slice.** Slice 3 owns re-running and `delivery resume`, including the rule that a resumed run keeps the gate, closer and task it started with. Nothing here reads an existing case file.
- **Verified before planning:** every module, message and behaviour in Tasks 1 to 4 and 6 was built as a scratch prototype inside this worktree, typechecked with `npx tsc --noEmit`, and driven end to end through the contributor test seam: a `merge-back` config file merged the work into `main`; `--closer commit-to-branch` overrode it; a `teleport` closer in the file stopped with the choices listed and nothing written; `--task-file` with `--gate-command` ran in a repository with no `package.json`; a custom gate with a wrong path stopped with the path named and no stack trace; every validation message in Task 1 was produced by the real `zod` 4 issues. The prototype was deleted and the worktree left clean; nothing of it is in the tree. Task 5's wording was designed from the closers' own reports but not prototyped.
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests. Tests that run `dist/cli/main.js` need `npm run build` first; no task here needs one.
- **TDD and commits:** red, then green, then commit. Every commit message is one line saying what changed, a blank line, a paragraph saying why, a blank line, and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Scaffolding Impact

- **Reactive, the "no check" message is now wrong:** `NO_CHECK` in `src/cli/project.ts` tells the user to add a `test` script, because slice 1 had no `--gate-command`. This slice gives them that flag, so the message becomes the spec's wording → Task 3.
- **Reactive, the closing sentence describes only `commit-to-branch`:** `src/cli/outcome.ts` always says "committed on branch X, base not changed", which is false for a `merge-back` or `open-pr` run this slice makes reachable → Task 5.
- **Reactive, `README.md` describes a command with nothing to configure:** it gains a "Configure it once" section covering the file, the four keys, the flags, the environment variables and the precedence order → Task 6. Its existing "Run a task from the command line" section and its exit-code table both state as fact that the work is committed to a new branch, which is now only the default → Task 6 qualifies both.
- **Reactive, `delivery run --help` describes one closing action:** the `run` command's own description in `src/cli/program.ts` ends "and the result is committed to a new branch", which `--closer` and the config file now contradict → Task 6.
- **Reactive, `docs/writing-a-gate.md` describes `gateRef` as something a library caller passes to `create()`:** it gains the two-sentence note that the same shape goes in `delivery.config.json` under `gate`, and that the command loads the module before it starts → Task 6.
- **Reactive, `docs/writing-a-closer.md` describes `closerRef` the same way,** and says an unintelligible `closerRef` becomes an ERROR report rather than an exception, which stays true of the library but is no longer what a command-line user meets → it gains the matching note → Task 6.
- **Unchanged, checked:** `CONTRIBUTING.md` (no new build, test or run step; the `DELIVERY_TEST_MOCK_SCRIPT` seam is untouched); `examples/sample-project/` and its README (`tests/sample-project.test.ts` asserts the folder holds exactly `README.md`, `add.js`, `add.test.js` and `package.json`, so no config file is shipped, and its zero-config walkthrough still works); `package.json` (`zod` and `commander` are already dependencies; no new script); `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push` (all call `npm test`, unchanged); `vitest.config.ts` and `tsconfig.json` (new files sit under the existing `src/**` globs and include paths); `eslint.config.js`; `docs/configuring-a-role.md` and `docs/testing-your-pipeline.md` (library behaviour, unchanged); `docs/provisioning.md`; `vendor/README.md`.

---

### Task 1: The config file's shape, and what the command says about a file it can't use ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/config.ts`
- Create: `src/cli/config.test.ts`

**Interfaces:**
- Consumes: `TaskDef`, `GateRef`, `CloserRef` (zod schemas) from `src/schema.ts`.
- Produces, from `src/cli/config.ts`:
  - `const CONFIG_BASENAME = "delivery.config"`
  - `const CONFIG_EXTENSIONS: readonly [".json", ".js", ".mjs"]`
  - `const CONFIG_KEYS: string` (the sentence fragment naming the four keys)
  - `const BUILT_IN_CLOSERS: string[]`
  - `function unknownCloser(type: unknown): string`
  - `const Budgets` (zod) and `type Budgets`
  - `const DeliveryConfig` (zod) and `type DeliveryConfig`
  - `function describeProblem(file: string, error: z.ZodError, raw: unknown): string`

- [ ] **Step 1: Write the failing test**

Create `src/cli/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DeliveryConfig, describeProblem, unknownCloser } from "./config.js";

const FILE = "delivery.config.json";

/** The message the command would print for a config file it refuses. */
function problemFor(raw: unknown): string {
  const parsed = DeliveryConfig.safeParse(raw);
  if (parsed.success) throw new Error(`expected ${JSON.stringify(raw)} to be refused`);
  return describeProblem(FILE, parsed.error, raw);
}

describe("what a config file may contain", () => {
  it("accepts exactly task, gate, closer and budgets, in the shapes the library already documents", () => {
    const config = {
      task: { intent: "add a function that says goodbye to a name, with a test" },
      gate: { type: "command", command: "npm test", parseMode: "exitcode" },
      closer: { type: "merge-back", deleteBranch: true },
      budgets: { correction: 5 },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts a custom gate and a custom closer, the shapes a flag cannot express", () => {
    const config = {
      gate: { type: "custom", modulePath: "./gates/mine.mjs", exportName: "slow" },
      closer: { type: "custom", modulePath: "./closers/mine.mjs" },
    };
    expect(DeliveryConfig.parse(config)).toEqual(config);
  });

  it("accepts an empty file, because every setting has a default", () => {
    expect(DeliveryConfig.parse({})).toEqual({});
  });

  it("takes a cap per attempt category and leaves the rest unset, so they keep their defaults", () => {
    expect(DeliveryConfig.parse({ budgets: { close: 2 } })).toEqual({ budgets: { close: 2 } });
    expect(DeliveryConfig.parse({ budgets: { correction: 5, gateError: 4, gateMaintenance: 3, terminus: 9, close: 2 } })).toEqual({
      budgets: { correction: 5, gateError: 4, gateMaintenance: 3, terminus: 9, close: 2 },
    });
  });

  it("never takes a used counter, which is the harness's own state", () => {
    expect(DeliveryConfig.safeParse({ budgets: { correction: { used: 0, max: 5 } } }).success).toBe(false);
  });
});

describe("what it says about a file it can't use", () => {
  it("names an unknown top-level key, and what the file does take", () => {
    expect(problemFor({ closr: { type: "merge-back" } })).toBe(
      "I can't use delivery.config.json: there's no setting called `closr`. A config file takes only `task`, `gate`, `closer` and `budgets`.",
    );
  });

  it("names an unknown budget key, and where it was", () => {
    expect(problemFor({ budgets: { corection: 5 } })).toBe(
      "I can't use delivery.config.json: there's no setting called `corection`. `budgets` doesn't take it.",
    );
  });

  it.each([["five"], [0], [-1], [2.5]])("names a limit that is not a whole number of attempts (%p)", (value) => {
    expect(problemFor({ budgets: { correction: value } })).toBe(
      `I can't use delivery.config.json: the limit \`budgets.correction\` is \`${JSON.stringify(value)}\`. A limit is a whole number of attempts, 1 or more.`,
    );
  });

  it("names a malformed value and the setting it belongs to", () => {
    expect(problemFor({ gate: { type: "command", command: "npm test", parseMode: "toml" } })).toContain(
      'I can\'t use delivery.config.json: the setting `gate.parseMode` is `"toml"`',
    );
  });

  it("names a setting given the wrong kind of value altogether", () => {
    expect(problemFor({ task: "add a goodbye function" })).toContain(
      'I can\'t use delivery.config.json: the setting `task` is `"add a goodbye function"`',
    );
  });

  it("answers an unknown closer type with the choices, not with a schema complaint", () => {
    expect(problemFor({ closer: { type: "teleport" } })).toBe(unknownCloser("teleport"));
  });
});

describe("unknownCloser", () => {
  it("lists the built-in choices and how to point at your own", () => {
    expect(unknownCloser("teleport")).toBe(
      "I don't know the closer type `teleport`. The built-in choices are `merge-back`, `commit-to-branch` and `open-pr`. " +
        'To use your own, put `{ "type": "custom", "modulePath": "./closers/mine.js" }` in delivery.config.json.',
    );
  });

  it("copes with a closer type that is not a string at all", () => {
    expect(unknownCloser(undefined)).toContain("I don't know that closer type.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL; `Cannot find module './config.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/config.ts`:

```ts
import { z } from "zod";
import { CloserRef, GateRef, TaskDef } from "../schema.js";

/** The one filename family a project uses, and the forms it may take. A `.js` or `.mjs` file exports the same object, for a project that computes a value. */
export const CONFIG_BASENAME = "delivery.config";
export const CONFIG_EXTENSIONS = [".json", ".js", ".mjs"] as const;

/** The four keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `gate`, `closer` and `budgets`";

/** The closer types a person can name without a module path of their own, from the library's own list so the two can never disagree. */
export const BUILT_IN_CLOSERS: string[] = CloserRef.options
  .map((option) => option.shape.type.value)
  .filter((type) => type !== "custom");

/** A closer type the harness does not know, answered with the choices rather than with a schema complaint. */
export function unknownCloser(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the closer type \`${type}\`` : "that closer type";
  const quoted = BUILT_IN_CLOSERS.map((choice) => `\`${choice}\``);
  const choices = `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
  return (
    `I don't know ${named}. The built-in choices are ${choices}. ` +
    `To use your own, put \`{ "type": "custom", "modulePath": "./closers/mine.js" }\` in ${CONFIG_BASENAME}.json.`
  );
}

/**
 * Caps only, one per attempt category, each optional and merged over the
 * default set. `used` is never here: usage is counted from the run's own log,
 * so a config file that could set it could lie about what a run had spent.
 */
export const Budgets = z
  .object({
    correction: z.number().int().positive(),
    gateError: z.number().int().positive(),
    gateMaintenance: z.number().int().positive(),
    terminus: z.number().int().positive(),
    close: z.number().int().positive(),
  })
  .partial()
  .strict();
export type Budgets = z.infer<typeof Budgets>;

/**
 * The whole of a `delivery.config.json`. `task`, `gate` and `closer` are the
 * library's own schemas, composed rather than restated, so the file can never
 * drift from what the harness accepts. `.strict()` on both objects means a typo
 * is named rather than silently ignored.
 */
export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
  })
  .strict();
export type DeliveryConfig = z.infer<typeof DeliveryConfig>;

/** The value the file actually held at an issue's path, so a complaint can quote it back. */
function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let here: unknown = raw;
  for (const step of path) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
}

/**
 * One plain-language sentence about the first thing wrong with a config file,
 * naming the key or the value. The first issue is enough: a person fixes one
 * thing and runs again, and a list of schema complaints is the stack trace this
 * command exists to avoid.
 */
export function describeProblem(file: string, error: z.ZodError, raw: unknown): string {
  const issue = error.issues[0];
  if (!issue) return `I can't use ${file}.`;
  const where = issue.path.join(".");

  if (issue.code === "unrecognized_keys") {
    const takes = where === "" ? `A config file takes only ${CONFIG_KEYS}.` : `\`${where}\` doesn't take it.`;
    return `I can't use ${file}: there's no setting called \`${issue.keys[0]}\`. ${takes}`;
  }
  if (where === "closer.type") return unknownCloser(valueAt(raw, issue.path));
  if (issue.path[0] === "budgets" && issue.path.length > 1) {
    return (
      `I can't use ${file}: the limit \`${where}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ` +
      `A limit is a whole number of attempts, 1 or more.`
    );
  }
  return `I can't use ${file}: the setting \`${where || "(the file itself)"}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\` (${issue.message}).`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Check types and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/cli/config.ts src/cli/config.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts
git commit -m "$(cat <<'EOF'
Add the delivery.config schema and its plain-language complaints

A project needs somewhere to say what checks its work and what happens to it
once checked. The schema composes the library's own TaskDef, GateRef and
CloserRef rather than restating them, so the file can never accept a shape the
harness would reject, and .strict() means a misspelt key is named instead of
silently ignored. An unknown closer type is answered with the list of choices,
because a schema complaint about a discriminated union tells a person nothing
they can act on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Finding and reading the config file ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/config.ts`
- Modify: `src/cli/config.test.ts`

**Interfaces:**
- Consumes: `CONFIG_BASENAME`, `CONFIG_EXTENSIONS`, `DeliveryConfig`, `describeProblem` from Task 1; `Refusal` and `EXIT` from `src/cli/failures.js`; `messageOf` from `src/gate-support.js`.
- Produces, from `src/cli/config.ts`:
  - `function NO_SUCH_CONFIG(file: string): string`
  - `function configCandidates(startDir: string, repoPath: string): string[]`
  - `function loadConfig(ctx: { startDir: string; repoPath: string; flag: string | undefined; env: NodeJS.ProcessEnv }): Promise<DeliveryConfig>`

- [ ] **Step 1: Write the failing test**

Append to `src/cli/config.test.ts`. First widen its existing `./config.js` import and add the node ones, so the file's import block reads:

```ts
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configCandidates, DeliveryConfig, describeProblem, loadConfig, NO_SUCH_CONFIG, unknownCloser } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
```

Then append:

```ts
/** A folder tree standing in for a checkout: `<parent>/repo/sub/deep`, with the repository root at `repo`. */
function tree(): { parent: string; repo: string; sub: string; deep: string } {
  const parent = mkdtempSync(join(tmpdir(), "config-tree-"));
  const repo = join(parent, "repo");
  const sub = join(repo, "sub");
  const deep = join(sub, "deep");
  mkdirSync(deep, { recursive: true });
  return { parent, repo, sub, deep };
}

const write = (dir: string, name: string, contents: string): string => {
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
};

/** Load the config a run would use, with nothing named on the command line or in the environment. */
const found = (startDir: string, repoPath: string, env: NodeJS.ProcessEnv = {}) =>
  loadConfig({ startDir, repoPath, flag: undefined, env });

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("finding a config file nobody named", () => {
  it("uses one in the folder the command was run from", async () => {
    const { repo, deep } = tree();
    write(deep, "delivery.config.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(deep, repo)).toEqual({ closer: { type: "merge-back" } });
  });

  it("walks up to the repository root to find one", async () => {
    const { repo, deep } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    expect(await found(deep, repo)).toEqual({ closer: { type: "open-pr" } });
  });

  it("prefers the nearest one", async () => {
    const { repo, sub, deep } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    write(sub, "delivery.config.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(deep, repo)).toEqual({ closer: { type: "merge-back" } });
  });

  it("stops at the repository root, so a stray file above it is never used", async () => {
    const { parent, repo, deep } = tree();
    write(parent, "delivery.config.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(deep, repo)).toEqual({});
    expect(configCandidates(deep, repo).every((candidate) => candidate.startsWith(repo))).toBe(true);
  });

  it("is not an error when there is no config file at all", async () => {
    const { repo, deep } = tree();
    expect(await found(deep, repo)).toEqual({});
  });
});

describe("reading a config file", () => {
  it("reads a .js module's default export", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.js", 'export default { budgets: { correction: 5 } };\n');
    expect(await found(repo, repo)).toEqual({ budgets: { correction: 5 } });
  });

  it("reads a .mjs module's default export", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.mjs", 'export default { closer: { type: "merge-back" } };\n');
    expect(await found(repo, repo)).toEqual({ closer: { type: "merge-back" } });
  });

  it("refuses a .json file that is not JSON, naming the file", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", "{ not json");
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toContain(`I can't read ${file}: it isn't valid JSON`);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses a file whose contents the harness can't use, naming the setting", async () => {
    const { repo } = tree();
    const file = write(repo, "delivery.config.json", JSON.stringify({ closr: 1 }));
    const refusal = await refusalOf(found(repo, repo));
    expect(refusal.message).toBe(
      `I can't use ${file}: there's no setting called \`closr\`. A config file takes only \`task\`, \`gate\`, \`closer\` and \`budgets\`.`,
    );
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});

describe("naming a config file yourself", () => {
  it("uses the file --config names, wherever it is", async () => {
    const { parent, repo } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    write(parent, "elsewhere.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await loadConfig({ startDir: repo, repoPath: repo, flag: join(parent, "elsewhere.json"), env: {} })).toEqual({
      closer: { type: "merge-back" },
    });
  });

  it("resolves a relative --config against the folder the command was run from", async () => {
    const { repo, deep } = tree();
    write(deep, "elsewhere.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await loadConfig({ startDir: deep, repoPath: repo, flag: "elsewhere.json", env: {} })).toEqual({
      closer: { type: "merge-back" },
    });
  });

  it("uses DELIVERY_CONFIG when no --config is given", async () => {
    const { parent, repo } = tree();
    const file = write(parent, "from-env.json", JSON.stringify({ closer: { type: "merge-back" } }));
    expect(await found(repo, repo, { DELIVERY_CONFIG: file })).toEqual({ closer: { type: "merge-back" } });
  });

  it("lets --config beat DELIVERY_CONFIG", async () => {
    const { parent, repo } = tree();
    const fromEnv = write(parent, "from-env.json", JSON.stringify({ closer: { type: "merge-back" } }));
    const fromFlag = write(parent, "from-flag.json", JSON.stringify({ closer: { type: "open-pr" } }));
    expect(await loadConfig({ startDir: repo, repoPath: repo, flag: fromFlag, env: { DELIVERY_CONFIG: fromEnv } })).toEqual({
      closer: { type: "open-pr" },
    });
  });

  it("treats DELIVERY_CONFIG set to nothing as not set, and goes on looking", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    expect(await found(repo, repo, { DELIVERY_CONFIG: "" })).toEqual({ closer: { type: "open-pr" } });
  });

  it("refuses a named file that isn't there, rather than quietly falling back to discovery", async () => {
    const { repo } = tree();
    write(repo, "delivery.config.json", JSON.stringify({ closer: { type: "open-pr" } }));
    const refusal = await refusalOf(loadConfig({ startDir: repo, repoPath: repo, flag: "missing.json", env: {} }));
    expect(refusal.message).toBe(NO_SUCH_CONFIG("missing.json"));
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/config.test.ts`
Expected: FAIL; `config.js` exports no `loadConfig`, `configCandidates` or `NO_SUCH_CONFIG`.

- [ ] **Step 3: Write the implementation**

In `src/cli/config.ts`, add these imports above the existing `zod` import:

```ts
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
```

and below the `zod` import:

```ts
import { messageOf } from "../gate-support.js";
import { EXIT, Refusal } from "./failures.js";
```

Append to the end of `src/cli/config.ts`:

```ts
export const NO_SUCH_CONFIG = (file: string): string =>
  `I couldn't find the config file \`${file}\`. Check the path, or leave it out and I'll look for a ${CONFIG_BASENAME}.json next to your code.`;

/** A real path, so a folder reached through a symlink still matches the repository root the walk stops at. */
function realOf(path: string): string {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

/**
 * Every place a config file could be, nearest first: the folder the command was
 * run from and each folder above it, stopping at the repository root. Nothing
 * above the repository is considered, so one project's settings can never leak
 * into another's.
 */
export function configCandidates(startDir: string, repoPath: string): string[] {
  const paths: string[] = [];
  const top = realOf(repoPath);
  let dir = realOf(startDir);
  for (;;) {
    for (const extension of CONFIG_EXTENSIONS) paths.push(join(dir, CONFIG_BASENAME + extension));
    if (dir === top || dirname(dir) === dir) break;
    dir = dirname(dir);
  }
  return paths;
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, "utf-8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Refusal(`I can't read ${file}: it isn't valid JSON (${messageOf(err)}).`, EXIT.configuration);
  }
}

/**
 * The settings a run starts from: the file the user named, or the nearest one
 * at or above the folder they ran in, or nothing at all, which is not an error
 * because every setting has a default.
 */
export async function loadConfig({
  startDir,
  repoPath,
  flag,
  env,
}: {
  startDir: string;
  repoPath: string;
  flag: string | undefined;
  env: NodeJS.ProcessEnv;
}): Promise<DeliveryConfig> {
  // An empty DELIVERY_CONFIG is CI writing an input nobody filled in: not a
  // file called "", and not a reason to refuse before discovery has run.
  const named = flag ?? (env.DELIVERY_CONFIG || undefined);
  let file: string | undefined;
  if (named !== undefined) {
    file = resolve(startDir, named);
    if (!existsSync(file)) throw new Refusal(NO_SUCH_CONFIG(named), EXIT.configuration);
  } else {
    file = configCandidates(startDir, repoPath).find((candidate) => existsSync(candidate));
    if (file === undefined) return {};
  }

  const raw = file.endsWith(".json")
    ? await readJson(file)
    : ((await import(pathToFileURL(file).href)) as { default?: unknown }).default;
  const parsed = DeliveryConfig.safeParse(raw);
  if (!parsed.success) throw new Refusal(describeProblem(file, parsed.error, raw), EXIT.configuration);
  return parsed.data;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Check types and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/cli/config.ts src/cli/config.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/config.ts src/cli/config.test.ts
git commit -m "$(cat <<'EOF'
Find and read a project's delivery.config file

A config file only saves anyone effort if they never have to name it, so the
command walks up from where it was run to the repository root, taking the
nearest file it finds, and stops there rather than reaching into a parent
project's settings. Discovery is existsSync and dirname, and loading is
JSON.parse or a dynamic import, because one filename family in two formats does
not need a multi-format config loader. A file the user did name and that is not
there is a refusal, not a quiet fall back to discovery, which would run with
settings they did not ask for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Which setting wins: flag, then environment, then file, then default ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/settings.ts`
- Create: `src/cli/settings.test.ts`
- Modify: `src/cli/project.ts` (the `NO_CHECK` message)
- Modify: `src/cli/run-command.ts` (re-export `NO_TASK` from its new home)

**Interfaces:**
- Consumes: `DeliveryConfig`, `unknownCloser` from `src/cli/config.ts`; `inferGate` from `src/cli/project.ts`; `DEFAULT_BUDGETS` from `src/budgets.ts`; `CloserRef` (schema), `BudgetSet`, `GateRef`, `TaskDef` (types) from `src/schema.ts`; `EXIT`, `Refusal` from `src/cli/failures.ts`.
- Produces, from `src/cli/settings.ts`:
  - `const NO_TASK: string`, `const BOTH_TASKS: string`, `function NO_TASK_FILE(path: string): string`
  - `const DEFAULT_CLOSER: CloserRef`
  - `interface RunFlags { task?: string; taskFile?: string; gateCommand?: string; closer?: string; config?: string; repo?: string }`
  - `interface Settings { taskDef: TaskDef; gateRef: GateRef; closerRef: CloserRef; budgets: BudgetSet }`
  - `function taskIntent(taskDef: TaskDef): string`
  - `function resolveSettings(flags: RunFlags, ctx: { env: NodeJS.ProcessEnv; cwd: string; repoPath: string; config: DeliveryConfig }): Promise<Settings>`

- [ ] **Step 1: Write the failing test**

Create `src/cli/settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/settings.test.ts`
Expected: FAIL; `Cannot find module './settings.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/settings.ts`:

```ts
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { CloserRef } from "../schema.js";
import type { BudgetSet, GateRef, TaskDef } from "../schema.js";
import { unknownCloser, type DeliveryConfig } from "./config.js";
import { EXIT, Refusal } from "./failures.js";
import { inferGate } from "./project.js";

export const NO_TASK = 'Tell me what to do: add `--task "describe the change you want"`.';

export const BOTH_TASKS = "Use either `--task` or `--task-file`, not both: I can't tell which one you mean.";

export const NO_TASK_FILE = (path: string): string =>
  `I couldn't read the task file \`${path}\`. Check the path, or give the task on the command line with \`--task "..."\`.`;

/** The one closer a run uses when nothing else is configured: it needs only git, and leaves a branch to inspect before trusting it. */
export const DEFAULT_CLOSER: CloserRef = { type: "commit-to-branch" };

/** What `delivery run` was given on the command line. */
export interface RunFlags {
  task?: string;
  taskFile?: string;
  gateCommand?: string;
  closer?: string;
  config?: string;
  repo?: string;
}

/** Everything a run needs to be created, once every source of settings has had its say. */
export interface Settings {
  taskDef: TaskDef;
  gateRef: GateRef;
  closerRef: CloserRef;
  budgets: BudgetSet;
}

/** The task's own words, for the run's id and the line that announces it. A task is opaque to the harness, so one shaped another way still gets a run. */
export function taskIntent(taskDef: TaskDef): string {
  return typeof taskDef.intent === "string" && taskDef.intent.trim() !== "" ? taskDef.intent.trim() : "run";
}

async function taskFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig, cwd: string): Promise<TaskDef> {
  if (flags.task !== undefined && flags.taskFile !== undefined) throw new Refusal(BOTH_TASKS, EXIT.configuration);

  let fromFile: string | undefined;
  if (flags.taskFile !== undefined) {
    try {
      fromFile = (await readFile(resolve(cwd, flags.taskFile), "utf-8")).trim();
    } catch {
      throw new Refusal(NO_TASK_FILE(flags.taskFile), EXIT.configuration);
    }
  }

  const intent = (flags.task ?? fromFile ?? env.DELIVERY_TASK)?.trim();
  if (intent) return { intent };
  if (config.task) return config.task;
  throw new Refusal(NO_TASK, EXIT.configuration);
}

/**
 * An environment variable set to nothing is not set. CI writes
 * `DELIVERY_CLOSER=` for an input nobody filled in, and taking that literally
 * would refuse the run over a closer type of `""` or check the work with an
 * empty command, in both cases ignoring the file the project checked in.
 */
const fromEnv = (value: string | undefined): string | undefined => value || undefined;

async function gateFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig, repoPath: string): Promise<GateRef> {
  const command = flags.gateCommand ?? fromEnv(env.DELIVERY_GATE_COMMAND);
  // `exitcode` is the only parse mode that assumes nothing about the command's output,
  // so it is the one a flag can safely stand for; the rest are named in the file.
  if (command !== undefined) return { type: "command", command, parseMode: "exitcode" };
  return config.gate ?? (await inferGate(repoPath));
}

function closerFrom(flags: RunFlags, env: NodeJS.ProcessEnv, config: DeliveryConfig): CloserRef {
  const named = flags.closer ?? fromEnv(env.DELIVERY_CLOSER);
  if (named === undefined) return config.closer ?? DEFAULT_CLOSER;
  // A type with no required fields parses on its own; `custom` does not, because it
  // needs a module path, which is what the config file is for.
  const parsed = CloserRef.safeParse({ type: named });
  if (!parsed.success) throw new Refusal(unknownCloser(named), EXIT.configuration);
  return parsed.data;
}

/** The default caps with whichever ones the project set laid over them. Nothing is used yet: usage is counted from the run's log. */
function budgetsFrom(config: DeliveryConfig): BudgetSet {
  const set = { ...DEFAULT_BUDGETS };
  for (const [population, max] of Object.entries(config.budgets ?? {})) {
    if (max !== undefined) set[population as keyof BudgetSet] = { used: 0, max };
  }
  return set;
}

/**
 * What this run will use, from every source that has a say: a flag beats an
 * environment variable, which beats the config file, which beats the built-in
 * default. Everything that can refuse does so here, before the run's record or
 * its working copy exists.
 */
export async function resolveSettings(
  flags: RunFlags,
  { env, cwd, repoPath, config }: { env: NodeJS.ProcessEnv; cwd: string; repoPath: string; config: DeliveryConfig },
): Promise<Settings> {
  return {
    taskDef: await taskFrom(flags, env, config, cwd),
    gateRef: await gateFrom(flags, env, config, repoPath),
    closerRef: closerFrom(flags, env, config),
    budgets: budgetsFrom(config),
  };
}
```

In `src/cli/project.ts`, replace the `NO_CHECK` constant with the message this slice makes true (the flag it names now exists):

```ts
export const NO_CHECK =
  "I couldn't find a command to check the agent's work with. Tell me what marks a change as good, for example " +
  '`--gate-command "npm test"`, or add a `test` script to your `package.json`.';
```

In `src/cli/run-command.ts`, delete the `NO_TASK` constant and re-export it from its new home, so the existing tests and any later command keep one import path for it. Replace:

```ts
export const NO_TASK = 'Tell me what to do: add `--task "describe the change you want"`.';
```

with:

```ts
import { NO_TASK } from "./settings.js";
export { NO_TASK };
```

An `export … from` alone would not compile here: `runCommand` still refers to `NO_TASK` by name until Task 6 moves that refusal into the resolver, and a bare re-export creates no local binding. Task 6 collapses this pair back to `export { NO_TASK } from "./settings.js";` once the throw site is gone.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/settings.test.ts src/cli/project.test.ts`
Expected: PASS. (`project.test.ts` asserts against the `NO_CHECK` constant, so the new wording passes unchanged.)

- [ ] **Step 5: Check types and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/cli/settings.ts src/cli/settings.test.ts src/cli/project.ts src/cli/run-command.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/settings.ts src/cli/settings.test.ts src/cli/project.ts src/cli/run-command.ts
git commit -m "$(cat <<'EOF'
Resolve a run's task, check, closer and limits from every source that has a say

Settings that belong to a project belong in a file beside its code, but any of
them may need overriding for one run, so a flag beats an environment variable,
which beats the file, which beats the built-in default: the order comparable
tools follow, which lets a checked-in file serve CI and a person's one-off run
alike. Every refusal lives here, before the run's record or working copy exists,
so a mistake leaves the repository exactly as it was. A closer named on the
command line is parsed by the library's own schema rather than checked against a
second list, which is why `custom` is refused there: it needs a module path, and
the file is where a module path goes.

The "no check" message now names --gate-command, which did not exist when it was
written.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: A custom gate or closer that cannot be loaded stops the command before it starts ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/settings.ts`
- Modify: `src/cli/settings.test.ts`

**Interfaces:**
- Consumes: `loadCustomGate` from `src/custom-gate.js`, `loadCustomCloser` from `src/custom-closer.js` (both throw `GateModuleLoadFailure` / `InvalidGateExport` / `CloserModuleLoadFailure` / `InvalidCloserExport`, which `renderFailure` in `src/cli/failures.ts` already renders with the module path and the matching guide).
- Produces: `function checkCustomModules(gateRef: GateRef, closerRef: CloserRef, repoPath: string): Promise<void>` from `src/cli/settings.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/cli/settings.test.ts`. First widen its two existing imports rather than adding second ones from the same modules:

```ts
import { EXIT, Refusal, renderFailure } from "./failures.js";
import { BOTH_TASKS, checkCustomModules, NO_TASK, NO_TASK_FILE, resolveSettings, taskIntent, type RunFlags } from "./settings.js";
```

Then append:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/settings.test.ts`
Expected: FAIL; `settings.js` exports no `checkCustomModules`.

- [ ] **Step 3: Write the implementation**

In `src/cli/settings.ts`, add these imports below the existing `node:path` import:

```ts
import { loadCustomCloser } from "../custom-closer.js";
import { loadCustomGate } from "../custom-gate.js";
```

and append to the end of the file:

```ts
/**
 * Load a custom gate or closer now, rather than when the run first needs it.
 * Resolution is deliberately total in the library, so a module that cannot be
 * loaded becomes an ERROR report and the run spends a budget finding out. On the
 * command line that is the wrong shape: a wrong path is a mistake in the
 * project's configuration, so it stops the command before anything is
 * provisioned, with the path and the guide named. Loading twice costs nothing:
 * Node caches the module.
 */
export async function checkCustomModules(gateRef: GateRef, closerRef: CloserRef, repoPath: string): Promise<void> {
  if (gateRef.type === "custom") await loadCustomGate(repoPath, gateRef.modulePath, gateRef.exportName);
  if (closerRef.type === "custom") await loadCustomCloser(repoPath, closerRef.modulePath, closerRef.exportName);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Check types and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/cli/settings.ts src/cli/settings.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/settings.ts src/cli/settings.test.ts
git commit -m "$(cat <<'EOF'
Load a custom gate or closer before the run starts

The library resolves a gate or closer reference totally, so a module that cannot
be loaded becomes an ERROR report and the run discovers the mistake after
provisioning a working copy and spending a budget on it. That is right for a
running surface and wrong for a command line, where a wrong module path is a
mistake in the project's configuration and should stop the command with the path
and the guide named. Loading eagerly costs nothing at run time, because Node
caches the module the run then uses.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: A closed run says where the work actually went ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/outcome.ts`
- Modify: `src/cli/outcome.test.ts`

**Interfaces:**
- Consumes: `readRef` from `src/case-file.js`; `CloseReport` (zod) and `CloserRef`, `CaseFile` (types) from `src/schema.js`; `branchName` from `src/provision.js`.
- Produces: no new export. `summariseOutcome(dir, caseFile)` keeps its signature and `OutcomeSummary` shape; only what it says for a closed run changes, keyed on the closer the run pinned.

- [ ] **Step 1: Write the failing test**

In `src/cli/outcome.test.ts`, replace the `finishedRun` helper so a test can pin a different closer and record the closer's own report, and add the imports it needs. Change the import lines at the top to:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, load, setBaseBranch, setOutcome, writeRef } from "../case-file.js";
import type { CaseFileOutcome, CloserRef } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import { EXIT } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
```

and replace the `finishedRun` helper with:

```ts
/** A finished run's record, as the run loop leaves it: the closer it was started with, and what that closer reported. */
async function finishedRun(
  outcome: (dir: string) => Promise<CaseFileOutcome>,
  { closerRef = { type: "commit-to-branch" }, closeDetail }: { closerRef?: CloserRef; closeDetail?: string } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "outcome-"));
  await create(
    dir,
    {
      surfaceId: RUN_ID,
      taskDef: { intent: "add a hello function" },
      gateRef: { type: "command", command: "npm test", parseMode: "exitcode" },
      closerRef,
    },
    DEFAULT_BUDGETS,
  );
  await setBaseBranch(dir, "main");
  if (closeDetail !== undefined) {
    const detailRef = await writeRef(dir, "close-0", { status: "DONE", detail: closeDetail });
    await appendEntry(dir, { t: "close", status: "DONE", detailRef });
  }
  await setOutcome(dir, await outcome(dir));
  return { dir, caseFile: await load(dir) };
}
```

Then append this describe block at the end of the file:

```ts
const closed = async (): Promise<CaseFileOutcome> => ({ kind: "closed", source: "closer", reason: "committed", at: AT });

describe("where a closed run says its work went", () => {
  it("names the branch, and says the base branch is untouched, for a run committed to a branch", async () => {
    const { dir, caseFile } = await finishedRun(closed, { closerRef: { type: "commit-to-branch" } });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe(
      `Done: the change for "add a hello function" passed \`npm test\` and is committed on branch surface/${RUN_ID}.`,
    );
    expect(summary.details).toEqual([`main was not changed. To look at the work: git log surface/${RUN_ID}`]);
  });

  it("says the work is on the base branch for a run that merged back", async () => {
    const { dir, caseFile } = await finishedRun(closed, { closerRef: { type: "merge-back" } });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe('Done: the change for "add a hello function" passed `npm test` and is merged into main.');
    expect(summary.details).toEqual(["To look at the work: git log main"]);
    expect(summary.exitCode).toBe(EXIT.ok);
  });

  it("gives the pull request's address for a run that opened one", async () => {
    const { dir, caseFile } = await finishedRun(closed, {
      closerRef: { type: "open-pr" },
      closeDetail: "https://github.com/me/project/pull/7",
    });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe(
      `Done: the change for "add a hello function" passed \`npm test\` and is on branch surface/${RUN_ID}, with a pull request open.`,
    );
    expect(summary.details).toEqual(["The pull request: https://github.com/me/project/pull/7"]);
  });

  it("repeats a custom closer's own report, because only it knows what it did", async () => {
    const { dir, caseFile } = await finishedRun(closed, {
      closerRef: { type: "custom", modulePath: "./closers/notify.mjs" },
      closeDetail: "Told the release channel and tagged v2.",
    });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe('Done: the change for "add a hello function" passed `npm test` and your own closer finished it.');
    expect(summary.details).toEqual(["Your closer says: Told the release channel and tagged v2."]);
  });

  it("still says something useful when a closer left no readable report", async () => {
    const { dir, caseFile } = await finishedRun(closed, { closerRef: { type: "open-pr" } });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.details).toEqual([`main was not changed. To look at the work: git log surface/${RUN_ID}`]);
  });

  it("speaks as if the work were committed to a branch for a run that pinned no closer at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outcome-no-closer-"));
    await create(
      dir,
      { surfaceId: RUN_ID, taskDef: { intent: "add a hello function" }, gateRef: { type: "command", command: "npm test", parseMode: "exitcode" } },
      DEFAULT_BUDGETS,
    );
    await setBaseBranch(dir, "main");
    await setOutcome(dir, await closed());
    const summary = await summariseOutcome(dir, await load(dir));
    expect(summary.headline).toContain(`is committed on branch surface/${RUN_ID}.`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/outcome.test.ts`
Expected: FAIL; the merge-back, open-pr and custom runs all say "is committed on branch surface/...".

- [ ] **Step 3: Write the implementation**

In `src/cli/outcome.ts`, replace the line

```ts
import type { CaseFile } from "../schema.js";
```

with

```ts
import { CloseReport } from "../schema.js";
import type { CaseFile, CloserRef } from "../schema.js";
```

Add these two functions above `summariseOutcome`:

```ts
/** What the run's last close reported, for the closers whose result only they can describe. */
async function closeDetail(dir: string, caseFile: CaseFile): Promise<string | undefined> {
  const entry = caseFile.history.findLast((historyEntry) => historyEntry.t === "close");
  if (entry?.status !== "DONE") return undefined;
  const parsed = CloseReport.safeParse(await readRef(dir, entry.detailRef));
  return parsed.success ? parsed.data.detail : undefined;
}

/**
 * Where the work ended up, which is a different sentence for each closing
 * action: committed to its own branch, merged into the base branch, or left on a
 * branch with a pull request open. Total over the closer types, so a new one
 * does not compile until it can say where it put the work. A run that pinned no
 * closer predates closers being pinned, and was committed to its branch.
 */
function landing(
  closerRef: CloserRef | undefined,
  { branch, base, detail }: { branch: string; base: string; detail: string | undefined },
): { where: string; details: string[] } {
  const onItsBranch = {
    where: `is committed on branch ${branch}`,
    details: [`${base} was not changed. To look at the work: git log ${branch}`],
  };
  switch (closerRef?.type) {
    case undefined:
    case "commit-to-branch":
      return onItsBranch;
    case "merge-back":
      return { where: `is merged into ${base}`, details: [`To look at the work: git log ${base}`] };
    case "open-pr":
      return detail === undefined
        ? { where: `is on branch ${branch}, with a pull request open`, details: onItsBranch.details }
        : { where: `is on branch ${branch}, with a pull request open`, details: [`The pull request: ${detail}`] };
    case "custom":
      return {
        where: "your own closer finished it",
        details: detail === undefined ? [] : [`Your closer says: ${detail}`],
      };
  }
}
```

and replace the `case "closed":` arm of `summariseOutcome` with:

```ts
    case "closed": {
      const { closerRef } = caseFile.header;
      const needsDetail = closerRef?.type === "open-pr" || closerRef?.type === "custom";
      const { where, details } = landing(closerRef, {
        branch,
        base,
        detail: needsDetail ? await closeDetail(dir, caseFile) : undefined,
      });
      return {
        headline: `Done: the change for "${intentOf(caseFile)}" passed ${checkOf(caseFile)} and ${where}.`,
        tone: "done",
        details,
        exitCode: EXIT.ok,
      };
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/outcome.test.ts`
Expected: PASS.

- [ ] **Step 5: Check types and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/cli/outcome.ts src/cli/outcome.test.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/cli/outcome.ts src/cli/outcome.test.ts
git commit -m "$(cat <<'EOF'
Say where a closed run's work actually went, per closing action

The closing sentence told every run it was committed on its own branch and the
base branch untouched, which was true while committing to a branch was the only
closing action anyone could choose. Now that a project can ask for a merge back
or a pull request, that sentence would be a lie in exactly the moment a person
is deciding whether to trust the harness. The lookup is total over the closer
types, so a new closing action cannot be added without saying where it puts the
work, and a pull request or a custom closer quotes its own report rather than
having its result guessed at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `delivery run` takes its settings from the file, the flags and the environment ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/cli/program.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/cli/run-command.test.ts`
- Modify: `README.md`
- Modify: `docs/writing-a-gate.md`
- Modify: `docs/writing-a-closer.md`

**Interfaces:**
- Consumes: `loadConfig` from `src/cli/config.js`; `checkCustomModules`, `resolveSettings`, `taskIntent`, `RunFlags` from `src/cli/settings.js`; everything `run-command.ts` already uses.
- Produces: `RunOptions` in `src/cli/run-command.ts` becomes an alias of `RunFlags`, so the commander action and the resolver cannot drift apart.

- [ ] **Step 1: Write the failing test**

Append to `src/cli/run-command.test.ts`. First widen its existing `node:fs` import and add two new ones, so those lines read:

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { unknownCloser } from "./config.js";
import { BOTH_TASKS } from "./settings.js";
```

(`join`, `tmpdir` and the `git`, `delivery`, `scriptFile`, `branchIn`, `completes`, `PACKAGE`, `TASK` and `RUN_TIMEOUT` helpers are already in this file.)

Then append:

```ts
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
    RUN_TIMEOUT,
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
    RUN_TIMEOUT,
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
    RUN_TIMEOUT,
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
  }, RUN_TIMEOUT);

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
  }, RUN_TIMEOUT);

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/run-command.test.ts`
Expected: FAIL; the config file is ignored, so the merge-back run commits to a branch, the unknown closer is never noticed, and `--task-file`, `--gate-command`, `--closer` and `--config` are rejected as unknown options.

- [ ] **Step 3: Write the implementation**

In `src/cli/program.ts`, add the four options to the `run` command, between `--task` and `--repo`, and change the `run` description's closing clause, which promises one closing action:

```ts
    .description("start a run: the agent works on the task, your check decides whether it is good, and the result is delivered the way your config file asks (by default, committed to a new branch)")
    .option("--task <text>", "what you want done, in plain English")
    .option("--task-file <path>", "read what you want done from a file")
    .option("--gate-command <command>", "the command that checks the agent's work: it passes when the command exits 0")
    .option("--closer <type>", "what happens to accepted work: commit-to-branch, merge-back or open-pr")
    .option("--config <path>", "use this config file instead of looking for a delivery.config.json")
    .option("--repo <path>", "the git repository to work on (default: the current folder)")
```

In `src/cli/run-command.ts`, replace the imports of `DEFAULT_BUDGETS`, `CloserRef` and `inferGate`, and the `RunOptions` interface, with the settings modules. The import block becomes:

```ts
import { resolve } from "node:path";
import { createAgentPort } from "../agent-invoke.js";
import { create, load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { SurfacePorts } from "../ports.js";
import { agentSession } from "./agent-session.js";
import { loadConfig } from "./config.js";
import { type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { createProgress, paint } from "./output.js";
import { findRepository, hasUncommittedChanges, UNCOMMITTED_NOTE } from "./project.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";
import { checkCustomModules, resolveSettings, taskIntent, type RunFlags } from "./settings.js";

export { NO_TASK } from "./settings.js";

/** What `delivery run` was given on the command line: the flags the settings resolver reads, and nothing else. */
export type RunOptions = RunFlags;
```

and replace the body of `runCommand` down to the `Starting run` line with:

```ts
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const { taskDef, gateRef, closerRef, budgets } = await resolveSettings(options, {
    env: ctx.env,
    cwd: ctx.cwd,
    repoPath,
    config,
  });
  await checkCustomModules(gateRef, closerRef, repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.writeLine(UNCOMMITTED_NOTE);

  const intent = taskIntent(taskDef);
  const runId = runIdFor(intent, new Date());
  const { dir, location } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  await create(dir, { surfaceId: runId, taskDef, gateRef, closerRef }, budgets);
  ctx.writeLine(`Starting run ${runId}: ${intent}`);
```

and change the ports line further down to use the resolved closer:

```ts
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer: resolveCloser(closerRef, repoPath) };
```

Also update the doc comment above `runCommand`, whose first line says "resolve the defaults":

```ts
/**
 * `delivery run`: work out what this run should do from the project's config
 * file, the flags and the environment, check the agent can start, then drive one
 * run to its end, one plain-language line per step.
 *
 * Every check that can refuse runs before anything is written, so a refusal
 * leaves the repository exactly as it was.
 */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/cli/run-command.test.ts`
Expected: PASS, including the slice 1 tests already in the file.

- [ ] **Step 5: Update the README**

In `README.md`, first qualify the two places that state one closing action as fact. In "Run a task from the command line", change "and commits the work to a new branch; your base branch is not touched" to "and, unless you configure otherwise, commits the work to a new branch without touching your base branch"; in the exit-code table, change row `0` to "The run finished and the work was delivered". Then insert this section immediately after that section (before `## Documentation`):

````markdown
## Configure it once

Settings that belong to a project live in a `delivery.config.json` beside your code. The
command looks for one in the folder you run from and each folder above it, up to the top of
the repository, so you never have to name it. A `delivery.config.js` or `.mjs` exporting the
same object works too, for a project that needs to compute a value.

```json
{
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "merge-back" },
  "budgets": { "correction": 5 }
}
```

| Setting | What it says |
|---|---|
| `task` | What you want done, when it is the same every run |
| `gate` | What decides whether a change is good: see [Writing a gate](docs/writing-a-gate.md) |
| `closer` | What happens to accepted work: see [Writing a closer](docs/writing-a-closer.md) |
| `budgets` | How many attempts each kind of setback gets before the run asks a person: `correction`, `gateError`, `gateMaintenance`, `terminus` and `close`, each a whole number. Anything you leave out keeps its default (3, 3, 2, 5 and 3). |

A gate or closer of your own is named here rather than on the command line, because it needs a
module path: `{ "type": "custom", "modulePath": "./gates/mine.mjs" }`.

For a single run, a flag or an environment variable overrides the file. A flag beats an
environment variable, which beats the file, which beats the built-in default.

| Flag | Environment variable | What it sets |
|---|---|---|
| `--task "..."` or `--task-file <path>` | `DELIVERY_TASK` | What you want done |
| `--gate-command "npm test"` | `DELIVERY_GATE_COMMAND` | A check that passes when the command exits 0 |
| `--closer commit-to-branch` | `DELIVERY_CLOSER` | What happens to accepted work: `commit-to-branch`, `merge-back` or `open-pr` |
| `--config <path>` | `DELIVERY_CONFIG` | A config file somewhere else |

An unknown setting, a limit that is not a whole number, a closer type the harness doesn't know
or a custom module it can't load all stop the command before it starts, naming what to fix.
````

- [ ] **Step 6: Update the two extender guides**

In `docs/writing-a-gate.md`, after the paragraph beginning "`exportName` selects a named export instead of `default`", insert:

````markdown
From the command line, the same shape goes in `delivery.config.json` under `gate`, so a project
names its gate once and writes no wiring code:

```json
{ "gate": { "type": "custom", "modulePath": "./gates/json-gate.mjs" } }
```

`delivery run` loads the module before it starts, so a wrong path, or an export missing
`baseline` or `check`, stops the command with the path named rather than failing part way
through a run.
````

In `docs/writing-a-closer.md`, after the paragraph beginning "A `closerRef` the harness cannot understand", insert:

````markdown
From the command line, the same shape goes in `delivery.config.json` under `closer`, and
`--closer` names one of the three built-in types for a single run:

```json
{ "closer": { "type": "custom", "modulePath": "closers/notify.mjs" } }
```

`delivery run` checks the closer before it starts rather than letting it become an `"ERROR"`
report: an unknown type stops the command listing the choices, and a custom module it cannot
load stops it with the path named.
````

- [ ] **Step 7: Check types and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/cli tests`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/cli/program.ts src/cli/run-command.ts src/cli/run-command.test.ts README.md docs/writing-a-gate.md docs/writing-a-closer.md
git commit -m "$(cat <<'EOF'
Take a run's settings from the project's config file, flags and environment

delivery run had its check, closer and limits wired in, which was enough to
prove the loop but left an extender with nothing to say. It now asks the config
file, the flags and the environment in that order of authority, so a project
records how its work is checked and delivered once, beside its code, and a
person overrides any of it for one run without editing the file. The run pins
whatever it resolved into its own record, so what a run was asked to do stays
readable afterwards.

The README gains the file, the flags and the precedence order, and the gate and
closer guides say where their shapes go on the command line, because both
previously described a library caller building a header by hand.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```
