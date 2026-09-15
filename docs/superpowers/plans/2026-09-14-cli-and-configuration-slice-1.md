# CLI and Configuration — Slice 1: Run a Task From the Command Line With Nothing Configured

> **Status:** ✅ Complete — 2026-09-15 — `6c490c9`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-14-cli-and-configuration-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`

**Goal:** Ship a compiled `delivery` command whose `run --task "..."` drives one surface to its end in any git repository with a `test` script, with plain-language progress, a plain-language outcome, six distinct exit codes, and nothing to configure; plus a sample project to try it on.

**Architecture:** A thin command layer in `src/cli/` over the existing library, with no library behaviour changed. `program.ts` (commander) parses arguments and turns every failure into one rendered message and exit code; `run-command.ts` resolves the defaults (repository, `npm test` gate, `commit-to-branch` closer, `DEFAULT_BUDGETS`), runs the agent-runtime preflight, writes the run's record under `<repo>/.delivery/runs/<run-id>/` and loops `advance` with a line renderer. Each concern the command needs sits in its own small module with its own unit tests (`failures`, `output`, `project`, `run-location`, `agent-session`, `outcome`); `main.ts` is the only file that touches the real process. The build is plain `tsc` into `dist/`, following `vendor/claude-mock`.

**Tech Stack:** Node ≥ 22 (`node:util` `styleText`, `node:child_process`, `node:module` `createRequire`), TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), commander 14, zod 4, vitest 5, git, `@anthropic-ai/claude-agent-sdk` 0.3.x and its bundled Claude Code binary, the vendored `@jorj/claude-mock`.

## Global Constraints

- **Buy-vs-build (Build note, verbatim):** "Compile with the TypeScript compiler already in the project, following the vendored claude-mock package's precedent; no bundler. Use commander for argument parsing and help. Terminal progress is a small line renderer, not ora or listr2. The default budget set is the literal the demos already share, lifted once into an exported library constant rather than invented." Also from the spec: reuse `zod` for any parsing of external JSON; plain-language error mapping is a lookup keyed on the existing error `code`s; the worktree location reuses the estate's autoloop convention.
- **Operability / DX (Operational note, verbatim):** "This slice introduces a compiled build of the harness with a runnable `delivery` command, and a regression harness that drives the compiled command against scratch repositories with the agent routed to the vendored scripted agent through a contributor-only test seam (documented for contributors, never shown in the command's help). CI must build before those tests run. Runs keep their record inside the repository in a self-ignoring folder and their working copy outside the repository under the user's state directory, following the estate's autoloop convention."
- **commander `^14`, not 15:** commander 15 requires Node ≥ 22.12; `package.json` `engines` stays `">=22"`. Verified: 14.0.3 gives `exitOverride` codes (help and version exit 0; unknown option or command exit 1, mapped here to 2), `optsWithGlobals()` for `--no-color` either side of `run`, and `configureHelp({ showGlobalOptions: true })` to show `--no-color` in `run --help`.
- **Exit codes (spec, verbatim):** "`0` closed, `1` unexpected/internal error, `2` configuration or input problem, `3` agent runtime precondition unmet, `4` run escalated (needs a human), `5` run aborted." In code: `EXIT = { ok: 0, unexpected: 1, configuration: 2, agentRuntime: 3, escalated: 4, aborted: 5 }`. `ok` rather than `closed`, because help and version also exit 0.
- **The agent runtime is the SDK's bundled binary, not `claude` on `PATH`.** SDK 0.3.266 launches `@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude` from its optional dependencies, so the spec's "`claude` executable on PATH" premise is out of date. The command resolves that binary the way the SDK does, passes it explicitly as `pathToClaudeCodeExecutable` (so the binary checked is the binary launched), and asks it `auth status --json` (`{ "loggedIn": boolean }`, exit 1 when signed out; covers an API key, an OAuth token and a stored login). Verified against the installed runtime with an empty `HOME`/`CLAUDE_CONFIG_DIR` and with each credential variable. This also settles the spec's open question 4 (detecting a stored login) by asking the runtime instead of guessing where it keeps its login.
- **Copy (spec, adjusted only where the spec is wrong for this slice):** "Every message names the problem and the fix without harness vocabulary ("worktree", "envelope", "surface", a state name)." No em-dashes in any user-facing string or doc. Deliberate differences from the spec's table: the missing-runtime message names the bundled runtime and `--omit=optional` (there is no separate install); the sign-in message says `claude auth login` (`claude login` is not a command of the current runtime, checked with `claude auth --help`); the no-check message does not mention `--gate-command` because that flag arrives in slice 2, which updates the message.
- **Exact user-facing strings are constants the tests import:** `NOT_A_REPOSITORY`, `NO_CHECK`, `UNCOMMITTED_NOTE` (`src/cli/project.ts`), `NO_RUNTIME`, `NOT_SIGNED_IN` (`src/cli/agent-session.ts`), `NO_TASK` (`src/cli/run-command.ts`), `UNEXPECTED_FOOTER` (`src/cli/failures.ts`).
- **Refusal ordering:** repository, then task, then gate inference, then the agent runtime preflight, then the uncommitted-changes note, and only then is anything written. A refusal leaves the repository exactly as it was.
- **Contributor test seam:** environment variable `DELIVERY_TEST_MOCK_SCRIPT` names a claude-mock script; the journal goes to `<script>.journal.jsonl`; the preflight is skipped. Documented in `CONTRIBUTING.md`, never in `--help` (a test asserts its absence).
- **Places:** record at `<repo>/.delivery/runs/<run-id>/`, with `<repo>/.delivery/.gitignore` containing `*` (self-ignoring; the repository's own `.gitignore` is never touched). Working copy at `$XDG_STATE_HOME/delivery-service/worktrees/<repo-key>/<run-id>` (fallback `~/.local/state`), where `<repo-key>` is autoloop's target-key rule from `lib/target-key.sh`: drop the leading `/`, map `[^A-Za-z0-9_.]` to `-`. Run id: first five lower-case words of the task joined by `-` (or `run`), then `-YYYYMMDDTHHMMSSZ`.
- **`DEFAULT_BUDGETS`** is `correction 3, gateError 3, gateMaintenance 2, terminus 5, close 3`, all `used: 0`. The existing tests, demos and guides keep their explicit literals: a test should state its inputs, and a demo's UAT output should not move when a tunable default does. Only new code uses the constant.
- **An `npm init` placeholder test script (`echo "Error: no test specified" && exit 1`) counts as no check:** it always fails, so any change would pass the delta.
- **Build:** `"build": "rm -rf dist && tsc -p tsconfig.build.json && chmod +x dist/cli/main.js"`; `"test": "npm run build && vitest run"`, the claude-mock precedent, so CI, `make verify` and the pre-push hook build before tests with no change of their own. `dist/` is already git-ignored. `tsconfig.build.json` includes only `src` and excludes `src/**/*.test.ts` (compiling with `tsconfig.json` would emit `.js` beside every demo and test).
- **Every tracked `.ts` file outside `vendor/` is inside `tsconfig.json`'s `include`** (`tests/typecheck-coverage.test.ts`): new files live under `src/cli/` and `tests/`. `examples/` holds only `.js`, `.json` and `.md`, and is added to ESLint's ignores (typed linting rejects files outside the tsconfig).
- **Verified before planning:** every module and test in Tasks 1 to 9 was built in a scratch prototype against this repository's `src/`: 86 tests passing, `tsc` and ESLint clean, and the compiled `dist/cli/main.js` run through the test seam produced the expected lines, branch and exit code. The sample project's `npm test` was run passing and shown to fail when `add` is broken. Nothing of the prototype is in the worktree. Review edits made after the prototype, not re-verified by it: the INCOMPLETE_TERMINUS phrase, the escalated and provisioning-abort outcome wording (Task 8), the single catch in `runCli` (Task 9), and the compiled-build run test (Task 9).
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests. Tests that run `dist/cli/main.js` need `npm run build` first; the task steps say so.
- **TDD and commits:** red, then green, then commit. Every commit message is one line saying what changed, a blank line, a paragraph saying why, a blank line, and `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Scaffolding Impact

- **Inherited (Operational note), compiled build and runnable command:** `tsconfig.build.json`, `package.json` `build`/`test` scripts and `bin`, the `commander` dependency → Task 3.
- **Inherited (Operational note), CI builds before the compiled-command tests:** satisfied by `"test": "npm run build && vitest run"`; `.github/workflows/ci.yml`, `Makefile` and `.githooks/pre-push` all call `npm test` and so need no edit → Task 3 (checked, unchanged).
- **Inherited (Operational note), regression harness for the compiled command:** `tests/helpers.ts` gains `DELIVERY_BIN` and `runDelivery`, with smoke tests in `tests/delivery-command.test.ts` → Task 3, and one full run of the compiled command through the test seam → Task 9. The recorded UAT test covering every acceptance criterion through it belongs to the UAT phase, not this plan.
- **Inherited (Operational note), contributor-only test seam:** `DELIVERY_TEST_MOCK_SCRIPT` in `src/cli/agent-session.ts` → Task 7; documented in `CONTRIBUTING.md` in Task 9, when the command honours it; its absence from `run --help` is asserted in Task 9.
- **Inherited (Operational note), self-ignoring record folder and working copy under the state directory:** `src/cli/run-location.ts` → Task 6.
- **Proactive, contributor local-run story:** `CONTRIBUTING.md` gains `npm run build`, why `npm test` builds first, `npm link`, and running from source with `npx tsx src/cli/main.ts` → Task 3; the scripted-run seam → Task 9.
- **Proactive, adopter docs:** `README.md` gains a "Run a task from the command line" section (install-from-checkout, what a run does, where it keeps things, exit codes) → Task 9; a pointer to the sample project → Task 10.
- **Proactive, lint scope:** `eslint.config.js` ignores `examples/` → Task 10.
- **Reactive, library export list:** `src/index.ts` exports `DEFAULT_BUDGETS` → Task 1.
- **Unchanged, checked:** `docs/configuring-a-role.md`, `docs/testing-your-pipeline.md` and the demos keep their explicit budget literals (see Global Constraints) and describe no command-line behaviour; `docs/writing-a-gate.md`, `docs/writing-a-closer.md`, `docs/provisioning.md` describe library behaviour this slice does not change (the command passes `worktreePath` in, as any library caller does); `vendor/README.md` (no change to the vendored mock); `.gitignore` (already ignores `dist/`; `.delivery/` ignores itself in target repositories); `vitest.config.ts` (new tests sit under the existing `src/**` and `tests/**` globs); `tsconfig.json` (`src` and `tests` already included).

---

### Task 1: The default budget set as a library constant ✅ DONE (deliver-slice)

**Files:**
- Modify: `src/budgets.ts`
- Modify: `src/index.ts`
- Test: `src/budgets.test.ts`

**Interfaces:**
- Consumes: `BudgetSet` (type and zod schema) from `src/schema.ts`.
- Produces: `export const DEFAULT_BUDGETS: BudgetSet` from `src/budgets.ts`, re-exported from `src/index.ts`.

- [ ] **Step 1: Write the failing test**

Replace the import line at the top of `src/budgets.test.ts` and append a new `describe` block at the end of the file:

```ts
import { describe, it, expect } from "vitest";
import { budgetExhausted, DEFAULT_BUDGETS } from "./budgets.js";
import { BudgetSet } from "./schema.js";
```

```ts
describe("DEFAULT_BUDGETS", () => {
  it("is the cap set the demos and tests already share, with nothing used", () => {
    expect(DEFAULT_BUDGETS).toEqual({
      correction: { used: 0, max: 3 },
      gateError: { used: 0, max: 3 },
      gateMaintenance: { used: 0, max: 2 },
      terminus: { used: 0, max: 5 },
      close: { used: 0, max: 3 },
    });
  });

  it("is a budget set the case file accepts", () => {
    expect(BudgetSet.parse(DEFAULT_BUDGETS)).toEqual(DEFAULT_BUDGETS);
  });

  it("is exported from the library entry point, so every caller starts from the same numbers", async () => {
    const index = await import("./index.js");
    expect(index.DEFAULT_BUDGETS).toBe(DEFAULT_BUDGETS);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/budgets.test.ts`
Expected: FAIL; `DEFAULT_BUDGETS` is undefined (not exported by `./budgets.js`).

- [ ] **Step 3: Implement**

In `src/budgets.ts`, change the import line to:

```ts
import type { Budget, BudgetPopulation, BudgetSet } from "./schema.js";
```

