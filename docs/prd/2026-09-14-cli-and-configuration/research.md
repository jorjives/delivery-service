# Research: CLI and Configuration (Roadmap Item 8)

Factual foundation for the design of a CLI/packaging surface over the delivery
harness. Compiled by the researcher; verified against the code at the paths and
line numbers cited. No recommendation is made here — trade-offs only, for the
product-designer and architect to weigh.

## 1. Current state of this repo

### 1.1 The public API today (`src/index.ts`)

The harness ships as a library only. `src/index.ts` re-exports the entire
surface as named exports: case-file primitives (`create`, `appendEntry`,
`load`, `logTail`, `resumeAction`, `rebuild`, …, `src/index.ts:1`), the gate
interface (`resolveGate`, `createCommandGate`, `createCustomGate`,
`src/index.ts:2-6`), the close interface (`resolveCloser`,
`createMergeBackCloser`, `createCommitToBranchCloser`, `createOpenPrCloser`,
`createCustomCloser`, `src/index.ts:7-13`), the driver (`advance`, `run`,
`src/index.ts:14`), types (`AdvanceResult`, `RunResult`, `AgentPort`,
`SurfacePorts`, `CaseFile`, `TaskDef`, `GateRef`, `CloserRef`, …,
`src/index.ts:17-65`), typed errors (`src/index.ts:66-81`), role configuration
(`workerRoleConfig`, `gateMaintenanceRoleConfig`, `validateRoleConfig`,
`src/index.ts:82-83`), triage (`triageRoleConfig`, `src/index.ts:84`),
prompt assembly (`src/index.ts:85-86`), the SDK-backed agent port
(`invoke`, `createAgentPort`, `src/index.ts:87-88`), tool authority
(`src/index.ts:89-90`) and the escalation packet builder
(`src/index.ts:92-93`). There is no CLI, no `bin`, and no config-file loader
anywhere in the tree (confirmed by `grep` across `src/`, `package.json`).

### 1.2 How a run is started today (`src/surface.ts`, `src/ports.ts`)

A caller drives one surface with two functions:

- `advance(dir, location, ports)` — performs exactly one state transition and
  commits it (`src/surface.ts:725-767`).
- `run(dir, location, ports)` — loops `advance` until terminal, then returns
  `{ state, outcome }` (`src/surface.ts:782-794`).

Both take:

- `dir: string` — the case-file directory (persisted state lives in
  `case.json` + `log.jsonl` + `refs/*.json` under it; see `src/case-file.ts:1-2,
  44-146, 251-271`).
- `location: SurfaceLocation` — `{ repoPath, worktreePath }`
  (`src/ports.ts:140-143`).
- `ports: SurfacePorts` — `{ agent: AgentPort, triage: TriagePort, closer:
  CloserPort }` (`src/ports.ts:126-130`).

To start a fresh surface, the caller must first call `create(dir, header,
budgetDefaults)` from `src/case-file.ts:57-81`, which writes the initial
`case.json` (state `PROVISIONING`) and an empty `log.jsonl`. `header` is a
`CreateHeader` — `CaseFileHeader` minus the fields the surface fills in later
(`baseline`, `baseBranch`; `src/schema.ts:129-147`) — i.e. the caller supplies
`surfaceId`, `taskDef`, `gateRef`, and optionally `closerRef` and
`domainPrompt`.

**What a caller must construct, concretely:**

- `TaskDef` — `z.record(z.string(), z.unknown())`, an opaque passthrough JSON
  object; the harness does not validate its shape (`src/schema.ts:31-34`). No
  natural-language task authoring exists yet (deferred to Item 9 per
  `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md:357-373`).
- `GateRef` — a discriminated union: `{ type: "command", command, parseMode:
  "tap"|"junit"|"exitcode", failOnNewAssertions? }` or `{ type: "custom",
  modulePath, exportName?, failOnNewAssertions? }` (`src/schema.ts:36-50`).
- `CloserRef` — `{ type: "merge-back", deleteBranch? }` | `{ type:
  "commit-to-branch" }` | `{ type: "open-pr" }` | `{ type: "custom",
  modulePath, exportName? }` (`src/schema.ts:60-78`).
