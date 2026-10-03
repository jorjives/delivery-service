# Architecture: Pre-Built Task Packs (Roadmap Item 12)

Grounded in the real `src/` (every claim about existing code names its file), the roadmap's
Item 12, `docs/prd/2026-10-03-task-packs/review-log.md` (scope tiers as revised after critic
round 1), and `research.md` (citations `[research N]`, N being a heading number). Style and
altitude follow `docs/prd/2026-10-01-observability-and-reporting/architecture.md`. This
describes the system as it will exist, not the order of building it.

Scope tiers designed against: MUST = pack format; scan, owner review, fix flow; the code
review pack and the security review pack, each with a per-finding gate that verifies the
specific issue is resolved and withstands a fix agent weakening it; plain-language findings;
security severity with authority-class escalation above the roadmap default threshold;
unresolvable findings escalated. SHOULD = configurable severity threshold. COULD = third-party
pack discovery and distribution. Non-goals: scheduling and triggers (Items 13, 14), a hosted
registry.

## 0. The premises, checked against the code

Item 9 says "a pack is a project configuration authored once and distributed. Its work is
discovery and distribution, not shape". Item 11 says "a pack tags tasks through `taskDef`".
Both are only partly true. Verified gaps, and how each is closed:

| Premise | What the code says | Resolution in this design |
|---|---|---|
| A pack is a project configuration | `gate`, `closer`, `roles`, `domain`, `budgets` are project-wide and pinned per run; a task is an opaque object (`src/cli/config.ts` `DeliveryConfig`, `src/cli/settings.ts`) `[research 0.1]`. There is no scan phase in a configuration. | The **fix phase is** an ordinary project configuration (one gate, one closer, one worker prompt, a task list), generated as a real `DeliveryConfig`. The **scan is not a task**: it is a read-only session of a new role, run before any task exists (section 3). Per-finding variation lives inside the single gate and closer, which read `taskDef` (`GateContext.taskDef`, `src/command-gate.ts`). No per-task gate or closer is added. |
| The gate verifies the finding is resolved | `computeDelta` skips every assertion that was not PASS at baseline (`src/delta-rule.ts`), so "finding resolved" cannot be a red-at-baseline assertion `[research 0.2]`. | The finding assertion is **absent at baseline** and appears at check; with `failOnNewAssertions: true` (`GateRef`, `src/schema.ts`; `computeDelta` option) a new non-PASS assertion is a new failure. Works today, no change to the delta rule (section 7). |
| A fix that deletes the test is caught | True only when the gate reports per-test assertions; an `exitcode` gate has one assertion for the command (`src/parsers.ts` `parseExitCode`), and the default `npm test` inference uses it (`src/cli/project.ts`, `src/cli/settings.ts`) `[research 4.2]`. | A diff guard in the pack gate, independent of parse mode (section 7.2). |
| Tags are echoed into the report | The report document carries only `task: taskIntent(taskDef)` (`src/report/derive.ts`, `src/report/document.ts`) `[research 1.7]`. | One additive optional key, `tags`, on `ReportSurface` (section 10). |
| The scan list reaches the fix tasks | Fix worktrees branch from committed state (`src/provision.ts` `resolveBaseRef`) `[research 1.3]`. | Findings are **embedded in each fix task's `taskDef`**; the prompt already carries `taskDef` verbatim (`src/prompt-assembly.ts`), the case file pins it (`CaseFileHeader.taskDef`), and the gate receives it. Nothing needs committing. |
| An agent can return a list | No role emits one; `WorkerEnvelope` is `completed|escalate` (`src/role-config.ts`) `[research 0.3]`. | New `scanner` role with its own envelope (section 3). |
| Severity escalation exists | Authority escalation is reactive only (`src/router.ts`, `src/tool-authority.ts`); escalated runs cannot be resumed (`src/cli/resume-command.ts`) `[research 1.6]`. | Authority-class handling is **held for owner sign-off**, a landing decision recorded in the pack ledger, not an `ESCALATED` run (section 8). |

Small additive core changes this design needs (each optional-field or extraction, none alters
control flow): (1) extract the session-running half of `invoke` so a caseless session can reuse
it (tidy-first, behaviour-preserving); (2) a `scanner` role; (3) `baseBranch` on `GateContext`;
(4) `tags` on `ReportSurface`; (5) plan-file fallback in config lookup. Section 14 verifies
each is additive.

## 1. Platform strategy

CLI and library; no service. Packs are a capability of the existing `delivery` CLI
(`src/cli/program.ts`, commander) and a new `src/packs/` module exported from `src/index.ts`
(the stability-promised library surface), so Item 13's scheduler and adopters call the same
functions the CLI does.

- **Pack engine** (`src/packs/`): manifest, finding schema, scanner, ledger, plan generator,
  finding gate, finding closer, findings view. The CLI renders; the engine decides.
- **Files on disk**: `.delivery/packs/<review-id>/` inside the target repository, beside
  `.delivery/runs/` and `.delivery/supervised/`; `.delivery/` already ignores itself
  (`prepareDeliveryDir`, `src/run-location.ts`), so nothing shows in `git status`.
- **No new daemon, database, network service or credential.** The scan and fix sessions use
  the agent runtime the harness already requires.

## 2. How a pack is represented

### 2.1 Format

A pack is a **folder**, data-only in MUST:

```
<pack>/
  pack.json      schema "delivery.pack/1": the manifest
  scan.md        the scanner's instructions (lens, severity definitions, exclusions)
  fix.md         the fix worker's instructions
  fixtures/      (conformance fixtures: a small repo and a scripted scan, section 11)
```

`pack.json` is a zod schema (`src/packs/manifest.ts`), `.strict()` so a typo is named, as
`DeliveryConfig` is. It is JSON for the same reason `delivery.config.json` is: no code runs to
read it. Fields:

- `schema`, `name` (slug), `version` (semver), `title`, `summary` (plain words, shown by
  `delivery packs`).
- `scan`: `prompt` (file), `categories[]` (`id`, `title`, one plain sentence each),
  `maxFindings` (default 40), `checks` (which check kinds, section 5.3, a finding may use;
  subset of the library's closed set).
- `severity`: the vocabulary is the library's `low | medium | high | critical`, with the
  pack's plain definition of each by consequence (research 3.2 argues consequence wording
  calibrates an LLM better than a score). The pack supplies words, not a new scale.
- `hold`: `{ atOrAbove: "high" | ... | null }`, the pack's default threshold (security review
  `high`, code review `null`).