and append:

```ts
/**
 * The caps a run starts with when its caller names none. These are the numbers
 * the demos and tests already shared, lifted into one place so the command line
 * and any library caller start from the same set. Every `used` is 0: usage is
 * harness state, counted from the log, never a default.
 */
export const DEFAULT_BUDGETS: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
```

In `src/index.ts`, add this line directly after the first line (the `./case-file.js` export):

```ts
export { DEFAULT_BUDGETS } from "./budgets.js";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/budgets.test.ts src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/budgets.ts src/budgets.test.ts src/index.ts
git commit -F - <<'EOF'
Add DEFAULT_BUDGETS as an exported library constant

The command line needs a budget set when the user names none, and the spec
chose the literal every demo and test already agrees on rather than inventing
new numbers. Lifting it into one exported constant gives the CLI and Item 9's
declarative surface the same defaults. Existing tests and demos keep their own
literals, because a test should state its inputs and a demo's output should not
move when a tunable default does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Every failure as one plain-language message and exit code ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/failures.ts`
- Test: `src/cli/failures.test.ts`

**Interfaces:**
- Consumes: the 15 error classes in `src/errors.ts` (`FileNotFound`, `CorruptCaseFile`, `ImmutabilityViolation`, `WriteFailure`, `ParseError`, `DuplicateIdError`, `GateModuleLoadFailure`, `InvalidGateExport`, `CloserModuleLoadFailure`, `InvalidCloserExport`, `MissingBaseline`, `ProvisioningFailure`, `IllegalStateTransition`, `InvalidRoleConfig`, `MockNotInstalled`), each with a literal `code`; `messageOf(err: unknown): string` from `src/gate-support.ts`.
- Produces:
  - `export const EXIT: { ok: 0; unexpected: 1; configuration: 2; agentRuntime: 3; escalated: 4; aborted: 5 }`
  - `export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5`
  - `export class Refusal extends Error { constructor(message: string, readonly exitCode: ExitCode) }`
  - `export interface RenderedFailure { message: string; exitCode: ExitCode }`
  - `export const UNEXPECTED_FOOTER = "This is unexpected, please file an issue."`
  - `export function renderFailure(err: unknown): RenderedFailure`

- [ ] **Step 1: Write the failing test**

Create `src/cli/failures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FileNotFound,
  CorruptCaseFile,
  ImmutabilityViolation,
  WriteFailure,
  ParseError,
  DuplicateIdError,
  GateModuleLoadFailure,
  InvalidGateExport,
  CloserModuleLoadFailure,
  InvalidCloserExport,
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
  MockNotInstalled,
} from "../errors.js";
import { EXIT, Refusal, renderFailure, UNEXPECTED_FOOTER } from "./failures.js";

/** Harness vocabulary a person using the command should never have to learn. */
const JARGON = /worktree|envelope|surface|terminus|[A-Z]{2,}_[A-Z_]+/;

describe("EXIT", () => {
  it("gives every way the command ends its own code", () => {
    expect(EXIT).toEqual({ ok: 0, unexpected: 1, configuration: 2, agentRuntime: 3, escalated: 4, aborted: 5 });
  });
});

describe("renderFailure", () => {
  it("passes a refusal through as its own message and exit code", () => {
    expect(renderFailure(new Refusal("Tell me what to do.", EXIT.configuration))).toEqual({
      message: "Tell me what to do.",
      exitCode: EXIT.configuration,
    });
  });

  it.each([
    [new FileNotFound("/r/.delivery/runs/x", "/r/.delivery/runs/x/case.json"), EXIT.configuration, "/r/.delivery/runs/x/case.json"],
    [new CorruptCaseFile("/r/.delivery/runs/x", "bad json"), EXIT.unexpected, "Remove that folder to start afresh"],
    [new WriteFailure("/r/.delivery/runs/x", "ENOSPC"), EXIT.unexpected, "free disk space"],
    [new DuplicateIdError("adds numbers"), EXIT.configuration, '"adds numbers"'],
    [new GateModuleLoadFailure("./gates/g.js", "not found"), EXIT.configuration, "docs/writing-a-gate.md"],
    [new InvalidGateExport("./gates/g.js", "default", "no check()"), EXIT.configuration, "docs/writing-a-gate.md"],
    [new CloserModuleLoadFailure("./closers/c.js", "not found"), EXIT.configuration, "docs/writing-a-closer.md"],
    [new InvalidCloserExport("./closers/c.js", "default", "no close()"), EXIT.configuration, "docs/writing-a-closer.md"],
    [new ProvisioningFailure("/r/.delivery/runs/x", "fatal: invalid reference: main"), EXIT.configuration, "at least one commit"],
    [new InvalidRoleConfig("allowedTools", "must not be empty"), EXIT.configuration, "docs/configuring-a-role.md"],
    [new MockNotInstalled("/h/node_modules/.bin/claude-mock"), EXIT.configuration, "development checkout"],
    [new ImmutabilityViolation("/r/.delivery/runs/x", "baseline"), EXIT.unexpected, "This is a bug"],
    [new MissingBaseline("/r/.delivery/runs/x"), EXIT.unexpected, "This is a bug"],
    [new IllegalStateTransition("/r/.delivery/runs/x", "TRIAGE", "triage"), EXIT.unexpected, "This is a bug"],
    [new ParseError("unexpected token"), EXIT.unexpected, "This is a bug"],
  ])("renders %o in plain language with its mapped exit code", (err, exitCode, mentions) => {
    const rendered = renderFailure(err);
    expect(rendered.exitCode).toBe(exitCode);
    expect(rendered.message).toContain(mentions);
    expect(rendered.message).not.toContain(err.name);
    expect(rendered.message).not.toContain("    at ");
  });

  it("keeps harness vocabulary out of every rendering a user can act on", () => {
    const actionable = [
      new FileNotFound("/r/runs/x", "/r/runs/x/case.json"),
      new WriteFailure("/r/runs/x", "ENOSPC"),
      new DuplicateIdError("adds numbers"),
      new ProvisioningFailure("/r/runs/x", "fatal: invalid reference: main"),
    ];
    for (const err of actionable) expect(renderFailure(err).message).not.toMatch(JARGON);
  });

  it("names the run folder for a broken invariant, so a maintainer gets what they need", () => {
    expect(renderFailure(new MissingBaseline("/r/.delivery/runs/x")).message).toContain("attaching the run folder /r/.delivery/runs/x");
  });

  it("shows an unrecognised failure by its message with an honest footer, never a stack trace", () => {
    const err = new Error("ENOTDIR: not a directory, open '/r/.delivery/.gitignore'");
    expect(renderFailure(err)).toEqual({
      message: `ENOTDIR: not a directory, open '/r/.delivery/.gitignore'\n${UNEXPECTED_FOOTER}`,
      exitCode: EXIT.unexpected,
    });
    expect(UNEXPECTED_FOOTER).toBe("This is unexpected, please file an issue.");
  });

  it("renders a thrown non-Error the same honest way", () => {
    expect(renderFailure("boom")).toEqual({ message: `boom\n${UNEXPECTED_FOOTER}`, exitCode: EXIT.unexpected });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/failures.test.ts`
Expected: FAIL; cannot find module `./failures.js`.

- [ ] **Step 3: Implement**

Create `src/cli/failures.ts`:

```ts
import {
  FileNotFound,
  CorruptCaseFile,
  ImmutabilityViolation,
  WriteFailure,
  ParseError,
  DuplicateIdError,
  GateModuleLoadFailure,
  InvalidGateExport,
  CloserModuleLoadFailure,
  InvalidCloserExport,
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
  MockNotInstalled,
} from "../errors.js";
import { messageOf } from "../gate-support.js";

/**
 * How the command ends, as a number a script can act on without reading text:
 * "needs a person" (escalated) is distinct from "broke" (unexpected) and from
 * "set up wrong" (configuration, agent runtime). `ok` is a closed run, and
 * also help or version.
 */
export const EXIT = {
  ok: 0,
  unexpected: 1,
  configuration: 2,
  agentRuntime: 3,
  escalated: 4,
  aborted: 5,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * The command declining to go on: something about the user's setup, never a
 * bug. The message is the whole of what they see, so it names the one missing
 * thing and how to fix it.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

/** What reaches the terminal for a failure: one plain-language message, and the code to exit with. */
export interface RenderedFailure {
  message: string;
  exitCode: ExitCode;
}

export const UNEXPECTED_FOOTER = "This is unexpected, please file an issue.";

const KNOWN_ERRORS = [
  FileNotFound,
  CorruptCaseFile,
  ImmutabilityViolation,
  WriteFailure,
  ParseError,
  DuplicateIdError,
  GateModuleLoadFailure,
  InvalidGateExport,
  CloserModuleLoadFailure,
  InvalidCloserExport,
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
  MockNotInstalled,
] as const;
type KnownError = InstanceType<(typeof KNOWN_ERRORS)[number]>;

function isKnown(err: unknown): err is KnownError {
  return KNOWN_ERRORS.some((Known) => err instanceof Known);
}

/** A broken harness invariant: the user did nothing wrong, and the run folder is what a maintainer needs. */
function bug(detail: string, runFolder?: string): RenderedFailure {
  const attach = runFolder ? `, attaching the run folder ${runFolder}` : "";
  return {
    message: `Something went wrong inside the harness: ${detail}\nThis is a bug: please file an issue${attach}.`,
    exitCode: EXIT.unexpected,
  };
}

/**
 * One plain-language rendering per harness error, keyed on its `code`. The
 * switch has no default, so a new error class added to KNOWN_ERRORS does not
 * compile until it has a rendering here.
 */
function renderKnown(err: KnownError): RenderedFailure {
  switch (err.code) {
    case "FILE_NOT_FOUND":
      return {
        message: `I couldn't find that run's record (${err.filePath}). Start a new run with \`delivery run --task "..."\`.`,
        exitCode: EXIT.configuration,
      };
    case "CORRUPT_CASE_FILE":
      return {
        message: `The saved run in ${err.surfaceDir} can't be read back, usually because the harness was stopped while writing it. Remove that folder to start afresh.`,
        exitCode: EXIT.unexpected,
      };
    case "WRITE_FAILURE":
      return {
        message: `I couldn't save the run's record in ${err.surfaceDir}. Check there is free disk space and that you can write to that folder.`,
        exitCode: EXIT.unexpected,
      };
    case "DUPLICATE_ID":
      return {
        message: `The check's output names the same test ("${err.duplicateId}") more than once, so its results can't be told apart. Give each test a unique name.`,
        exitCode: EXIT.configuration,
      };
    case "GATE_MODULE_LOAD_FAILURE":
    case "INVALID_GATE_EXPORT":
      return {
        message: `Couldn't load the custom gate at \`${err.modulePath}\` (${err.detail}). Check the path, and that it exports what docs/writing-a-gate.md describes.`,
        exitCode: EXIT.configuration,
      };
    case "CLOSER_MODULE_LOAD_FAILURE":
    case "INVALID_CLOSER_EXPORT":
      return {
        message: `Couldn't load the custom closer at \`${err.modulePath}\` (${err.detail}). Check the path, and that it exports what docs/writing-a-closer.md describes.`,
        exitCode: EXIT.configuration,
      };
    case "PROVISIONING_FAILURE":
      return {
        message: `I couldn't set up a working copy of the repository (${err.detail}). Check it is a git repository with at least one commit, and that you can write to it.`,
        exitCode: EXIT.configuration,
      };
    case "INVALID_ROLE_CONFIG":
      return {
        message: `A role setting is invalid: ${err.field} ${err.detail}. See docs/configuring-a-role.md.`,
        exitCode: EXIT.configuration,
      };
    case "MOCK_NOT_INSTALLED":
      return {
        message: `${err.message} Scripted test runs only work inside a development checkout of the harness.`,
        exitCode: EXIT.configuration,
      };
    case "IMMUTABILITY_VIOLATION":
    case "MISSING_BASELINE":
    case "ILLEGAL_STATE_TRANSITION":
      return bug(err.message, err.surfaceDir);
    case "PARSE_ERROR":
      return bug(err.message);
  }
}

/**
 * Every failure the command can meet, as the one message and exit code the
 * user sees. Never a stack trace: a refusal and a known harness error each have
 * their own wording, and anything else is shown by its message with an honest
 * footer, because pretending to understand it would mislead.
 */