- `BudgetSet` — five named budgets (`correction`, `gateError`,
  `gateMaintenance`, `terminus`, `close`), each `{ used, max }`
  (`src/schema.ts:12-25`). **There are no built-in defaults in `src/`.** Every
  demo and test hand-writes the same values inline — `correction: max 3`,
  `gateError: max 3`, `gateMaintenance: max 2`, `terminus: max 5`, `close: max
  3` (e.g. `demos/slice-1-round-trip.ts:19-23`,
  `demos/single-surface-slice-2-happy-path.ts:22-28`,
  `src/mock-session.test.ts:15-21`) — but nothing in the library ships this
  as a constant a caller can import; a CLI's "sensible defaults" would have to
  invent and own this table itself, or the library would need to export one
  first.
- Role configs (`RoleConfig`, `src/role-config.ts:39-52`) for `worker`,
  `gate-maintenance`, and `triage`. Built-ins exist:
  `workerRoleConfig` (`src/role-config.ts:65-76`), `gateMaintenanceRoleConfig`
  (`src/role-config.ts:87-99`), `triageRoleConfig`
  (`src/triage-role-config.ts:53-69`). `validateRoleConfig` checks a config
  before any session starts and throws `InvalidRoleConfig` naming the bad
  field (`src/role-config.ts:127-134`).
- The real `AgentPort`, built with `createAgentPort(configs, session)`
  (`src/agent-invoke.ts:164-170`), which needs a `RoleConfigs` map (one config
  per role, `src/agent-invoke.ts:153-157`) and optionally a
  `SessionEnvironment` (`pathToClaudeCodeExecutable`, `env`;
  `src/agent-invoke.ts:41-44`) if not using the default `claude` on `PATH`.
- A `TriagePort`: either the deterministic router (`deterministicRouter`,
  exported at `src/index.ts:16`) or an agent-backed one (`createAgentTriage`,
  `src/index.ts:91`).
- A `CloserPort`: `resolveCloser(closerRef, repoPath)` turns the pinned
  `CloserRef` into one (`src/resolve-closer.ts:21-38`), or use `noopCloser`
  for tests/demos (`src/ports.ts:120-122`).

### 1.3 Resolving built-in vs custom components by name

`resolveGate(gateRef, repoPath)` (`src/resolve-gate.ts:18-28`) and
`resolveCloser(closerRef, repoPath)` (`src/resolve-closer.ts:21-38`) both
switch on the ref's `type` discriminant: known built-in types map straight to
a constructor (`createCommandGate`, `createMergeBackCloser`, etc.); `type:
"custom"` defers to `src/plugin-loader.ts`'s `loadPlugin` (used inside
`createCustomGate`/`createCustomCloser`, not shown directly in the read files
but referenced from `resolve-gate.ts:26` / `resolve-closer.ts:36`). Both
resolvers are **total**: an unparseable ref or a plugin that fails to load
never throws — it returns a component that reports `ERROR`/`fail` on the spot
(`src/resolve-gate.ts:19-22`, `src/resolve-closer.ts:22-25`).

`loadPlugin` (`src/plugin-loader.ts:21-54`) resolves a relative `modulePath`
against `repoPath` — **the repository root, never the worktree under
judgement and never `process.cwd()`** (`src/plugin-loader.ts:13-19`) —
dynamically `import()`s it, and checks the named export is an object exposing
every required method before returning it. Both resolvers require `repoPath`
as an explicit parameter for exactly this reason
(`src/resolve-gate.ts:14-16`, `src/resolve-closer.ts:16-19`). This is the
whole "resolve built-in vs custom by name" mechanism today; there is no
plugin registry, package-based plugin discovery, or name-to-npm-package
lookup — "custom" always means "a local file, resolved from the repo root".

`guardMethod` (`src/plugin-loader.ts:69-91`) wraps every plugin method call so
a third-party throw or a malformed return value becomes a typed `fail(...)`
result rather than an exception reaching the surface driver.

### 1.4 Resume semantics

Resume is not a separate code path — `advance`/`run` are unconditionally
resumable because every branch reads either pre-entry state or the on-disk log
tail (`src/surface.ts:720-723`). Two related-but-distinct helpers describe
"where things are":

- `logTail(caseFile)` (`src/case-file.ts:148-150`) — the last `HistoryEntry`
  appended to `log.jsonl`, or `undefined`.
