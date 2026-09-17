---
type: phase-design
created: 2026-09-14
roadmap_item: 8
seeded_by: [50-20260913T211119Z-choose-a-licence-before-open-sourcing.md]
---

# CLI and Configuration — Design

> **Status:** ✅ Complete — 2026-09-17 — all 7 slices delivered
> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 8.
> Builds on: `2026-09-07-single-surface-state-machine-design.md` (`advance`, `run`, `SurfacePorts`, resume), `2026-09-04-gate-interface-design.md` (`GateRef`, command gate), `2026-09-11-close-interface-design.md` (`CloserRef`, built-in closers), `2026-09-09-agent-invocation-primitive-design.md` (`createAgentPort`, role configs), `2026-09-10-triage-and-router-design.md` (`deterministicRouter`, `EscalationPacket`), `2026-09-13-agent-mock-design.md` (`src/testing.ts`, vendored `claude-mock`, guide-as-test pattern).
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed; Dana's goal extended in place by this run).
> Audit trail: `docs/prd/2026-09-14-cli-and-configuration/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md).
> Produced by an autonomous design-team run (`20260914T200704Z`); no human reviewed it.

## Problem

The delivery harness works, but only as a library. To run it at all, a person
writes TypeScript against `src/index.ts`, constructs a case-file header, picks a
`BudgetSet` by hand, wires a `SurfacePorts` object and loops `advance()`
(research §1.2, §1.7). Every demo copies that wiring. Three published guides
(`docs/configuring-a-role.md`, `docs/writing-a-gate.md`,
`docs/testing-your-pipeline.md`) each say the harness "is not published as a
package yet" and route their examples through `npx tsx` against a clone
(research §1.8). Concretely, today:

1. **There is no tool to install.** `package.json` has no `bin`, `exports`,
   `files` or `license`; `tsconfig.json` sets `noEmit: true`, so there is no
   build output at all (research §1.10).
2. **Nothing has a default.** The library ships no default `BudgetSet` (every
   demo hand-writes the same literal), no default gate or closer, and no
   convention for where a case file lives (research §1.4, §1.5, §8).
3. **Crash recovery exists but nobody can reach it.** `advance`/`run` are
   unconditionally resumable from the case file, and `AdvanceResult.recovery`
   says what a resumed run put right, but no caller ever prints it and a user
   must remember the case-file directory to resume (research §1.4).
4. **A missing credential fails late and opaquely.** A real run needs a `claude`
   executable and a credential; neither the SDK seam nor the library checks,
   so a misconfigured machine surfaces only as `DID_NOT_COMPLETE.notRun`
   inside a terminus entry after a worktree was provisioned
   (`src/agent-invoke.ts:22-27`, research §1.11).
5. **Publication is blocked on a decision nobody has made.** There is no
   licence (seed idea `50-20260913T211119Z-choose-a-licence-before-open-sourcing.md`).
   The vendored `claude-mock` "inherits whatever licence this repository adopts"
   (`vendor/README.md`).

The roadmap names this item "the adoption gate": every later item (9, 11, 12,
13, 14) depends on the harness being invocable. The command surface and
configuration shape chosen here are what Item 9 extends; getting them wrong
means Item 9 replaces them.

## Personas

From `docs/personas.md`:

- **Dana Okafor, Non-technical Project Owner.** First-touch user of the CLI.
  This run extended her goal in place: install the harness and get a working
  run from a repo and a task description alone, no config file, no code. Also
  checks in later to see whether a run needs her.
- **Priya Shah, Harness Extender.** Wires her own gate and closer and wants the
  CLI to pick them up with no glue code; most likely to run unattended and hit
  a crash.
- **Marcus Webb, On-call Engineer.** Arrives after a run escalated, with no
  context and no live terminal; needs the packet's verbatim evidence.

## Scope

### Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The MUST tier below was derived from roadmap
Item 8's success criteria and accessibility note, and critic-reviewed as
conservative but usable (review-log, phase-choice verdict and round 2).

**MUST**

1. An installable package, `delivery-service`, exposing one binary, `delivery`.
   Both a global install and a no-install `npx delivery-service` invocation
   work. *(All personas; roadmap success criterion.)*
2. `delivery run` starts a single-surface run against a repository with a gate,
   a closer and a task, from a config file and/or flags. *(Dana, Priya.)*
3. Defaults such that repo + task description alone give a working run: a
   built-in gate and closer, a default budget set, and a case-file location the
   user never has to name. When a default cannot be inferred, the CLI names the
   one missing thing. *(Dana.)*
4. Plain-language terminal progress while the run is active. *(Dana, Priya.)*
5. A crashed run is resumed from the command line without the user supplying
   anything the harness can remember itself. *(Priya, Dana.)*
6. A preflight check for the agent runtime (executable and credential) before
   anything is provisioned, and plain-language errors for the base failure
   modes, with distinct exit codes. *(Dana; Priya and Marcus for scripting.)*
7. `delivery status` prints a finished run's outcome after the terminal that
   started it has gone: plain language for a closed run, the escalation
   packet's fields verbatim for an escalated one. One run, plain text.
   *(Marcus, Dana: both arrive later; neither can hand-read `case.json`.)*
8. A sample project and a getting-started guide, proven by a test that executes
   the guide's own instructions. *(Dana; roadmap DX note.)*
9. Semver and a changelog. *(Priya, as a consumer of the library API.)*
10. The package is publish-ready (build output, `bin`, `exports`, `files`, a
    release workflow, a clean publish dry-run). First publication is gated on
    the licence decision and is not performed by this phase. *(All personas;
    hard constraint of this run.)*

**SHOULD**

11. `--json` output for `run` progress and `status`, and `status --all` listing
    every run in the repository. *(Marcus scripting a check; CI.)*
12. `delivery init`: an interactive wizard that writes a config file by choosing
    a gate, a closer and a first task. *(Dana, first run.)*

**COULD**

13. `delivery doctor`: the preflight check (MUST 6) exposed as a standalone
    command.
14. Shell completion.
15. A public rehearsal mode (`--rehearse <script>`) that runs the CLI against
    `claude-mock` for adopters, once `claude-mock` is distributable beyond this
    repository's dev dependencies (see Non-goals).

## UX / Product

### Command surface

The package is `delivery-service`; the binary is `delivery`.

- **`delivery run [--task <text> | --task-file <path>] [--gate-command <cmd>] [--closer <type>] [--config <file>] [--repo <path>] [--fresh]`**
  Starts a run, or resumes the unfinished one (see Resume). `--repo` defaults
  to the current directory. `GateRef` and `CloserRef` are structured
  discriminated unions (`src/schema.ts`), so flags cover only the flat common
  cases: `--gate-command` is shorthand for
  `{ type: "command", command: <cmd>, parseMode: "exitcode" }`; `--closer`
  takes a built-in type with no required fields (`commit-to-branch`,
  `merge-back`, `open-pr`). A `custom` gate or closer, a non-default
  `parseMode`, or closer options such as `merge-back`'s `deleteBranch` are
  expressed in the config file only.
- **`delivery resume [<run-id> | --last] [--repo <path>]`** The explicit form of
  the resume `run` performs implicitly, for scripts and for a person who wants
  certainty. Errors plainly when no unfinished run exists.
- **`delivery status [<run-id> | --last] [--repo <path>] [--all]`** Read-only.
  For an unfinished run, prints the plain-language "what happens next"; for a
  finished run, the outcome, or the escalation packet when escalated (see
  Terminal output). `--all` *(SHOULD)* lists every run under `.delivery/runs/`
  instead of looking up one. Never advances state.
- **`delivery init [--repo <path>]`** *(SHOULD)* Interactive wizard; writes
  `delivery.config.json`. Never a required step.
- **`--help`** on every command; **`--version`** reads the installed package's
  own `version`.

Illustrative first run: `delivery run --task "add a health-check endpoint that returns 200"`.

### Configuration file

One file, `delivery.config.json` (or `delivery.config.js` / `.mjs` for an
extender who wants to compute values), holding exactly the four keys a run
needs:

```json
{
  "task": { "intent": "add a health-check endpoint that returns 200" },
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "budgets": { "correction": 5 }
}
```

- `task`, `gate`, `closer` are the library's existing `TaskDef`, `GateRef` and
  `CloserRef` shapes verbatim. Nothing new to learn beyond where they go.
- `budgets` sets caps only, as integers per population (`correction`,
  `gateError`, `gateMaintenance`, `terminus`, `close`), each optional and
  merged over the default budget set. The `used` counter is harness state and
  is never configurable.

**Precedence** (highest wins): flag, then environment variable, then config
file, then built-in default. Environment variables mirror the flags:
`DELIVERY_TASK`, `DELIVERY_GATE_COMMAND`, `DELIVERY_CLOSER`, `DELIVERY_CONFIG`.
This is the convention comparable tools follow (research §6), so a checked-in
config can be overridden for one run by a flag or for CI by an environment
variable.

**Relationship to Item 9.** Item 9's declarative surface is a superset of this
file: the same four keys, with new producers of them (prose that compiles to a
`TaskDef`, a gate selected by name) and new keys alongside (domain prompt, task
queue). Item 8 adds no role-config or system-prompt field; overriding a role's
`systemPromptFragment` or `allowedTools` stays a library-level code choice until
Item 9 designs its authoring surface.

### Defaults

- **Gate:** if the target repository's `package.json` has `scripts.test`,
  `{ type: "command", command: "npm test", parseMode: "exitcode" }`. `exitcode`
  is the only parse mode that assumes nothing about the runner's output
  (`src/command-gate.ts:71-72`). With no test script and no gate configured,
  the CLI refuses before provisioning and names the one missing thing.
- **Closer:** `commit-to-branch`. `merge-back` lands on the base branch with no
  review step, wrong for a first unsupervised run; `open-pr` needs a remote and
  forge credentials, turning "repo and task" into "repo, task, remote and
  token". `commit-to-branch` needs only git and leaves a branch the owner can
  inspect before trusting it.
- **Budgets:** `correction: 3, gateError: 3, gateMaintenance: 2, terminus: 5,
  close: 3`, the literal every demo and test already agrees on (research §1.5),
  lifted once into an exported library constant `DEFAULT_BUDGETS` so Item 9
  and any library caller share the same numbers.
- **Roles and triage:** the existing `workerRoleConfig`,
  `gateMaintenanceRoleConfig` and `deterministicRouter` (no second agent call
  on every setback). Agent-backed triage stays a library-level choice.
- **Task:** `--task <text>` becomes `{ intent: <text> }`, the minimal `TaskDef`
  every demo already builds.

### Primary journeys

**1. First run (Dana).** Dana installs the package and, inside the sample
project (a clean git repository with a `test` script), runs `delivery run
--task "…"`. The CLI runs the preflight check, infers the gate and closer,
creates the run, and prints one plain-language line per step. It finishes with
what was done and where to find it: a branch name, not a worktree path. If the
run escalates, it leads with the decision being asked of her.

**2. Extender wiring a custom gate and closer (Priya).** Priya writes modules
against the unchanged `Gate` and `CloserPort` contracts
(`docs/writing-a-gate.md`, `docs/writing-a-closer.md`) and names them in
`delivery.config.json` as `{ "type": "custom", "modulePath": "./gates/my-gate.js" }`.
She runs `delivery run` with no gate or closer flags. A wrong path or a module
that does not satisfy the contract produces a plain-language error pointing at
the relevant guide, not an import stack trace.

**3. Resuming after a crash (Priya, Dana).** The process is killed mid-run.
Running `delivery run` again (with the same task or none) resumes it and says
so in plain language, translating `resumeAction` ("picking up where it left
off: rechecking your work") and printing the `recovery` string when present.
If several unfinished runs exist, the CLI lists each (run id, start time, task)
and asks which to resume rather than guessing.

**4. Reading an escalated run later (Marcus, Dana).** A run ends escalated. The
terminal, if still attached, prints the outcome. Marcus arrives later with no
context and runs `delivery status --last`. The CLI prints the packet's
`decision`, `evidence`, `dead_ends`, `why_now` and `references` verbatim, plus
where the retained work is. Dana sees the same output, which leads with the
plain-language `decision` sentence (already written for a non-technical reader,
`src/escalation-packet.ts:62-95`) ahead of the technical evidence.

### Terminal output

- **Plain, append-only lines by default, in every environment.** One line per
  state transition, no cursor movement, spinners or box drawing. The same stream
  is CI-safe and screen-reader-safe. There is no automatic switch to a different
  format when stdout is not a TTY; `--json` (SHOULD) is an explicit opt-in that
  emits one JSON object per step (`{ state, done, recovery?, at }`).
- **States are translated, never shown raw in the human stream.** The state set
  is closed, so the table is small and fixed: "setting up", "checking the
  starting point", "the agent is working", "checking the agent's work", "the
  agent is fixing something", "wrapping up", "done". Raw state names appear only
  in `--json`.
- **Colour is decorative only.** Meaning is never carried by colour alone.
  Colour is dropped when `NO_COLOR` is non-empty, when `--no-color` is passed,
  or when stdout is not a TTY.
- **Outcome summary** leads with plain language in terms of the task ("the
  tests passed and the change is on branch `…`" / "this needs your decision:
  …"). For an escalation, the verbatim evidence follows beneath it; it is never
  paraphrased away, which is Marcus's bar.

### Error and warning states

Every message names the problem and the fix without harness vocabulary
("worktree", "envelope", "surface", a state name).

| Condition | What the user sees | Exit |
|---|---|---|
| No `claude` executable | "I can't start the agent that does the work: the Claude Code CLI isn't installed or isn't on your PATH. Install it, then try again." | 3 |
| No credential | "I can't start the agent that does the work: you're not signed in. Run `claude login`, or set `ANTHROPIC_API_KEY`, then try again." | 3 |
| Not a git repository | "This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one." | 2 |
| No test script and no gate | "I couldn't find a command to check the agent's work with. Tell me what marks a change as good, for example `--gate-command \"npm test\"`, or add a `test` script to your `package.json`." | 2 |
| Unknown closer type | "I don't know the closer type `<type>`. Built-in options are `commit-to-branch`, `merge-back` and `open-pr`, or point at your own with `{ \"type\": \"custom\", \"modulePath\": \"…\" }`." | 2 |
| Custom gate/closer fails to load | "Couldn't load the custom gate at `<modulePath>` (`<detail>`). Check the path, and that it exports what `docs/writing-a-gate.md` describes." (closer: `docs/writing-a-closer.md`) | 2 |
| Different task requested while an unfinished run exists | "There's a run that didn't finish (started `<time>`, task: `<intent>`). Run `delivery resume` to finish it, or add `--fresh` to start this new task anyway." | 2 |
| Uncommitted changes in the repository (warning, run proceeds) | "Note: you have uncommitted changes. The agent works from your last commit, so it won't see them." | n/a |