export function renderFailure(err: unknown): RenderedFailure {
  if (err instanceof Refusal) return { message: err.message, exitCode: err.exitCode };
  if (isKnown(err)) return renderKnown(err);
  return { message: `${messageOf(err)}\n${UNEXPECTED_FOOTER}`, exitCode: EXIT.unexpected };
}
```

- [ ] **Step 4: Run the test and the type check to verify they pass**

Run: `npx vitest run src/cli/failures.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; `tsc` and ESLint print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/failures.ts src/cli/failures.test.ts
git commit -F - <<'EOF'
Add plain-language rendering and exit codes for every CLI failure

A person running the command must never see a stack trace or a harness error
name, and a script must be able to tell "needs attention" from "broke" from
"set up wrong" by exit code alone. Keying the rendering on each error's existing
code, in a switch with no default, means a new harness error cannot ship without
a message; anything unrecognised is shown by its message with an honest footer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: A compiled `delivery` command with help and version ✅ DONE (deliver-slice)

**Files:**
- Create: `tsconfig.build.json`
- Create: `src/cli/program.ts`
- Create: `src/cli/main.ts`
- Modify: `package.json` (scripts `build` and `test`, `bin`, dependency `commander`), `package-lock.json` (via `npm install`)
- Modify: `tests/helpers.ts`
- Modify: `CONTRIBUTING.md`
- Test: `tests/delivery-command.test.ts`

**Interfaces:**
- Consumes: `EXIT`, `renderFailure` from `src/cli/failures.ts` (Task 2).
- Produces:
  - `export interface CliIo { argv: string[]; cwd: string; env: NodeJS.ProcessEnv; stdout: { write(text: string): unknown; isTTY?: boolean }; stderr: { write(text: string): unknown } }` from `src/cli/program.ts`
  - `export async function runCli(io: CliIo): Promise<number>` from `src/cli/program.ts` (never throws; Task 9 adds the `run` subcommand)
  - `export const DELIVERY_BIN: string` and `export function runDelivery(args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): { stdout: string; stderr: string; status: number | null }` from `tests/helpers.ts`
  - `npm run build` producing an executable `dist/cli/main.js`; `package.json` `bin.delivery === "./dist/cli/main.js"`

- [ ] **Step 1: Write the failing test and the harness helper**

In `tests/helpers.ts`, replace the first two import lines:

```ts
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
```

and append at the end of the file:

```ts
/** The compiled `delivery` command, as `npm run build` leaves it. */
export const DELIVERY_BIN = join(REPO_ROOT, "dist", "cli", "main.js");

/** Run the compiled `delivery` command as a person would, capturing what it prints and how it exits. */
export function runDelivery(
  args: string[],
  { cwd = REPO_ROOT, env = process.env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number | null } {
  if (!existsSync(DELIVERY_BIN)) {
    throw new Error("dist/cli/main.js is missing: run `npm run build` (npm test does this for you)");
  }
  const { stdout, stderr, status } = spawnSync(process.execPath, [DELIVERY_BIN, ...args], { cwd, env, encoding: "utf-8" });
  return { stdout, stderr, status };
}
```

Create `tests/delivery-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "../src/cli/failures.js";
import { DELIVERY_BIN, REPO_ROOT, runDelivery } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
  version: string;
  bin?: Record<string, string>;
};

describe("the compiled delivery command", () => {
  it("prints the package version with --version", () => {
    expect(runDelivery(["--version"])).toEqual({ stdout: `${pkg.version}\n`, stderr: "", status: EXIT.ok });
  });

  it("describes itself with --help", () => {
    const { stdout, status } = runDelivery(["--help"]);
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain("Usage: delivery");
    expect(stdout).toContain("Hand an AI agent a task in plain English.");
    expect(stdout).toContain("-V, --version");
  });

  it("treats an unknown option as a configuration mistake, saying which", () => {
    const { stderr, status } = runDelivery(["--bogus"]);
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("unknown option '--bogus'");
    expect(stderr).not.toContain("    at ");
  });

  it("is installed as `delivery` and runs directly", () => {
    expect(pkg.bin).toEqual({ delivery: "./dist/cli/main.js" });
    expect(readFileSync(DELIVERY_BIN, "utf-8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(statSync(DELIVERY_BIN).mode & 0o111).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/delivery-command.test.ts`
Expected: FAIL; every test throws `dist/cli/main.js is missing: run \`npm run build\` (npm test does this for you)`, and `npm run build` itself fails with `Missing script: "build"`.

- [ ] **Step 3: Add commander, the build config and the scripts**

Run: `npm install commander@^14`
Expected: `package.json` `dependencies` gains `"commander": "^14.0.3"` (or a later 14.x), and `package-lock.json` updates.

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

In `package.json`, add `bin` after `"type": "module",`:

```json
  "type": "module",
  "bin": {
    "delivery": "./dist/cli/main.js"
  },
```

and replace `"test": "vitest run",` with:

```json
    "build": "rm -rf dist && tsc -p tsconfig.build.json && chmod +x dist/cli/main.js",
    "test": "npm run build && vitest run",
```

- [ ] **Step 4: Implement the program and its entry point**

Create `src/cli/program.ts`:

```ts
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { EXIT, renderFailure } from "./failures.js";

/** Everything the command takes from the process that runs it. `main.ts` passes the real process; tests pass their own. */
export interface CliIo {
  /** The arguments after the command name. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
}

/** This package's own version: `package.json` sits two folders above both `src/cli/` and `dist/cli/`. */
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };

/**
 * Parse `io.argv`, run the command it names, and return the exit code. Never
 * throws and never prints a stack trace: every failure is rendered by
 * `renderFailure`, and a usage mistake (an unknown option or command) is a
 * configuration exit after commander has said what was wrong.
 */
export async function runCli(io: CliIo): Promise<number> {
  const program = new Command("delivery")
    .description(
      "Hand an AI agent a task in plain English. It works on a copy of your repository, your own tests check the result, and the work is left on a branch for you.",
    )
    .version(version, "-V, --version", "print the harness version")
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) });

  try {
    await program.parseAsync(io.argv, { from: "user" });
    return EXIT.ok;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode === 0 ? EXIT.ok : EXIT.configuration;
    const failure = renderFailure(err);
    io.stderr.write(`${failure.message}\n`);
    return failure.exitCode;
  }
}
```

Create `src/cli/main.ts`:

```ts
#!/usr/bin/env node
import { runCli } from "./program.js";

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
});
```

- [ ] **Step 5: Build and run the test to verify it passes**

Run: `npm run build && npx vitest run tests/delivery-command.test.ts tests/typecheck-coverage.test.ts && npx tsc --noEmit && npx eslint src/cli tests/helpers.ts tests/delivery-command.test.ts`
Expected: build succeeds; `dist/` holds no `*.test.js`; tests PASS; `tsc` and ESLint print nothing; `git status --short` shows no `.js` files beside sources and no `dist/`.

- [ ] **Step 6: Document the build and the local-run story**

In `CONTRIBUTING.md`, replace the `## Development` code block:

````markdown
```bash
npm test            # run tests once
npm run test:watch  # run tests in watch mode
npm run lint        # ESLint + TypeScript strict check
npm run typecheck   # TypeScript only
```
````

with:

````markdown
```bash
npm run build       # compile src/ into dist/, including the `delivery` command
npm test            # build, then run tests once
npm run test:watch  # run tests in watch mode (run `npm run build` first)
npm run lint        # ESLint + TypeScript strict check
npm run typecheck   # TypeScript only
```

`npm test` builds first because some tests run the compiled `delivery` command the way a
person would, through `runDelivery` in `tests/helpers.ts`. When you run vitest directly or in
watch mode, run `npm run build` first, and again after changing `src/`.

To run the command from a checkout, build and link it, which puts `delivery` on your `PATH`:

```bash
npm run build
npm link
delivery --help
```

or run it straight from source with `npx tsx src/cli/main.ts --help`.
````

- [ ] **Step 7: Commit**

```bash
git add tsconfig.build.json package.json package-lock.json src/cli/program.ts src/cli/main.ts tests/helpers.ts tests/delivery-command.test.ts CONTRIBUTING.md
git commit -F - <<'EOF'
Add a compiled delivery command with help and version

The harness is only usable as a library today; adoption needs a command a
person can type. This compiles src/ with the existing tsc, as vendor/claude-mock
does, uses commander for parsing and generated help, and makes npm test build
first so CI, make verify and the pre-push hook exercise the compiled command
without changes of their own. runDelivery gives later tests one way to drive
the binary as a user would.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Plain-language progress lines and colour rules ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/output.ts`
- Test: `src/cli/output.test.ts`

**Interfaces:**
- Consumes: `SurfaceState` (type and zod enum, `SurfaceState.options`) from `src/schema.ts`.
- Produces:
  - `export function useColour(input: { flag: boolean; env: NodeJS.ProcessEnv; isTTY: boolean | undefined }): boolean`
  - `export type Tone = "done" | "attention" | "stopped" | "quiet"`
  - `export function paint(colour: boolean, tone: Tone, text: string): string`
  - `export const STEP_PHRASES: Record<SurfaceState, string>`
  - `export interface Progress { step(state: SurfaceState): void }`
  - `export function createProgress(writeLine: (line: string) => void, colour: boolean): Progress`

- [ ] **Step 1: Write the failing test**

Create `src/cli/output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SurfaceState } from "../schema.js";
import { createProgress, paint, STEP_PHRASES, useColour } from "./output.js";

const ESC = "[";

describe("useColour", () => {
  const tty = { flag: true, env: {}, isTTY: true };

  it("colours a terminal by default", () => {
    expect(useColour(tty)).toBe(true);
  });

  it("prints no colour when --no-color is passed", () => {
    expect(useColour({ ...tty, flag: false })).toBe(false);
  });

  it("prints no colour when NO_COLOR is set to anything", () => {
    expect(useColour({ ...tty, env: { NO_COLOR: "1" } })).toBe(false);
  });

  it("treats an empty NO_COLOR as unset, as no-color.org says", () => {
    expect(useColour({ ...tty, env: { NO_COLOR: "" } })).toBe(true);
  });

  it("prints no colour when output is not a terminal", () => {
    expect(useColour({ ...tty, isTTY: false })).toBe(false);
    expect(useColour({ ...tty, isTTY: undefined })).toBe(false);
  });
});

describe("paint", () => {
  it("wraps the words in colour when colour is on, keeping the words", () => {
    const painted = paint(true, "done", "Done: it worked.");
    expect(painted).toContain(ESC);
    expect(painted).toContain("Done: it worked.");
  });

  it("returns the words unchanged when colour is off", () => {
    expect(paint(false, "stopped", "The run stopped.")).toBe("The run stopped.");
  });
});

describe("STEP_PHRASES", () => {
  it("has a phrase for every state", () => {
    expect(Object.keys(STEP_PHRASES).sort()).toEqual([...SurfaceState.options].sort());
  });

  it("never shows a raw state name", () => {
    for (const phrase of Object.values(STEP_PHRASES)) {
      for (const state of SurfaceState.options) expect(phrase).not.toContain(state);
      expect(phrase).not.toMatch(/[A-Z_]{3,}/);
    }
  });

  it("uses the design's words for the steps a person watches most", () => {
    expect(STEP_PHRASES.PROVISIONING).toBe("setting up");
    expect(STEP_PHRASES.PRE_GATING).toBe("checking the starting point");
    expect(STEP_PHRASES.AGENT_ACTIVE).toBe("the agent is working");
    expect(STEP_PHRASES.GATING).toBe("checking the agent's work");
    expect(STEP_PHRASES.GATE_MAINTENANCE).toBe("the agent is fixing something");
    expect(STEP_PHRASES.CLOSING).toBe("wrapping up");
    expect(STEP_PHRASES.CLOSED).toBe("done");
  });
});

describe("createProgress", () => {
  it("writes one plain line per step", () => {
    const lines: string[] = [];
    const progress = createProgress((line) => lines.push(line), false);
    progress.step("PROVISIONING");
    progress.step("PRE_GATING");
    progress.step("AGENT_ACTIVE");
    expect(lines).toEqual(["- setting up", "- checking the starting point", "- the agent is working"]);
  });

  it("does not repeat a step that reads the same as the one before", () => {
    const lines: string[] = [];
    const progress = createProgress((line) => lines.push(line), false);
    progress.step("AGENT_ACTIVE");
    progress.step("AGENT_ACTIVE");
    progress.step("GATING");
    progress.step("AGENT_ACTIVE");
    expect(lines).toEqual(["- the agent is working", "- checking the agent's work", "- the agent is working"]);
  });

  it("prints no escape codes when colour is off", () => {
    const lines: string[] = [];
    createProgress((line) => lines.push(line), false).step("CLOSING");
    expect(lines.join("")).not.toContain(ESC);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/output.test.ts`