- `resumeAction(tail)` (`src/case-file.ts:404-434`) — a human/UI-facing
  classification of what a resumed run is about to do next, derived purely
  from the tail entry's type and status: `"start" | "incomplete_terminus" |
  "gate" | "triage" | "close" | "act_on_verdict" | "close_triage" | "done"`.
  This function is exported from `case-file.ts` and re-exported from
  `src/index.ts:1,64`, but the surface driver itself never calls it — it
  routes on `deriveStateFromEntry` instead (`src/case-file.ts:289-317`,
  used throughout `src/surface.ts`, e.g. lines 338, 707, 745-763).
  `resumeAction` looks purpose-built for a CLI's "here's what will happen when
  you resume" message.
- The case file also records a `recovery` string on `AdvanceResult` when a
  step recovered from an interruption (e.g. a torn worktree,
  `src/surface.ts:494-497`; a missing terminus,
  `src/surface.ts:250-266,438-439,535-536`) — data intended to be surfaced to
  a person, per the doc comment at `src/surface.ts:17-24`: "a resumed run says
  what it had to put right; it is returned as data, never printed from here."
  **No current caller prints it** — a CLI would be the first place this
  string is ever shown to a user.

**Case file location**: purely caller-chosen — `dir` is just a filesystem path
the caller passes to every case-file function; nothing in `src/` picks a
default location (e.g. no `.delivery-service/` convention exists yet). A CLI
would need to invent this.

Resuming a *crashed process* (as opposed to a normal mid-run state) is simply:
call `advance`/`run` again with the same `dir`/`location`/`ports`. `run` has
no step cap and documents this directly: "Safe to call from a fresh process
against an existing `dir` — it is just `advance`, which resumes onto a legal
edge from whatever is on disk." (`src/surface.ts:774-781`).

### 1.5 Budgets and their defaults

See §1.2 above — `BudgetSet` has five populations (`src/schema.ts:18-25`,
labelled for humans in `src/escalation-packet.ts:8-14`:
`correction`→"correction", `gateError`→"gate recheck",
`gateMaintenance`→"gate repair", `terminus`→"session retry",
`close`→"close retry"). Budgets are tracked two ways that must agree:
`incrementBudget` (imperative, `src/case-file.ts:230-243`, exported but
apparently unused by the driver) and `deriveBudgetsFromLog` (derived from the
log tail, `src/case-file.ts:336-372`, what `src/surface.ts` actually uses
throughout). There is **no shipped default `BudgetSet` constant** in `src/`;
every demo/test defines its own identical literal (§1.2).

### 1.6 Escalation packet and run result shapes

`RunResult` (`src/surface.ts:769-772`): `{ state: SurfaceState, outcome?:
CaseFileOutcome }`. `CaseFileOutcome` (`src/schema.ts:225-234`): `{ kind:
"closed"|"escalated"|"aborted", source: string, reason: string, at: string
(ISO 8601), packetRef?: string }`. When `kind === "escalated"`, `packetRef`
names a ref file under `refs/` holding the `EscalationPacket`
(`src/schema.ts:29-36` in `triage-role-config.ts`, written at
`src/surface.ts:158-166`). An `EscalationPacket` has five string/array fields
a human reads: `decision`, `evidence`, `dead_ends`, `why_now`, `references:
string[]` (`src/triage-role-config.ts:29-36`). `buildEscalationPacket`
(`src/escalation-packet.ts:49-60`) composes it deterministically from a fixed
per-cause `decision`/`reason` sentence (`src/escalation-packet.ts:62-95`) plus
verbatim evidence quoted from the case file (`src/escalation-packet.ts:103-147`)
— i.e. the packet is designed from the ground up to be read by a
non-technical person without harness vocabulary, which a CLI's "inspect an
escalation" command (a SHOULD/COULD per the review-log) would essentially just
pretty-print.

### 1.7 How demos wire it all together

`demos/*.ts` (29 files, `ls demos`) are the only present-day "how do I run
this" examples, and every one is invoked via `npx tsx demos/<file>.ts`
(`package.json:10-34` — one `npm run demo:*` script per demo, all of the shape
`"npx tsx demos/<file>.ts"`). A representative example,
`demos/single-surface-slice-2-happy-path.ts:46-80`, shows the full manual
wiring: `fs.mkdtempSync` for a scratch case-file dir, `initTempRepo` for a
scratch git repo, a hand-built `SurfaceLocation`, a hand-built
`SurfacePorts` (using `fakeAgentPort` from `src/testing.ts` and `noopCloser`),
a call to `create(...)`, then a manual `while (!done) { advance(...) }` loop
printing state transitions to `console.log`. **This loop-and-print pattern is
exactly the shape a CLI's terminal-progress reporting would need to
formalise** — today it is copy-pasted per demo, not a library capability.

### 1.8 Existing docs

- `docs/configuring-a-role.md` — how to build/validate a `RoleConfig`; states
  plainly "You do not need to read any source to follow it" and imports
  everything from `./src/index.js` "from the repository root (the harness is
  not published as a package yet)" (`docs/configuring-a-role.md:1-13`, and see
  the identical framing in `docs/writing-a-gate.md:1-22` and
  `docs/testing-your-pipeline.md:1-16` — three separate docs each state the
  harness is unpublished and every snippet is run with `npx tsx`).
- `docs/writing-a-gate.md`, `docs/writing-a-closer.md` — same "not published
  yet, run with npx tsx" framing; explain `GateRef`/`CloserRef` shapes and the
  built-in vs custom split.
- `docs/testing-your-pipeline.md` — teaches `runSurfaceAgainstMock`,
  `initTempRepo`, `fakeAgentPort` from `src/testing.ts`
  (also documented in `CONTRIBUTING.md:24-40`); explicitly requires "Node.js
  22 or later, and `git`" and "A clone of the harness with `npm install` run
  in it" (`docs/testing-your-pipeline.md:17-21`) — i.e. today's only
  "getting started" path is git-clone-and-npm-install, not package install.
- `docs/provisioning.md`, `docs/single-surface-control-flow.md` — internal
  design/architecture notes (state machine, worktree provisioning), not
  user-facing "how do I run this" docs.
- `CONTRIBUTING.md` — developer setup only (`git clone`, `npm install`,
  `npm test`/`lint`/`typecheck`), testing API guidance, PR rules
  (`CONTRIBUTING.md:1-51`). No mention of packaging, publishing, or a CLI.
- `README.md` — six lines of quick start (`npm install && npm test`) plus a
  doc index (`README.md:1-16`). No install-from-registry story, no CLI usage.

### 1.9 `vendor/`

`vendor/claude-mock` is a full copy (source + committed build output) of a
sibling project `@jorj/claude-mock`, vendored because that sibling is
`"private": true` and unpublished (`vendor/README.md:5-7`). It is pulled in as
`"@jorj/claude-mock": "file:vendor/claude-mock"` devDependency
(`package.json:42`), with `.npmrc`'s `install-links=true`
(`.npmrc:1-4`) so npm copies rather than symlinks it (avoiding a second
TypeScript/Vitest/Agent-SDK toolchain leaking in). **This is itself a working
example, inside this repo, of exactly the CLI-packaging shape Item 8 needs**
(see §2 below) — a `bin` field, a `tsc` build step, committed `dist/`.
`vendor/README.md:61-66` records explicitly: "claude-mock has no licence field
and this repository has no LICENSE yet. … The copy inherits whatever licence
this repository adopts; licensing it for redistribution is a decision to make
explicitly if the harness is open-sourced." — directly corroborating the
seeding idea file.

### 1.10 `.github/workflows/ci.yml` and `package.json`

CI (`.github/workflows/ci.yml:1-19`): on push/PR to `main`, Node 22, `npm ci`,
`npm run lint`, `npm test`. No build step, no publish step, no release
workflow.

`package.json` (full file read, `package.json:1-54`):
- `"name": "delivery-service"`, `"version": "0.0.1"`, `"type": "module"`.
- **No `bin`, no `exports`, no `files`, no `license` field.**
- `engines.node: ">=22"` (`package.json:37-39`).
- All 25 `demo:*` scripts run `npx tsx demos/<file>.ts` directly
  (`package.json:10-34`) — **there is no build step**; the project ships and
  runs as raw TypeScript via `tsx` everywhere, including CI (`lint` runs `tsc
  --noEmit` only — a typecheck, not a build; `package.json:8-9`).
  `tsconfig.json` confirms this: `"noEmit": true` (`tsconfig.json:9`).
- `dependencies`: `@anthropic-ai/claude-agent-sdk` `^0.3.266`, `zod` `^4.5.4`
  (`package.json:50-53`) — zod is already a runtime dependency, relevant to
  config validation (§3).
- `devDependencies` include `tsx` `^4.23.13`, `typescript` `^6.0.3`, `eslint`
  `^10.9.1`, `vitest` `^5.0.0`, and the vendored `@jorj/claude-mock`
  (`package.json:40-49`).
- `"prepare": "git config core.hooksPath .githooks"` (`package.json:35`).

### 1.11 What the Claude Agent SDK requires at runtime

A real (non-mocked) run needs the `claude` CLI executable and a working
credential. Evidence from this codebase itself: `src/mock-session.ts:13`
defines `CREDENTIALS = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
"CLAUDE_CODE_OAUTH_TOKEN"])` and deliberately **strips** these env vars when
building a mocked session's environment (`src/mock-session.ts:36-43`), with
the comment "Credentials a scripted session never needs. Leaving them out
means a mock-backed test proves it runs without a key, even on a machine that
has one." (`src/mock-session.ts:9-13`) — i.e. a *real* session does need one of
these three. `buildSessionOptions` (`src/agent-invoke.ts:57-75`) passes
`pathToClaudeCodeExecutable` straight to the SDK's `query()` options
(`src/agent-invoke.ts:64-74`), defaulting to whatever the SDK itself resolves
(presumably `claude` on `PATH`) when a caller supplies none
(`invoke`'s default `session: SessionEnvironment = {}`,
`src/agent-invoke.ts:98-101`). A CLI installed via `npm`/`npx` therefore has a
precondition the harness does not manage itself: the operator must separately
have the Claude Code CLI installed and authenticated (or `ANTHROPIC_API_KEY`
set) before a real (non-mock) run can dispatch any agent session. Nothing in
`src/` checks for this proactively or produces a plain-language error if it is
missing — `invoke` only classifies whatever the SDK reports back as one of the
four `DID_NOT_COMPLETE` reasons (`src/agent-invoke.ts:22-27`), including
`"notRun": "the session could not be started or run to completion"`, which is
the closest thing to a "no CLI/no credential" failure and does not name the
cause.

## 2. Prior art in the estate

Surveyed `/home/jorjives/dev` (local only, no root-filesystem search) for
sibling Node/TS CLIs by the same author:

**`vendor/claude-mock` (`@jorj/claude-mock`)** — the closest and most directly
relevant precedent, vendored inside this very repo. `bin: { "claude-mock":
"./dist/cli.js" }` (`vendor/claude-mock/package.json:6-8`); build step
`"build": "tsc && chmod +x dist/cli.js"` (`vendor/claude-mock/package.json:10`)
— i.e. **compiled JS shipped, not `tsx` at runtime**, unlike delivery-service
itself today. Config/args: no arg-parsing library at all — everything is env
vars (`CLAUDE_MOCK_SCRIPT`, `CLAUDE_MOCK_JOURNAL`,
`CLAUDE_MOCK_INIT_DELAY_MS`; `vendor/claude-mock/src/cli.ts:7-14,90`), read
with plain `process.env`, and it exits with a plain-language stderr message
and exit code 2 if the required one is missing
(`vendor/claude-mock/src/cli.ts:7-11`). Output is JSON-lines to stdout
(`vendor/claude-mock/src/cli.ts:21`), matching the Agent SDK's own wire
protocol rather than a human-facing terminal UI (it is a fake CLI backend, not
an operator-facing tool, so this is a different problem shape from
delivery-service's own CLI). `engines.node: >=20`
(`vendor/claude-mock/package.json:14-16`); `"private": true`, no `license`
field (`vendor/claude-mock/package.json:17`).

**`autoloop`** (`/home/jorjives/dev/autoloop`, per a subagent's local survey —
not independently re-verified line-by-line by the researcher) — ships four
`bin` entries including an interactive setup wizard built on
`@inquirer/prompts`, with defaults centralised in a `wizard/args.mjs` module;
terminal output uses `chalk` for colour and `Ink` (React-based) for richer TUI
elements. This is the estate's one existing example of an interactive `init`
wizard, relevant to the roadmap's SHOULD-tier `init` idea.

**`open-design`** (`/home/jorjives/dev/open-design`) — single `bin` entry, runs
via `tsx` (no compiled output committed), manual flag parsing with
allow-listed `Set`s per subcommand rather than a parsing library.

**Pattern across all three**: none uses an external arg-parsing library
(commander/yargs/etc.); all either use env vars, manual flag whitelisting, or
delegate entirely to an interactive-prompts library. Two of three ship
compiled JS via `tsc`; one runs TS directly via `tsx`. This is prior art
*against* reaching for a heavyweight CLI framework by default, and *for*
checking whether `util.parseArgs` plus the project's own config-loading needs
suffice, but it is not dispositive — none of the three is a close functional
analogue of an "install one tool, point it at a repo and a task" harness CLI,
and `claude-mock`'s "CLI" is a wire-protocol backend, not an operator-facing
command surface with subcommands, `--help`, and config-file merging.

## 3. CLI and config libraries — trade-offs

*(Findings below are sourced by a delegated web-research pass; every claim
below carries its original citation.)*

**Argument parsing:**
- `util.parseArgs` (Node ≥18.3, stable since v20) — built-in, zero-dependency.
  Supports booleans/strings, short aliases, `multiple`, defaults, `--no-`
  negation, `strict`/`allowPositionals`, a `tokens` mode for custom handling.
  No sub-command routing or help-text generation — both must be hand-rolled.
  [nodejs.org/api/util.html](https://nodejs.org/api/util.html#utilparseargsconfig)
- **commander** — ~50M weekly downloads, zero runtime deps, TS-first typings
  since v8; declarative, well-suited to git/npm-style hierarchical
  subcommands with auto-generated help.
  [npm-compare.com/commander,yargs](https://npm-compare.com/commander,yargs)
- **yargs** — ~30M weekly downloads, has runtime deps, heavier than commander;
  stronger built-in validation/coercion/option-dependency handling.
  [npm-compare.com/commander,yargs](https://npm-compare.com/commander,yargs)
- **citty** (unjs) — lightweight, zero-dep, ESM-only, wraps `util.parseArgs`
  internally since v0.2; declarative `defineCommand()`, fits naturally beside
  other unjs tooling (e.g. c12).
  [github.com/unjs/citty](https://github.com/unjs/citty)
- **clipanion** — powers Yarn Berry; strong TS inference, but v4 has sat at
  RC since Sept 2024 with no recent activity (maintenance-risk flag).
- **oclif** — plugin-architecture framework (Heroku/Salesforce), built for
  large team-extended CLIs; heaviest footprint, can exceed 50MB unpacked with
  Heroku-plugin deps — likely overkill here.
  [dev.to comparison](https://dev.to/thegdsks/building-a-production-typescript-cli-in-2026-oclif-vs-commander-vs-custom-9ah)

**Config file loading** (to combine with the already-installed `zod`
`^4.5.4`, `package.json:52`):
- **cosmiconfig** — searches upward from project root (`package.json` prop,
  `.rc`/`.rc.json`/`.rc.yaml`/`.rc.js`, `config/` dir); JSON/YAML/JS/TS via
  async loaders (TS needs `cosmiconfig-typescript-loader`).
- **lilconfig** — "cosmiconfig without async loaders": smaller/faster,
  sync-first, not YAML-aware out of the box.
  [github.com/antonk52/lilconfig](https://github.com/antonk52/lilconfig)
- **c12** (unjs) — supports `.js/.ts/.mjs/.cjs/.mts/.cts` (native import or
  `jiti` fallback for TS) plus `.json/.jsonc/.json5/.yaml/.yml/.toml` via
  unjs/confbox; has a `defaults` option to pre-populate before validation.
  [github.com/unjs/c12](https://github.com/unjs/c12)
- All three follow the same pattern with zod: load raw config, then
  `schema.safeParse` it — c12's `defaults` is a convenient pre-fill step
  before that pass.

**Interactive prompts** (relevant to a possible `init`, cf. `autoloop`'s
precedent above):
- **@clack/prompts** — ~4KB gzipped, fully ESM, current default choice for
  init-style wizards.
- **enquirer** — ~100KB, ESM+CJS.
- **inquirer** (`@inquirer/prompts`, v9+) — ESM-only, modular, heaviest at
  ~194KB min+gzip.
  [pkgpulse.com comparison](https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026)

**Terminal progress / TTY / `NO_COLOR`:**
- Plain line-based `console.log` — simplest, CI-safe by construction, no
  live-update UX. (This is exactly today's demo pattern, §1.7.)
- **ora** — single-spinner, auto-detects non-TTY/CI and falls back to static
  text; not designed for concurrent indicators.
  [npmjs.com/package/ora](https://www.npmjs.com/package/ora)
- **listr2** — full task-list runner (sequential/concurrent/nested, rollback);
  its verbose renderer produces clean, control-character-free output suited to
  CI log aggregation.
- **`NO_COLOR`** (no-color.org, 2017 informal standard) — any CLI adding ANSI
  colour by default should check for a non-empty `NO_COLOR` env var and
  disable colour if set, while leaving non-colour styling unaffected; a
  well-behaved CLI should also let an explicit flag/config override it.
  [no-color.org](https://no-color.org/)

## 4. Packaging and distribution

- **`bin`** maps a command name to an executable entry file (shebang required,
  executable bit set at publish). `vendor/claude-mock/package.json:6-8` is a
  working in-repo example.
- **`exports`** is the modern gate on what is importable; takes precedence
  over `main`; can declare separate `import`/`require` conditions for
  dual-format consumption.
- **`files`** (allow-list, fails safe) is generally preferred over
  `.npmignore` (deny-list).
- **`engines`** pins the supported Node range — delivery-service already has
  `>=22` (`package.json:37-39`), consistent with a CLI package.
- **Compiled JS vs `tsx` at runtime**: delivery-service currently ships and
  runs as raw TypeScript via `tsx` everywhere, including its own demos
  (§1.7, §1.10) — there is no build step today. Shipping compiled JS avoids
  requiring consumers to have `tsx`/`ts-node` installed and avoids
  per-invocation transpile latency; running via `tsx` simplifies the
  dev/publish pipeline but adds a runtime dependency and startup cost.
  `vendor/claude-mock` (§2) already demonstrates the compiled-JS approach
  working inside this monorepo.
- **Build tools**: `tsc` alone is simplest but does not bundle; `tsup`/
  `tsdown`/`unbuild`/`pkgroll` bundle and emit both ESM/CJS from one TS
  source; `tshy` is a more opinionated `tsc`-based alternative for dual-format
  output.
- **Provenance**: `npm publish --provenance --access public` uses OIDC-based
  attestation, typically run from CI (e.g. GitHub Actions) — delivery-service
  already has a GitHub Actions CI workflow to extend
  (`.github/workflows/ci.yml`).
- **`npx <package>`**: relies on a correctly wired `bin` field and a
  Node-compatible published artifact; the standard zero-install run
  experience for CLIs, and the harness's own docs already describe running
  its snippets via `npx tsx` (§1.8) — a different, dev-only use of `npx`.

## 5. Release tooling and changelog conventions

- **semantic-release** — fully automated: Conventional Commits drive version
  bump and changelog generation; no manual gates; ~2.6M weekly downloads.
- **changesets** — PR-based: contributors add changeset files describing
  their change; a bot PR aggregates version bumps/changelog entries; built
  with monorepos in mind; treats the changelog as an intentionally
  human-authored artifact.
- **release-please** (Google) — PR-based like changesets, but derives
  versions/changelog from Conventional Commits, opening a standing "release
  PR" that accumulates changes until merged.
- **Keep a Changelog** (keepachangelog.com v1.1.0) — reverse-chronological,
  dated sections per release plus an `Unreleased` section; six standard
  categories (Added, Changed, Deprecated, Removed, Fixed, Security); ISO 8601
  dates; pairs with SemVer; philosophy "changelogs are for humans" — curated,
  readable entries over raw commit dumps. delivery-service has no
  `CHANGELOG.md` today (confirmed by directory listing, §1.10) — none of the
  vendored/sibling projects surveyed in §2 was observed to maintain one
  either.

## 6. Competitive landscape / comparable tools

*(Sourced by a delegated web-research pass; citations as returned.)*

- **Aider** — config: YAML `.aider.conf.yml` discovered from three locations
  in precedence order (home → git repo root → cwd, later overrides earlier);
  `--config <file>` overrides discovery; options also settable via
  `AIDER_*` env vars or `.env`. Zero-config default: works with no config
  file, falling back to built-in defaults. No dedicated "resume a crashed
  run" feature beyond restoring chat history if a flag is set.
  [aider.chat/docs/config](https://aider.chat/docs/config.html)
- **Claude Code headless (`claude -p`)** — no dedicated headless-only config
  file; inherits the same context as interactive mode unless `--bare` skips
  auto-discovery for deterministic CI runs. Output modes: `text` (default),
  `json` (result + session_id + cost metadata), `stream-json`
  (newline-delimited events). Resume: `--continue` (most recent finished
  session), `--resume <session_id>` (any session by ID or transcript path).
  On SIGTERM the current turn is left unfinished and recorded as such; resume
  continues that unfinished turn.
  [code.claude.com/docs/en/headless](https://code.claude.com/docs/en/headless)
- **OpenHands CLI** — `--resume` (lists recent conversations), `--resume <id>`,
  `--resume --last`; conversations persist as JSON under
  `~/.openhands/conversations/<id>/conversation.json`, loading full history on
  resume. Config via `config.toml` plus env vars; runtime settings palette
  (`Ctrl+P`). Documentation is thin on the exact schema/defaults — noted as
  sparse rather than guessed.
  [github.com/OpenHands/OpenHands-CLI](https://github.com/OpenHands/OpenHands-CLI)
- No further comparable agentic-coding CLIs (e.g. Devin CLI, sweep.dev) had
  sufficient public documentation to cite reliably; omitted rather than
  fabricated.

**Relevance to this harness**: delivery-service's own `resumeAction`
(§1.4) and case-file-directory model is structurally closer to Claude Code's
session-ID/transcript resume than to Aider's chat-history flag or OpenHands'
conversation-list — the harness already has an unambiguous on-disk resume
point (the case-file `dir`) per surface; the open design question is only how
a CLI discovers/remembers that `dir` for an operator who does not want to
type a path every time (cf. OpenHands' conversation list, Claude Code's
`--resume` without an ID).

## 7. Licensing facts

*(Facts only, for a human decision — not a recommendation. See the seeding
idea file for the trigger context.)*

- **MIT** — permissive: commercial use, distribution, modification, private
  use, sublicensing permitted under different terms; sole condition is
  preserving the copyright/licence notice; no patent grant; no warranty or
  liability. Typical for small libraries/tools wanting maximum adoption with
  minimal friction. [choosealicense.com/licenses/mit](https://choosealicense.com/licenses/mit/)
- **Apache-2.0** — adds an explicit, perpetual, worldwide, royalty-free patent
  grant covering patents the contributor necessarily infringes via their
  contribution, which terminates if the licensee sues over the work; also
  requires stating changes to modified files and preserving NOTICE files;
  explicitly withholds trademark rights. Typical for larger projects/companies
  wanting patent-troll protection.
  [choosealicense.com/licenses/apache-2.0](https://choosealicense.com/licenses/apache-2.0/)
- **npm's `license` field** — `"UNLICENSED"` explicitly means "you do not
  wish to grant others the right to use a private or unpublished package
  under any terms"; commonly paired with `"private": true` to block
  accidental publish. Standard licences use SPDX identifiers (`"MIT"`,
  `"BSD-3-Clause"`); multiple licences use SPDX expressions; custom terms use
  `"SEE LICENSE IN <filename>"`. npm's docs do not state an explicit default
  behaviour for an *omitted* field — they only stress that specifying one
  "helps people know how they are permitted to use it."
  [docs.npmjs.com package.json](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/)
- **Facts as they apply here**: `package.json` has no `license` field today
  (§1.10, confirmed directly); the vendored `@jorj/claude-mock` is
  `"private": true` with no `license` field either
  (`vendor/claude-mock/package.json:17`, §1.9). `vendor/README.md:61-66`
  already records, in-repo, that the vendored copy "inherits whatever licence
  this repository adopts" and that licensing it for redistribution is "a
  decision to make explicitly if the harness is open-sourced" — i.e. the
  licence choice this item is gated on has a second-order effect already
  anticipated in the codebase: it also settles what the vendored copy's
  effective licence becomes. Omitting `license` while planning to publish
  publicly leaves consumers and license-scanning tooling with undefined
  terms; this is a fact about ambiguity, not a defect requiring any specific
  fix.

## 8. Open questions / gaps for the design team

- No shipped default `BudgetSet` exists (§1.2, §1.5) — a CLI offering "repo +
  task alone" defaults needs the design to either pick and own these numbers
  in the CLI layer, or get the library to export a canonical default first
  (a scope question, not a research question).
- No case-file-directory convention exists (§1.4) — where does the CLI put
  `dir` by default, and how does it find it again to resume?
  `resumeAction`/`recovery` (§1.4) are exported but currently unused/unprinted
  anywhere — ready-made material for a CLI's human-facing resume/recovery
  messaging.
- The Claude Agent SDK's runtime precondition (a `claude` executable plus one
  of three credential env vars, §1.11) is entirely unmanaged by the library
  today; `DID_NOT_COMPLETE.notRun` (`src/agent-invoke.ts:27`) is the closest
  existing signal and does not distinguish "no CLI installed" from "no
  credential" from any other launch failure — a CLI aiming for plain-language
  errors will need to add this diagnosis itself, since the library provides
  no hook for it.
- `custom` gate/closer plugins are always local files resolved from the repo
  root (§1.3) — there is no packaged/named plugin distribution mechanism to
  build a CLI convenience on top of; "resolve a gate/closer by name" today
  only means the four/five built-in `type` literals.