The uncommitted-changes case is a warning, not a refusal: provisioning branches
a fresh worktree from the base ref (`src/provision.ts:44-58`), so uncommitted
edits in the user's checkout cannot contaminate the run; they are simply
invisible to it, which is what the user needs to know.

**Exit codes:** `0` closed, `1` unexpected/internal error, `2` configuration or
input problem, `3` agent runtime precondition unmet, `4` run escalated (needs a
human), `5` run aborted. `status` and `init` exit `0` on success and `2` when
the named run or repository is not found. The six-way split lets a script or a
future scheduler (Item 13) tell "needs attention" from "broke" from "wrong
config" without parsing text.

## Architecture

### Packaging

The package ships compiled JavaScript, following the precedent of
`vendor/claude-mock` inside this repository (`bin` to a shebang'd compiled
entry, `tsc` build; research §2).

- **Build:** `tsc` emits `dist/` from `src/`, including a new `src/cli/`. No
  bundler: the package is ESM-only with two runtime dependencies that stay
  external, so dual-format output or inlining would be unrequested. The
  typecheck-only CI step remains; the publish build is the same compiler
  without `noEmit`.
- **`bin`:** `{ "delivery": "./dist/cli/main.js" }`.
- **`exports`:** `.` → `./dist/index.js` (the existing library surface) and
  `./testing` → `./dist/testing.js` (the Item 7 testing API). `src/cli/**` is
  not exported and carries no API stability promise.