Expected: FAIL; cannot find module `./output.js`.

- [ ] **Step 3: Implement**

Create `src/cli/output.ts`:

```ts
import { styleText } from "node:util";
import type { SurfaceState } from "../schema.js";

/**
 * Whether to print colour at all. Off when `--no-color` was passed, when
 * `NO_COLOR` is non-empty (no-color.org), or when output is not a terminal.
 */
export function useColour({ flag, env, isTTY }: { flag: boolean; env: NodeJS.ProcessEnv; isTTY: boolean | undefined }): boolean {
  return flag && !env.NO_COLOR && isTTY === true;
}

/** What a line means. Always also said in words: colour only decorates it. */
export type Tone = "done" | "attention" | "stopped" | "quiet";

const STYLE: Record<Tone, "green" | "yellow" | "red" | "dim"> = {
  done: "green",
  attention: "yellow",
  stopped: "red",
  quiet: "dim",
};

/**
 * `text` in its tone's colour, or unchanged when colour is off. The stream
 * check is ours (`useColour`), so styleText is told not to make its own.
 */
export function paint(colour: boolean, tone: Tone, text: string): string {
  return colour ? styleText(STYLE[tone], text, { validateStream: false }) : text;
}

/**
 * Every state as a person reads it. The state set is closed, so the table is
 * total: a new state does not compile until it has a phrase, and a raw state
 * name can never reach the terminal.
 */
export const STEP_PHRASES: Record<SurfaceState, string> = {
  PROVISIONING: "setting up",
  PRE_GATING: "checking the starting point",
  AGENT_ACTIVE: "the agent is working",
  // Not "so trying again": with the terminus budget spent, this routes to a person instead.
  INCOMPLETE_TERMINUS: "the agent stopped without finishing",
  GATING: "checking the agent's work",
  TRIAGE: "deciding what to do about a setback",
  GATE_MAINTENANCE: "the agent is fixing something",
  CLOSING: "wrapping up",
  CLOSED: "done",
  ESCALATED: "stopped: this needs a person",
  ABORTED: "stopped",
};

export interface Progress {
  /** Say what the run is doing next. A step that reads the same as the last one is not repeated. */
  step(state: SurfaceState): void;
}

/** Plain, append-only progress lines: no cursor movement, spinners or box drawing, so logs and screen readers read it as printed. */
export function createProgress(writeLine: (line: string) => void, colour: boolean): Progress {
  let last: string | undefined;
  return {
    step(state) {
      const phrase = STEP_PHRASES[state];
      if (phrase === last) return;
      last = phrase;
      writeLine(paint(colour, "quiet", `- ${phrase}`));
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/output.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; `tsc` and ESLint print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/output.ts src/cli/output.test.ts
git commit -F - <<'EOF'
Add plain-language step phrases and colour rules for CLI output

The command must print one readable line per step and never a raw state name,
and colour must never be the only carrier of meaning or appear when NO_COLOR,
--no-color or a non-terminal says not to. A total table over the closed state
set makes a missing phrase a compile error, and a small line renderer is all a
single surface needs, without a spinner library.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Find the repository, infer the check, notice uncommitted work ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/project.ts`
- Test: `src/cli/project.test.ts`

**Interfaces:**
- Consumes: `git(cwd: string, args: string[]): Promise<string>` from `src/git-exec.ts` (resolves trimmed stdout, rejects on non-zero exit); `GateRef` type from `src/schema.ts`; `EXIT`, `Refusal` from `src/cli/failures.ts` (Task 2). Tests use `initTempRepo(prefix, files)` from `src/temp-repo.ts` and `cleanGitEnv()` from `src/git-env.ts`.
- Produces:
  - `export const NOT_A_REPOSITORY: string`, `export const NO_CHECK: string`, `export const UNCOMMITTED_NOTE: string`
  - `export async function findRepository(path: string): Promise<string>` (top-level folder, or throws `Refusal(NOT_A_REPOSITORY, EXIT.configuration)`)
  - `export async function inferGate(repoPath: string): Promise<GateRef>` (`{ type: "command", command: "npm test", parseMode: "exitcode" }`, or throws `Refusal(NO_CHECK, EXIT.configuration)`)
  - `export async function hasUncommittedChanges(repoPath: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `src/cli/project.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { initTempRepo } from "../temp-repo.js";
import { EXIT, Refusal } from "./failures.js";
import { findRepository, hasUncommittedChanges, inferGate, NO_CHECK, NOT_A_REPOSITORY } from "./project.js";

const withTest = (test: string) => JSON.stringify({ name: "scratch", scripts: { test } });

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("findRepository", () => {
  it("finds the top of the repository from a folder inside it", async () => {
    const repo = initTempRepo("project-find-", { "README.md": "hi\n" });
    mkdirSync(join(repo, "src"));
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() }).trim();
    expect(await findRepository(join(repo, "src"))).toBe(top);
  });

  it("refuses a folder that is not a git repository, saying how to make it one", async () => {
    const refusal = await refusalOf(findRepository(mkdtempSync(join(tmpdir(), "project-not-repo-"))));
    expect(refusal.message).toBe(NOT_A_REPOSITORY);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("refuses a folder that does not exist the same way", async () => {
    const refusal = await refusalOf(findRepository(join(tmpdir(), "project-no-such-folder-9f3a")));
    expect(refusal.message).toBe(NOT_A_REPOSITORY);
  });
});

describe("inferGate", () => {
  it("uses the package's test script, judged by exit code", async () => {
    const repo = initTempRepo("project-gate-", { "package.json": withTest("node --test") });
    expect(await inferGate(repo)).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
  });

  it.each([
    ["no package.json", {}],
    ["a package.json with no scripts", { "package.json": JSON.stringify({ name: "scratch" }) }],
    ["an empty test script", { "package.json": withTest("  ") }],
    ["npm init's always-failing placeholder", { "package.json": withTest('echo "Error: no test specified" && exit 1') }],
    ["a package.json that is not JSON", { "package.json": "{ not json" }],
  ])("refuses %s, naming the missing check", async (_label, files: Record<string, string>) => {
    const repo = initTempRepo("project-no-gate-", { "README.md": "hi\n", ...files });
    const refusal = await refusalOf(inferGate(repo));
    expect(refusal.message).toBe(NO_CHECK);
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });
});

