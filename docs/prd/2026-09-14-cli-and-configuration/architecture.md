# Architecture: CLI and Configuration (Roadmap Item 8)

Status: draft, pending critic approval.

This document describes the system as it will exist once Item 8 ships: an
installable `delivery-service` package exposing a `delivery` CLI over the
existing single-surface library (`src/surface.ts`, `src/ports.ts`,
`src/case-file.ts`, `src/schema.ts`). It does not prescribe build order —
that is a plan's concern.

All factual claims about the current codebase are grounded in
`docs/prd/2026-09-14-cli-and-configuration/research.md` (cited as §N below)
and were separately verified by reading the cited source files.

## 1. Platform and packaging strategy

**The package ships compiled JavaScript, not TypeScript run through `tsx`.**
Today the whole project runs as raw TypeScript via `tsx` with no build step
(`tsconfig.json`'s `noEmit: true`; research §1.10). That is fine for a
git-cloned contributor checkout but wrong for a published CLI: it would force
every consumer to have `tsx`/`ts-node` on their machine and pay a transpile
cost on every invocation. `vendor/claude-mock`, already vendored inside this
repo, is a working precedent for the alternative: `tsc` compiles `src/` to
`dist/`, `bin` points at a compiled entry, the shebang'd entry file is
`chmod +x`'d at build time (research §2, §4). Item 8 adopts that same shape
for `delivery-service` itself.

- **Build**: `tsc` emits `dist/` from `src/` (library) and a new `src/cli/`
  (CLI). No bundler. The project has two runtime dependencies
  (`@anthropic-ai/claude-agent-sdk`, `zod`) and one new one (the CLI framework,
  §3); there is nothing here a bundler earns its keep on — `tsup`/`unbuild`
  solve dual ESM/CJS output and dependency inlining, neither of which this
  package needs (`type: "module"`, ESM-only, dependencies stay as
  dependencies). `tsc` alone is the buy-vs-build "already have the tool"
  choice: it is already a devDependency and already runs in CI as `tsc
  --noEmit`; the only change is dropping `--noEmit` for the publish build.
- **`bin`**: `{ "delivery": "./dist/cli/main.js" }`. One binary, one shebang'd
  entry, mirroring `vendor/claude-mock/package.json`'s `bin` shape exactly
  (research §2, §4).
- **`exports`**: two conditions — `.` maps to `./dist/index.js` (the existing
  library surface, unchanged in shape) and `./testing` maps to
  `./dist/testing.js` (the existing testing API, `src/testing.ts`). The CLI
  itself (`src/cli/**`) is not exported: it is consumed only via `bin`, never
  `import`ed, so it carries no public-API stability promise and can be
  restructured freely. This keeps the roadmap's "library API stays usable"
  property (Items 9/10/11/13 all import `src/index.ts` directly, per the
  roadmap's dependency graph) while adding the CLI as a second, independent
  entry point rather than a replacement.
- **`files`**: an allow-list (`dist`, `README.md`, `CHANGELOG.md`, `LICENSE`
  once one exists) rather than `.npmignore` — fails safe by construction
  (research §4).
- **`engines`**: `{ "node": ">=22" }`, already set and unchanged
  (`package.json`; research §1.10).
- **Module system**: ESM throughout, matching the existing `"type": "module"`
  and every source file's `import`/`export` syntax already in `src/`. No
  CommonJS interop layer is added — there is no evidence any consumer needs
  `require()`, and adding dual output would be speculative flexibility the
  ladder rejects.

## 2. Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Compiled build output | Buy (reuse `tsc`, already a devDependency) | `tsup`/`tshy`/`pkgroll` bundlers | No dual-format or bundling need exists (ESM-only, deps stay external); `vendor/claude-mock` already proves plain `tsc` works for exactly this package shape in this monorepo (research §2, §4). Adding a bundler would be an unrequested abstraction. |
| Argument parsing + subcommand routing | Buy (`commander`) | `util.parseArgs` (stdlib); hand-rolled flag whitelisting (as `open-design` does, research §2) | The CLI has multiple subcommands (`run`, `resume`, `status`, `init`) each with their own flags, needs auto-generated `--help`, and needs `--` passthrough conventions users expect from git/npm-style tools. `util.parseArgs` has no subcommand routing or help generation — both would be hand-rolled, which is exactly the boilerplate commander already solves at zero runtime dependencies (research §3). None of the estate's prior art (`vendor/claude-mock`, `autoloop`, `open-design`; research §2) has more than one or two flags per single command, so it is not a close analogue against which to prefer hand-rolling here. |
| Config file discovery/loading | Build (small, hand-rolled) | `cosmiconfig`, `c12`, `lilconfig` (research §3) | The discovery need is narrow and fixed: one filename family (`delivery.config.{json,js,mjs}`), walked upward from cwd like git, no YAML/TOML requirement this phase. Node's own `fs`/dynamic `import()` cover it in well under the surface area of a general-purpose multi-format loader. Reaching for a library here would be pulling a dependency to save the ~30 lines stdlib already provides — the ladder's rung 3 (stdlib) holds. Item 9 may revisit this if it needs additional formats a non-technical author expects (e.g. YAML); that is Item 9's decision to make against its own requirements, not one to pre-empt here. |
| Config schema validation | Reuse-estate (`zod`, already a runtime dependency) | A second schema library; hand-written validation | `zod` is already load-bearing throughout `src/schema.ts`, `src/role-config.ts`. The CLI's config schema is a `z.object` that composes the *existing* `GateRef`/`CloserRef`/`BudgetSet`/`TaskDef` schemas (§4 below) rather than re-describing their shapes, so it is additive, not a new dependency or a parallel contract. |
| Interactive `init` wizard prompts | Buy (`@clack/prompts`) | `enquirer`, `@inquirer/prompts`, hand-rolled `readline` | `autoloop` (this author's own estate, research §2) already ships an interactive setup wizard and validates the pattern is wanted; `@clack/prompts` is the lightest of the three surveyed options (~4KB gzipped, ESM) and `init` is explicitly SHOULD/COULD-tier (review-log), so the smallest footprint choice that still meets the bar wins. `enquirer`/`inquirer` bring no capability `init`'s small prompt set (pick a gate, pick a closer, describe the task) needs. |
| Terminal progress | Build (line-based `console` output + a small observer seam) | `ora`, `listr2` | This phase is single-surface only (Item 10's multi-surface concurrency is explicitly out of scope) — there is exactly one thing progressing at a time, so there is nothing for a multi-task list renderer (`listr2`) to render, and a single spinner (`ora`) adds an animation dependency for a state machine that already prints one line per state transition today in every demo (`demos/single-surface-slice-2-happy-path.ts`, research §1.7). `NO_COLOR` and non-TTY detection are a handful of stdlib checks (`process.stdout.isTTY`, `process.env.NO_COLOR`), not a library concern. |
| Release automation (changelog, version bump) | Buy (`changesets`) | `semantic-release`, `release-please`, fully manual | `changesets` treats the changelog as a human-authored artefact ("Keep a Changelog" philosophy, research §5) rather than a raw Conventional-Commits dump, which fits a project whose commit style (seen throughout this repo's own git log) is prose, not Conventional-Commits — `semantic-release`/`release-please` would require adopting a commit-message convention this project does not use, purely to satisfy the tool. `changesets`' PR-based flow (a contributor adds a changeset file describing their change) is also the closer fit for a project with human-reviewed PRs and no monorepo-wide auto-publish need yet. |
| Case-file directory convention | Build | None (no library convention exists to reuse — research §1.4, §8) | Nothing in `src/` picks a default location; this is a CLI-layer decision with no prior art to build on inside this repo. See §5. |
| Default gate/closer inference | Build | None (no built-in defaults exist in the library — research §1.2, §1.5, §8) | Same reasoning: the roadmap requires "repo + task alone works," and nothing upstream provides this, so the CLI must own the inference. See §5. |
| Runtime credential/executable preflight | Build | None (unmanaged by the SDK/library today — research §1.11, §8) | `DID_NOT_COMPLETE.notRun` is the closest existing signal and does not distinguish cause (research §1.11). A plain-language precondition check is new, small, CLI-only logic (see §9); there is no commodity library for "does this specific CLI exist and is one of these three env vars set." |
| Plain-language error mapping | Build | None (errors are already typed with a `code` field — `src/errors.ts` — but carry no user-facing copy) | A lookup table from the existing typed error `code`s to a sentence and an exit code (§8) is the whole task; no library turns typed exceptions into prose, because the prose is domain-specific to this harness. |

## 3. The command layer

Argument parsing and subcommand routing use **commander** (§2). Commands:

- `delivery run [repoPath]` — start a new run, or continue one already in
  progress at the resolved case-file directory (see §5): starting is
  idempotent with resuming because `advance`/`run` already are
  (`src/surface.ts:774-781`; research §1.4). There is deliberately no separate
  "start" vs "resume" verb for the common case — a user who runs `delivery
  run` twice against the same repo and task continues the same surface,
  which matches "resume a crashed run from the CLI" without requiring the
  user to know their run crashed.
- `delivery resume [surfaceId] [repoPath]` — an explicit alias of the above,
  for the case a user wants to be unambiguous about intent (docs and
  first-run output steer new users to `run`; `resume` exists for the
  "I know this crashed, continue it" mental model the roadmap names). Accepts
  `--last` in place of `surfaceId` to pick the most recently modified
  non-terminal run under the resolved runs directory (§5), mirroring Claude
  Code's `--resume` with no id (research §6).
- `delivery status [surfaceId] [repoPath]` — read-only. Loads the case file,
  computes `resumeAction(logTail(caseFile))` (`src/case-file.ts:414-434`) and
  prints the plain-language "what would happen next" sentence, or — if the
  case file already carries an `outcome` — the terminal result (state,
  reason, and, when escalated, a pointer to the escalation packet). Performs
  no state transition: it is `load` plus a lookup table, not `advance`. This
  folds in the review-log's SHOULD/COULD "inspecting an escalation packet /
  case file from the CLI" at near-zero cost, since `resumeAction` and the
  case-file reader already exist and are otherwise unused by any caller
  (research §1.4).
- `delivery init [repoPath]` (SHOULD-tier) — an interactive wizard
  (`@clack/prompts`, §2) that writes a `delivery.config.*` file: offers the
  inferred default gate (§5) or lets the user pick a built-in gate type and
  fill its parameters, same for the closer, and prompts for the task text.
  Never a required step — `run` works without a config file ever having been
  written.
- `--help` / `-h` on every command (commander-generated); `--version`
  (reads the installed package's own `version` field, never hand-maintained).

**Exit codes** (§8 has the full mapping): `0` closed, `1` unexpected/internal
error, `2` configuration or flag problem, `3` environment precondition failed,
`4` run ended escalated, `5` run ended aborted. A CLI that exits non-zero on
"needs a human decision" (`4`) rather than folding it into generic failure
(`1`) is what lets a scheduled/scripted caller (a future Item 13/14 concern)
branch on "needs attention" versus "broke."

## 4. Configuration

**File format**: `delivery.config.json` at the discovery root, or
`delivery.config.js`/`.mjs` for an extender who wants to compute values (e.g.
read an env var, or register a `custom` gate/closer inline via an absolute
`modulePath`). No YAML/TOML this phase (§2's ledger entry).

**Discovery**: walk upward from `process.cwd()` (or the given `repoPath`)
looking for `delivery.config.{json,js,mjs}`, stopping at the filesystem root
or a `.git` directory, whichever comes first — the same walk-to-repo-root
convention git itself uses, so "put the config at your repo root" needs no
explanation. No config file found is not an error: it means every setting
falls through to flags, env, or built-in defaults (§5).

**Precedence** (highest wins): CLI flags → environment variables
(`DELIVERY_TASK`, `DELIVERY_GATE`, … one per top-level schema field, useful
for CI) → config file → built-in defaults. This is the same precedence order
every surveyed comparable tool uses (Aider's `--config` overriding its
discovered file, research §6) and matches ordinary Unix tool convention, so
it needs no bespoke explanation in the getting-started guide.

**Schema**: one `zod` object, `DeliveryConfig`, defined in the CLI layer and
built by composing the library's *existing* schemas rather than re-describing
them:

```ts
const DeliveryConfig = z.object({
  task: TaskDef.optional(),        // reused from src/schema.ts
  gate: GateRef.optional(),        // reused from src/schema.ts
  closer: CloserRef.optional(),    // reused from src/schema.ts
  budgets: BudgetSet.partial().optional(), // reused, partial: CLI fills gaps with defaults
  dir: z.string().optional(),      // case-file directory override
});
```

Deliberately exactly the four top-level keys product-design.md fixes
(`gate`/`closer`/`budgets`/`task`, plus `dir` as a pure filesystem-location
override with no bearing on the config format Item 9 extends). Role-config
overriding (a config field that edits `systemPromptFragment`/`allowedTools`)
is explicitly out of scope for this phase: no persona journey in
product-design.md calls for it, authoring a role's system-prompt content is
Item 9's own stated roadmap turf (roadmap Item 9, "the domain system-prompt
fragment … can be authored and previewed"), and adding it here would be
exactly the "config format Item 9 would need to migrate away from" that
product-design.md's §4-equivalent warns against. Role configs stay
code-only overrides for this phase (an extender who needs a different
`workerRoleConfig` still authors one in TypeScript and consumes the library
directly, as today) until Item 9 defines the declarative authoring surface
for them.

**Relationship to Item 9**: this schema is the floor Item 9 builds on, not a
parallel one. Item 9's declarative authoring surface (natural-language task
structuring, a domain system-prompt fragment, previewable configuration)
extends `DeliveryConfig` with additional optional fields and a higher-level
authoring layer that *compiles down* to the same `TaskDef`/`GateRef`/
`CloserRef`/role-config shapes this schema already validates — it does not
introduce a second config file, a second discovery mechanism, or a
second schema. Concretely: Item 9's "select a gate by name" and "describe
your domain in prose" are new *producers* of a `GateRef` and a
`systemPromptFragment` string respectively; both still flow through this
same `DeliveryConfig` shape and the same `zod` validation. This is the
"one schema, extended" contract the design brief requires, and it holds
because `TaskDef` is already an opaque passthrough object in the library
schema (`src/schema.ts:31-34`) — there is nothing in the *library* to widen,
only the CLI's own config schema, which is additive by construction.

## 5. Defaults

The roadmap's MUST is "repo + task alone gives a working run." Concretely,
given `delivery run --task "add a health-check endpoint"` with no config file
and no `--gate`/`--closer` flags:

**Gate**: the CLI inspects the target repo's `package.json` for a `scripts.test`
entry. If present, the default gate is `{ type: "command", command: "npm
test", parseMode: "exitcode" }`. `exitcode` is the only parse mode that
requires no assumption about the test runner's output format
(`parseExitCode`, used identically regardless of what `npm test` prints;
`src/command-gate.ts:71-72`) — `tap`/`junit` would require guessing the
project's test framework, which is exactly the kind of silent, wrong
assumption a "sensible default" must not make. If no `scripts.test` exists,
the CLI refuses before provisioning anything, with a plain-language message
naming the one missing thing ("no gate is configured and this repo's
package.json has no `test` script to default to — add a `gate` to
`delivery.config.json`, pass `--gate`, or add a test script") — this is the
roadmap's explicit fallback ("a working run … or a plain-language explanation
of the one missing thing," review-log) rather than silently no-op'ing or
guessing.

**Closer**: the default is `{ type: "commit-to-branch" }`
(`createCommitToBranchCloser`, `src/resolve-closer.ts:31-32`). This is the
safest of the three built-ins to run with zero configuration: it never
touches the repository's default branch (unlike `merge-back`) and needs no
external credentials or a configured remote (unlike `open-pr`, which needs a
place to open a PR against). A first-time user gets a branch they can
inspect and merge themselves — nothing is silently pushed or merged on their
behalf.

**Budgets**: the library ships no default `BudgetSet` (research §1.2, §1.5,
§8) — every demo/test hand-writes an identical literal. Item 8 lifts that
literal once into a single exported constant,
`DEFAULT_BUDGETS` in `src/defaults.ts`, re-exported from `src/index.ts`
alongside the other library exports (`correction: 3, gateError: 3,
gateMaintenance: 2, terminus: 5, close: 3` — the values every demo and test
already agree on). The CLI uses it as its own default and a config file's
`budgets` (§4) is merged over it field-by-field. Exporting it from the
library rather than owning it privately in the CLI means Item 9's declarative
surface, and any future caller, share the same numbers rather than each
guessing their own — a small, uncontroversial addition to the existing
library surface, not a new contract.

**Role configs**: default to the existing `workerRoleConfig` and
`gateMaintenanceRoleConfig` (`src/role-config.ts:65-99`) and
`deterministicRouter` for triage (`src/router.ts`, re-exported
`src/index.ts:16`) — the fast, no-agent-call path for triage decisions,
which is also the cheaper default for a first run (no second agent
invocation on every setback).

**Task**: `--task <text>` becomes `{ intent: text }`, the same minimal
`TaskDef` shape every demo constructs by hand today (`taskDef: { intent:
"add a feature" }`, research §1.2). `--task-file <path>` reads the same text
from a file for longer task descriptions. Item 9 replaces this minimal
shape with structured, richer task authoring; Item 8 does not anticipate that
shape beyond leaving `TaskDef` opaque, which it already is.

**Case-file directory**: `<repoPath>/.delivery/runs/<surfaceId>/`, matching
product-design.md exactly. `<surfaceId>` defaults to a slug derived from the
task text unless `--id`/config `dir` (§4) names one explicitly. The CLI
ensures `.delivery/` is git-ignored (adding a one-line-explained entry to
`.gitignore` if none covers it yet) — colocated with the repo so `resume`/
`status` never require the user to remember or supply a path, matching how
`advance`/`run` already treat `dir` as a caller-chosen, otherwise-opaque
string (research §1.4). `resume`/`status` invoked with no id list every
`case.json` under `.delivery/runs/` for the repo and default to the most
recently modified one whose `outcome` is not yet set (the "most recent, no id
needed" convenience research §6 notes Claude Code's own `--resume` offers);
if more than one non-terminal run exists, the CLI lists each with its start
time and task text and asks which to resume rather than guessing, per
product-design.md's journey 3. This is `SurfaceLocation.repoPath` (`<repoPath>`
itself, unchanged) and `dir` (this resolved path) as `src/surface.ts:725-767`
already defines them — the CLI invents the *convention* for where `dir`
lives, not a new parameter the library doesn't already accept.

## 6. Run lifecycle composition

The CLI's `run`/`resume` commands compose `SurfacePorts` from real components,
the same wiring every demo does by hand today (`demos/single-surface-slice-2
-happy-path.ts:53-54`, research §1.7) — formalised once instead of
copy-pasted:

1. Resolve `DeliveryConfig` (§4) and defaults (§5) into a `CreateHeader`
   (`surfaceId`, `taskDef`, `gateRef`, `closerRef`) and a `BudgetSet`.
2. Resolve the case-file directory `dir` and `SurfaceLocation`
   (`{ repoPath, worktreePath }`) — see §5's directory convention.
3. Run the credential/executable preflight (§9) unless `--mock` is set.
4. Build `SurfacePorts`:
   - `agent`: `createAgentPort(roleConfigs, sessionEnvironment)`
     (`src/agent-invoke.ts:164-170`) for a real run;
     `fakeAgentPort`/`runSurfaceAgainstMock`'s wiring
     (`src/testing.ts`) when `--mock` is set (used by the getting-started
     guide's own tests and by a user who wants to rehearse their
     configuration without spending API calls — the same value proposition
     `docs/testing-your-pipeline.md` already sells to extenders, now
     available from the CLI directly).
   - `triage`: `deterministicRouter` by default (§5); Item 8 does not expose
     a flag for `createAgentTriage` — that stays a library-level choice an
     extender wires up in code, since it is not part of the roadmap's MUST
     scope and no persona need for it was identified.
   - `closer`: `resolveCloser(closerRef, repoPath)`
     (`src/resolve-closer.ts:21-38`).
5. If `dir` has no `case.json` yet, call `create(dir, header, budgets)`
   (`src/case-file.ts:57-81`); otherwise load the existing one.
6. Loop `advance(dir, location, ports)` (`src/surface.ts:725-767`) until
   `done`, rendering progress after each step (§7).
7. Print the terminal outcome and exit with the mapped code (§3, §8).

No new library API is introduced for this — `advance` and `run` already do
exactly what a CLI needs; the CLI is a caller like any demo, just a
formalised and distributed one.

## 7. Progress reporting

The CLI's own `advance` loop (§6, step 6) is the observation seam — there is
no new event/observer API added to `src/surface.ts`. After every `advance`
call the CLI has an `AdvanceResult` (`{ state, done, recovery? }`,
`src/surface.ts:14-24`) and can render it:

- **TTY**: one line per state transition (`PROVISIONING → PRE_GATING →
  AGENT_ACTIVE → …`, matching the state names a reader of `docs/single
  -surface-control-flow.md` already knows), with elapsed time since the
  previous transition and, when a step returns a `recovery` string, that
  string printed distinctly — this is the *first* place `recovery` is ever
  shown to a user (research §1.4 notes it is exported and populated but
  currently unprinted anywhere).
- **Non-TTY / `--json`**: one JSON object per line (`{ state, done, recovery?,
  at }`) to stdout — machine-parseable, and the natural format for a CI log
  or a future Item 11 dashboard to consume without re-parsing human prose.
  Detected via `process.stdout.isTTY`, overridable with `--json` explicitly
  in either direction.
- **`NO_COLOR`**: respected per the informal standard (research §3) — colour
  (used only for state names and pass/fail framing) is dropped, not the
  output itself, when `NO_COLOR` is set or output is non-TTY.

**Why this is not more than this**: Item 11 (Observability and Reporting) is
explicitly downstream and explicitly open on whether the eventual surface is
"a structured log, a live TUI, a post-run report, or all three" (roadmap
Item 11 notes). Building a richer progress renderer now would be building
Item 11 under Item 8's name. What Item 8 commits to structurally is that
progress is derived from `AdvanceResult`, one CLI-owned rendering step at a
time — a shape Item 11 can replace or extend (e.g. by also writing the same
per-step events to a structured log file) without the CLI's run loop
changing, because the seam is already "loop, get a result, render it" rather
than something baked into `advance` itself.

## 8. Error model

Every typed error in `src/errors.ts` maps to a plain-language template and an
exit code, in a CLI-only lookup keyed on each error's own `code` field (every
error already carries one, e.g. `FileNotFound.code === "FILE_NOT_FOUND"`).
The library's errors are untouched — they keep their structured fields for
any programmatic caller; only the CLI's presentation layer translates:

| Error (`code`) | Plain-language rendering | Exit |
|---|---|---|
| `FileNotFound` | "No run found at `<dir>`. If you meant to start a new run, use `delivery run`; if you meant to resume one, check the path." | 2 |
| `CorruptCaseFile` | "The saved run at `<dir>` can't be read back (`<detail>`) — this usually means the process was killed mid-write. If you don't need this run's history, remove the directory and start again." | 1 |
| `ImmutabilityViolation` | Internal-invariant class; surfaced as "something the harness expects to be fixed once was written twice — this is a bug, please file an issue with the run's log." | 1 |
| `WriteFailure` | "Couldn't write to `<dir>` (`<detail>`) — check disk space and permissions." | 1 |
| `ParseError` (surfaced via `errorReport`, never thrown to the CLI directly — becomes a gate `ERROR` report instead, per `src/command-gate.ts:78-82`) | Not a CLI-level error at all: it becomes a routed gate-error escalation, already handled by the run itself. | n/a |
| `DuplicateIdError` | "Your gate's output has two assertions with the same id (`<id>`) — gate assertion ids must be unique." | 2 |
| `GateModuleLoadFailure` / `InvalidGateExport` | "Couldn't load the custom gate at `<modulePath>` (`<detail>`) — check the path is right and it exports the methods the gate interface needs (see `docs/writing-a-gate.md`)." | 2 |
| `CloserModuleLoadFailure` / `InvalidCloserExport` | Same shape, for closers, pointing at `docs/writing-a-closer.md`. | 2 |
| `MissingBaseline` | Internal-invariant class (the driver never calls `check` before `baseline`); surfaced as a bug report prompt, as `ImmutabilityViolation` is. | 1 |
| `ProvisioningFailure` | "Couldn't set up a working copy of `<repoPath>` (`<detail>`) — check it's a git repository you have write access to." | 2 |
| `IllegalStateTransition` | Internal-invariant class; bug report prompt. | 1 |
| `InvalidRoleConfig` | "Your configuration for the `<field>` role setting is invalid (`<detail>`) — see `docs/configuring-a-role.md`." | 2 |
| `MockNotInstalled` | Passed through near-verbatim — already plain language ("claude-mock was not found at `<path>`. Run `npm install`…" — this only applies to `--mock` runs inside a checkout, not to an installed package, so the CLI additionally notes that a published install never needs `--mock`). | 2 |

An error not in this table (anything unexpected — a thrown non-harness
exception, an SDK-internal failure) is caught at the top level, printed with
its message and a "this is unexpected — please file an issue at
`<repo-url>/issues` with this message and, if possible, the run directory"
footer, and exits `1`. This is the single catch-all: the CLI never lets a
raw stack trace reach a terminal for a *known* error class, and is honest
about not recognising an *unknown* one rather than pretending to translate
it.

The three non-error terminal outcomes (`closed`, `escalated`, `aborted`) are
not errors at all — they print the outcome's `reason` (and, when escalated,
the escalation packet's `decision` — already written in plain language for
exactly this audience, `src/escalation-packet.ts:49-95`) and exit `0`, `4`,
`5` respectively (§3).

## 9. Credentials and Claude Agent SDK runtime prerequisites

A real (non-`--mock`) run needs a `claude` executable reachable and one of
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` set
(research §1.11) — a precondition the SDK and library do not check or report
on distinctly today (`DID_NOT_COMPLETE.notRun` collapses every launch failure
into one sentence, `src/agent-invoke.ts:22-27`).

The CLI adds a **preflight check**, run once before `PROVISIONING`, only for
a real run:

1. Resolve the executable the same way `buildSessionOptions` would
   (`pathToClaudeCodeExecutable` from config/flag, else whatever the SDK
   resolves by default) and confirm it exists and is executable.
2. Confirm at least one of the three credential env vars is non-empty.

Either check failing exits `3` (§3, §8) with a message naming exactly which
precondition is unmet and how to fix it ("no Claude Code executable found —
install it and ensure `claude` is on your PATH, or set
`pathToClaudeCodeExecutable`" / "no credential found — set one of
ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, or run
`claude login`"). This exists precisely because, without it, a
misconfigured environment would only surface as
`DID_NOT_COMPLETE.notRun` deep inside a `terminus` entry after a worktree was
already provisioned — technically correct but a poor first-run experience for
exactly the persona (Dana) the roadmap centres. `--mock` skips both checks
entirely, since `mockSessionEnvironment` (`src/testing.ts`) deliberately
strips credentials and points at `claude-mock` instead
(`src/mock-session.ts:9-13,36-43`).

This check lives in the CLI, not the library: the library's job is to run a
session it is given a port for, not to police an operator's environment, and
a library caller who has already resolved these preconditions themselves
(e.g. Item 9's future agent-driven onboarding) should not pay for a redundant
check on every `invoke`.

## 10. Security

- **Arbitrary gate commands**: `{ type: "command", command }` already shells
  out via `/bin/sh -c` (`src/command-gate.ts:26-30`) — unchanged by Item 8.
  A `delivery.config.json` committed to a repo carries exactly the same trust
  level as `package.json`'s own `scripts` block or a CI workflow file already
  does: whoever can edit the config can run arbitrary shell commands as the
  invoking user. Item 8 introduces no new execution surface here and adds no
  sandboxing — the accepted ceiling is "a delivery config is as trusted as
  the rest of the repository," matching how npm scripts already work in this
  ecosystem. (ponytail: no sandbox around `command` gates or `custom` plugin
  modules; revisit only if the CLI starts running configs from repositories
  the operator does not otherwise trust, e.g. a future PR-triggered mode.)
- **Custom module loading**: `type: "custom"` gates/closers already
  `import()` a file resolved against the repo root
  (`src/plugin-loader.ts:21-54`) — same trust boundary as above, unchanged.
- **Config-file secrets**: `DeliveryConfig` never stores a raw secret value.
  A closer needing a credential (e.g. a future `open-pr` token) is expected
  to reference an environment variable name, resolved at closer-construction
  time only, in memory — never written into `case.json`, `log.jsonl`, or any
  `refs/*.json` file, and never included in progress output (§7) or an error
  message (§8). This is a design constraint on any future config field that
  carries a credential reference, not new code Item 8 must write today (no
  such field exists in this phase's schema, §4).
- **The case file itself is not a secret store or a sandboxed artefact**: it
  already lives on disk in plain JSON/JSONL by design (crash recovery
  requires this). The CLI introduces no new persistence of anything more
  sensitive than what `src/case-file.ts` already writes.

## 11. Non-functional requirements

- **Determinism**: identical inputs (config, flags, case-file state) produce
  identical prompts and identical routing decisions — this is already a
  property of the library (`assemblePrompt`'s doc comment: "same case file
  produces byte-identical prompt," roadmap Item 4) that the CLI must not
  undermine. The CLI adds no source of nondeterminism to the run itself
  (only to *rendering*, e.g. elapsed-time strings, which are cosmetic).
- **No network access beyond the agent SDK's own calls**: the CLI itself
  makes no network calls (config loading, case-file I/O, and git operations
  are all local). This matters for the getting-started guide's CI test (§13)
  running fully offline against `claude-mock`.
- **Idempotent resume**: already guaranteed by the library (`run`'s doc
  comment, `src/surface.ts:774-781`); the CLI must not add any per-invocation
  state (e.g. a lock file that could itself go stale) that would break this.
  A concurrent second `delivery run` against the same `dir` is out of scope
  for single-surface Item 8 (Item 10 owns concurrency); the CLI does not
  attempt to detect or prevent it beyond what a filesystem-level clash would
  already surface as (a `WriteFailure` or a confusing interleaved log, an
  acceptable gap explicitly deferred to Item 10's shared-fate handling).
- **Startup latency**: compiled JS (§1) keeps `delivery`'s own startup at
  Node's baseline module-load cost, not `tsx`'s per-invocation transpile
  cost — relevant because `status`/`run` are invoked repeatedly by a human
  watching a long-running task.

## 12. Testing

- **Unit**: the CLI's own logic — config precedence merging, default
  inference (§5), the error-code lookup table (§8), the preflight check
  (§9) — is unit-tested the same way the rest of the codebase is (`vitest`),
  with no process spawned.
- **CLI end-to-end against `claude-mock`**: `runSurfaceAgainstMock` and
  `mockSessionEnvironment` (`src/testing.ts`) already give a fully offline,
  no-network, no-API-key harness for scripting an agent's behaviour
  (research §1.9, §1.11) — the same seam `tests/testing-your-pipeline-guide
  .test.ts` already exercises for the *library's* testing guide. The CLI's
  end-to-end tests spawn the compiled `dist/cli/main.js` (via
  `execFileSync`/`node:child_process`, the same pattern
  `tests/testing-your-pipeline-guide.test.ts` already uses for `npx tsx`
  invocations) against a scratch git repository and a `MockScript`, asserting
  on stdout, exit code, and the resulting case file on disk. `--mock` routes
  the CLI's own `SessionEnvironment` construction at exactly the same seam
  the library's testing API already uses — no second mocking mechanism.
- **Getting-started guide executed as a test in CI**: mirrors
  `tests/testing-your-pipeline-guide.test.ts`'s established pattern exactly —
  a new `tests/getting-started-guide.test.ts` reads
  `docs/getting-started.md`, extracts its snippets/commands (the same
  `snippetFrom`/`sectionOf` helpers already in `tests/helpers.js`), and
  actually runs them (`npm install`-equivalent against a local pack, or
  directly against the built `dist/`, then `delivery init`/`run --mock`
  against the sample project) asserting the documented output appears
  verbatim. This is the same "the guide cannot drift from the tool it
  teaches" property Item 7 already established for the testing guide,
  applied to the CLI's own onboarding doc, per the roadmap's explicit
  requirement ("tested by running its own instructions from scratch",
  roadmap Item 8 DX note).
- **Sample project**: a small fixture repository (a handful of source files,
  a `package.json` with a trivial `test` script and one or two committed
  failing/passing states) checked into the repo (e.g.
  `examples/sample-project/`), the same one the getting-started guide's test
  runs `delivery run` against — one fixture, one guide, one test, not a
  separate demo for each.

## 13. Release, versioning, and publish readiness

- **Semver**: standard semver, starting the first published version at
  `0.1.0` (pre-1.0, signalling "usable, not yet a stability promise" — the
  library API has never been versioned for external consumers before this
  item). `1.0.0` is a later, deliberate decision, not something Item 8
  forces.
- **Changelog**: `changesets` (§2) generates `CHANGELOG.md` in the
  established Keep a Changelog shape (research §5) from PR-attached
  changeset files; this becomes part of the PR template/CONTRIBUTING
  guidance, extending the existing `CONTRIBUTING.md` rather than replacing
  it.
- **Tagged releases**: a GitHub Actions job (extending
  `.github/workflows/ci.yml`, which already runs on push/PR to `main` —
  research §1.10) runs `changesets`' version/publish flow on merges to
  `main` that carry pending changesets, producing a git tag and a
  `CHANGELOG.md` update in the same PR-based flow.
- **Publish readiness, gated on licence**: the package is fully buildable,
  installable-from-a-local-pack, and `npm publish --dry-run`-clean before a
  licence exists — `files`/`exports`/`bin`/`engines` (§1) are all in place,
  and `npm publish --provenance --access public` (research §4) is the one
  command an operator runs once a licence is chosen. **This design does not
  select a licence and does not perform a first public publish** — per the
  hard constraint, `license` stays absent from `package.json` and the
  publish workflow's actual `npm publish` step stays commented-out /
  manually-gated until a human adds a `LICENSE` file and a `license` SPDX
  identifier. `vendor/README.md` already documents that the vendored
  `claude-mock` copy "inherits whatever licence this repository adopts"
  (research §1.9) — so this same open question also resolves that dependency's
  effective licence the moment it is answered, and not before.

## 14. Extensibility (Items 9, 10, 11, 13)

- **Item 9** (Project Configuration) extends `DeliveryConfig` (§4) with a
  declarative/natural-language authoring layer that compiles to the same
  `TaskDef`/`GateRef`/`CloserRef`/role-config shapes; it reuses this item's
  discovery, precedence, and validation machinery rather than introducing a
  second config surface. It also gets the `init` wizard shape from this item
  as a starting scaffold for its own guided authoring flow.
- **Item 10** (Multi-Surface Supervisor) reuses this item's config schema
  (a run needs the same gate/closer/task shape whether it is one surface or
  N) and its `SurfacePorts` composition (§6) per surface; the CLI's `run`
  command is the natural place a future `--surfaces N` or a queue-file flag
  would land, without changing how a single surface is composed.
- **Item 11** (Observability and Reporting) replaces or augments this item's
  progress renderer (§7) at the seam already established (`AdvanceResult` in,
  rendering out) — the design deliberately does not build a richer reporting
  surface now so as not to pre-empt Item 11's own decision on shape (log,
  TUI, or report).
- **Item 13** (Local Scheduling) drives the same `delivery run` command this
  item defines, on a schedule; nothing about the CLI's command shape assumes
  interactive, human-attended invocation (non-TTY output, `--json`, and
  well-defined exit codes, §3/§7/§8, are exactly what an unattended scheduled
  invocation needs and already gets from this design).

## Open questions

- **Licence choice** (hard constraint, §13): gates the first public
  `npm publish`. A human decision, not made here.
- Whether `init`'s wizard (§3) ships in the same release as `run`/`resume`/
  `status`, or slightly after, is a scope/sequencing question for the
  delivery plan, not an architectural one — nothing about `run`'s design
  depends on `init` existing first.