- **`files`:** an allow-list (`dist`, `README.md`, `CHANGELOG.md`, and
  `LICENSE` once one exists).
- **`engines`:** `node >= 22`, unchanged. ESM throughout, matching
  `"type": "module"`.

### Command layer

`commander` parses arguments, routes subcommands and generates `--help`. Each
command is a thin handler: resolve configuration, compose ports, then call
library functions. Handlers never reach into library internals beyond the
exported API plus `DEFAULT_BUDGETS`.

### Configuration loading

- **Discovery:** `--config`/`DELIVERY_CONFIG` if given; otherwise walk upward
  from `--repo` (default cwd) for `delivery.config.{json,js,mjs}`, stopping at
  the directory containing `.git` or the filesystem root. No file is not an
  error.
- **Schema:** one `zod` object in the CLI layer composing the library's own
  schemas:

  ```ts
  const DeliveryConfig = z.object({
    task: TaskDef.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: z.object({
      correction: z.number().int().positive(),
      gateError: z.number().int().positive(),
      gateMaintenance: z.number().int().positive(),
      terminus: z.number().int().positive(),
      close: z.number().int().positive(),
    }).partial().optional(),
  }).strict();
  ```

  `.strict()` rejects an unknown key with a plain-language error naming it, so
  a typo is not silently ignored.