describe("hasUncommittedChanges", () => {
  it("is false for a clean repository", async () => {
    expect(await hasUncommittedChanges(initTempRepo("project-clean-", { "a.txt": "a\n" }))).toBe(false);
  });

  it("is true when a tracked file changed or a new file appeared", async () => {
    const edited = initTempRepo("project-edited-", { "a.txt": "a\n" });
    writeFileSync(join(edited, "a.txt"), "changed\n");
    expect(await hasUncommittedChanges(edited)).toBe(true);

    const added = initTempRepo("project-added-", { "a.txt": "a\n" });
    writeFileSync(join(added, "notes.txt"), "new\n");
    expect(await hasUncommittedChanges(added)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/project.test.ts`
Expected: FAIL; cannot find module `./project.js`.

- [ ] **Step 3: Implement**

Create `src/cli/project.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "../git-exec.js";
import type { GateRef } from "../schema.js";
import { EXIT, Refusal } from "./failures.js";

export const NOT_A_REPOSITORY =
  "This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one.";

export const NO_CHECK =
  "I couldn't find a command to check the agent's work with. Add a `test` script to your `package.json` that passes when a change is good.";

export const UNCOMMITTED_NOTE =
  "Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.";

/** The top folder of the git repository containing `path`, or a refusal saying the folder needs to be one. */
export async function findRepository(path: string): Promise<string> {
  try {
    return await git(path, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Refusal(NOT_A_REPOSITORY, EXIT.configuration);
  }
}

const TestScript = z.object({ scripts: z.object({ test: z.string().trim().min(1) }) });

/**
 * The placeholder `npm init` writes. It always fails, so a delta against it
 * would accept any change: no check at all, dressed as one.
 */
const NPM_INIT_PLACEHOLDER = "no test specified";

/**
 * The default check: the repository's own `npm test`, judged by its exit code
 * alone, the one parse mode that assumes nothing about the runner's output.
 */
export async function inferGate(repoPath: string): Promise<GateRef> {
  const script = await testScript(repoPath);
  if (script === undefined || script.includes(NPM_INIT_PLACEHOLDER)) {
    throw new Refusal(NO_CHECK, EXIT.configuration);
  }
  return { type: "command", command: "npm test", parseMode: "exitcode" };
}

async function testScript(repoPath: string): Promise<string | undefined> {
  try {
    const parsed = TestScript.safeParse(JSON.parse(await readFile(join(repoPath, "package.json"), "utf-8")));
    return parsed.success ? parsed.data.scripts.test : undefined;
  } catch {
    return undefined; // no package.json, or not JSON
  }
}

/** Whether `git status` shows anything: changes the agent will not see, because it starts from the last commit. */
export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  return (await git(repoPath, ["status", "--porcelain"])) !== "";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/project.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; `tsc` and ESLint print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/project.ts src/cli/project.test.ts
git commit -F - <<'EOF'
Add repository discovery, default gate inference and the uncommitted note

With nothing configured, a run needs a git repository and something that marks
a change as good. The repository's own npm test, judged by exit code, is the
one check that assumes nothing about the runner, and each missing piece gets a
refusal naming exactly that piece. An npm init placeholder counts as no check,
since it always fails and would let any change through.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Where a run keeps its record and its working copy ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/run-location.ts`
- Test: `src/cli/run-location.test.ts`

**Interfaces:**
- Consumes: `SurfaceLocation` type (`{ repoPath: string; worktreePath: string }`) from `src/ports.ts`. Tests use `initTempRepo` and `cleanGitEnv`.
- Produces:
  - `export function runIdFor(intent: string, now: Date): string`
  - `export function repoKey(repoPath: string): string`
  - `export function stateHome(env: NodeJS.ProcessEnv): string`
  - `export interface RunPlace { dir: string; location: SurfaceLocation }`
  - `export function runPlace(repoPath: string, runId: string, env: NodeJS.ProcessEnv): RunPlace`
  - `export async function prepareRunDir(repoPath: string, dir: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/cli/run-location.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { initTempRepo } from "../temp-repo.js";
import { prepareRunDir, repoKey, runIdFor, runPlace, stateHome } from "./run-location.js";

const AT = new Date("2026-09-14T21:03:09.123Z");

describe("runIdFor", () => {
  it("is the first five words of the task, then the UTC second it started", () => {
    expect(runIdFor("Add a function that says hello to a name, with a test", AT)).toBe(
      "add-a-function-that-says-20260914T210309Z",
    );
  });

  it("keeps only letters and digits from the task, so the id is a safe branch name", () => {
    expect(runIdFor("Fix: the `login` page's 404!", AT)).toBe("fix-the-login-page-s-20260914T210309Z");
  });

  it("falls back to 'run' when the task has no letters or digits", () => {
    expect(runIdFor("!!!", AT)).toBe("run-20260914T210309Z");
  });

  it("gives the same task a new id a second later", () => {
    expect(runIdFor("add a thing", AT)).not.toBe(runIdFor("add a thing", new Date("2026-09-14T21:03:10.000Z")));
  });
});

describe("repoKey", () => {
  it("follows autoloop's target-key rule", () => {
    expect(repoKey("/home/dana/dev/my-app.v2")).toBe("home-dana-dev-my-app.v2");
    expect(repoKey("/home/dana/My Projects/app")).toBe("home-dana-My-Projects-app");
  });
});

describe("stateHome", () => {
  it("uses XDG_STATE_HOME when it is an absolute path", () => {
    expect(stateHome({ XDG_STATE_HOME: "/var/state" })).toBe("/var/state");
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is unset or relative", () => {
    expect(stateHome({})).toBe(join(homedir(), ".local", "state"));
    expect(stateHome({ XDG_STATE_HOME: "state" })).toBe(join(homedir(), ".local", "state"));
  });
});

describe("runPlace", () => {
  it("keeps the record inside the repository and the working copy under the state folder", () => {
    expect(runPlace("/home/dana/app", "add-a-thing-20260914T210309Z", { XDG_STATE_HOME: "/state" })).toEqual({
      dir: "/home/dana/app/.delivery/runs/add-a-thing-20260914T210309Z",
      location: {
        repoPath: "/home/dana/app",
        worktreePath: "/state/delivery-service/worktrees/home-dana-app/add-a-thing-20260914T210309Z",
      },
    });
  });
});

describe("prepareRunDir", () => {
  it("creates an empty record folder that git status does not report", async () => {
    const repo = initTempRepo("run-location-prepare-", { "a.txt": "a\n" });
    const { dir } = runPlace(repo, "add-a-thing-20260914T210309Z", { XDG_STATE_HOME: "/state" });

    await prepareRunDir(repo, dir);

    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(repo, ".delivery", ".gitignore"), "utf-8")).toBe("*\n");
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf-8", env: cleanGitEnv() })).toBe("");
  });

  it("leaves the repository's own .gitignore alone", async () => {
    const repo = initTempRepo("run-location-own-ignore-", { ".gitignore": "node_modules/\n" });
    await prepareRunDir(repo, runPlace(repo, "x-20260914T210309Z", {}).dir);
    expect(readFileSync(join(repo, ".gitignore"), "utf-8")).toBe("node_modules/\n");
  });

  it("refuses to reuse a record folder that already exists", async () => {
    const repo = initTempRepo("run-location-exists-", { "a.txt": "a\n" });
    const { dir } = runPlace(repo, "x-20260914T210309Z", {});
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "case.json"), "{}");
    await expect(prepareRunDir(repo, dir)).rejects.toThrow(/EEXIST/);
    expect(readFileSync(join(dir, "case.json"), "utf-8")).toBe("{}");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/run-location.test.ts`
Expected: FAIL; cannot find module `./run-location.js`.

- [ ] **Step 3: Implement**

Create `src/cli/run-location.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { SurfaceLocation } from "../ports.js";

/** How many words of the task name a run. Enough to tell runs apart at a glance. */
const SLUG_WORDS = 5;

/**
 * A run's id, which is also its surface id and so its branch name: the first
 * words of the task, so a person can tell runs apart, then the UTC second it
 * started, so re-running a finished task starts a new run instead of reopening
 * the old one.
 */
export function runIdFor(intent: string, now: Date): string {
  const slug =
    intent
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, SLUG_WORDS)
      .join("-") || "run";
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  return `${slug}-${stamp}`;
}

/**
 * A single path component naming a repository, from its path: the estate's
 * autoloop target-key rule (drop the leading slash, and anything outside
 * [A-Za-z0-9_.] becomes "-"), so the two tools' state folders read alike.
 */
export function repoKey(repoPath: string): string {
  return repoPath.replace(/^\//, "").replace(/[^A-Za-z0-9_.]/g, "-");
}

/** `$XDG_STATE_HOME`, or `~/.local/state` when it is unset or relative, as the XDG base directory rules say. */
export function stateHome(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_STATE_HOME;
  return xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state");
}

export interface RunPlace {
  /** The run's record: inside the repository, so nobody has to remember where it is. */
  dir: string;
  /** The repository, and the run's working copy outside it, where the user's own tools will not pick it up. */
  location: SurfaceLocation;
}

/**
 * Where a run keeps its record and its working copy. Pure: the same repository
 * and run id always give the same places, so a later command can recompute
 * them rather than store them.
 */
export function runPlace(repoPath: string, runId: string, env: NodeJS.ProcessEnv): RunPlace {
  return {
    dir: join(repoPath, ".delivery", "runs", runId),
    location: {
      repoPath,
      worktreePath: join(stateHome(env), "delivery-service", "worktrees", repoKey(repoPath), runId),
    },
  };
}

/**
 * Create the run's empty record folder, and make `.delivery/` ignore itself so
 * starting a run leaves `git status` exactly as it was. The repository's own
 * `.gitignore` is never touched. Fails if the folder already exists, rather
 * than write over another run's record.
 */
export async function prepareRunDir(repoPath: string, dir: string): Promise<void> {
  await mkdir(dirname(dir), { recursive: true });
  await writeFile(join(repoPath, ".delivery", ".gitignore"), "*\n");
  await mkdir(dir);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/run-location.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; `tsc` and ESLint print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/run-location.ts src/cli/run-location.test.ts
git commit -F - <<'EOF'
Add run ids and the record and working-copy locations for CLI runs

Starting a run must not change what git status reports, and the agent's copy
must not sit where the user's own tools will scan it. The record lives in a
self-ignoring .delivery folder so it is easy to find, and the working copy lives
under the XDG state directory keyed the way autoloop keys its worktrees, so the
estate's tools agree on where such things go.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: Check the agent can start, or route it to the scripted agent ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/agent-session.ts`
- Test: `src/cli/agent-session.test.ts`

**Interfaces:**
- Consumes: `SessionEnvironment` type (`{ pathToClaudeCodeExecutable?: string; env?: NodeJS.ProcessEnv }`) from `src/agent-invoke.ts`; `mockSessionEnvironment({ scriptPath, journalPath }): SessionEnvironment` and `resolveMockExecutable(): string` from `src/mock-session.ts` (the former throws `MockNotInstalled` when the vendored mock is absent); `EXIT`, `Refusal` from `src/cli/failures.ts` (Task 2).
- Produces:
  - `export const NO_RUNTIME: string`, `export const NOT_SIGNED_IN: string`
  - `export const TEST_MOCK_SCRIPT = "DELIVERY_TEST_MOCK_SCRIPT"`
  - `export interface Platform { platform: NodeJS.Platform; arch: string; musl: boolean }`
  - `export function runtimeCandidates(platform: Platform): string[]`
  - `export function resolveRuntime(resolve?: (id: string) => string, platform?: Platform): string | undefined`
  - `export async function preflight(runtime: string | undefined, env: NodeJS.ProcessEnv): Promise<string>`
  - `export async function agentSession(env: NodeJS.ProcessEnv): Promise<SessionEnvironment>`

- [ ] **Step 1: Write the failing test**

Create `src/cli/agent-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMockExecutable } from "../mock-session.js";
import { EXIT, Refusal } from "./failures.js";
import {
  agentSession,
  NO_RUNTIME,
  NOT_SIGNED_IN,
  preflight,
  resolveRuntime,
  runtimeCandidates,
  TEST_MOCK_SCRIPT,
} from "./agent-session.js";

const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

/** This process's environment with no credential and an empty Claude Code config folder: a machine nobody signed in on. */
function signedOutEnv(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), "agent-session-home-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.includes(name)));
  return { ...env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
}

/** A stand-in runtime: a shell script that prints `stdout` and exits with `code` for any arguments. */
function fakeRuntime(stdout: string, code: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "agent-session-runtime-")), "claude");
  writeFileSync(path, `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${code}\n`);
  chmodSync(path, 0o755);
  return path;
}

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Refusal);
  return err as Refusal;
}

describe("runtimeCandidates", () => {
  it("names the SDK's binary package for this platform", () => {
    expect(runtimeCandidates({ platform: "darwin", arch: "arm64", musl: false })).toEqual([
      "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
    ]);
    expect(runtimeCandidates({ platform: "win32", arch: "x64", musl: false })).toEqual([
      "@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
    ]);
  });

  it("tries the matching C library's build first on Linux, then the other", () => {
    expect(runtimeCandidates({ platform: "linux", arch: "x64", musl: false })).toEqual([
      "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
      "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
    ]);
    expect(runtimeCandidates({ platform: "linux", arch: "arm64", musl: true })).toEqual([
      "@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude",
      "@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
    ]);
  });
});

describe("resolveRuntime", () => {
  it("finds the binary the installed SDK ships for this machine", () => {
    const runtime = resolveRuntime();
    expect(runtime).toBeDefined();
    expect(existsSync(runtime ?? "")).toBe(true);
  });

  it("is undefined when no candidate package is installed", () => {
    const missing = (id: string): string => {
      throw new Error(`Cannot find module '${id}'`);
    };
    expect(resolveRuntime(missing)).toBeUndefined();
  });
});

describe("preflight", () => {
  it("refuses when there is no runtime, naming it and the fix", async () => {
    const refusal = await refusalOf(preflight(undefined, process.env));
    expect(refusal.message).toBe(NO_RUNTIME);
    expect(refusal.exitCode).toBe(EXIT.agentRuntime);
  });

  it("refuses a runtime that will not start", async () => {
    const refusal = await refusalOf(preflight(join(tmpdir(), "agent-session-no-such-binary"), process.env));
    expect(refusal.message).toBe(NO_RUNTIME);
  });

  it("refuses a runtime that answers with something unreadable", async () => {
    const refusal = await refusalOf(preflight(fakeRuntime("not json", 0), process.env));
    expect(refusal.message).toBe(NO_RUNTIME);
  });

  it("refuses a signed-out runtime, naming sign-in and the fix", async () => {
    const refusal = await refusalOf(preflight(fakeRuntime('{"loggedIn": false}', 1), process.env));
    expect(refusal.message).toBe(NOT_SIGNED_IN);
    expect(refusal.exitCode).toBe(EXIT.agentRuntime);
  });

  it("passes a signed-in runtime and returns its path", async () => {
    const runtime = fakeRuntime('{"loggedIn": true, "authMethod": "api_key"}', 0);
    expect(await preflight(runtime, process.env)).toBe(runtime);
  });

  it("reads sign-in from the real runtime: with no credential and no stored login it is signed out", async () => {
    const refusal = await refusalOf(preflight(resolveRuntime(), signedOutEnv()));
    expect(refusal.message).toBe(NOT_SIGNED_IN);
  });
});

describe("agentSession", () => {
  it("routes to the vendored scripted agent when the contributor test seam names a script, skipping the preflight", async () => {
    const session = await agentSession({ ...signedOutEnv(), [TEST_MOCK_SCRIPT]: "/tmp/run/mock.json" });
    expect(session.pathToClaudeCodeExecutable).toBe(resolveMockExecutable());
    expect(session.env?.CLAUDE_MOCK_SCRIPT).toBe("/tmp/run/mock.json");
    expect(session.env?.CLAUDE_MOCK_JOURNAL).toBe("/tmp/run/mock.json.journal.jsonl");
  });

  it("runs the preflight for a real session", async () => {
    const refusal = await refusalOf(agentSession(signedOutEnv()));
    expect(refusal.message).toBe(NOT_SIGNED_IN);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/agent-session.test.ts`
Expected: FAIL; cannot find module `./agent-session.js`.

- [ ] **Step 3: Implement**

Create `src/cli/agent-session.ts`:

```ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { z } from "zod";
import type { SessionEnvironment } from "../agent-invoke.js";
import { mockSessionEnvironment } from "../mock-session.js";
import { EXIT, Refusal } from "./failures.js";

export const NO_RUNTIME =
  "I can't start the agent that does the work: the Claude Code runtime that comes with the harness is missing or won't start on this machine. Reinstall the harness without `--omit=optional`, then try again.";

export const NOT_SIGNED_IN =
  "I can't start the agent that does the work: you're not signed in. Run `claude auth login`, or set `ANTHROPIC_API_KEY`, then try again.";

/**
 * Contributor-only test seam: the path of a claude-mock script. When set, every
 * agent session in the run is routed to the vendored scripted agent and the
 * runtime preflight is skipped. Documented in CONTRIBUTING.md and deliberately
 * absent from `--help`: claude-mock is a dev dependency, so the seam cannot
 * work in an installed copy.
 */
export const TEST_MOCK_SCRIPT = "DELIVERY_TEST_MOCK_SCRIPT";

export interface Platform {
  platform: NodeJS.Platform;
  arch: string;
  /** A Linux whose C library is musl rather than glibc. */
  musl: boolean;
}

/**
 * The packages the Agent SDK looks in for the Claude Code binary it launches,
 * in the order it tries them. The SDK does not export its lookup, so this
 * mirrors it (SDK 0.3.x); `resolveRuntime`'s test fails on install if a new
 * SDK renames the packages.
 */
export function runtimeCandidates({ platform, arch, musl }: Platform): string[] {
  const executable = platform === "win32" ? "claude.exe" : "claude";
  const packages =
    platform === "linux"
      ? musl
        ? [`linux-${arch}-musl`, `linux-${arch}`]
        : [`linux-${arch}`, `linux-${arch}-musl`]
      : [`${platform}-${arch}`];
  return packages.map((name) => `@anthropic-ai/claude-agent-sdk-${name}/${executable}`);
}

function thisPlatform(): Platform {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === "linux" && report.header?.glibcVersionRuntime === undefined,
  };
}

/** Resolves module ids from where the SDK is installed, as the SDK itself does. */
const fromSdk = createRequire(createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"));

/**
 * The Claude Code binary the Agent SDK would launch, or undefined when none is
 * installed. The command hands this path to the SDK explicitly, so the binary
 * the preflight checks is the binary that runs.
 */
export function resolveRuntime(
  resolve: (id: string) => string = (id) => fromSdk.resolve(id),
  platform: Platform = thisPlatform(),
): string | undefined {
  for (const id of runtimeCandidates(platform)) {
    try {
      const path = resolve(id);
      if (existsSync(path)) return path;
    } catch {
      // Not installed for this platform: try the next candidate.
    }
  }
  return undefined;
}

const AuthStatus = z.object({ loggedIn: z.boolean() });

/**
 * What `claude auth status --json` reports, or undefined when the binary would
 * not run or said something unreadable. A signed-out runtime exits non-zero
 * with the same JSON on stdout, so stdout is read whatever the exit code.
 */
function authStatus(runtime: string, env: NodeJS.ProcessEnv): Promise<{ loggedIn: boolean } | undefined> {
  return new Promise((resolve) => {
    execFile(runtime, ["auth", "status", "--json"], { env, timeout: 30_000 }, (_err, stdout) => {
      try {
        const parsed = AuthStatus.safeParse(JSON.parse(stdout));
        resolve(parsed.success ? parsed.data : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Check, before anything is set up, that the agent can start: the runtime
 * exists and runs, and it is signed in. The runtime is asked rather than
 * second-guessed, so an API key, a token and a stored login all count, however
 * this machine keeps them. Returns the runtime's path.
 */
export async function preflight(runtime: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  if (runtime === undefined) throw new Refusal(NO_RUNTIME, EXIT.agentRuntime);
  const status = await authStatus(runtime, env);
  if (status === undefined) throw new Refusal(NO_RUNTIME, EXIT.agentRuntime);
  if (!status.loggedIn) throw new Refusal(NOT_SIGNED_IN, EXIT.agentRuntime);
  return runtime;
}

/**
 * The session every agent call in a run uses: the scripted agent when the
 * contributor test seam names a script, otherwise the real runtime, once it has
 * passed the preflight.
 */
export async function agentSession(env: NodeJS.ProcessEnv): Promise<SessionEnvironment> {
  const script = env[TEST_MOCK_SCRIPT];
  if (script) return mockSessionEnvironment({ scriptPath: script, journalPath: `${script}.journal.jsonl` });
  return { pathToClaudeCodeExecutable: await preflight(resolveRuntime(), env), env };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/agent-session.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS (the real-runtime test takes well under a second); `tsc` and ESLint print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/agent-session.ts src/cli/agent-session.test.ts
git commit -F - <<'EOF'
Add the agent runtime preflight and the contributor mock seam

The SDK collapses every launch failure into one opaque signal, so without a
check a missing runtime or sign-in surfaces as an unexplained incomplete run
after a working copy is already made. The SDK now bundles its own Claude Code
binary, so the check resolves that binary the way the SDK does, passes it to
the SDK explicitly, and asks it whether it is signed in rather than guessing
where a login is stored. The DELIVERY_TEST_MOCK_SCRIPT seam lets contributor
tests drive a real command run offline against the vendored scripted agent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: A finished run's outcome in the task's terms ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/outcome.ts`
- Test: `src/cli/outcome.test.ts`

**Interfaces:**
- Consumes: `readRef(dir, ref)`, `create`, `load`, `setBaseBranch`, `setOutcome`, `writeRef(dir, kind, value)` from `src/case-file.ts`; `branchName(surfaceId): string` (`surface/<id>`) from `src/provision.ts`; `EscalationPacket` (zod schema and type: `decision`, `evidence`, `dead_ends`, `why_now`, `references`) from `src/triage-role-config.ts`; `CaseFile`, `CaseFileOutcome` types from `src/schema.ts`; `DEFAULT_BUDGETS` (Task 1); `EXIT`, `ExitCode` (Task 2); `Tone` (Task 4).
- Produces:
  - `export interface OutcomeSummary { headline: string; tone: Tone; details: string[]; exitCode: ExitCode }`
  - `export async function summariseOutcome(dir: string, caseFile: CaseFile): Promise<OutcomeSummary>`

- [ ] **Step 1: Write the failing test**

Create `src/cli/outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, load, setBaseBranch, setOutcome, writeRef } from "../case-file.js";
import type { CaseFileOutcome } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import { EXIT } from "./failures.js";
import { summariseOutcome } from "./outcome.js";

const RUN_ID = "add-a-hello-function-20260914T210309Z";
const AT = "2026-09-14T21:05:00.000Z";

const packet: EscalationPacket = {
  decision: "The worker stopped because it judged it lacked authority. Decide whether to grant that authority or take the action yourself.",
  evidence: "the task asks me to delete files outside what I was given",
  dead_ends: "No prior attempts were triaged.",
  why_now: "The worker reported that it lacks the authority to go on.",
  references: ["worker-1-0"],
};

/** A finished run's record, as the run loop leaves it. */
async function finishedRun(outcome: (dir: string) => Promise<CaseFileOutcome>) {
  const dir = await mkdtemp(join(tmpdir(), "outcome-"));
  await create(
    dir,
    {
      surfaceId: RUN_ID,
      taskDef: { intent: "add a hello function" },
      gateRef: { type: "command", command: "npm test", parseMode: "exitcode" },
      closerRef: { type: "commit-to-branch" },
    },
    DEFAULT_BUDGETS,
  );
  await setBaseBranch(dir, "main");
  await setOutcome(dir, await outcome(dir));
  return { dir, caseFile: await load(dir) };
}

describe("summariseOutcome", () => {
  it("says what was done and the branch it is on for a closed run, exiting ok", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({ kind: "closed", source: "closer", reason: "committed", at: AT }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline: `Done: the change for "add a hello function" passed \`npm test\` and is committed on branch surface/${RUN_ID}.`,
      tone: "done",
      details: [`main was not changed. To look at the work: git log surface/${RUN_ID}`],
      exitCode: EXIT.ok,
    });
  });

  it("leads an escalated run with the decision asked of a person, then quotes the evidence, exiting escalated", async () => {
    const { dir, caseFile } = await finishedRun(async (d) => ({
      kind: "escalated",
      source: "worker",
      reason: "authority limit",
      at: AT,
      packetRef: await writeRef(d, "escalation", packet),
    }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline: `This needs your decision: ${packet.decision}`,
      tone: "attention",
      details: [
        "",
        "What the harness saw:",
        packet.evidence,
        "",
        "Nothing was changed on main.",
      ],
      exitCode: EXIT.escalated,
    });
  });

  it("falls back to the recorded reason for an escalation with no readable packet", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({ kind: "escalated", source: "worker", reason: "authority limit", at: AT }));
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe("This needs your decision: authority limit");
    expect(summary.exitCode).toBe(EXIT.escalated);
  });

  it("says in plain language why a run that could not set up stopped, keeping git's words as detail, exiting aborted", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({
      kind: "aborted",
      source: "provisioning",
      reason: "Command failed: git worktree add -b surface/x -- /s/x main\nfatal: invalid reference: main",
      at: AT,
    }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline:
        "The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit, and that you can write to it.",
      tone: "stopped",
      details: ["Details: Command failed: git worktree add -b surface/x -- /s/x main\nfatal: invalid reference: main"],
      exitCode: EXIT.aborted,
    });
  });

  it("says why any other aborted run stopped, exiting aborted", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({ kind: "aborted", source: "triage", reason: "the task cannot be done", at: AT }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline: "The run stopped: the task cannot be done",
      tone: "stopped",
      details: [],
      exitCode: EXIT.aborted,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/outcome.test.ts`
Expected: FAIL; cannot find module `./outcome.js`.

- [ ] **Step 3: Implement**

Create `src/cli/outcome.ts`:

```ts
import { readRef } from "../case-file.js";
import { branchName } from "../provision.js";
import { EscalationPacket } from "../triage-role-config.js";
import type { CaseFile } from "../schema.js";
import { EXIT, type ExitCode } from "./failures.js";
import type { Tone } from "./output.js";

/** How a finished run is reported: a headline in plain language, the lines under it, and the exit code. */
export interface OutcomeSummary {
  headline: string;
  tone: Tone;
  details: string[];
  exitCode: ExitCode;
}

function intentOf(caseFile: CaseFile): string {
  const { intent } = caseFile.header.taskDef;
  return typeof intent === "string" ? intent : "the task";
}

function checkOf(caseFile: CaseFile): string {
  const { gateRef } = caseFile.header;
  return gateRef.type === "command" ? `\`${gateRef.command}\`` : "the check";
}

/** The packet the escalation recorded, or undefined when the run has none to show. */
async function packetOf(dir: string, packetRef: string | undefined): Promise<EscalationPacket | undefined> {
  if (packetRef === undefined) return undefined;
  const parsed = EscalationPacket.safeParse(await readRef(dir, packetRef));
  return parsed.success ? parsed.data : undefined;
}

/**
 * What a finished run did, in the task's terms. A closed run names the branch
 * the work is on; an escalated one leads with the decision being asked of a
 * person, with the evidence quoted beneath it, never paraphrased away.
 */
export async function summariseOutcome(dir: string, caseFile: CaseFile): Promise<OutcomeSummary> {
  const { outcome } = caseFile;
  if (!outcome) throw new Error(`summariseOutcome was given an unfinished run: ${dir}`);
  const branch = branchName(caseFile.header.surfaceId);
  const base = caseFile.header.baseBranch ?? "your base branch";

  switch (outcome.kind) {
    case "closed":
      return {
        headline: `Done: the change for "${intentOf(caseFile)}" passed ${checkOf(caseFile)} and is committed on branch ${branch}.`,
        tone: "done",
        details: [`${base} was not changed. To look at the work: git log ${branch}`],
        exitCode: EXIT.ok,
      };
    case "escalated": {
      const packet = await packetOf(dir, outcome.packetRef);
      return {
        headline: `This needs your decision: ${packet?.decision ?? outcome.reason}`,
        tone: "attention",
        details: [
          ...(packet ? ["", "What the harness saw:", packet.evidence] : []),
          "",
          // Not "the work is kept on the branch": a stopped run's closer force-removes the
          // working copy without committing, so the branch holds none of this run's edits.
          `Nothing was changed on ${base}.`,
        ],
        exitCode: EXIT.escalated,
      };
    }
    case "aborted":
      // A provisioning abort's reason is raw git output ("worktree", the branch scheme):
      // lead with what to fix, and keep git's words beneath it for diagnosis.
      if (outcome.source === "provisioning") {
        return {
          headline:
            "The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit, and that you can write to it.",
          tone: "stopped",
          details: [`Details: ${outcome.reason}`],
          exitCode: EXIT.aborted,
        };
      }
      return {
        headline: `The run stopped: ${outcome.reason}`,
        tone: "stopped",
        details: [],
        exitCode: EXIT.aborted,
      };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/cli/outcome.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS; `tsc` and ESLint print nothing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/outcome.ts src/cli/outcome.test.ts
git commit -F - <<'EOF'
Add plain-language outcome summaries for finished CLI runs

A person should finish a run knowing what was done and where it is, or what
decision is being asked of them, without reading the case file. A closed run
names its branch and confirms the base branch is untouched; an escalated run
leads with the packet's decision sentence, already written for a non-technical
reader, and quotes the evidence beneath it; each ending maps to its own exit
code.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: `delivery run` drives a run with nothing configured ✅ DONE (deliver-slice)

**Files:**
- Create: `src/cli/run-command.ts`
- Modify: `src/cli/program.ts` (replace the whole file)
- Modify: `CONTRIBUTING.md`
- Modify: `README.md`
- Test: `src/cli/run-command.test.ts`
- Test: `tests/delivery-command.test.ts` (one compiled-build run through the test seam)

**Interfaces:**
- Consumes:
  - Library: `createAgentPort(configs: RoleConfigs, session: SessionEnvironment): AgentPort` (`src/agent-invoke.ts`); `create(dir, header, budgets)`, `load(dir)` (`src/case-file.ts`); `resolveCloser(ref: CloserRef, repoPath: string): CloserPort` (`src/resolve-closer.ts`); `workerRoleConfig`, `gateMaintenanceRoleConfig` (`src/role-config.ts`); `triageRoleConfig` (`src/triage-role-config.ts`); `deterministicRouter` (`src/router.ts`); `advance(dir, location, ports): Promise<AdvanceResult>` with `AdvanceResult { state: SurfaceState; done: boolean; recovery?: string }` (`src/surface.ts`); `SurfacePorts` (`src/ports.ts`); `CloserRef` (`src/schema.ts`). Tests: `writeMockScript(path, script)`, `MockScript` (`src/mock-script.ts`), `initTempRepo`, `cleanGitEnv`, `SurfaceState`.
  - Earlier tasks: `DEFAULT_BUDGETS` (1); `EXIT`, `Refusal`, `ExitCode`, `renderFailure`, `UNEXPECTED_FOOTER` (2); `CliIo`, `runCli` (3); `useColour`, `createProgress`, `paint` (4); `findRepository`, `inferGate`, `hasUncommittedChanges`, `NOT_A_REPOSITORY`, `NO_CHECK`, `UNCOMMITTED_NOTE` (5); `runIdFor`, `runPlace`, `prepareRunDir` (6); `agentSession`, `NOT_SIGNED_IN`, `TEST_MOCK_SCRIPT` (7); `summariseOutcome` (8).
- Produces:
  - `export const NO_TASK: string`
  - `export interface RunOptions { task?: string; repo?: string }`
  - `export interface CommandContext { cwd: string; env: NodeJS.ProcessEnv; colour: boolean; writeLine(line: string): void }`
  - `export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode>`
  - `runCli` gains the `run` subcommand (`--task <text>`, `--repo <path>`) and the global `--no-color`.

- [ ] **Step 1: Write the failing test**

Create `src/cli/run-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { writeMockScript, type MockScript } from "../mock-script.js";
import { SurfaceState } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { NOT_SIGNED_IN, TEST_MOCK_SCRIPT } from "./agent-session.js";
import { EXIT, UNEXPECTED_FOOTER } from "./failures.js";
import { runCli } from "./program.js";
import { NO_CHECK, NOT_A_REPOSITORY, UNCOMMITTED_NOTE } from "./project.js";
import { NO_TASK } from "./run-command.js";

const TASK = "add a function that says hello to a name, with a test";
const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });
const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const ESC = "[";
const RUN_TIMEOUT = 60_000;

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

/** A claude-mock script file for the contributor test seam. */
async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "run-command-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

const completes: MockScript = {
  expectations: [
    {
      effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
      json: { status: "completed", rationale: "added hello.js" },
    },
  ],
};

const escalates: MockScript = {
  expectations: [
    { json: { status: "escalate", category: "authority", rationale: "the task asks me to delete files I was not given" } },
  ],
};

/** Run `delivery <args>` in-process, capturing what it prints. Working copies go under a scratch state folder. */
async function delivery(args: string[], { cwd, env = {}, isTTY = false }: { cwd: string; env?: NodeJS.ProcessEnv; isTTY?: boolean }) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv: args,
    cwd,
    env: { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "run-command-state-")), ...env },
    stdout: { write: (text: string) => (stdout += text), isTTY },
    stderr: { write: (text: string) => (stderr += text) },
  });
  return { exitCode, stdout, stderr };
}

/** The branch a closing or escalating run names. */
function branchIn(stdout: string): string {
  const match = /branch (surface\/\S+?)\.?$/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no branch named in:\n${stdout}`);
  return match[1];
}

describe("delivery run", () => {
  it(
    "runs a task with nothing configured: the test script checks it, the work lands on a branch, and the base branch is untouched",
    async () => {
      const repo = initTempRepo("run-command-closed-", { "package.json": PACKAGE });
      const mainBefore = git(repo, ["rev-parse", "main"]);

      const { exitCode, stdout, stderr } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stderr).toBe("");
      expect(exitCode).toBe(EXIT.ok);
      const branch = branchIn(stdout);
      expect(stdout).toContain(`Done: the change for "${TASK}" passed \`npm test\` and is committed on branch ${branch}.`);
      expect(git(repo, ["show", `${branch}:hello.js`])).toContain("hello");
      expect(git(repo, ["rev-parse", "main"])).toBe(mainBefore);
      expect(git(repo, ["status", "--porcelain"])).toBe("");
    },
    RUN_TIMEOUT,
  );

  it(
    "prints one plain-language line per step and never a raw state name",
    async () => {
      const repo = initTempRepo("run-command-progress-", { "package.json": PACKAGE });
      const { stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      const steps = stdout.split("\n").filter((line) => line.startsWith("- "));
      expect(steps).toEqual([
        "- setting up",
        "- checking the starting point",
        "- the agent is working",
        "- checking the agent's work",
        "- wrapping up",
        "- done",
      ]);
      for (const state of SurfaceState.options) expect(stdout).not.toContain(state);
    },
    RUN_TIMEOUT,
  );

  it(
    "keeps the run's record in a self-ignoring folder and its working copy outside the repository",
    async () => {
      const repo = initTempRepo("run-command-places-", { "package.json": PACKAGE });
      const { stdout } = await delivery(["run", "--task", TASK], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) } });

      const runId = branchIn(stdout).replace("surface/", "");
      expect(existsSync(join(repo, ".delivery", "runs", runId, "case.json"))).toBe(true);
      expect(git(repo, ["check-ignore", ".delivery/runs"])).toBe(".delivery/runs");
      expect(readdirSync(repo).sort()).toEqual([".delivery", ".git", "package.json"]);
    },
    RUN_TIMEOUT,
  );

  it(
    "leads an escalated run with the decision asked of a person, and exits escalated",
    async () => {
      const repo = initTempRepo("run-command-escalated-", { "package.json": PACKAGE });
      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(escalates) },
      });

      expect(exitCode).toBe(EXIT.escalated);
      const decision = stdout.indexOf("This needs your decision: The worker stopped because it judged it lacked authority.");
      expect(decision).toBeGreaterThan(stdout.indexOf("- stopped: this needs a person"));
      expect(stdout.indexOf("the task asks me to delete files I was not given")).toBeGreaterThan(decision);
    },
    RUN_TIMEOUT,
  );

  it(
    "exits aborted when the run cannot start, as in a repository with no commits",
    async () => {
      const repo = mkdtempSync(join(tmpdir(), "run-command-aborted-"));
      git(repo, ["init", "-b", "main"]);
      writeFileSync(join(repo, "package.json"), PACKAGE);

      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [] }) },
      });

      expect(exitCode).toBe(EXIT.aborted);
      expect(stdout).toContain("The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit");
    },
    RUN_TIMEOUT,
  );

  it(
    "notes uncommitted changes, proceeds, and leaves git status as it found it",
    async () => {
      const repo = initTempRepo("run-command-dirty-", { "package.json": PACKAGE });
      writeFileSync(join(repo, "notes.txt"), "my own work in progress\n");
      const statusBefore = git(repo, ["status", "--porcelain"]);

      const { exitCode, stdout } = await delivery(["run", "--task", TASK], {
        cwd: repo,
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
      });

      expect(stdout).toContain(UNCOMMITTED_NOTE);
      expect(exitCode).toBe(EXIT.ok);
      expect(git(repo, ["status", "--porcelain"])).toBe(statusBefore);
    },
    RUN_TIMEOUT,
  );

  it(
    "prints colour on a terminal, and none when --no-color is passed",
    async () => {
      const coloured = await delivery(["run", "--task", TASK], {
        cwd: initTempRepo("run-command-colour-", { "package.json": PACKAGE }),
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes), NO_COLOR: "" },
        isTTY: true,
      });
      expect(coloured.stdout).toContain(ESC);

      const plain = await delivery(["run", "--task", TASK, "--no-color"], {
        cwd: initTempRepo("run-command-no-colour-", { "package.json": PACKAGE }),
        env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes), NO_COLOR: "" },
        isTTY: true,
      });
      expect(plain.exitCode).toBe(EXIT.ok);
      expect(plain.stdout).not.toContain(ESC);
    },
    RUN_TIMEOUT * 2,
  );

  it("refuses outside a git repository, naming the missing repository, with the configuration code", async () => {
    const { exitCode, stdout, stderr } = await delivery(["run", "--task", TASK], { cwd: mkdtempSync(join(tmpdir(), "run-command-not-repo-")) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NOT_A_REPOSITORY}\n`);
    expect(stdout).toBe("");
  });

  it("refuses a repository with no test script, naming the missing check, and writes nothing", async () => {
    const repo = initTempRepo("run-command-no-check-", { "README.md": "hi\n" });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NO_CHECK}\n`);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });

  it("refuses a run with no task, saying how to give one", async () => {
    const repo = initTempRepo("run-command-no-task-", { "package.json": PACKAGE });
    const { exitCode, stderr } = await delivery(["run"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe(`${NO_TASK}\n`);
  });

  it("stops before setting anything up when the agent runtime is not signed in, with the agent runtime code", async () => {
    const repo = initTempRepo("run-command-signed-out-", { "package.json": PACKAGE });
    const home = mkdtempSync(join(tmpdir(), "run-command-home-"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIALS.includes(name)));

    const { exitCode, stderr } = await delivery(["run", "--task", TASK], {
      cwd: repo,
      env: { ...env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") },
    });

    expect(exitCode).toBe(EXIT.agentRuntime);
    expect(stderr).toBe(`${NOT_SIGNED_IN}\n`);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
    expect(git(repo, ["status", "--porcelain"])).toBe("");
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
  });

  it("shows a failure it does not recognise by its message and the footer, never a stack trace", async () => {
    const repo = initTempRepo("run-command-unexpected-", { "package.json": PACKAGE, ".delivery": "a file where the run folder goes\n" });
    const { exitCode, stderr } = await delivery(["run", "--task", TASK], {
      cwd: repo,
      env: { [TEST_MOCK_SCRIPT]: await scriptFile(completes) },
    });
    expect(exitCode).toBe(EXIT.unexpected);
    expect(stderr).toContain(UNEXPECTED_FOOTER);
    expect(stderr).not.toContain("    at ");
  });

  it("lists the run command and --no-color in delivery --help", async () => {
    const { exitCode, stdout } = await delivery(["--help"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("run [options]");
    expect(stdout).toContain("--no-color");
  });

  it("describes itself with run --help, without mentioning the contributor test seam", async () => {
    const { exitCode, stdout } = await delivery(["run", "--help"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Usage: delivery run [options]");
    expect(stdout).toContain("--task <text>");
    expect(stdout).toContain("--no-color");
    expect(stdout).not.toContain(TEST_MOCK_SCRIPT);
  });

  it("treats an unknown option as a configuration mistake", async () => {
    const { exitCode, stderr } = await delivery(["run", "--bogus"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("unknown option '--bogus'");
  });
});
```

The in-process tests above exercise `src/`. The Operational note's regression harness drives the *compiled* command, where `package.json` and the vendored mock are resolved from `dist/` by relative path, so add one full run through the built binary. In `tests/delivery-command.test.ts`, replace the imports with:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { writeMockScript } from "../src/mock-script.js";
import { initTempRepo } from "../src/temp-repo.js";
import { DELIVERY_BIN, REPO_ROOT, runDelivery } from "./helpers.js";
```

and add this test inside the `describe` block:

```ts
  it("runs a task end to end from the compiled build, with the agent routed through the contributor test seam", async () => {
    const repo = initTempRepo("delivery-command-run-", {
      "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }),
    });
    const script = join(mkdtempSync(join(tmpdir(), "delivery-command-script-")), "mock.json");
    await writeMockScript(script, {
      expectations: [
        {
          effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
          json: { status: "completed", rationale: "added hello.js" },
        },
      ],
    });

    const { stdout, stderr, status } = runDelivery(["run", "--task", "add a hello function"], {
      cwd: repo,
      env: { ...process.env, [TEST_MOCK_SCRIPT]: script, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "delivery-command-state-")) },
    });

    expect(status, `${stdout}\n${stderr}`).toBe(EXIT.ok);
    expect(stdout).toMatch(/committed on branch surface\/add-a-hello-function-\d{8}T\d{6}Z\./);
  }, 60_000);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/cli/run-command.test.ts`
Expected: FAIL; cannot find module `./run-command.js`. Then run `npm run build && npx vitest run tests/delivery-command.test.ts`: the new compiled-build test FAILS with exit 2 and `unknown command 'run'` on stderr, because the built program has no `run` yet.

- [ ] **Step 3: Implement the run command**

Create `src/cli/run-command.ts`:

```ts
import { resolve } from "node:path";
import { createAgentPort } from "../agent-invoke.js";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, load } from "../case-file.js";
import { resolveCloser } from "../resolve-closer.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { deterministicRouter } from "../router.js";
import { advance, type AdvanceResult } from "../surface.js";
import { triageRoleConfig } from "../triage-role-config.js";
import type { SurfacePorts } from "../ports.js";
import type { CloserRef } from "../schema.js";
import { agentSession } from "./agent-session.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { summariseOutcome } from "./outcome.js";
import { createProgress, paint } from "./output.js";
import { findRepository, hasUncommittedChanges, inferGate, UNCOMMITTED_NOTE } from "./project.js";
import { prepareRunDir, runIdFor, runPlace } from "./run-location.js";

export const NO_TASK = 'Tell me what to do: add `--task "describe the change you want"`.';

/** The one closer a run uses when nothing else is configured: it needs only git, and leaves a branch to inspect before trusting it. */
const DEFAULT_CLOSER: CloserRef = { type: "commit-to-branch" };

/** What `delivery run` was given on the command line. */
export interface RunOptions {
  task?: string;
  repo?: string;
}

/** What a command needs from the process it runs in, passed in so tests can run it in-process. */
export interface CommandContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  colour: boolean;
  writeLine(line: string): void;
}

/**
 * `delivery run`: resolve the defaults, check the agent can start, then drive
 * one run to its end, one plain-language line per step.
 *
 * Every check that can refuse runs before anything is written, so a refusal
 * leaves the repository exactly as it was.
 */
export async function runCommand(options: RunOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const intent = options.task?.trim();
  if (!intent) throw new Refusal(NO_TASK, EXIT.configuration);
  const gateRef = await inferGate(repoPath);
  const session = await agentSession(ctx.env);
  if (await hasUncommittedChanges(repoPath)) ctx.writeLine(UNCOMMITTED_NOTE);

  const runId = runIdFor(intent, new Date());
  const { dir, location } = runPlace(repoPath, runId, ctx.env);
  await prepareRunDir(repoPath, dir);
  await create(dir, { surfaceId: runId, taskDef: { intent }, gateRef, closerRef: DEFAULT_CLOSER }, DEFAULT_BUDGETS);
  ctx.writeLine(`Starting run ${runId}: ${intent}`);

  const agent = createAgentPort(
    { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    session,
  );
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer: resolveCloser(DEFAULT_CLOSER, repoPath) };
  const progress = createProgress(ctx.writeLine, ctx.colour);
  progress.step("PROVISIONING");
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
    progress.step(result.state);
  } while (!result.done);

  const summary = await summariseOutcome(dir, await load(dir));
  ctx.writeLine(paint(ctx.colour, summary.tone, summary.headline));
  for (const line of summary.details) ctx.writeLine(line);
  return summary.exitCode;
}
```

- [ ] **Step 4: Add the `run` subcommand and `--no-color` to the program**

Replace the whole of `src/cli/program.ts` with:

```ts
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { EXIT, renderFailure } from "./failures.js";
import { useColour } from "./output.js";
import { runCommand, type RunOptions } from "./run-command.js";

/** Everything the command takes from the process that runs it. `main.ts` passes the real process; tests pass their own. */
export interface CliIo {
  /** The arguments after the command name. */
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
}

/** This package's own version: `package.json` sits two folders above both `src/cli/` and `dist/cli/`. */
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string };

/**
 * Parse `io.argv`, run the command it names, and return the exit code. Never
 * throws and never prints a stack trace: every failure is rendered by
 * `renderFailure`, and a usage mistake (an unknown option or command) is a
 * configuration exit after commander has said what was wrong.
 */
export async function runCli(io: CliIo): Promise<number> {
  let exitCode: number = EXIT.ok;

  const program = new Command("delivery")
    .description(
      "Hand an AI agent a task in plain English. It works on a copy of your repository, your own tests check the result, and the work is left on a branch for you.",
    )
    .version(version, "-V, --version", "print the harness version")
    .option("--no-color", "print without colour")
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) });

  program
    .command("run")
    .description("start a run: the agent works on the task, your test script checks it, and the result is committed to a new branch")
    .option("--task <text>", "what you want done, in plain English")
    .option("--repo <path>", "the git repository to work on (default: the current folder)")
    .action(async (options: RunOptions, command: Command) => {
      // A throw here rejects parseAsync with the original error, rendered once below.
      const { color } = command.optsWithGlobals<{ color: boolean }>();
      exitCode = await runCommand(options, {
        cwd: io.cwd,
        env: io.env,
        colour: useColour({ flag: color, env: io.env, isTTY: io.stdout.isTTY }),
        writeLine: (line) => io.stdout.write(`${line}\n`),
      });
    });

  try {
    await program.parseAsync(io.argv, { from: "user" });
    return exitCode;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode === 0 ? EXIT.ok : EXIT.configuration;
    const failure = renderFailure(err);
    io.stderr.write(`${failure.message}\n`);
    return failure.exitCode;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/cli/run-command.test.ts && npm run build && npx vitest run tests/delivery-command.test.ts && npx tsc --noEmit && npx eslint src/cli`
Expected: PASS (the run-command file takes roughly 5 to 10 seconds); `tsc` and ESLint print nothing. After the run, `git status --short` in the worktree shows only the files this task changed.

- [ ] **Step 6: Document the command for adopters and the seam for contributors**

In `README.md`, insert this section between `## Quick start` (after its code block) and `## Documentation`:

````markdown
## Run a task from the command line

In a git repository whose `package.json` has a `test` script:

```bash
delivery run --task "add a function that says hello to a name, with a test"
```

The harness hands the task to an agent working on a separate copy of your repository, checks
the result with `npm test`, and commits the work to a new branch; your base branch is not
touched. It prints a line for each step and ends by naming the branch or, if the agent needs a
decision from you, by saying what that decision is.

You need Node 22 or later, git, and a signed-in Claude Code (`claude auth login`, or set
`ANTHROPIC_API_KEY`). The command checks the sign-in before it starts. Until the package is
published, build and link the command from this checkout with `npm run build && npm link`.

Each run keeps its record in `.delivery/runs/` in your repository (the folder ignores itself,
so `git status` does not change) and its working copy under
`~/.local/state/delivery-service/worktrees/` (or `$XDG_STATE_HOME`, when set).

| Exit code | Meaning |
|---|---|
| 0 | The run finished and the work is on a branch |
| 1 | Something unexpected went wrong |
| 2 | Something about the setup or the command needs fixing |
| 3 | The agent could not start: Claude Code is missing or not signed in |
| 4 | The run stopped because it needs a decision from you |
| 5 | The run stopped before it could finish |

`delivery --help` and `delivery run --help` list the options; `--no-color`, or setting
`NO_COLOR`, turns colour off.
````

In `CONTRIBUTING.md`, insert this paragraph after the paragraph that ends "`claude-mock` command or rely on `PATH`.":

````markdown
To run the `delivery` command itself against `claude-mock`, set `DELIVERY_TEST_MOCK_SCRIPT` to
the path of a script written with `writeMockScript` from `src/testing.ts`. Every agent session in
the run then goes to `claude-mock`, the sign-in check is skipped, and the journal is written next
to the script as `<script>.journal.jsonl`:

```bash
DELIVERY_TEST_MOCK_SCRIPT=/tmp/scratch/mock.json delivery run --task "add a hello function"
```

This seam is for contributors only: it needs the dev dependency, so an installed copy refuses
it with a plain message, and it is deliberately left out of `--help`. `src/cli/run-command.test.ts`
drives the command in-process this way; `runDelivery` in `tests/helpers.ts` drives the compiled
binary.
````

- [ ] **Step 7: Commit**

```bash
git add src/cli/run-command.ts src/cli/run-command.test.ts src/cli/program.ts tests/delivery-command.test.ts README.md CONTRIBUTING.md
git commit -F - <<'EOF'
Add delivery run: a full run from a task description with nothing configured

This is the adoption floor: inside a git repository with a test script, one
command turns a plain-English task into verified work on a branch. It resolves
the defaults the spec chose (npm test by exit code, commit-to-branch,
DEFAULT_BUDGETS, the deterministic router), refuses before writing anything when
the repository, task, check or agent runtime is missing, prints one translated
line per step, and ends with an outcome and exit code a person and a script can
both act on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: A sample project to try the first run on ✅ DONE (deliver-slice)

**Files:**
- Create: `examples/sample-project/package.json`
- Create: `examples/sample-project/add.js`
- Create: `examples/sample-project/add.test.js`
- Create: `examples/sample-project/README.md`
- Modify: `eslint.config.js`
- Modify: `README.md`
- Test: `tests/sample-project.test.ts`

**Interfaces:**
- Consumes: `inferGate(repoPath): Promise<GateRef>` from `src/cli/project.ts` (Task 5); `REPO_ROOT` from `tests/helpers.ts`.
- Produces: `examples/sample-project/`, a git-ready project whose `npm test` passes as shipped.

- [ ] **Step 1: Write the failing test**

Create `tests/sample-project.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { inferGate } from "../src/cli/project.js";
import { REPO_ROOT } from "./helpers.js";

const SAMPLE = join(REPO_ROOT, "examples", "sample-project");

describe("the sample project", () => {
  it("has a test script the harness picks up as its check", async () => {
    expect(await inferGate(SAMPLE)).toEqual({ type: "command", command: "npm test", parseMode: "exitcode" });
  });

  it("passes its own tests as shipped, so a first run starts from green", () => {
    const { status, stdout, stderr } = spawnSync("npm", ["test"], { cwd: SAMPLE, encoding: "utf-8" });
    expect(status, `${stdout}\n${stderr}`).toBe(0);
  });

  it("ships only its source, so a copy is ready for git init", () => {
    expect(readdirSync(SAMPLE).sort()).toEqual(["README.md", "add.js", "add.test.js", "package.json"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sample-project.test.ts`
Expected: FAIL; `inferGate` refuses with `NO_CHECK` and `readdirSync` throws `ENOENT` because `examples/sample-project` does not exist.

- [ ] **Step 3: Create the sample project**

Create `examples/sample-project/package.json`:

```json
{
  "name": "sample-project",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

Create `examples/sample-project/add.js`:

```js
/** Adds two numbers. */
export function add(a, b) {
  return a + b;
}
```

Create `examples/sample-project/add.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "./add.js";

test("adds two numbers", () => {
  assert.equal(add(2, 3), 5);
});
```

Create `examples/sample-project/README.md`:

````markdown
# Sample project

A tiny project to try the harness on: one function, one test, and a `test` script, which is all
`delivery run` needs.

## Try a first run

1. Copy this folder somewhere outside the harness checkout and make it a git repository:

   ```bash
   cp -r examples/sample-project ~/sample-project
   cd ~/sample-project
   git init -b main
   git add -A
   git commit -m "Start the sample project"
   ```

2. Make sure Claude Code is signed in (`claude auth status`), or set `ANTHROPIC_API_KEY`.

3. If `delivery` is not on your `PATH` yet, run `npm run build && npm link` in the harness
   checkout.

4. Run:

   ```bash
   delivery run --task "add a function that says hello to a name, with a test"
   ```

5. When it finishes, the last message names a branch. Look at the work with
   `git log <branch>`; `main` is unchanged.
````

In `eslint.config.js`, change the final ignores entry:

```js
  {
    ignores: ["dist/", "node_modules/", "vendor/"],
  }
```

to:

```js
  {
    // examples/ holds plain JavaScript projects a person copies out; they are
    // outside tsconfig.json, so typed linting cannot parse them.
    ignores: ["dist/", "node_modules/", "vendor/", "examples/"],
  }
```

In `README.md`, add this line as the last paragraph of the "Run a task from the command line" section (after the `--no-color` sentence):

```markdown
To try it on something small first, use the [sample project](examples/sample-project/README.md).
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sample-project.test.ts && npx eslint . && npx tsc --noEmit`
Expected: PASS; ESLint and `tsc` print nothing.

- [ ] **Step 5: Commit**

```bash
git add examples/sample-project tests/sample-project.test.ts eslint.config.js README.md
git commit -F - <<'EOF'
Add a sample project for trying a first delivery run

A new user needs somewhere safe to try the command before pointing it at their
own work. The sample is the smallest project the defaults fit: a test script
that passes as shipped, no dependencies, and no repository of its own so a copy
is ready for git init. A test keeps it green and keeps the harness recognising
its check.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```