- `fix`: `prompt` (file), `testGlobs`, `protectedGlobs`, `skipMarkers` (additions to the
  library's defaults, section 7.2).
- `landing`: default closer for a fix that is not held (`merge-back` default).

Why data-only: a pack that is only prompts and parameters cannot run code on the owner's
machine. The gate and closer are harness-owned (sections 7, 8), so "each pack ships a gate
suited to its domain" is met by the pack **choosing check kinds and guard globs for its
domain**, not by shipping gate code. A pack with its own gate or closer module is a COULD,
gated behind an explicit trust confirmation (section 13).

### 2.2 Where built-in packs live and how a project references one

Built-in packs ship in the npm package under `packs/code-review/` and `packs/security-review/`
(added to `package.json` `files`; they are located relative to the installed package, as the
CLI already locates its own runtime, `src/cli/agent-session.ts`). A pack is referenced **by
the command**, `delivery review <name-or-path>`; no configuration key is added. Rationale: the
owner "points at the codebase with no configuration" (roadmap criterion), and adding a key to a
`.strict()` schema for a thing a command names is configuration for nothing. Item 13 can add a
`pack` reference to the config when it needs one (section 14).

### 2.3 Relation to the project configuration schema

The pack never extends `DeliveryConfig`. `delivery fix` generates a **plan file**,
`.delivery/packs/<review-id>/plan.config.json`, that is a valid `DeliveryConfig` (the existing
strict schema, `src/cli/config.ts`): `tasks` (the authorised fix tasks), `domain` (the
project's own, if its config has one), `roles.worker.systemPromptFragment` (the pack's
`fix.md`), `gate` and `closer` (the library's finding gate and closer, as `custom` refs with
absolute module paths into the installed package), `budgets` and `concurrency` from the
project's config or flags. Being a real `DeliveryConfig` means `validate`, `preview`, `status`
and `report` read it unmodified, and "what is previewed is what runs" (`src/cli/roles.ts`
`rolesFor` is shared) holds for packs too. A project's own `gate` is not discarded: it supplies
the regression command the finding gate wraps (section 7.1).

## 3. The scan step

### 3.1 Role

A new role, `scanner`, beside `worker`, `triage` and `gate-maintenance`
(`AgentRole`, `src/ports.ts`; `RoleConfigShape`, `src/role-config.ts`).

- **Tools: `READ_ONLY_TOOLS` only** (`Read`, `Glob`, `Grep`, `src/role-config.ts`). The
  existing `superRefine` that refuses a writable triage role is extended to `scanner`, so a
  pack cannot widen it, and `RoleOverride` never exposes it (`RoleOverrides` already omits
  triage for the same reason). No `Bash`, no network tools: the tool guard
  (`createToolAuthority`, `src/tool-authority.ts`) refuses anything off the list and anything
  outside the worktree, and a refusal surfaces as an authority incomplete exactly as for the
  worker.
- **Envelope**: `ScanEnvelope = { findings: ScannedFinding[], notes: string }` where
  `ScannedFinding` has no `id` and no verification (those are the harness's, section 3.3).
  The SDK enforces it with `outputFormat: json_schema` from `z.toJSONSchema`
  (`buildSessionOptions`, `src/agent-invoke.ts`), and the harness re-validates with zod; a
  wrong shape is an incomplete, as for every role (`invoke`).
- **Where it runs**: in a scratch worktree provisioned at the base branch tip
  (`provisionWorktree`, `src/provision.ts`), so the scan sees committed state exactly as the
  fix tasks will and never the owner's uncommitted edits; removed afterwards
  (`removeWorktree`, `src/closer-support.ts`).
- **Session mechanics**: `invoke` today loads a case file and assembles the task prompt from it
  (`src/agent-invoke.ts`, `src/prompt-assembly.ts`). A scan has no case file. The tidy-first
  step extracts the part after prompt assembly (options, `sessionEnd`, refusal classification,
  usage, envelope validation) into `runSession(roleCfg, ctx, prompt, systemPrompt, session)`;
  `invoke` becomes load, assemble, `runSession`, and the existing `agent-invoke.test.ts`
  proves it unchanged. The scanner prompt is its own pure function (`assembleScanPrompt`: pack
  `scan.md`, the fixed reply-format slot, the repository summary), deterministic like
  `assemblePrompt`. `recordFailureCause` writes to a `refs/` folder; the review directory
  provides one.

### 3.2 Scan output is untrusted input, validated deterministically

The scanner's word is not believed. After the envelope parses, the harness checks each claim
against the scratch worktree at the scan commit:

1. `path` exists and is inside the repository (no `..`, no absolute path, no symlink escape:
   resolved with `realpath` against the worktree root; the guard in `tool-authority.ts` is
   lexical only, a documented `ponytail:` ceiling, so findings get the stricter check).
2. `anchor` (the exact offending text, one to five lines, at least 8 non-space characters)
   occurs in that file after whitespace normalisation. A finding the harness cannot place is
   not proposed; it is recorded as `unconfirmed` with the scanner's wording and listed to the
   owner under "could not be confirmed", never silently dropped (the nothing-dropped
   invariant, section 6).
3. `check`, if `pattern-absent`: the ERE compiles under `git grep -E` and **matches at the
   scan commit** (a pattern that does not match now cannot go red to green). If
   `dependency-absent`: the package and version are in `package-lock.json` now.
4. Free text is length-capped and stripped of control characters (C0, C1, ESC), as the report
   sanitises terminal output; findings are capped at `maxFindings`, with a visible
   "N more not shown" note.

### 3.3 Identity

`id = first 12 hex of sha256(JSON [pack, category, path, normalisedAnchor])`
(`node:crypto`). Not line numbers, which drift as fixes land, and not the title, which an LLM
rewords between runs. Two proposals with the same id merge (first wins). The id is stable
across re-scans, which is what lets a skipped finding stay skipped (section 4.3) and is the
content identity the fix task inherits (section 6).

### 3.4 Persistence and crash safety

A review is a directory, `.delivery/packs/<review-id>/`, built on `journal.ts` exactly as the
case file and run file are (`atomicWriteJson`, `appendLine`, `parseLines`, torn-tail
tolerance):

- `review.json` (written once, atomically): review id, pack name and version, a hash of the
  manifest and prompt files, repository path, scan commit sha, `scanner` role pinned.
- `refs/scan.json` (atomic): the validated result, including `unconfirmed` entries.
- `log.jsonl` (append-only, one zod discriminated-union entry per line, each stamped `at` by
  the single append function, as `appendEntry` stamps case entries): `scan_started`,
  `scan_session` (`sessionKey`, `usage: SessionUsage`), `scan_done` (ref), `decision`,
  `authorise`, `fix_observed`, `signed_off`, `rejected`, `landed`.

The log tail is the authority, as for case files (`deriveStateFromEntry`, `resumeAction`,
`src/case-file.ts`). A crash after `refs/scan.json` but before `scan_done` is recovered by
re-validating the file and appending the entry (idempotent). A crash mid-session leaves no
`scan_done`; sessions are reconstructed, never continued (`invoke` doc comment), so `delivery
review` re-runs the scan at the cost of one session. Scan cost and duration are recorded the
way every session's are (`SessionUsage`, `src/schema.ts`).

## 4. Owner review and authorisation

### 4.1 The decision is recorded, never inferred

`approve`, `skip`, `sign-off` and `reject` are CLI verbs that append a `decision` entry
naming **concrete finding ids**. `--all` is expanded to the ids in the entry, so a later
re-scan cannot widen it. The last decision per id wins (a fold). Nothing an agent says can
write a decision: the scanner role has no write tool, and the ledger is outside every
worktree.

### 4.2 Authorisation entry

`delivery fix` first appends one `authorise` entry per approval batch:
`{ ids, threshold, hold: {id: boolean}, landing: CloserRef, verify: {command, parseMode} | null }`.
`hold[id]` is computed once, deterministically, from the finding's severity against the
threshold (the pack default, or the owner's flag; the flag is the SHOULD), plus one more rule:
**a fix with no regression command to run is always held**, as is an owner-granted test-edit exemption (section 7.4, 7.2). The entry is the
owner's recorded authority; it is what makes a security finding's later landing an
authorised act.

### 4.3 Carry-over across re-scans (SHOULD; identity is MUST)

A new review folds the ledgers of earlier reviews of the same pack in the same repository
(the way `allRuns` enumerates run folders, `src/cli/runs.ts`). A finding whose id was skipped,
rejected or fixed before is shown with that state, defaulted to skipped or fixed; a fixed one
whose anchor is present again is shown as "came back". Pure fold, no stored suppression file
to rot.

## 5. The finding schema

### 5.1 Decision: a small harness-owned schema, SARIF at the edge

Evaluated `[research 3.1]`. SARIF 2.1.0 is the interchange format Semgrep, CodeQL and
OSV-Scanner emit, and has fingerprints, `level`, suppressions. It is a poor authoring format
here: the owner must read it, it has no field for plain-language problem, why it matters, or
what fixed looks like (they would live in non-standard `properties`), and its nesting is heavy
for a non-engineer. So the finding is our zod schema (`src/packs/finding.ts`), published as a
JSON Schema through `z.toJSONSchema` (the report's precedent, `src/report/json-schema.ts`).
A lossless mapper **to** SARIF (`results[]` with `partialFingerprints`, `level`, physical
location) is the export edge, and one **from** SARIF the detector-ingest edge; both COULD
(`product-design.md` item 22), neither on the MUST path.

### 5.2 Shape

```
Finding {
  id            12-hex fingerprint (harness-assigned)
  title         short, plain
  category      one of the manifest's category ids
  severity      low | medium | high | critical
  where         { path, line? }               line is a hint only, never identity
  problem       plain: what is wrong
  whyItMatters  plain: the consequence, for a non-engineer
  fixedLooksLike plain: what done looks like
  anchor        exact offending text (the identity and the default check)
  check         one of the kinds in 5.3
  detail?       technical block for engineers (rule, evidence, references)
  needsDecision? true: the scanner says only a person can resolve it
  outsideStep?  plain: what only a person can do after the code fix (e.g. rotate a credential)
  source        reviewer | detector     who produced it (section 5.4)
}
```

### 5.3 Check kinds (closed, harness-owned)

| Kind | Resolved means | Level shown to the owner |
|---|---|---|
| `anchor-gone` (default) | the anchor text, whitespace-normalised, no longer occurs in the file (`scope: file`, the default) or anywhere in the repository (`scope: repo`, which a pack sets per category, as security sets for `secret` so moving a password to another file does not pass). Commenting it out leaves it, so does not pass; deleting or rewriting does | "checked: the flagged code is gone" |
| `pattern-absent` | the scan-supplied ERE matched at the scan commit and now matches nowhere in the stated paths | "checked: the risky pattern no longer appears" |
| `dependency-absent` | `package@version` no longer in `package-lock.json` (parsed, no network) | "checked: the vulnerable version is no longer installed" |
| none | nothing finding-specific | "tests only: no check of this specific issue" |

The ceiling, said plainly: for judgement findings, absence of a pattern is not proof the
problem is solved; an agent can rename a variable past `anchor-gone`. Research 4.1 shows no
deterministic proof exists for LLM-found correctness findings, and that the field's LLM-only
tools ship no verifier at all `[research 2]`. The design does not claim one. It (a) makes the
check explicit and owner-visible at review time (the check is data the owner approves, the
precondition research 4.3 names), (b) layers the guards of section 7.2 so the check cannot be
made easier, (c) holds anything severe for a human, and (d) labels the weakest level so the
owner never mistakes "tests pass" for "issue fixed". A pack can require a targeted check
(`requireCheck: true`; and see 7.4 for repositories with no tests): a finding with none becomes `needsDecision` and is escalated at review
as not machine-fixable.

### 5.4 What the MUST path delivers for dependency findings

The scanner is read-only with no shell and no network, so in MUST the security pack's
dependency lens is **the reviewer's own knowledge**: it reads `package.json` and
`package-lock.json` with `Read` and may flag a package it recognises as vulnerable, with
`source: "reviewer"`. The owner is told in plain words, beside the finding, "from the
reviewer's knowledge, not from an advisory database; it may be out of date or wrong"; the
`dependency-absent` check is still deterministic for whether the version is gone. A
harness-run **detector** (`npm audit --json`, OSV-Scanner SARIF) is a COULD, owned by the pack
engine and run **outside the scanner role**, before the scan, with `execFile` (no shell), a
timeout and zod-validated output; its results become findings directly (`source:
"detector"`, fixed plain wording around the advisory's quoted title and severity,
`dependency-absent` check), and it degrades to a stated "no advisory data available" when the
tool or network is missing (research 3.3). The seam exists (`runDetectors` in the scan step);
the MUST path does not depend on it.

`test-red-green` (the fix adds a test that fails at the base commit and passes after,
SWE-bench style `[research 4.1]`) and detector re-run (the originating Semgrep or OSV rule)
are COULD kinds the closed set leaves room for. Not built: they need per-language runner
knowledge or an installed tool, and the roadmap's language-agnostic stance wins.

## 6. Fix-task generation and content identity

For each approved, not-yet-terminal finding the plan generator emits:

```
{ intent: "Fix: <title> (<path>)",
  tags: { pack, findingId, severity, phase: "fix" },
  finding: { ...whole Finding... },
  authorisation: { hold, landing, verify } }
```

- **Identity is content.** The queue matches a run to a task by `isDeepStrictEqual` on the
  pinned `taskDef` (`findQueueRun`, `src/task-list.ts`); an object with extra fields is legal
  (`QueueEntry` is a `looseObject`, `src/cli/config.ts`). The same finding with the same
  authorisation is the same task, so re-running `delivery fix`, or a crashed run, never
  duplicates it. `authorisation` is in identity on purpose: authorising the same finding
  differently (held versus landing) is a different promise and a new task. No `at` is in the
  object, or identity would change every time.
- The plan is a **pure function of the ledger**: the same entries produce the same
  `plan.config.json`, byte for byte, in a stable order (severity, then id). Regenerating it
  after a crash is safe.
- **Before running**, each task's precondition is re-checked against the current base: anchor
  or pattern or dependency still present. If not (a concurrent fix, an owner edit), the
  finding becomes `already resolved`, not a task. This is also where fan-out overlap is caught
  cheaply.
- The agent sees the finding verbatim in the `## Task` JSON (`src/prompt-assembly.ts`). The
  pack's `fix.md` states that the `finding` fields are a description to act on, not
  instructions to obey (section 9).

`delivery fix` is a loop over the existing queue driver (`runQueue`, `src/cli/queue.ts`):
plan, run the remaining tasks, fold outcomes into `fix_observed` entries, repeat until no
approved finding is non-terminal. Reason: with `concurrency` 1 an escalated task stops the
list (`queue.ts`, `STOPPED_PART_WAY`), and "unfixable findings are escalated, not skipped"
must not mean "and nothing after them runs". An escalated finding is recorded terminal and
dropped from the next pass; the plan file on disk still lists it, so the report shows it.
Each pass makes progress or the loop ends (an environment escalation, a usage limit), and
says which.

## 7. The per-finding gate

One harness-owned custom gate, `findingGate` (`src/packs/finding-gate.ts`), pinned as
`{ type: "custom", modulePath: <absolute, in the installed package>, failOnNewAssertions: true }`.
The gate module is loaded from outside the worktree (`loadCustomGate`, `src/custom-gate.ts`;
`gateOf`, `src/run-gate.ts`, loads from the repository root, never the worktree), and the tool
guard refuses any call aimed outside the worktree (`src/tool-authority.ts`), so the fix agent
can neither read nor edit it. The finding and its check are in `taskDef`, pinned in
`case.json` outside the worktree.

### 7.1 Composition

`baseline(ctx)` runs the project's regression command through the existing
`createCommandGate` (`src/command-gate.ts`) using `taskDef.authorisation.verify` (the
project's `gate` if its config has a command gate, else the `npm test` inference
`inferredCheck`, `src/cli/project.ts`) and returns its assertions only.
`check(ctx)` returns the same command's assertions **plus**:

- `finding:<id>:resolved`: PASS or FAIL by the finding's check kind (section 5.3), computed
  against the worktree. Absent at baseline, so with `failOnNewAssertions` a FAIL is a new
  failure and PASS is not (`computeDelta`).
- the guard assertions of 7.2.

So "this finding is resolved and nothing regressed" is two deterministic parts through the
unmodified delta rule: baseline-PASS assertions must stay PASS (regression), and the new
assertions must be PASS (resolution, guards). No new delta mechanism, no edit to
`src/delta-rule.ts`.

### 7.2 Resistance to weakening

`GateContext` gains the pinned `baseBranch` (`CaseFileHeader.baseBranch`; `gateContext`,
`src/run-gate.ts`, builds the context), so the gate can run `git merge-base HEAD <baseBranch>`
and `git diff --name-status <merge-base>` (committed and uncommitted changes; the base may
have advanced under fan-out, the merge-base does not). Guards, all by git against the diff,
so **independent of the test parse mode** (closing the exitcode hole `[research 4.2]`):

| Guard assertion | FAIL when |
|---|---|
| `guard:tests-untouched` | a file matching `testGlobs` is deleted or modified (added test files are allowed); for category `tests`, only deletion fails |
| `guard:check-untouched` | a file matching `protectedGlobs` changes (test runner configs, CI configs), or `package.json` `scripts.test` differs from the merge-base value |
| `guard:no-skips` | an added line matches a skip marker (`.skip(`, `xit(`, `@Ignore`, `pytest.mark.skip`, and the pack's additions) |

**Stated limitation.** `guard:tests-untouched` fails any modified existing test, so a legitimate
fix that must change one (a changed signature, an assertion that encodes the bug, a
dependency upgrade that breaks a fixture) cannot pass and ends `unfixable`. This is
deliberate (a fix that edits the tests that judge it is the weakening vector), and it must
not inflate the owner's "could not be fixed" count unexplained. It surfaces three ways: the
last gate entry's failing ids (`GateEntry.newFailures`, `src/schema.ts`) name
`guard:tests-untouched`, so the ledger records the finding as `unfixable` with cause
`needs_test_change`, the findings view says "the fix needs to change one of your tests, which
this review does not let an agent do" and counts those separately from other unfixables;
category `tests` relaxes modification for findings that are about tests; and (SHOULD) the
owner may grant `approve <n> --allow-test-edits`, recorded in `authorise`, forced held,
deletion still refused.

Globs are git pathspecs (`':(glob)**/*.test.*'`), so git does the matching. This answers the
three questions of the pooled idea `50-20260930T212043Z-gate-maintenance-can-weaken-the-check`
for pack fixes: the change is **shown** (the diff against the merge-base is what the guards
read, and a held fix's branch diff is shown by `findings`), a weakened check is **refused**
(guard FAIL), and the finding check is **data, not a command** (a pattern run by `git grep`,
never `sh -c`). It does not cover special-casing production code to satisfy a check, which no
gate can; the owner sees the diff for held fixes, and the level label is honest.

### 7.3 Determinism and ERROR

A command that cannot run is a gate ERROR as today (`errorReport`, `src/gate-support.ts`) and
takes the existing gate-maintenance route. A pattern that is malformed or times out (10 s,
`git grep` run with a timeout) is ERROR for that finding, not PASS; the gate never converts
"could not check" into success, which is the failure the research calls out for missing tools
`[research 3.4]`.

### 7.4 No tests

One story, agreed with the product design. If the project has no regression command
(`inferredCheck` finds none):
- a finding **with** a targeted check (`anchor-gone`, `pattern-absent`, `dependency-absent`)
  is offered and approvable, and its fix is **forced held**; the view says "finding check
  only, no regression tests";
- a finding **without** one (check kind none) cannot be checked at all, so it is not offered:
  it is `needs_decision` ("cannot be checked"), and `approve --allow-unchecked` is the owner's
  explicit, recorded choice (in `authorise`, forced held, one-line warning).

`location-changed` is not a check kind: `anchor-gone` replaces it with a stricter, named
predicate. This resolves the roadmap's "static analysis gate if no tests exist" by honesty and
sign-off, not a bundled tool.

## 8. The closer, severity and authority-class escalation

`findingCloser` (`src/packs/finding-closer.ts`) is pinned as a `custom` closer
(`CloserRef`, `src/schema.ts`; `resolveCloser`, `src/resolve-closer.ts`). It reads
`taskDef.authorisation` from the case file (`load(dir)`, as `open-pr-closer.ts` reads the
task):

- `hold: false`: delegate to `authorisation.landing` (default `merge-back`; the project's
  `closer` if set, e.g. `open-pr`). All existing closer semantics apply (ff-only, idempotent,
  plain failures: `src/merge-back-closer.ts`).
- `hold: true`: delegate to `commit-to-branch` behaviour (`src/commit-to-branch-closer.ts`):
  the gated work is committed on `surface/<id>`, the worktree is removed, the branch is kept,
  the base is untouched. The task is harness-`closed`; **held is a ledger state**, derived
  (section 9.2).
- A stopped surface tears down and keeps the branch, as every built-in closer does
  (`teardownWorktree`, `src/closer-support.ts`).

**Authority-class escalation** is defined as: a finding at or above the threshold needs the
owner's authority to land, however well it was gated. It is deliberately not an `ESCALATED`
run. An escalation ends a run before the gate and closer, cannot be resumed, and (sequential)
blocks the list `[research 1.6]`; a held fix has passed its gate and keeps its work. The
tradeoff and the alternative are in the ledger.

**Sign-off and the moved base.** A held fix was gated against the base as it stood when its
task started; by sign-off other fixes have usually landed, so a bare `merge --ff-only`
(`src/merge-back-closer.ts`) would be diverged and would fail in the ordinary case (a security
fix held while lower-severity fixes land). Sign-off therefore does not call the closer cold.
`delivery findings sign-off <n>` appends `signed_off`, takes the repository lock
(`takeRepoLock`, `src/repo-lock.ts`, so sign-offs and supervised closes serialise) and runs
`landHeld`:

1. add a scratch worktree on the kept branch `surface/<id>` and `git rebase <baseBranch>`
   (`baseBranch` pinned in the case header; `branchName`, `src/provision.ts`). A conflict
   aborts the rebase and ends the finding `signed_off_failed`: "your main copy changed in the
   same lines; the fix was not landed; branch kept".
2. **re-gate on the base it will land on**: `findingGate.baseline` in a second scratch worktree
   at the base tip and `findingGate.check` in the rebased one, compared with `computeDelta`
   (`src/delta-rule.ts`), exactly the delta the task was judged by, on the new base. This
   is library composition (`gateOf`, `computeDelta`), not a new gate. FAIL (the fix no longer
   passes on current main, including `finding:<id>:resolved` failing because another change
   reintroduced the pattern) ends `signed_off_failed` with the failing assertion ids quoted;
   nothing is merged.
3. only on PASS, `createMergeBackCloser` (or the project's landing closer) lands it, which
   now fast-forwards because the branch contains the base tip. The `CloseReport`, the
   re-gate verdict and the new base sha are appended as `landed`.

So a landing is never un-gated against a moved base, and a signed-off fix either lands
re-verified or says why it did not. Every step is idempotent on replay (rebase of an
already-rebased branch is a no-op; the closer's ancestry probe handles "already merged").
What the owner sees: "Checking the fix still works on your current main copy... passed. Landed."
or "Could not land: <plain reason>. The fix is kept on <branch>." The same rebase and re-gate
is available to a non-held fix whose landing failed with the moved-base FAIL, but that path
stays the existing close retry; this design does not change supervised closes. `reject`
appends `rejected`; the branch is kept.

**Unfixable findings**: a worker `escalate` (`WorkerEnvelope`), an authority refusal or a
spent budget ends the task `ESCALATED` with the harness-built `EscalationPacket`
(`src/escalation-packet.ts`) and the report's plain text (Item 11, `src/report/plain.ts`);
the ledger records `fix_observed` with the outcome and the finding view quotes that
explanation. `needsDecision` findings and `unconfirmed` ones are likewise terminal states with
an explanation, never silent.

Severity threshold: the manifest default (SHOULD: owner flag and per-pack setting). The comparison is on the
closed ordered enum; a threshold of `null` holds nothing.

## 9. States, data model, and the findings view

### 9.1 States

`proposed` -> `approved | skipped`; `approved` -> `already_resolved | fixing`; `fixing` ->
`fixed` (landed) | `held` | `unfixable` | `stopped`; `held` -> `signed_off_landed |
signed_off_failed | rejected`; scan-time: `unconfirmed`, `needs_decision`. Invariant: every
finding has exactly one state at every moment and ends in a terminal one. Enforced by the
fold being an exhaustive `switch` with a `never` check (the repository's convention for
closed sets, e.g. `WHAT_IT_TAKES` is keyed on `keyof DeliveryConfig`), and a test that
property-checks it over generated ledgers.

The owner-facing names are `product-design.md`'s closed set; the mapping is one-to-one on
the internal names above, plus: **out of date** is not a state: tasks branch from the current
base, so a file that merely changed since the review is not stale; a finding whose
precondition (anchor, pattern, dependency) no longer holds is `already_resolved` ("already
fixed"). **Declined at sign-off** is `rejected`. **Fixed with an outside step left** is
`fixed` or `held` with `outsideStep` shown beside it, not a state. **Could not be
confirmed** is `unconfirmed`. **Needs your decision** is `needs_decision` (scanner flag, or no
check in a no-tests repository). **Signed off but could not be merged** is
`signed_off_failed` (conflict or re-gate failure, 8). **Stopped by a setup problem** is
`stopped`.

### 9.2 The findings view

`deriveFindings(snapshot)` is a **pure fold** of the ledger and the run records of the fix
tasks (matched by `findQueueRun` against the generated tasks), the same snapshot-then-derive
shape as the report (`loadSnapshot`/`deriveReport`, `src/report/`). It reads `taskDef` and
`outcome` from case files and `CloseEntry`/escalation packets; it never reads a clock.
`delivery findings` renders it and `--json` emits a versioned zod document
(`delivery.findings/1`, published JSON Schema). It adds no second source of truth: standing
of the underlying runs still comes from `deriveReport`.

### 9.3 Data model summary

| Artefact | Owner | Written | Read by |
|---|---|---|---|
| `review.json` | pack engine | once, atomic | everything |
| `refs/scan.json` | scanner step | once, atomic | findings view, plan |
| `log.jsonl` | pack engine | append, synced | the fold |
| `plan.config.json` | plan generator | regenerated, atomic | `run`-family commands, report |
| fix runs `.delivery/runs/<id>/` | existing surface | existing | fold, report |

No existing file's format changes except the additive `tags` on the report document.

## 10. Integration with the supervisor and the report

- **Supervisor.** Fix tasks are list entries to the existing driver. `concurrency` N gives N
  surfaces in N worktrees, the shared repair breaker, the repo lock, serialised closes
  (`src/supervisor.ts`, `src/breaker.ts`, `src/repo-lock.ts`, `docs/multi-surface-control-flow.md`).
  Nothing in the supervisor changes. Known limit, inherited and named: there is no dependency
  scheduling, so two findings in one file can conflict at landing; with `merge-back`, the
  second `--ff-only` fails plainly and goes to existing close retry. The plan orders by
  severity then id, and the docs recommend a branch-keeping or PR landing for concurrency
  above one. A cheap mitigation lands in the plan: tasks touching the same path are adjacent
  and the finding precondition re-check (section 6) drops a fix a prior one already resolved.
- **Report.** No new report type (Item 11). `ReportSurface` gains optional `tags`
  (`Record<string, string|number|boolean> | null`) echoed from `taskDef.tags`, which is what
  Item 11 asserted and the code does not do `[research 1.7]`. It is additive in the published
  `delivery.report/1` schema (`src/report/json-schema.ts`, `src/report/published-keys.txt`
  guard the key set). Text rendering prints the intent as today, so a fix reads "Task 3 of 9:
  Fix: Hard-coded database password (src/db.ts)". The reporting list is the task list
  (`derive.ts`), so the plan file must be discoverable: when no `delivery.config.*` exists,
  config lookup falls back to the latest plan (`findConfig`, `src/cli/config.ts`); with a
  project config, `--config` selects the plan. Scan sessions appear in the findings view, not
  as report tasks (they are not tasks).
- **Cost.** Scan usage is a ledger entry; fix usage is already per run
  (`SessionUsage`); the findings view totals both.

## 11. Testing

Per the repository's convention, everything runs offline through the existing agent mock
(`vendor/claude-mock` via `src/mock-session.ts`, `src/mock-script.ts`); for CLI-level tests the
`DELIVERY_TEST_MOCK_SCRIPT` seam routes every session of a `delivery` invocation to a script
(`src/cli/agent-session.ts`). A scripted scan is a `MockExpectation.json` carrying the
`ScanEnvelope`; a scripted fix is `effects` (real file writes and edits in the worktree)
plus a worker envelope.

Behaviours asserted (intended behaviour, red first, not current behaviour):

- Scan: a hallucinated path or anchor becomes `unconfirmed`, not a task; duplicate findings
  merge; ids are stable under line drift and re-wording; `maxFindings` truncates visibly;
  the scanner is refused `Edit`, `Bash` and out-of-worktree reads (as `tool-authority.test.ts`
  does for roles); a crash between `refs/scan.json` and `scan_done` recovers.
- Review: `--all` records concrete ids; the last decision wins; `hold` follows severity and
  threshold; no tests found forces hold.
- Plan: generation is byte-identical for the same ledger; running `fix` twice creates no
  second run for any finding (`findQueueRun`); an unfixable finding does not stop the next
  one at concurrency 1.
- Gate, adversarially, with scripted fix agents that cheat: delete a test; edit a test;
  add a skip marker; edit `scripts.test`; comment the offending line out (`anchor-gone`
  must stay FAIL); fix the pattern by obfuscating (documents the ceiling and asserts the
  label); leave a stale finding (precondition drops it); an `exitcode` gate and a tap gate
  both catch the file-level tampering.
- Closer and sign-off: a held fix leaves base untouched and the branch intact; sign-off lands
  via `merge-back`; replaying sign-off is a no-op; a moved base gives the plain FAIL.
- Moved-base sign-off: a held fix plus other landed fixes; sign-off rebases, re-gates on the
  new base and lands; a conflicting rebase and a reintroduced pattern each end
  `signed_off_failed` with nothing merged; replay is a no-op.
- Secrets: a seeded literal never appears in any rendered output; `refs/scan.json` is mode 0600.
- Fan-out: `runSupervisorAgainstMock` (`src/scripted-supervisor-run.ts`) with N findings
  at concurrency N reaches one terminal state each.
- **Pack conformance suite**, exported from `delivery-service/testing`: given a pack
  folder with `fixtures/` (a tiny seeded repo, a scripted scan, expected finding states),
  asserts manifest validity, that every category and check kind resolves, that the scan
  yields the expected confirmed findings, and that the seeded fix passes its gate while a
  seeded cheat fails. The two built-in packs run it in `npm test`; a third-party author runs
  the same suite with `delivery packs check`.
- Prompt-injection tests: a seeded repo file containing instructions aimed at the scanner;
  with a scripted scanner that "obeys" it, the harness still validates, caps and labels, and
  the fix worker's authority is unchanged.

What scripted tests cannot prove, said in the docs as `docs/testing-your-pipeline.md` says it:
how good a real scan is, or whether a real agent obeys `scan.md`.

## 12. Security and compliance

- **Scanner authority is read-only** (section 3.1): `READ_ONLY_TOOLS`, enforced by
  `validateRoleConfig`, not overridable, worktree-confined by the tool guard. It cannot
  write the ledger, run commands, or reach the network.
- **Untrusted repo content reaches prompts.** The chain is: hostile file, scanner, finding
  text, fix task `taskDef`, fix worker (which has `Bash`). Controls, in depth: (1) the
  scanner cannot act, only describe; (2) every finding claim is checked against the
  repository (3.2) and free text is capped and stripped; (3) the owner reads the finding text
  verbatim at review before anything is authorised, and the technical block shows the check;
  (4) the fix prompt labels finding fields as untrusted description; (5) the fix worker's
  authority is unchanged and bounded: worktree-confined, gate pinned outside it; (6) severe
  fixes are held for sign-off; (7) the check cannot be loosened by the agent (7.2).
  Residual: a hostile file can make the scanner omit findings, so "no findings" is worded as
  "none found", never "clean".
- **Regex safety.** An LLM-authored regex from untrusted content is a ReDoS vector under
  `RegExp`. It is run by `git grep -E` with a 10 s timeout and a length cap, never by the
  harness's own regex engine (ledger).
- **Path safety.** Finding paths are resolved with `realpath` against the worktree root;
  absolute or escaping paths are refused.
- **Code execution.** Data-only packs run no code. A pack with code modules (COULD) requires
  an explicit trust confirmation, records content hashes in `review.json`, and re-asks if
  they change.
- **Data egress.** No new egress: repository content goes to the agent runtime, as for the
  worker today. Optional detectors (SHOULD) are named per pack and run only when the pack
  declares them; `npm audit` needs the network and says so.
- **Secrets in findings.** One rule. A *secret-shaped literal* is detected by the harness,
  not the scanner's say-so: private-key headers, provider key prefixes, a `password|secret|token|api_key`
  assignment to a quoted value, JWT shape, and any 20-plus character high-entropy token,
  plus anything in a category the pack marks `sensitive`. (1) The literal may exist only in
  `anchor` and `check.pattern`; at ingestion every other free-text field (title, problem,
  why it matters, fixed looks like, detail) has any detected literal replaced by its mask.
  (2) **Every rendering masks** the anchor and pattern: first 4 characters, an ellipsis and
  the length (`AKIA…(20)`), in the findings view, `--json`, the report and events, SARIF
  export, `preview`, error text and the escalation text. (3) **Stores that carry the
  literal unmasked**: `refs/scan.json`, `plan.config.json`, and each fix run's `case.json`
  and prompt, because the gate and the agent must act on it and the repository already
  holds it. These live under the self-ignoring `.delivery/`, are written with mode `0600`
  (`atomicWrite` takes a `mode`, `src/journal.ts`), and are never committed or echoed.
  `findings` and `report` build only from masked views; a test asserts no literal appears in
  any rendered output.

## 13. Extensibility: third-party and community packs

- A pack is a folder; a path to one works anywhere `delivery review <path>` does (MUST for
  the format, as local use is how Priya develops and how a team shares one in its repo).
- Distribution and discovery (COULD): an npm package whose `package.json` names the pack
  folder (a `delivery-pack` field); `delivery packs` lists built-ins, local paths from the
  project, and installed packages that declare the field. No hosted registry (non-goal).
- Versioning: `delivery.pack/1` is the contract; the manifest hash and `version` are
  recorded in each review, so a result is reproducible and a changed pack is visible.
- A conformance suite (section 11) is the trust signal a community pack can carry.
- Packs with code (own gate or closer module): COULD, behind the trust prompt of section 12.
- What Items 13 and 14 hang off: `reviewAndPlan(repo, pack)` and `runFix(plan)` are library
  functions; a scheduler calls them, and a trigger filter selects findings by tag. A
  `pack` key in `DeliveryConfig` is deferred to Item 13 with a reason: it is the first
  consumer that needs a project to name a pack without a command line.

## 14. Non-functional requirements

| Property | Target |
|---|---|
| Determinism | ids, plan, states, view: pure functions of recorded data; no clock in a fold; ordering by severity then id |
| Crash safety | every write atomic or synced append; any crash is recovered by re-running the command |
| Idempotence | `review` resume, `fix`, `sign-off` safe to repeat |
| Cost visibility | scan and fix usage recorded and totalled; scan is one session |
| Bounded work | `maxFindings`; text caps; regex timeout 10 s; no unbounded loop in `fix` (each pass terminalises a finding or stops) |
| Offline | everything except the agent sessions and an optional detector |
| Plain language | fixed phrase tables over the closed enums, agent text always quoted and attributed, as `src/report/document.ts` does; no stack traces; British English |
| Accessibility | no cursor movement; colour never the only signal (`useColour`, `src/cli/output.ts`) |
| Compatibility | all schema additions optional; old records read; section below |

Additivity check: `scanner` is a new member of `AgentRole` (consumers switch on it, so every
`switch` gets a compile-time prompt); `GateContext.baseBranch` is an added field existing gates
ignore; `tags` is an optional report key; the config fallback only applies when no config is
found, a state that is an error today. `invoke`'s extraction is behaviour-preserving.

## Tier map

| Tier | Sections it covers | Depends on |
|---|---|---|
| MUST | 2 (format), 3 (scan), 4.1-4.2, 5 (schema, check kinds, 5.4), 6, 7, 8 (closer, hold, landing, unfixable), 9, 10, 11, 12 | nothing below |
| SHOULD | configurable threshold (4.2, 8), carry-over (4.3), `--allow-test-edits` (7.2) | MUST only |
| COULD | SARIF export and ingest, detectors, `packs new`, pack discovery and code-bearing packs (13), `test-red-green` | MUST only; the MUST path does not depend on any of them |

## Buy-vs-build ledger

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Fan-out of fixes across surfaces | **Reuse-estate**: `runQueue`, `supervise`, breaker, repo lock | A pack-specific scheduler | The roadmap's fan-out is the supervisor; fix tasks are list entries. A second scheduler would disagree on locks and repairs. |
| Landing a held fix on a moved base | **Reuse-estate (composition)**: `git rebase`, `findingGate`, `computeDelta`, `createMergeBackCloser`, `takeRepoLock` | Cold `merge --ff-only`; re-running the fix as a new task on the current base | A cold ff-only fails in the ordinary case; a re-run is a second nondeterministic agent session. Rebase plus re-gate is deterministic, uses the same delta the task was judged by, and adds no new git landing code. |
| Per-surface isolation, close, idempotent landing | **Reuse-estate**: `provisionWorktree`, the three built-in closers | Own git landing code | `merge-back` already lands correctly with the worktree gone; sign-off is a call, not new git code. |
| Regression check | **Reuse-estate**: `createCommandGate` plus `computeDelta` | Own test runner wrapper | Already parses tap, junit, exitcode and reports ids. |
| "Finding resolved" as a gate assertion | **Reuse-estate (technique)**: assertion absent at baseline plus `failOnNewAssertions` | A new must-turn-green assertion class in the delta rule; a second gate stage | Works today, zero change to the pinned delta rule that every task relies on. A new class changes semantics for all gates and needs its own slice. |
| Per-finding "resolved" check | **Build**, thin: three check kinds in one gate | Re-run Semgrep or CodeQL on the location; a second LLM verifies the fix | Re-run tools need installation, rules per finding class, and do not exist for LLM-found findings (Copilot admits the same, research 2); an LLM verifier is not deterministic and violates "agent word is never proof". Kept as COULD kinds. |
| Pattern matching on untrusted regexes | **Buy (platform)**: `git grep -E` with timeout | `RegExp` (ReDoS); `re2` (native module dependency); `safe-regex` (heuristic) | git is already a hard dependency; its matcher is not a backtracking engine for ERE; no new dependency. `re2` is the better engine but adds a native build to a five-dependency package. |
| Glob matching for test and protected paths | **Buy (platform)**: git pathspecs `:(glob)` | `picomatch`, `micromatch`, `path.matchesGlob` | The diff is already git's; matching in git avoids a second glob dialect and a dependency. |
| Lockfile presence check | **Build**, ~20 lines (`JSON.parse` of `package-lock.json`) | `@npmcli/arborist`; OSV-Scanner; `snyk` | A presence test needs no resolver. Other ecosystems are the detector COULD; building npm-only now is stated, not hidden. |
| Advisory data for dependency findings | **Buy** (COULD; MUST uses reviewer knowledge, labelled, 5.4): optional detector: `npm audit --json`, OSV-Scanner SARIF when installed | Embedding an advisory database | Commodity, changes daily, owned by others. Degrades honestly with no network or tool (research 3.3). |
| Finding schema | **Build**, small zod schema | SARIF as the native schema | Needs plain-language fields SARIF lacks and an owner-readable shape (5.1). SARIF mapper at the edge keeps interchange. |
| Schema validation and published JSON Schema | **Reuse-estate**: zod 4 `z.toJSONSchema` | `ajv` + hand-written schema | One source, no drift; precedent `src/report/json-schema.ts`. |
| SARIF export and ingest | **Build**, thin mapper (COULD) | A SARIF library (`@microsoft/sarif-multitool`, a .NET tool) | The subset used is `results`, `level`, `partialFingerprints`, location: a mapper, not a library. |
| Severity vocabulary | **Reuse (standard)**: CVSS qualitative bands as words (low to critical) | Own scale; numeric CVSS; Snyk score | Matches the roadmap, GitHub and npm; no scoring because an LLM cannot supply CVSS vectors honestly (research 3.2). |
| Structured agent output | **Reuse-estate**: SDK `outputFormat json_schema`, `invoke` core | Parse free text; MCP tool-call output | Already enforced and re-validated per role. |
| Read-only agent authority | **Reuse-estate**: `READ_ONLY_TOOLS`, `createToolAuthority`, `validateRoleConfig` | A sandbox or container | The triage precedent is exactly this guarantee. |
| Crash-safe ledger | **Reuse-estate**: `journal.ts` | SQLite; a JSON blob | Same discipline as case and run files; a database adds a second source of truth and a native dependency. |
| Fingerprint | **Reuse (platform)**: `node:crypto` sha256 | Content-defined chunking; SARIF fingerprint libs | Four fields hashed. |
| Owner decisions | **Build**, thin: ledger entries and CLI verbs | GitHub issue labels (OpenHands `fix-me`), Dependabot-style PR review | Must work with no GitHub and be deterministic and replayable; labels are mutable external state. The PR remains available as landing (`open-pr`). |
| Review prompt (checkbox) | **Reuse-estate**: `@inquirer/prompts` (already a dependency, `delivery init`) | A TUI library | Product design needs a three-way choice and a list. |
| Plain-language rendering | **Reuse-estate**: phrase tables over closed enums (`src/report/plain.ts`, `src/cli/output.ts`) | LLM summaries | Deterministic, free, cannot contradict the evidence. The finding's own plain fields are agent words, quoted and attributed. |
| Pack manifest format | **Build**: JSON + zod | YAML; a TS module; npm `package.json` convention | JSON matches `delivery.config.json`, needs no parser dependency, and executes nothing. |
| Pack distribution | **Reuse (platform)**: folders and npm packages | A hosted registry; git submodules | Registry is a non-goal; npm already versions, signs and hosts. |
| Authority escalation | **Build**, as ledger sign-off over existing closers | Real `ESCALATED` outcome via worker `escalate: authority` | An escalation cannot resume and blocks sequential lists, discards a passed gate, and has no landing verb; a hold keeps the gated work and lands on sign-off. |
| Test double for scans | **Reuse-estate**: claude-mock, `mockSessionEnvironment`, `DELIVERY_TEST_MOCK_SCRIPT` | A pack-specific fake | One harness for every behaviour. |
| Scheduling a weekly review | **Not built**: Item 13 | cron or systemd here | Out of scope; the library functions are the seam. |

## Operability / DX

Properties of the built system, not steps to reach it.

**Environment.** Packs are a capability of the existing `delivery` CLI (Node 22 or later,
TypeScript ESM, commander, zod 4, `git`) and the library behind it. No service, daemon,
database or new credential: a scan and a fix use the agent runtime the CLI already requires,
and everything else runs offline. Optional detectors (COULD: `npm audit`, OSV-Scanner) are named in a
pack's manifest, used when present, and reported honestly when absent. It runs wherever
`delivery` runs: a developer's machine, CI, an autoloop worker, and Item 13's scheduler on the
same host. State lives in `.delivery/packs/` inside the target repository, self-ignored.

**Harness.** The existing one: `vendor/claude-mock` through `mock-session.ts` and
`mock-script.ts`, `runSurfaceAgainstMock`, `runSupervisorAgainstMock`, and the
`DELIVERY_TEST_MOCK_SCRIPT` seam for whole-CLI tests. A scripted scan is a `json` envelope
in the same `MockScript` as every other behaviour; a scripted cheating fix is `effects`.
There is no pack-specific mock vocabulary. A pack **conformance suite** is exported from
`delivery-service/testing` and is the one harness for built-in and third-party packs alike,
driven by each pack's `fixtures/`. Time is injected; no fold reads a clock.

**Scaffolding.** In MUST the scaffold is the two built-in packs and `delivery packs check`: a
new pack is copied from a built-in folder and proved against its `fixtures/`. `delivery packs
new` is COULD (`product-design.md` item 24): it writes a valid manifest,
a `scan.md` and `fix.md` with the required slots filled with commented guidance, and a
`fixtures/` folder with a tiny seeded repo and a scripted scan, so a new pack passes
conformance before it is customised. The manifest has a published JSON Schema
(`delivery packs --schema`, as `delivery report --schema` does), so an editor validates it
as it is typed. `delivery packs check <path>` runs the manifest checks and the conformance
suite against the fixtures with a scripted agent and says, in plain words, what each failure
means. There is no new `init` step and no configuration key for the owner.

**Local-run story.** An owner or developer points the review at a repository with a pack
name or path, reads the numbered findings with their plain explanation and verification
level, chooses, and the fixes run in worktrees as gated tasks; `status`, `report` and
`findings` read the same on-disk record at any moment, from another terminal, after a crash,
or from another process, because each is a pure fold of what is on disk. A pack author does the same
against `fixtures/` with the scripted agent and no API key, and can copy a failing
`.delivery/packs/<review-id>/` folder to reproduce it, since nothing needs to run to re-derive
a view. A real-agent run is the same flow against a real repository.

**Deploy target.** The npm package `delivery-service` (bin `delivery`, `exports` `.` and
`./testing`) is the only artefact; this item ships inside it. Built-in packs are in the
package under `packs/` (listed in `package.json` `files`, so `npm pack` carries them) and the
pack engine is in `dist/`. The stability-promised surfaces are `delivery.pack/1`,
`delivery.findings/1` and the additive report `tags`. Third-party packs deploy as a folder
in a repository or an npm package; nothing is hosted. `delivery.report/1` readers are
unaffected by the added optional key.

**Verification.** `npm test` (lint, build, vitest) stays the single gate. The pack
conformance suite for both built-in packs, the adversarial gate tests, the prompt-injection
tests and the report golden for `tags` run inside it, offline, with no key.

## Risks and open items

- **Judgement findings have a weak "resolved" check** (5.3). Labelled, owner-approved, held
  when severe; a stronger kind (`test-red-green`, detector re-run) is the upgrade path.
- **Concurrent landing of several fixes** with `merge-back` inherits the supervisor's lack of
  dependency scheduling (section 10).
- **Plan fallback in config lookup** is the one change to discovery; if the critic prefers an
  explicit `--config` only, the cost is that a no-config owner types it for `report`.
- **Masking rules for secrets** (section 12) are designed, not yet specified to the pattern level; the plan slice owns them.