- **Resolution:** flags, then env, then file, then defaults, merged into a
  `CreateHeader` (`surfaceId`, `taskDef`, `gateRef`, `closerRef`) and a
  `BudgetSet` (each cap becomes `{ used: 0, max }`).

### Where runs live

- **Case file:** `<repo>/.delivery/runs/<run-id>/`. Colocated with the
  repository so `resume` and `status` never need a path. The CLI makes the
  directory self-ignoring by writing `.delivery/.gitignore` containing `*`; it
  never edits the user's own `.gitignore`, so starting a run does not itself
  dirty their tree.
- **Run id (the `surfaceId`):** `<slug>-<UTC timestamp>`, where the slug is the
  first few words of the task intent, lower-cased and hyphenated. Timestamped
  ids mean re-running a finished task starts a new run rather than colliding
  with the old case file. The id is printed at start and in every `status`
  listing.
- **Worktree:** outside the repository, at
  `<state-home>/delivery-service/worktrees/<repo-key>/<run-id>`, where
  `<state-home>` is `$XDG_STATE_HOME` or `~/.local/state`, and `<repo-key>` is
  derived deterministically from the repository's real path. Keeping it out of
  the repository stops the user's own tooling (a test runner globbing from the
  repo root) from picking up the agent's copy. This matches the estate's
  `autoloop`, which places its worktrees under `~/.local/state/autoloop/`. Because
  `SurfaceLocation` is supplied on every `advance` call rather than persisted,
  the path is recomputed from `(repo, run-id)` on resume.

### Run lifecycle composition

`run` and `resume` compose the same wiring every demo writes by hand, once:

- Resolve configuration and defaults into a header and budgets.
- Resolve the case-file directory and `SurfaceLocation { repoPath, worktreePath }`.
- Run the preflight check (below).
- Build `SurfacePorts`: `agent` from `createAgentPort` with the default role
  configs (`src/agent-invoke.ts:164-170`); `triage` is `deterministicRouter`;
  `closer` from `resolveCloser(closerRef, repoPath)`.
- `create(dir, header, budgets)` when no case file exists; otherwise the
  existing case file is used as-is and its persisted header wins over any
  flags (a resumed run cannot be silently reconfigured mid-flight; conflicting
  flags produce a warning naming what was ignored).
- Loop `advance(dir, location, ports)` until `done`, rendering each
  `AdvanceResult`.
- Print the outcome and exit with the mapped code.

No new library API is needed beyond `DEFAULT_BUDGETS`: `advance` and `run`
already provide what a CLI needs.

### Resume

Resume is discovery plus the library's existing idempotent `advance`
(`src/surface.ts:774-781`).

- **Unfinished run:** a case file under `.delivery/runs/` with no `outcome`.
- **`delivery run`:** with no unfinished run, starts a new one. With exactly one
  unfinished run and no `--task` (or a `--task` whose intent equals that run's),
  resumes it. With a different `--task`, refuses (exit 2) naming the unfinished
  run, unless `--fresh` is passed, in which case a new run starts and the old
  one stays on disk, resumable. With several unfinished runs and no explicit id,
  lists them and asks which (in a non-interactive terminal, refuses with the
  list and exit 2).
- **`delivery resume`:** the same discovery without ever starting a new run;
  `--last` picks the most recently modified unfinished run.
- **Reporting:** before the first `advance`, the CLI prints the translated
  `resumeAction(logTail(caseFile))` (`src/case-file.ts:414-434`); after each
  step, any `recovery` string.

Running two processes against the same run concurrently is out of scope
(Item 10 owns concurrency); the CLI adds no lock file, which could itself go
stale and break idempotent resume.

### Progress reporting

The observation seam is the CLI's own `advance` loop: after every step it holds
an `AdvanceResult` (`{ state, done, recovery? }`, `src/surface.ts:14-24`) and
renders it through a small renderer (human lines, or JSON lines under `--json`).
No event or observer API is added to `src/surface.ts`. Item 11 can replace or
augment the renderer (for example, also writing each step to a structured log)
without the run loop changing.

### Status

`status` is `load` plus lookup tables, never `advance`. For an unfinished run
it prints the translated `resumeAction`. For a finished run it prints the
`CaseFileOutcome` (`kind`, `reason`, `at`). When `kind` is `escalated`, it reads
the packet named by `packetRef` from the run's `refs/` and prints `decision`,
`evidence`, `dead_ends`, `why_now` and `references` verbatim
(`src/triage-role-config.ts:29-36`), followed by the retained branch and
worktree location.

### Error model

A CLI-only lookup keyed on each typed error's `code` (`src/errors.ts`) maps it
to a plain-language template and an exit code. Library errors are unchanged
and keep their structured fields for programmatic callers.

| Error | Rendering | Exit |
|---|---|---|
| `FileNotFound` | No run found at the named id; suggests `delivery run` or `status --all`. | 2 |
| `CorruptCaseFile` | The saved run can't be read back (usually a kill mid-write); names the directory and that removing it starts afresh. | 1 |
| `WriteFailure` | Couldn't write the run directory; check disk space and permissions. | 1 |
| `DuplicateIdError` | The gate's output repeats an assertion id; ids must be unique. | 2 |
| `GateModuleLoadFailure`, `InvalidGateExport` | Custom gate failed to load; points at `docs/writing-a-gate.md`. | 2 |
| `CloserModuleLoadFailure`, `InvalidCloserExport` | Custom closer failed to load; points at `docs/writing-a-closer.md`. | 2 |
| `ProvisioningFailure` | Couldn't set up a working copy of the repository; check it is a git repository with at least one commit and write access. | 2 |
| `InvalidRoleConfig` | Invalid role setting, naming the field; points at `docs/configuring-a-role.md`. | 2 |
| `MockNotInstalled` | Passed through (already plain language); notes that mock runs exist only inside a development checkout. | 2 |
| `ImmutabilityViolation`, `MissingBaseline`, `IllegalStateTransition` | Internal invariant broken: "this is a bug", asks for an issue with the run directory attached. | 1 |
| `ParseError` | Never reaches the CLI: the command gate turns it into a gate `ERROR` report that the run routes itself (`src/command-gate.ts:78-82`). | n/a |

Anything else is caught once at the top level, printed with its message and an
honest "this is unexpected, please file an issue" footer, and exits `1`. A known
error class never reaches the terminal as a stack trace.

### Agent runtime preflight

Before provisioning, a real run checks that the `claude` executable the SDK
would launch resolves and is executable, and that at least one of
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` is set,
or that Claude Code has a stored login (research §1.11). Failure exits `3` with
the message naming which precondition is unmet. The check lives in the CLI, not
the library: a library caller that has already resolved its environment should
not pay for it on every `invoke`. Test runs routed to `claude-mock` skip it,
since `mockSessionEnvironment` deliberately strips credentials
(`src/mock-session.ts:9-13,36-43`).

### Security

- **Gate commands and custom modules** execute with the invoking user's
  authority, exactly as today (`src/command-gate.ts:26-30`,
  `src/plugin-loader.ts:21-54`). A `delivery.config.json` is as trusted as the
  repository's `package.json` scripts or CI workflow. Item 8 adds no sandbox.
  (ponytail: no sandbox around gate commands or custom modules; revisit if the
  CLI ever runs configs from repositories the operator does not otherwise
  trust, such as a PR-triggered mode in Item 14.)
- **Secrets:** the config schema has no secret-bearing field. Credentials are
  read from the environment by the SDK and are never written to `case.json`,
  the log, `refs/`, progress output or error messages. Any future field that
  references a credential must name an environment variable, resolved in
  memory.
- **The case file** is plain JSON on disk by design (crash recovery needs it);
  the CLI persists nothing more sensitive than the library already does.

### Non-functional requirements

- **Determinism:** identical configuration and case-file state produce identical
  headers, prompts and routing. The CLI adds non-determinism only to rendering
  (timestamps, elapsed time) and to run-id creation, which happens once and is
  then persisted.
- **No network calls by the CLI itself.** Only the agent SDK's own calls leave
  the machine, so the CLI's end-to-end and guide tests run offline.
- **Idempotent resume** is preserved: the CLI keeps no per-invocation state
  outside the case file, and the worktree path is a pure function of
  `(repo, run-id)`.
- **Startup cost:** compiled JavaScript keeps `status`, invoked repeatedly by a
  person watching a long run, at Node's baseline module-load cost.

### Testing

- **Unit (vitest):** precedence merging, default inference, run-id and worktree
  path derivation, resume discovery rules, the error lookup table, the state
  translation table, the preflight check. No process spawned.
- **CLI end-to-end:** tests spawn the compiled `dist/cli/main.js` against a
  scratch repository (`initTempRepo`) with the agent routed to the vendored
  `claude-mock` through `mockSessionEnvironment` (`src/testing.ts`), asserting
  stdout, exit code and the case file on disk. The routing is a contributor-only
  test seam (an environment variable naming a mock script, documented in
  `CONTRIBUTING.md`, absent from `--help`), because `claude-mock` is a dev
  dependency and is not present in a published install.
- **Getting-started guide as a test:** `tests/getting-started-guide.test.ts`
  reads `docs/getting-started.md`, extracts its commands with the existing
  section and snippet helpers in `tests/helpers.ts`, and executes them against
  the built CLI and the sample project with the agent routed to `claude-mock`,
  asserting the documented output. The guide text shows the real commands a
  person types. This is the same property `tests/testing-your-pipeline-guide.test.ts`
  gives the testing guide: the guide cannot drift from the tool.
- **Sample project:** one small fixture repository at
  `examples/sample-project/` with a trivial `test` script. It is the target of
  the getting-started guide and its test: one fixture, one guide, one test.
- **Publish readiness:** CI builds the package, installs it from a local pack
  into a scratch directory, runs `delivery --version` from that install, and
  runs a publish dry-run.

### Release and versioning

- **Semver,** starting at `0.1.0` for the first published version: usable, no
  stability promise yet. `1.0.0` is a later, deliberate decision.
- **Changelog:** `changesets` generates `CHANGELOG.md` in Keep a Changelog form
  from changeset files attached to PRs. The repository's commit messages are
  prose, not Conventional Commits, which `semantic-release` and
  `release-please` would require. `CONTRIBUTING.md` gains the changeset step.
- **Tagged releases:** a GitHub Actions job alongside the existing
  `.github/workflows/ci.yml` runs the changesets version flow on merges to
  `main`, producing a version PR, a tag and the changelog entry.
- **Licence gate:** `package.json` carries no `license` field and the workflow's
  publish step is disabled until a human adds a `LICENSE` file and an SPDX
  identifier. Once that happens, publishing with provenance is one operator
  action. This design does not choose a licence and does not publish. The same
  decision settles the vendored `claude-mock` copy's effective licence.

### Extensibility

- **Item 9** extends `DeliveryConfig` with new optional keys and higher-level
  producers that compile to the same `TaskDef`/`GateRef`/`CloserRef` shapes,
  reusing this item's discovery, precedence and validation. `init` is its
  starting scaffold for guided authoring.
- **Item 10** reuses the config schema and the per-surface port composition;
  `run` is where a queue or surface-count option would land.
- **Item 11** replaces or augments the renderer at the `AdvanceResult` seam and
  builds on `status`.
- **Item 13** drives `delivery run` unattended; plain non-TTY output, `--json`
  and distinct exit codes are what a scheduled invocation needs.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Build output | Reuse `tsc` (existing dev dependency) | `tsup`, `tshy`, `pkgroll` | ESM-only, dependencies external: nothing for a bundler to do. `vendor/claude-mock` proves plain `tsc` for this package shape in this repository. |
| Argument parsing and subcommands | Buy `commander` | `util.parseArgs`; hand-rolled flag allow-lists (as `open-design` does) | Four subcommands with their own flags and generated help. `util.parseArgs` has no subcommand routing or help, so both would be hand-rolled. The estate's CLIs have one or two flags per command and are not close analogues (research §2, §3). |
| Config discovery and loading | Build (stdlib `fs` and dynamic `import()`) | `cosmiconfig`, `lilconfig`, `c12` | One filename family, JSON or JS, walked up to the repository root. Stdlib covers it in a few dozen lines; a multi-format loader earns its place only if Item 9 needs YAML. |
| Config validation | Reuse `zod` (existing runtime dependency) | A second schema library; hand-written checks | Composes the library's existing `TaskDef`, `GateRef`, `CloserRef` schemas, so the CLI adds no parallel contract. |
| Interactive `init` prompts (SHOULD) | Buy `@inquirer/prompts` | `@clack/prompts`, `enquirer`, `readline` | Estate precedent: `autoloop` ships its setup wizard on `@inquirer/prompts` (`/home/jorjives/dev/autoloop/package.json`). The architect's draft preferred `@clack/prompts` for footprint; assembly chose the estate library, since `init`'s three prompts need nothing either lacks and conformity with the sibling wizard outweighs a few kilobytes. |
| Terminal progress | Build (line renderer over `AdvanceResult`) | `ora`, `listr2` | Single surface, one line per transition, already what every demo prints. TTY and `NO_COLOR` detection are stdlib checks. A spinner or task list would pre-empt Item 11. |
| Release automation and changelog | Buy `changesets` | `semantic-release`, `release-please`, manual | Human-authored changelog entries fit a prose commit style; the alternatives require Conventional Commits. |
| Default budgets | Build (lift the existing literal into `DEFAULT_BUDGETS`) | Keep per-caller literals | Every demo and test already agrees on the values; one exported constant removes the copies and gives Item 9 the same numbers. |
| Default gate and closer inference | Build | None exists upstream | The roadmap requires repo + task alone to work and nothing upstream provides defaults. |
| Agent runtime preflight | Build | None: the SDK collapses launch failures into one signal | A few checks for an executable and credential variables; no library does this for this CLI. |
| Plain-language error mapping | Build (lookup keyed on existing error `code`s) | None | The prose is domain-specific to this harness; the typed errors already carry the keys. |
| Worktree location convention | Reuse estate convention | Inside the repository; OS temp directory | `autoloop` keeps worktrees under `~/.local/state/`. Inside the repository risks the user's tooling scanning the agent's copy; temp directories may be wiped between a crash and a resume. |

## Operability / DX

- **Environment:** Node 22 or later, git, and for real runs the Claude Code
  executable with a credential. The CLI checks the last two itself before doing
  anything irreversible.
- **Harness:** vitest for unit tests; compiled-CLI end-to-end tests and the
  guide test drive `dist/cli/main.js` against the vendored `claude-mock` and
  scratch repositories, fully offline, with no API key. CI already runs lint,
  typecheck and tests on every push and PR; it additionally builds the package,
  exercises an install from a local pack, and runs a publish dry-run.
- **Scaffolding:** `src/cli/` holds the command handlers, config loader,
  defaults, renderer, error table and preflight. `examples/sample-project/` is
  the one fixture. `docs/getting-started.md` is the adoption document, and the
  existing guides drop their "not published yet" caveat in favour of the
  installed package's import paths (`delivery-service`,
  `delivery-service/testing`).
- **Local-run story:** a contributor runs the CLI from a checkout through the
  compiled output or directly from source with `tsx`, and routes it to
  `claude-mock` through the documented contributor test seam. An adopter runs
  the installed `delivery` binary against their own repository.
- **Deploy target:** the npm registry package `delivery-service`, versioned by
  changesets and released from tagged merges to `main`, with the publish step
  held behind the licence decision. Until then the deliverable is a
  publish-ready package installable from a local pack or a git URL.
- **Diagnosability:** every run leaves `<repo>/.delivery/runs/<run-id>/`
  readable by `delivery status`; escalated runs keep their branch and worktree
  for inspection, and `status` says where they are.

## What this design does not include

- **Item 9's declarative project configuration:** natural-language task
  structuring, domain system-prompt authoring or preview, role-config fields in
  the config file, a task queue, a standalone validation command.
- **Multi-surface concurrency, locking or a queue** (Item 10).
- **A reporting surface beyond the terminal renderer and `status`:** live
  dashboards, cross-run summaries, plain-language summaries generated at triage
  time (Item 11).
- **Task packs** (Item 12) and **scheduling or event triggers** (Items 13, 14).
- **Choosing a licence or performing the first public publish.** Human-gated.
- **Agent-backed triage from the CLI;** it stays a library-level choice.
- **A plugin distribution mechanism** for custom gates and closers: `custom`
  stays a local module path.
- **Distributing `claude-mock` to adopters** (a public rehearsal mode is COULD
  15, blocked on this).
- **Sandboxing** gate commands or custom modules.
- **YAML or TOML config formats.**
- **Pushing branches or remote interaction** beyond what the existing `open-pr`
  closer already does when explicitly selected.

## Assembly resolutions

The product design and architecture were each critic-approved, but disagreed or
were silent on several points. The team-lead resolved them at assembly:

1. **Progress wording.** The architecture printed raw state names on a TTY; the
   product design required translated phrases. Resolved to translated phrases
   in the human stream, raw names only in `--json`, because Dana is the
   first-touch persona.
2. **Non-TTY output.** The architecture switched automatically to JSON lines when
   stdout was not a TTY; the product design kept plain lines everywhere with
   JSON as an opt-in. Resolved to plain lines always and explicit `--json`: CI
   logs stay human-readable and output does not change shape unexpectedly.
3. **Flag names.** Adopted the product design's `--repo`, `--gate-command`,
   `--closer`, `--fresh` over the architecture's positional `repoPath` and
   `--gate`; kept the architecture's `--task-file`. Dropped `--id` and the
   config `dir` key (no persona need; the run id is generated).
4. **Escalation output.** The architecture printed only the packet's `decision`
   with a pointer; the product design's MUST 10 printed all five fields
   verbatim. Resolved to the product design, which is Marcus's bar.
5. **Budget config shape.** Neither form agreed (`{ "max": 3 }` objects versus
   `BudgetSet.partial()`, which would expose `used`). Resolved to integer caps.
6. **`.gitignore` handling.** Both proposed appending to the user's
   `.gitignore`, which dirties their tree on first run. Resolved to a
   self-ignoring `.delivery/.gitignore`.
7. **Worktree location.** Neither artefact placed the worktree. Resolved to the
   estate's `~/.local/state` convention, outside the repository.
8. **Dirty working tree.** The product design refused to run on uncommitted
   changes. Provisioning branches from the base ref (`src/provision.ts`), so
   uncommitted edits cannot contaminate a run. Resolved to a warning.
9. **Resume with a different task,** and run-id collisions for a re-run
   finished task, were unspecified. Resolved by timestamped run ids and the
   refusal-unless-`--fresh` rule.
10. **`init` prompt library.** Changed from `@clack/prompts` to the estate's
    `@inquirer/prompts` (see Buy-vs-build).
11. **Mock routing.** The architecture exposed a public `--mock` flag that cannot
    work in a published install. Resolved to a contributor-only test seam, with
    public rehearsal deferred to COULD 15.

## Open questions

1. **Licence.** MIT, Apache-2.0 or another choice (facts in research §7). Gates
   first publication and settles the vendored `claude-mock`'s effective licence.
   Needs a human.
2. **Default budget values for a first run.** The defaults reuse what the test
   suite exercises. Whether a first-run owner would be better served by a more
   generous correction budget is unvalidated.
3. **Default gate beyond npm.** Inference covers `package.json` `scripts.test`
   only; repositories using other ecosystems get the "name the missing thing"
   error. Whether to infer `make test`, `pytest` or `cargo test` is left to
   evidence from real use.
4. **Credential detection for a stored Claude Code login** relies on how the
   installed Claude Code persists its login, which is outside this repository's
   control; the preflight must treat an undetectable login as unmet only when no
   credential variable is set either, and the exact probe needs confirming
   against the SDK version in use.
