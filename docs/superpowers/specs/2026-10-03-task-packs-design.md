---
type: phase-design
created: 2026-10-03
roadmap_item: 12
seeded_by: [50-20260930T212043Z-gate-maintenance-can-weaken-the-check.md]
---

# Pre-Built Task Packs — Design

> **Status:** Approved (autonomous design-team run; no human reviewed it).
> Roadmap: `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`, Item 12.
> Extends: `2026-09-17-project-configuration-design.md` (Item 9: `DeliveryConfig`, the task list, content identity via `findQueueRun`), `2026-10-01-observability-and-reporting-design.md` (Item 11: the report document and its plain-language rendering).
> Builds on: `2026-09-04-gate-interface-design.md` (delta rule, `failOnNewAssertions`), `2026-09-09-agent-invocation-primitive-design.md` (`invoke`, role envelopes, tool authority), `2026-09-11-close-interface-design.md` (built-in closers), `2026-09-26-multi-surface-supervisor-design.md` (fan-out, repo lock), `2026-09-13-agent-mock-design.md` (the scripted mock stack).
> Personas: `docs/personas.md` (team-derived, assumed, not human-confirmed; Dana, Marcus and Priya each gain a goal extension in place from this run).
> Audit trail: `docs/prd/2026-10-03-task-packs/` (research.md, product-design.md, architecture.md, review-log.md, spec-review.md). Citations of the form "research §n" point into that research file.
> Produced by an autonomous design-team run (`20261003T130939Z`). One idea from the operator's pool seeded part of this work (`seeded_by` above): its three questions about a repair weakening the check are answered here **for pack fixes** (the change is shown, a weakened check is refused, and the check is data rather than a command). Approval and refusal for gate-maintenance repairs in general remain with that idea.

## Problem

Items 1 to 11 give an owner a gated, concurrent, crash-safe delivery loop and a
plain-language report. What they do not give is an answer to the first question a new
owner asks: "what can this do for me right now?" Today the owner must already know which
tasks to write. The roadmap's answer is a **task pack**: point the harness at a
repository, have an agent review it through a fixed lens (code review, security review),
let the owner choose which problems to fix, and have each fix delivered as a gated task.
The scan is discovery; the fix is where gated delivery earns its keep, because a fix that
"resolves" a finding by deleting the test is caught by the gate rather than waved through.

Item 9 asserted that "a pack is a project configuration authored once and distributed.
Its work is discovery and distribution, not shape". Item 11 asserted that "a pack tags
tasks through `taskDef`". Both are only partly true. Verified against the code
(research §0, §1):

| Premise | What the code says | Resolution in this design |
|---|---|---|
| A pack is a project configuration | `gate`, `closer`, `roles`, `domain`, `budgets` are project-wide and pinned per run; a task is an opaque object (`src/cli/config.ts` `DeliveryConfig`). There is no scan phase in a configuration. | The **fix phase is** an ordinary generated `DeliveryConfig`. The **scan is not a task**: it is a read-only session of a new role run before any task exists. Per-finding variation lives inside one gate and one closer that read `taskDef`. No per-task gate or closer is added. |
| The gate verifies the finding is resolved | `computeDelta` skips every assertion that was not PASS at baseline (`src/delta-rule.ts`), so a red-at-baseline "finding resolved" assertion can never fail a task. | The finding assertion is **absent at baseline** and appears at check; with `failOnNewAssertions: true` a new non-PASS assertion is a new failure. No change to the delta rule. |
| A fix that deletes the test is caught | Only when the gate reports per-test assertions. An `exitcode` gate has one assertion (`src/parsers.ts`), and the default `npm test` inference uses it (research §4.2). | Git-diff guards in the pack gate, independent of parse mode. |
| Tags are echoed into the report | The report carries only `task: taskIntent(taskDef)` (`src/report/derive.ts`, research §1.7). | One additive optional `tags` key on the report's per-task record. |
| The scan list reaches the fix tasks | Fix worktrees branch from committed state (`src/provision.ts`). | Each finding is **embedded in its fix task's `taskDef`**, which the prompt carries verbatim and the case file pins. Nothing needs committing. |
| An agent can return a list | No role emits one; `WorkerEnvelope` is `completed | escalate` (`src/role-config.ts`). | A new `scanner` role with its own envelope. |
| Severity escalation exists | Authority escalation is reactive only; an escalated run cannot be resumed (`src/cli/resume-command.ts`, research §1.6). | Authority-class handling is **held for owner sign-off**, a landing decision recorded in the pack ledger, not an `ESCALATED` run. |

So this phase adds a pack format, a read-only scan, an owner decision ledger, a generated
fix plan, one harness-owned gate and closer, and a findings view, with four small additive
changes to the core and one behaviour-preserving extraction.

## Personas

`docs/personas.md` is the source of truth. This phase extends three personas in place:

- **Dana Okafor, non-technical owner.** With no configuration, ask for a code or security
  review, read the problems in plain words, choose which to fix, and come back to a report
  that says what was fixed, what waits for her sign-off, and what could not be fixed. Never
  asked to approve what she cannot understand.
- **Marcus Webb, on-call engineer.** For an unfixable problem or a held security fix, see
  the technical detail beside the plain sentence (file and line, the check, what it saw),
  so he can judge it or take it over without re-running the scan.
- **Priya Shah, extender.** Author a pack for her own domain, prove it with scripted agents
  (no real agent run), and have a malformed pack refused in terms she can fix.

## Scope

### Derived minimum scope (assumed, not human-confirmed)

No human supplied a minimum scope. The team-lead derived it from the roadmap's Item 12
success criteria; the critic revised it upward in round 1 (both packs, not one, and the
per-finding gate in MUST, because the roadmap names them as success criteria and Item 13's
headline use, "security review every Sunday", needs the security pack). Each criterion
must be reachable by a named persona with no configuration beyond pointing at the
repository:

| # | Roadmap criterion | Persona | Reached by |
|---|---|---|---|
| 1 | Run a code review with no configuration beyond the repo | Dana | `delivery review code` |
| 2 | Findings give location, problem, why it matters | Dana, Marcus | the findings list; `delivery findings` |
| 3 | Each code finding becomes a fix task with a gate that verifies that issue | Dana | `delivery fix`; per-finding check |
| 4 | Run a security review with the same ease | Dana | `delivery review security` |
| 5 | Security findings by severity, understandable to a non-technical owner | Dana | severity words and a "what could happen" line |
| 6 | Each security finding's gate verifies the vulnerability is closed | Dana, Marcus | per-finding check; held for sign-off above threshold |
| 7 | Unfixable findings escalated with a clear explanation, not skipped | Dana, Marcus | the *could not be fixed* state and report section |
| 8 | Owner reviews scan output before authorising the fix phase | Dana | `delivery findings approve / skip` |
| 9 | A pack is a defined, stable bundle others can author | Priya | `delivery.pack/1`, `delivery packs check` |

The floor also needs, because a criterion cannot honestly be met without them: a **named
verification level** per finding shown at review time (some findings have only "tests
still pass"); a **held-for-sign-off state with a one-step land or reject** (the roadmap
requires sign-off before merge, and nothing today can act on it); a **stable finding
identity** (so re-runs do not duplicate fixes); the **anti-weakening guarantee** (the
roadmap's central promise is false for the default exit-code gate); and **report
integration with no new report type** (Item 11's stated contract).

### MUST

1. **Pack format `delivery.pack/1`**: a data-only folder (manifest, scan instructions, fix
   instructions, conformance fixtures). Versioned, additive-only within a major. [Priya]
2. **Two shipped packs, `code` and `security`.** Code review: correctness issues, dead
   code, missing error handling, inconsistent patterns, documented technical debt.
   Security review: dependency vulnerabilities (from the reviewer's own knowledge in this
   phase, labelled as such), injection surfaces, authentication and authorisation gaps,
   secret exposure, insecure defaults. Both run with no configuration file. [Dana]
3. **Scan phase, `delivery review <pack> [repo]`**: a read-only agent session over
   committed state, ending with the findings list and the exact next step. Changes nothing
   in the repository. [Dana]
4. **Plain-language findings**: title, severity (critical, high, medium, low), where,
   problem, why it matters, what fixed looks like, plus a technical block for engineers.
   On the code pack severity only orders the list; it never holds a fix. [Dana, Marcus]
5. **Owner review step before any fix**: findings start *not yet decided*; the owner
   approves or skips each, or all, by plain command or an interactive list. [Dana]
6. **Fix phase, `delivery fix`**: each approved finding becomes one gated fix task run
   through the existing queue and supervisor. [Dana, Priya]
7. **Per-finding targeted check with an honest level**, from a closed set of deterministic
   kinds, shown at review time and beside "fixed" in the report. [Dana, Marcus]
8. **Anti-weakening guarantee**: a fix that deletes or modifies existing tests, adds a
   skip marker, or changes test configuration or the test command is rejected; new test
   files are allowed; findings in the *tests* category may modify (never delete) tests.
   [Dana, Priya]
9. **Sign-off hold**: on the security pack, findings at or above the default threshold
   **high** are fixed and checked but not merged until the owner signs off; one command
   lands (`delivery findings sign-off <n>`, which rebases and re-checks first) and one
   rejects (`reject <n>`). Code pack threshold: none. Independently, every fix in a project
   with no tests is held. [Dana, Marcus]
10. **Unfixable findings escalate, never vanish**: every finding is in exactly one state of
    a closed set at every moment and ends in a terminal one. [Dana, Marcus]
11. **Results in the existing report and status**, by finding title and severity, grouped
    by owner-facing state, with the review counts in the headline. [Dana, Priya]
12. **Machine-readable output**: `--json` on `review`, `findings`, `fix`, `packs`; finding
    and pack schemas printable with `--schema`, versioned, additive-only. [Priya]
13. **Pack authoring check, `delivery packs check <path>`**: validates the manifest by file
    and field and runs the pack's conformance fixtures against a scripted agent. [Priya]
14. **Degraded states handled**: no findings, scan fails, scan output malformed, no tests,
    stale findings, damaged review record, unknown pack.

### SHOULD

15. **Allow test edits per finding**: `approve <n> --allow-test-edits`, recorded, fix
    forced held, deletion still refused.
16. **Configurable sign-off threshold** (`critical`, `high`, `medium`, `low`, `none`) by
    flag on `delivery fix`; the default stays the pack's.
17. **Skips remembered across scans** by finding identity, with `--include-skipped`.
18. **Confidence and quiet controls**: a per-finding confidence, low-confidence findings
    collapsed under "Possibly worth a look", and a pack-level exclusion list.
19. **Scan scope**: `delivery review code --path src/auth`.
20. **Cost and duration** of the scan and each fix in the report's tuning section.
21. **Recommended selection**: `approve --recommended` (strongest check, below threshold).
22. **Preview**: `delivery review <pack> --preview`, with no sign-in or network.

### COULD

23. Third-party pack discovery and distribution (npm packages declaring a `delivery-pack`
    field; `delivery packs add`; trust prompts). Packs carrying code modules, behind an
    explicit trust confirmation.
24. Ingest another tool's results as the scan (SARIF 2.1.0; detector output such as
    `npm audit --json` or OSV-Scanner, which gives the security pack an advisory
    database); SARIF export.
25. An agent-written "what changed" summary on the sign-off page, labelled as the agent's.
26. `delivery packs new <name>` scaffold.
27. Findings as a self-contained HTML report.
28. More shipped packs (accessibility, performance, documentation coverage).
29. Stronger check kinds: `test-red-green` and detector re-run.

## UX / Product

### Vision

An owner who has never configured anything points the harness at their repository and
asks "what is wrong with this, and can you fix it?" Within minutes they read a list of
problems written for someone who is not an engineer, choose which to fix, and each chosen
problem is fixed by an agent and checked by a check the agent cannot reach. They come back
to one report: what was fixed and merged, what waits for their sign-off, and what could not
be fixed and why. Nothing is dropped quietly.

The honest limits, stated to the owner because they will rely on them:

- A scan is an agent's opinion. The product says so.
- "Fixed" is only as strong as the check behind it. Every problem shows, before approval,
  how the harness will know it is fixed, and says plainly when the answer is only "the
  existing tests still pass".
- The product proves a fix passed its check, not that the fix is wise. That is what
  sign-off on the serious ones is for.

### Finding states (the closed set)

Every other section, the report, the JSON and the metrics refer to this table.

| Owner-facing state | Terminal? | Who acts | Internal |
|---|---|---|---|
| not yet decided | no | the owner: approve or skip | `proposed` |
| being fixed | no | nobody | `approved`, `fixing` |
| waiting for your sign-off | no | the owner: sign off or reject | `held` |
| fixed and merged | yes | nobody | `fixed`, `signed_off_landed` |
| already fixed | yes | nobody (the flagged code is no longer there) | `already_resolved` |
| skipped by you | yes | nobody | `skipped` |
| declined at sign-off | yes | an engineer if wanted; the branch is kept | `rejected` |
| signed off but could not be merged | yes | the owner or an engineer: the fix conflicts with the main copy or no longer passes its check there; the branch is kept | `signed_off_failed` |
| could not be fixed | yes | the owner or an engineer, per the explanation; "needs a change to one of your tests" is counted separately | `unfixable` (cause `needs_test_change` among others) |
| stopped by a setup problem | yes | an engineer | `stopped` |
| needs your decision | yes | the owner: the scan says only a person can resolve it, or the problem has no specific check in a project with no tests (terminal until the owner overrides: `approve <n> --allow-unchecked` is recorded and the fix is always held) | `needs_decision` |
| could not be confirmed | yes | nobody: the harness could not find the flagged code; listed, not offered | `unconfirmed` |

With a landing closer that opens a pull request (`open-pr`), *fixed and merged* reads "fixed, pull request opened", since nothing has merged.

A fix that is done except for something only a person can do (rotating a leaked
credential) is not a separate state: it is *fixed and merged* or *waiting for your
sign-off*, with the "one thing is left for you" line beside it and an entry under NEEDS YOU.

### Vocabulary

Owner-facing text uses only the left column; the right appears only in `--json`,
technical blocks and "For engineers".

| Say | Never say |
|---|---|
| problem, what the review found | finding (the *command* is `delivery findings`) |
| how serious it is: critical, high, medium, low | CVSS, CVE, exploit, vector |
| waiting for your sign-off | authority-class, escalated, held |
| could not be fixed | escalated, unresolvable |
| the check | gate, assertion, delta |
| the libraries your project uses | lockfile, transitive |
| the agent | worker, scan agent, triage |
| fixed and merged | closed, landed |

Enforced as Item 11 enforces it: closed enums, total phrase tables, and one test that scans
every owner-facing phrase for the forbidden words. Agent-written text (titles, problem
sentences) is quoted or labelled as the agent's; the harness's own sentences are fixed
strings.

### Commands

| Command | Does |
|---|---|
| `delivery review <pack-name-or-path> [repo]` | Scans; prints findings; on a TTY offers an interactive choice and "Fix now / Not now". Exit ok when the scan finished, whether or not it found anything; the existing configuration failure code when it could not run. |
| `delivery findings [n]` | Lists findings and states, or one finding in full with its FOR ENGINEERS block. `--changes` on a held fix shows the changed files and patch. `--unconfirmed`, `--include-skipped`. |
| `delivery findings approve <n…> \| --all` | Records approval of concrete finding ids. |
| `delivery findings skip <n…>` | Records skips. |
| `delivery fix` | Generates the fix plan and runs it through the existing queue until every approved finding is terminal or the run stops. |
| `delivery findings sign-off <n>` | Rebases the held fix onto the current main copy, re-checks it there, and lands it through the landing closer. |
| `delivery findings reject <n>` | Declines a held fix; the branch is kept. |
| `delivery packs` | Lists the reviews available. |
| `delivery packs check <path>` | Validates a pack and runs its conformance fixtures with a scripted agent. |

Every interactive action is also a plain command; no command requires a TTY, and `--json`
never prompts.

### Journeys

**J1. Dana's first code review** [Dana: review with no configuration]. In a repository with
no configuration file she types `delivery review code`. The harness says what it will do
and that it will not change her code, scans, prints the problems and asks whether to fix
them. "Not now" loses nothing: the list is saved and every later command works from it.

**J2. Dana chooses** [Dana: choose what is fixed]. Each numbered problem shows a plain
title, where, what is wrong, why it matters, what fixed looks like, and how the harness will
know. She skips two and approves the rest. `delivery findings` tomorrow shows the same list
with her choices.

**J3. Dana returns to a report** [Dana: return to a whole run]. `delivery report` opens with
one sentence: what was found, what was fixed and merged, what is waiting for her, what could
not be fixed.

**J4. A security fix needs her sign-off** [Dana: never approve what she cannot understand;
Marcus: judge a held fix]. A high-severity problem was fixed and passed its check but is
held. The report says what the risk was, what the agent changed, how the harness knows the
risk is closed, and that her say-so is needed. She can land it, reject it, or hand the
technical block to Marcus.

**J5. A problem cannot be fixed** [Dana, Marcus]. The report lists it under *could not be
fixed* with one fixed-table sentence, the agent's own words, who must act, and what.

**J6. Priya authors a pack** [Priya: author and prove a pack]. She copies the shipped `code`
pack folder, changes the scan instructions, categories, fixtures, and runs `delivery packs
check ./a11y-pack`. It names any problem by file and field, then runs her fixtures against a
scripted agent. `delivery review ./a11y-pack` then works as for a shipped pack.

### What a person sees

Layout rules inherited from Item 11: plain lines, no box drawing, no alignment columns, no
cursor movement in non-interactive output, fact-per-line, readable at 60 columns, in a pipe
and in a screen reader. Times are 24-hour UTC. Severity is always a word; colour never
carries meaning alone. The same record gives the same output.

`delivery review code`:

```
Reviewing your project for problems with the code (a code review).
This reads your project and writes nothing to it. It can take a few minutes.

Review finished in 4 min 12 s. It found 6 problems.
The agent that did the review is giving its opinion: check anything that matters.

 1. The price shown at checkout can be negative                      (high)
    Where: src/checkout/total.js, line 42
    What is wrong: A discount larger than the price makes the total negative, so
    the shop would pay the customer.
    Why it matters: Wrong totals cost money and trust.
    Fixed looks like: A total never goes below zero.
    How we will know: checked: the flagged code is gone.
 2. Old code for a payment provider you no longer use                (medium)
    Where: src/payments/legacy-gateway.js (whole file)
    What is wrong: Nothing calls this file any more.
    Why it matters: It is extra code to maintain and could confuse the next person.
    Fixed looks like: The file is removed and everything still works.
    How we will know: tests only: no check of this specific problem (31 tests pass today).
 ...

3 of 6 have a specific check; 3 are tests only.
Nothing has been changed and nothing will be until you approve it.

What next?
  Fix all 6:  delivery findings approve --all  then  delivery fix
  Choose:     delivery findings
```

`delivery review security` additionally opens with the severity counts, states that high
and critical problems wait for sign-off, and states that problems about out-of-date
libraries come "from the reviewer's knowledge, not from an advisory database; they may be
out of date or wrong". A finding may carry a "what only a person can do" note:

```
 1. A password for the payments service is written in the code        (critical)
    Where: config/settings.js, line 9
    What could happen: Anyone who can read this code can use the payments service
    as you, including people who should not see it, such as past contractors.
    Fixed looks like: The password is not in the code, and the code reads it from
    somewhere private instead.
    How we will know: checked: the flagged code is gone.
    Note: the password has already been seen by everyone with access to the project.
    Removing it from the code does not undo that; it needs changing at the provider.
    That part only a person can do.
```

(The secret literal itself never appears in output; see Security.)

`delivery report` after a pack's fix phase reuses Item 11's sections (`NEEDS YOU`,
`STOPPED, FOR YOUR ENGINEERS`, `DONE`) and adds `WAITING FOR YOUR SIGN-OFF` and
`SKIPPED BY YOU`, one section per owner-facing state:

```
Code review of text-helpers: 6 problems found; you approved 5 and skipped 1.
3 are fixed and merged; 1 is waiting for you; 1 could not be fixed.
Review 3 Oct 11:02 UTC. Fixes 11:09 to 11:38 UTC (29 min), up to 2 at once.

WAITING FOR YOUR SIGN-OFF (1)
  Problem 1 of 5: "A password for the payments service is written in the code" (critical)
    The agent removed the password from the code. The check passed: the password text
    no longer appears anywhere in the project, and your existing tests still pass
    (31 of 31).
    The agent said: "Moved the key to PAYMENTS_KEY; documented it in the README."
    Why this needs you: it is a serious problem, and you should see what changed
    before it reaches your main copy.
    To act: Look at what changed: delivery findings 1 --changes
            Say yes:  delivery findings sign-off 1
            Say no:   delivery findings reject 1
    For engineers: branch surface/..., 2 files changed.
```

Sign-off prints "Checking the fix still works on your current main copy... passed.
Landed." or "Could not land: <reason>. The fix is kept on <branch>." `--changes` prefixes
the patch with "The agent changed these files. This shows what changed; it cannot tell
you it is safe."

`delivery packs check` names faults by file and field ("a11y-pack/pack.json: "check.kind"
is "page-contains" but the available checks are: anchor-gone, pattern-absent,
dependency-absent.") and on success reports what the scripted run showed and that nothing
was sent to a real agent. Exit codes follow `validate`.

### Accessibility

- Severity is a word in a fixed place; `--no-color` and non-TTY stripping as today.
- Findings are numbered blocks, never tables, so a screen reader reads title, location and
  problem in order. Numbers are the selection handle; titles need not be unique.
- The interactive list is a convenience: every action it performs is a plain command.
- Nothing depends on terminal width.

### Empty and error states

| State | What the person sees |
|---|---|
| No findings | "The review found no problems. That is not proof there are none: the review is an agent's opinion, it looked at 84 files, and it can miss things." Exit ok. `delivery fix` then says there is nothing to fix. |
| Scan running | One start line; in a TTY one progress line per minute. `delivery status --watch` works as today. |
| Scan fails (agent error, no sign-in, no network, allowance spent) | A fixed-table sentence, the agent's words if any, one next step. No partial review is saved. Existing exit codes. |
| Scan output malformed | An envelope that does not validate is a failed scan, as for every role. Within a valid envelope, each finding is validated against the repository; one that cannot be placed is *could not be confirmed*, counted and listable, never shown as "no findings". |
| Repository has no tests | Stated at review. Any finding with a specific check is approvable and every fix is **held** whatever its severity; "checked" means only the problem's own check, shown as "finding check only, no regression tests". A finding with no specific check is *needs your decision* ("cannot be checked") unless approved with `--allow-unchecked`. |
| Uncommitted changes | The existing note: "Your agents only see what is committed", at `review` and `fix`. |
| Project changed since the review | Fix tasks start from the current main copy. A problem whose flagged code has gone is *already fixed* and not worked on. |
| Fix cannot be proved (check keeps failing) | As Item 11: failed after N attempts, the agent's last words, the next step. |
| Fix rejected as weakening the check | "The agent's fix was rejected because it removed or skipped existing tests." The agent is told and retries within the normal budget. |
| Fix would need a test changed | *Could not be fixed*, counted separately: "needs a change to one of your tests, which this review does not let an agent do." SHOULD: `--allow-test-edits`. |
| Damaged or missing review record | "No review found in this project. Run `delivery review code` first." A damaged one names the file and offers a re-run. |
| Pack malformed or unknown name | Names the pack, file and field; lists the available packs. |

### Success metrics

Proposed; no baseline exists.

- **Time to first findings list** for a new owner: under 10 minutes from install on a
  repository of up to about 20 000 lines, with no file edited.
- **Owner completes the journey unaided** in the UAT script: review, choose, fix, read the
  report.
- **Zero silently dropped findings**: a property test over scripted scenarios shows every
  finding in exactly one state at every moment, ending terminal.
- **Zero accepted weakening**: no scripted scenario where a fix deletes or modifies existing
  tests (outside the tests-category exemption), adds a skip marker, or changes test
  configuration or the test command ends fixed or held.
- **Zero unseen high-severity merges**: no fix at or above the threshold reaches the main
  copy without a recorded sign-off.
- **Owner-facing text is clean**: the forbidden-word test passes.
- **Gate catch rate** per pack (fix attempts the targeted check rejected / attempts), as
  tuning evidence: near 0 suggests weak checks, near 1 poorly specified findings.
- **Pack authoring** proved with `packs check` from the guide alone.
- **Approval rate** (share of problems owners approve) as a scan-noise signal; no target.

## Architecture

### 1. Where packs live

Packs are a capability of the existing `delivery` CLI (`src/cli/program.ts`) and a new
`src/packs/` module exported from `src/index.ts`, so Item 13's scheduler and adopters call
the same functions the CLI does (`reviewAndPlan(repo, pack)`, `runFix(plan)`). The engine
holds the manifest, finding schema, scanner step, ledger, plan generator, finding gate,
finding closer and findings view; the CLI renders. State lives in
`.delivery/packs/<review-id>/` inside the target repository, beside `.delivery/runs/`;
`.delivery/` already ignores itself (`prepareDeliveryDir`, `src/run-location.ts`). No new
daemon, database, network service or credential.

### 2. The pack format

A pack is a **folder**, data-only:

```
<pack>/
  pack.json      schema "delivery.pack/1": the manifest
  scan.md        the scanner's instructions (lens, severity definitions, exclusions)
  fix.md         the fix worker's instructions
  fixtures/      conformance fixtures: a small seeded repo, a scripted scan, expected states
```

`pack.json` is a strict zod schema (`src/packs/manifest.ts`), JSON for the same reason
`delivery.config.json` is: no code runs to read it. Fields:

- `schema`, `name` (slug), `version` (semver), `title`, `summary` (plain words).
- `scan`: `prompt` (file), `categories[]` (`id`, `title`, one plain sentence each, and
  per-category options such as `scope: repo` for the `anchor-gone` check, `sensitive`, and
  the `tests` category's test-edit allowance), `maxFindings` (default 40), `checks` (the
  subset of the closed check kinds a finding may use), `requireCheck`.
- `severity`: the pack's plain definition, by consequence, of each of `low | medium | high |
  critical`. The pack supplies words, not a new scale.
- `hold`: `{ atOrAbove: "low" | "medium" | "high" | "critical" | null }`, the default
  threshold (security `high`, code `null`).
- `fix`: `prompt` (file), `testGlobs`, `protectedGlobs`, `skipMarkers` (additions to the
  library's defaults).
- `landing`: default closer for a fix that is not held (`merge-back` unless the project's
  config names a closer).

**Why data-only.** A pack that is only prompts and parameters cannot run code on the
owner's machine. "Each pack ships a gate suited to its domain" is met by the pack
**choosing check kinds and guard globs**, not by shipping gate code. A pack cannot change
harness control flow, widen an agent's tool authority, or reach its own check from the fix
agent. Code-bearing packs are COULD, behind a trust confirmation.

**Where built-in packs live.** In the npm package under `packs/code-review/` and
`packs/security-review/`, listed in `package.json` `files` and located relative to the
installed package (as `src/cli/agent-session.ts` locates the runtime). A pack is referenced
**by the command** (`delivery review <name-or-path>`); no configuration key is added, since
the owner "points at the codebase with no configuration". A `pack` key in `DeliveryConfig`
is deferred to Item 13, the first consumer that needs a project to name a pack without a
command line.

**Relation to `DeliveryConfig`.** A pack never extends it. `delivery fix` generates a plan
file, `.delivery/packs/<review-id>/plan.config.json`, that is a valid `DeliveryConfig`
under the existing strict schema (`src/cli/config.ts`): `tasks` (the authorised fix tasks),
`domain` (the project's own if it has one), `roles.worker.systemPromptFragment` (the pack's
`fix.md`), `gate` and `closer` (the library's finding gate and closer as `custom` refs with
absolute paths into the installed package), and `budgets` and `concurrency` from the
project's config or flags. Being a real `DeliveryConfig`, `validate`, `preview`, `status`
and `report` read it unmodified, and "what is previewed is what runs" holds. The project's
own command gate is not discarded: it supplies the regression command the finding gate
wraps.

### 3. The scan

**Role.** A new role, `scanner`, beside `worker`, `triage` and `gate-maintenance`
(`AgentRole`, `src/ports.ts`; `src/role-config.ts`):

- Tools: `READ_ONLY_TOOLS` only (`Read`, `Glob`, `Grep`). The existing `superRefine` that
  refuses a writable triage role is extended to `scanner`, so a pack cannot widen it, and
  role overrides never expose it. The tool guard (`createToolAuthority`,
  `src/tool-authority.ts`) refuses anything off the list or outside the worktree.
- Envelope: `ScanEnvelope = { findings: ScannedFinding[], notes: string }`; a
  `ScannedFinding` carries no id and no verification, which are the harness's. Enforced by
  the SDK's `outputFormat: json_schema` and re-validated with zod; a wrong shape is an
  incomplete, as for every role.
- Runs in a scratch worktree at the base branch tip (`provisionWorktree`,
  `src/provision.ts`), so it sees committed state exactly as the fix tasks will; removed
  afterwards.
- Session mechanics: `invoke` loads a case file and assembles the task prompt; a scan has
  no case file. A behaviour-preserving extraction moves the part after prompt assembly
  (options, session end, refusal classification, usage, envelope validation) into
  `runSession`; `invoke` becomes load, assemble, `runSession`, and the existing
  `agent-invoke.test.ts` proves it unchanged. The scan prompt is its own pure, deterministic
  function (pack `scan.md`, the fixed reply-format slot, a repository summary).

**Scan output is untrusted and validated deterministically.** After the envelope parses,
each claim is checked against the scratch worktree at the scan commit:

1. `path` exists inside the repository (resolved with `realpath` against the worktree root;
   absolute, `..` and symlink-escaping paths refused).
2. `anchor` (the exact offending text, one to five lines, at least 8 non-space characters)
   occurs in the file after whitespace normalisation. A finding that cannot be placed is
   recorded `unconfirmed` with the scanner's wording, never silently dropped.
3. A `pattern-absent` check's ERE compiles under `git grep -E` and **matches now** (a
   pattern that does not match now cannot go from red to green). A `dependency-absent`
   check's package and version are in `package-lock.json` now.
4. Free text is length-capped and stripped of control characters; findings are capped at
   `maxFindings` with a visible "N more not shown".

**Identity.** `id = first 12 hex of sha256(JSON [pack, category, path, normalisedAnchor])`.
Not line numbers (drift as fixes land), not the title (an LLM rewords it). Proposals with
the same id merge, first wins. Stable across re-scans, which is what lets a skip persist
(SHOULD) and is the content identity the fix task inherits.

### 4. The review ledger

A review is a directory built on `src/journal.ts` exactly as case and run files are
(atomic writes, synced appends, torn-tail tolerance):

| Artefact | Written | Content |
|---|---|---|
| `review.json` | once, atomic | review id, pack name and version, hash of manifest and prompts, repository path, scan commit sha, pinned `scanner` role |
| `refs/scan.json` | once, atomic, mode 0600 | the validated result, including `unconfirmed` entries |
| `log.jsonl` | append-only | a zod discriminated union, each entry stamped `at` by the single append function: `scan_started`, `scan_session` (usage), `scan_done`, `decision`, `authorise`, `fix_observed`, `signed_off`, `rejected`, `landed` |
| `plan.config.json` | regenerated, atomic, mode 0600 | the generated `DeliveryConfig` |

The log tail is the authority, as for case files. A crash after `refs/scan.json` but before
`scan_done` is recovered by re-validating the file and appending the entry. A crash
mid-session leaves no `scan_done`; sessions are reconstructed, never continued, so `delivery
review` re-runs the scan at the cost of one session.

**Decisions are recorded, never inferred.** `approve`, `skip`, `sign-off` and `reject`
append entries naming **concrete finding ids**; `--all` is expanded to ids in the entry so a
later re-scan cannot widen it. The last decision per id wins. No agent can write a decision:
the scanner has no write tool and the ledger is outside every worktree.

**Authorisation.** `delivery fix` first appends one `authorise` entry per approval batch:
`{ ids, threshold, hold: {id: boolean}, allowTestEdits: id[], landing, verify: {command, parseMode} | null }`.
`hold[id]` is computed once, deterministically, from severity against the threshold, and is
forced true when there is no regression command or when the owner granted
`--allow-test-edits` or `--allow-unchecked`. This entry is the owner's recorded authority.

**Carry-over (SHOULD).** A new review folds the ledgers of earlier reviews of the same pack
in the same repository: a previously skipped, rejected or fixed id is shown with that state;
a fixed one whose anchor is back is shown as "came back". A pure fold; no suppression file.

### 5. The finding schema

**Decision: a small harness-owned schema, SARIF at the edge.** SARIF 2.1.0 is what
Semgrep, CodeQL and OSV-Scanner emit, but it has no field for the plain problem, why it
matters or what fixed looks like, and its nesting is heavy for a non-engineer (research
§3.1). The finding is a zod schema (`src/packs/finding.ts`) published as JSON Schema via
`z.toJSONSchema`, as the report's is. SARIF mappers in and out are COULD.

```
Finding {
  id             12-hex fingerprint (harness-assigned)
  title          short, plain
  category       one of the manifest's category ids
  severity       low | medium | high | critical
  where          { path, line? }                 line is a hint, never identity
  problem        plain: what is wrong
  whyItMatters   plain: the consequence, for a non-engineer
  fixedLooksLike plain: what done looks like
  anchor         exact offending text (identity and the default check)
  check          one of the check kinds
  detail?        technical block for engineers
  needsDecision? the scanner says only a person can resolve it
  outsideStep?   plain: what only a person can do after the code fix
  source         reviewer | detector
}
```

**Check kinds (closed, harness-owned):**

| Kind | Resolved means | Shown to the owner |
|---|---|---|
| `anchor-gone` (default) | the normalised anchor no longer occurs in the file (`scope: file`) or anywhere in the repository (`scope: repo`, set per category, e.g. for secrets so moving a password to another file does not pass). Commenting it out does not pass | "checked: the flagged code is gone" |
| `pattern-absent` | the ERE that matched at the scan commit now matches nowhere in the stated paths | "checked: the risky pattern no longer appears" |
| `dependency-absent` | `package@version` is no longer in `package-lock.json` (parsed, no network) | "checked: the vulnerable version is no longer installed" |
| none | nothing finding-specific | "tests only: no check of this specific problem" |

The ceiling, said plainly: for judgement findings, absence of a pattern is not proof the
problem is solved; an agent can rename a variable past `anchor-gone`. No deterministic proof
exists for LLM-found correctness findings, and the field's LLM-only tools ship no verifier
(research §2, §4.1). The design does not claim one. It makes the check explicit and
owner-approved at review, layers guards so the check cannot be made easier, holds anything
severe for a human, and labels the weakest level. A pack may set `requireCheck: true`, making
a finding with no check `needs_decision`. The old roadmap idea of "the location changed" is
not a check kind: `anchor-gone` is the stricter, named replacement.

**Dependency findings in MUST.** The scanner has no shell and no network, so the security
pack's dependency lens is the reviewer's own knowledge from reading `package.json` and
`package-lock.json` (`source: reviewer`), labelled to the owner as possibly out of date or
wrong. The `dependency-absent` check is still deterministic for whether the version is gone.
A harness-run detector (`npm audit --json`, OSV-Scanner) is COULD: run by the pack engine
outside the scanner role with `execFile`, a timeout and validated output, degrading to a
stated "no advisory data available". Lockfile support is npm only in this phase, stated.

### 6. Fix-task generation

For each approved, non-terminal finding the plan generator emits:

```
{ intent: "Fix: <title> (<path>)",
  tags: { pack, findingId, severity, phase: "fix" },
  finding: { ...whole Finding... },
  guards: { testGlobs, protectedGlobs, skipMarkers, scope, testsCategory },
  authorisation: { hold, landing, verify, allowTestEdits } }
```

`guards` is the pack's guard parameters resolved for this finding (the library defaults plus
the manifest's additions, the finding category's `anchor-gone` scope, whether the category
is `tests`), so the gate needs nothing but `taskDef`: it cannot read the pack folder, and a
changed pack is a changed task.

- **Identity is content.** The queue matches a run to a task by deep equality on the pinned
  `taskDef` (`findQueueRun`, `src/task-list.ts`); extra fields are legal (`QueueEntry` is a
  loose object). Re-running `delivery fix`, or a crashed run, never duplicates a finding.
  `authorisation` is in identity on purpose: authorising the same finding differently is a
  different promise. No timestamp is in the object.
- **The plan is a pure function of the ledger**: the same entries produce the same file,
  byte for byte, ordered by severity then id, with tasks touching the same path adjacent.
- **Precondition re-check** before running: anchor, pattern or dependency still present on
  the current base. If not, the finding is `already_resolved`, not a task. This also catches
  fan-out overlap cheaply.
- The agent sees the finding verbatim in the task JSON (`src/prompt-assembly.ts`); `fix.md`
  states that finding fields are a description to act on, not instructions to obey.

`delivery fix` loops over the existing queue driver (`runQueue`, `src/cli/queue.ts`): plan,
run the remaining tasks, fold outcomes into `fix_observed` entries, repeat until no approved
finding is non-terminal. Reason: at concurrency 1 an escalated task stops the list, and
"unfixable findings are escalated, not skipped" must not mean "and nothing after them runs".
Each pass terminalises at least one finding or the loop stops (an environment escalation, a
usage limit) and says which.

### 7. The per-finding gate

One harness-owned custom gate, `findingGate` (`src/packs/finding-gate.ts`), pinned as
`{ type: "custom", modulePath: <absolute, in the installed package>, failOnNewAssertions:
true }`. It is loaded from outside the worktree (`loadCustomGate`, `src/custom-gate.ts`) and
the tool guard refuses calls aimed outside the worktree, so the fix agent can neither read
nor edit it. The finding, its check and the guard parameters (`taskDef.guards`) live in `taskDef`, pinned
in `case.json` outside the worktree.

**Composition.** `baseline` runs the project's regression command through the existing
`createCommandGate` (`src/command-gate.ts`), using `taskDef.authorisation.verify` (the
project's command gate if configured, else the `npm test` inference in `src/cli/project.ts`),
and returns its assertions. `check` returns the same command's assertions **plus**
`finding:<id>:resolved` (PASS or FAIL by the check kind; absent at baseline, so a FAIL is a
new failure) and the guard assertions below. "Resolved and nothing regressed" is therefore
two deterministic parts through the unmodified delta rule.

**Resistance to weakening.** `GateContext` gains the pinned `baseBranch`, so the gate can
diff the worktree (committed and uncommitted) against `git merge-base HEAD <baseBranch>`
(the base may advance under fan-out; the merge-base does not). Guards (parameters from `taskDef.guards`) are by git against
the diff, so independent of the test parse mode:

| Guard assertion | FAIL when |
|---|---|
| `guard:tests-untouched` | a file matching `testGlobs` is deleted or modified (added test files allowed); for the `tests` category only deletion fails |
| `guard:check-untouched` | a file matching `protectedGlobs` changes (test runner and CI configs), or `package.json` `scripts.test` differs from the merge-base |
| `guard:no-skips` | an added line matches a skip marker (`.skip(`, `xit(`, `@Ignore`, `pytest.mark.skip`, and the pack's additions) |

Globs are git pathspecs, so git does the matching. **Stated limitation:**
`guard:tests-untouched` fails any modification of an existing test, so a legitimate fix that
must change one ends `unfixable` with cause `needs_test_change`, counted and explained
separately (SHOULD `--allow-test-edits` relaxes it, forced held). It does not catch
special-casing production code to satisfy a check; the owner sees the diff for held fixes
and the level label is honest.

**Errors.** A command that cannot run is a gate ERROR as today and takes the existing
gate-maintenance route. A malformed or timed-out pattern (10 s) is ERROR for that finding,
never PASS: the gate never turns "could not check" into success.

**No tests.** If no regression command exists: a finding with a specific check is approvable
and its fix forced held ("finding check only, no regression tests"); a finding with no check
is `needs_decision` ("cannot be checked") unless approved `--allow-unchecked`, recorded and
forced held. This meets the roadmap's "static analysis gate if no tests exist" by honesty
and sign-off rather than a bundled analyser.

### 8. The closer, severity and sign-off

`findingCloser` (`src/packs/finding-closer.ts`) is a `custom` closer that reads
`taskDef.authorisation` from the case file:

- `hold: false`: delegates to the landing closer (`merge-back` by default, or the project's
  closer such as `open-pr`), with all existing semantics (`src/merge-back-closer.ts`).
- `hold: true`: delegates to commit-to-branch behaviour
  (`src/commit-to-branch-closer.ts`): the gated work is committed on `surface/<id>`, the
  worktree removed, the branch kept, the base untouched. The task is harness-closed; *held*
  is a ledger state.

**Authority-class escalation** means: a finding at or above the threshold needs the owner's
authority to land, however well it was gated. It is deliberately not an `ESCALATED` run,
which ends before the gate and closer, cannot be resumed, and blocks a sequential list. A
held fix has passed its gate and keeps its work. The threshold compares on the closed
ordered enum; `null` holds nothing.

**Sign-off on a moved base.** By sign-off other fixes have usually landed, so a bare
fast-forward would fail in the ordinary case. `delivery findings sign-off <n>` appends
`signed_off`, takes the repository lock (`takeRepoLock`, `src/repo-lock.ts`, so sign-offs and
supervised closes serialise) and:

1. rebases the kept branch onto the base branch in a scratch worktree. A conflict aborts the
   rebase and ends the finding `signed_off_failed` ("your main copy changed in the same
   lines; the fix was not landed; branch kept");
2. **re-gates on the base it will land on**: `findingGate.baseline` at the base tip and
   `findingGate.check` on the rebased branch, compared with `computeDelta`, exactly the
   delta the task was judged by. FAIL (including the finding's pattern reintroduced by
   another change) ends `signed_off_failed` with the failing assertion ids; nothing merges;
3. only on PASS, the landing closer lands it, now a fast-forward. The close report, re-gate
   verdict and new base sha are appended as `landed`.

So a landing is never un-gated against a moved base. Each step is idempotent on replay.
`reject` appends `rejected`; the branch is kept.

**Unfixable findings.** A worker `escalate`, an authority refusal or a spent budget ends the
task `ESCALATED` with the existing `EscalationPacket` and Item 11's plain text; the ledger
records `fix_observed` and the findings view quotes the explanation. `needs_decision` and
`unconfirmed` are likewise terminal with an explanation.

### 9. States and the findings view

Internal state machine: `proposed` → `approved | skipped`; `approved` → `already_resolved |
fixing`; `fixing` → `fixed | held | unfixable | stopped`; `held` → `signed_off_landed |
signed_off_failed | rejected`; scan-time terminals `unconfirmed`, `needs_decision`. The
owner-facing mapping is the table in UX. The invariant (exactly one state, ending terminal)
is enforced by an exhaustive fold with a `never` check, and property-tested over generated
ledgers.

`deriveFindings(snapshot)` is a **pure fold** of the ledger and the fix tasks' run records
(matched by `findQueueRun`), in the same snapshot-then-derive shape as the report
(`src/report/`). It reads no clock. `delivery findings` renders it; `--json` emits a
versioned `delivery.findings/1` document with a published JSON Schema. Run standing still
comes from `deriveReport`; there is no second source of truth.

### 10. Supervisor and report integration

- **Supervisor.** Fix tasks are list entries to the existing driver: `concurrency` N gives N
  surfaces, the shared breaker, the repo lock and serialised closes, unchanged. Inherited
  limit: no dependency scheduling, so two findings in one file can conflict at landing; with
  `merge-back` the second fast-forward fails plainly into the existing close retry. The
  plan's adjacency and precondition re-check mitigate it; the docs recommend a
  branch-keeping or PR landing above concurrency 1.
- **Report.** No new report type. The report's per-task record gains optional `tags`
  (`Record<string, string | number | boolean> | null`) echoed from `taskDef.tags`, which is
  what Item 11 asserted and the code does not do; additive in `delivery.report/1`
  (`src/report/json-schema.ts`, `src/report/published-keys.txt`). Text prints the intent,
  so a fix reads "Fix: Hard-coded database password (src/db.ts)". The report reads the task
  list, so when no `delivery.config.*` exists config lookup falls back to the latest plan
  file (`findConfig`, `src/cli/config.ts`); with a project config, `--config` selects the
  plan. The pack-specific sections (WAITING FOR YOUR SIGN-OFF, SKIPPED BY YOU) and headline
  counts come from `deriveFindings`. Scan sessions appear in the findings view, not as report
  tasks.
- **Cost.** Scan usage is a ledger entry; fix usage is per run (`SessionUsage`); the
  findings view totals both.

### 11. Security

- **Scanner authority is read-only**, enforced by `validateRoleConfig`, not overridable,
  worktree-confined. It cannot write the ledger, run commands or reach the network.
- **Untrusted repository content reaches prompts.** The chain is: hostile file → scanner →
  finding text → fix `taskDef` → fix worker (which has `Bash`). Controls in depth: the
  scanner can only describe; every claim is checked against the repository and free text is
  capped and stripped; the owner reads the finding verbatim before authorising; the fix
  prompt labels finding fields as untrusted description; the worker's authority is
  unchanged and worktree-confined; severe fixes are held; the check cannot be loosened by
  the agent. Residual: a hostile file can make the scanner omit findings, so "no findings"
  is worded "none found", never "clean".
- **Regex safety.** An LLM-authored regex from untrusted content is run by `git grep -E`
  with a 10 s timeout and a length cap, never by the harness's own `RegExp`.
- **Path safety.** `realpath` against the worktree root; escaping paths refused.
- **Code execution.** Data-only packs run no code. Code-bearing packs (COULD) need a trust
  confirmation, record content hashes in `review.json`, and re-ask on change.
- **Data egress.** None new.
- **Secrets in findings.** A secret-shaped literal is detected by the harness, not the
  scanner's say-so (private-key headers, provider key prefixes, a
  `password|secret|token|api_key` assignment to a quoted value, JWT shape, any 20-plus
  character high-entropy token, and anything in a category the pack marks `sensitive`).
  The literal may exist only in `anchor` and `check.pattern`; any detected literal in other
  free text is masked at ingestion. **Every rendering masks** anchor and pattern (first four
  characters, an ellipsis and the length) in the findings view, `--json`, the report and
  events, `preview`, error text and escalation text. The stores that must carry the literal
  (`refs/scan.json`, `plan.config.json`, each fix run's case file and prompt) live under the
  self-ignoring `.delivery/`, are written mode 0600, and are never committed or echoed. A
  test asserts no seeded literal appears in any rendered output. The exact detection
  patterns are left to the plan for the slice that owns them.

### 12. Non-functional requirements

| Property | Target |
|---|---|
| Determinism | ids, plan, states and views are pure functions of recorded data; no clock in a fold; order by severity then id |
| Crash safety | every write atomic or a synced append; any crash recovered by re-running the command |
| Idempotence | `review` resume, `fix` and `sign-off` safe to repeat |
| Cost visibility | scan and fix usage recorded and totalled; a scan is one session |
| Bounded work | `maxFindings`; text caps; 10 s regex timeout; each `fix` pass terminalises a finding or stops |
| Offline | everything except agent sessions and an optional detector |
| Plain language | fixed phrase tables over closed enums; agent text quoted and attributed; no stack traces; British English |
| Accessibility | no cursor movement; colour never the only signal |
| Compatibility | every schema addition optional; old records read |

**Additivity of core changes.** (1) `runSession` extraction from `invoke`,
behaviour-preserving; (2) `scanner` joins `AgentRole` (every `switch` gets a compile-time
prompt); (3) `GateContext.baseBranch`, ignored by existing gates; (4) optional `tags` on the
report's per-task record; (5) config lookup falls back to the latest plan only when no
config is found, which is an error today.

### 13. Testing

Everything runs offline through the existing agent mock (`vendor/claude-mock` via
`src/mock-session.ts`, `src/mock-script.ts`; whole-CLI tests via the
`DELIVERY_TEST_MOCK_SCRIPT` seam). A scripted scan is a JSON expectation carrying the
`ScanEnvelope`; a scripted fix is file `effects` plus a worker envelope. Behaviours asserted
(intended behaviour, red first):

- Scan: a hallucinated path or anchor becomes `unconfirmed`; duplicates merge; ids are stable
  under line drift and rewording; `maxFindings` truncates visibly; the scanner is refused
  `Edit`, `Bash` and out-of-worktree reads; a crash between `refs/scan.json` and
  `scan_done` recovers.
- Review: `--all` records concrete ids; the last decision wins; hold follows severity and
  threshold; no tests forces hold.
- Plan: byte-identical for the same ledger; running `fix` twice creates no second run for
  any finding; an unfixable finding does not stop the next at concurrency 1.
- Gate, adversarially, with scripted cheating fixes: delete a test; edit a test; add a skip
  marker; edit `scripts.test`; comment the offending line out (`anchor-gone` stays FAIL);
  obfuscate past a pattern (asserts the label documents the ceiling); a stale finding is
  dropped by the precondition; both an `exitcode` and a TAP gate catch file-level tampering.
- Closer and sign-off: a held fix leaves the base untouched and the branch intact; sign-off
  after other fixes landed rebases, re-gates and lands; a conflicting rebase and a
  reintroduced pattern each end `signed_off_failed` with nothing merged; replay is a no-op.
- Secrets: a seeded literal never appears in rendered output; stores are mode 0600.
- Fan-out: `runSupervisorAgainstMock` with N findings at concurrency N reaches one terminal
  state each.
- Prompt injection: a seeded file aimed at the scanner, with a scripted scanner that
  "obeys" it; the harness still validates, caps and labels, and the fix worker's authority
  is unchanged.
- **Pack conformance suite**, exported from `delivery-service/testing`: given a pack folder
  with `fixtures/`, asserts manifest validity, that every category and check kind resolves,
  that the scan yields the expected confirmed findings, and that the seeded fix passes its
  gate while a seeded cheat fails. The two built-in packs run it in `npm test`; a third-party
  author runs the same suite through `delivery packs check`.

What scripted tests cannot prove, said in the docs as `docs/testing-your-pipeline.md` says
it: how good a real scan is, or whether a real agent obeys `scan.md`.

### 14. Extensibility

- A pack is a folder; a path works anywhere a name does (MUST: how Priya develops and how a
  team shares one in its repository).
- Distribution and discovery (COULD): npm packages declaring a `delivery-pack` field;
  `delivery packs` lists built-ins, local paths and installed packages. No hosted registry.
- `delivery.pack/1` is the contract; the manifest hash and version are recorded per review,
  so a result is reproducible and a changed pack is visible.
- Items 13 and 14 hang off the library functions `reviewAndPlan` and `runFix`; a trigger
  filter can select findings by tag.

## Buy-vs-build decisions

| Capability | Decision | Alternative considered | Rationale |
|---|---|---|---|
| Fan-out of fixes | **Reuse-estate**: `runQueue`, supervisor, breaker, repo lock | A pack-specific scheduler | Fix tasks are list entries; a second scheduler would disagree on locks and repairs. |
| Landing a held fix on a moved base | **Reuse-estate (composition)**: `git rebase`, `findingGate`, `computeDelta`, merge-back closer, repo lock | Cold fast-forward; re-running the fix as a new task | A cold fast-forward fails in the ordinary case; a re-run is a second nondeterministic session. Rebase plus re-gate is deterministic and adds no git landing code. |
| Isolation, close, idempotent landing | **Reuse-estate**: `provisionWorktree`, the three built-in closers | Own git landing code | The closers already land correctly. |
| Regression check | **Reuse-estate**: `createCommandGate` + `computeDelta` | Own test-runner wrapper | Already parses TAP, JUnit and exit codes. |
| "Finding resolved" as an assertion | **Reuse-estate (technique)**: absent at baseline + `failOnNewAssertions` | A must-turn-green class in the delta rule; a second gate stage | Works today with zero change to the delta rule every task relies on. |
| Per-finding resolved check | **Build**, thin: three check kinds in one gate | Re-run Semgrep/CodeQL; a second LLM verifier | Re-run tools need installation and rules and do not exist for LLM-found findings (research §2); an LLM verifier is not deterministic. Kept as COULD kinds. |
| Matching untrusted regexes | **Buy (platform)**: `git grep -E` with timeout | `RegExp` (ReDoS); `re2` (native dependency); `safe-regex` (heuristic) | git is already a hard dependency and not a backtracking engine for ERE. |
| Glob matching for guard paths | **Buy (platform)**: git pathspecs | `picomatch`, `micromatch`, `path.matchesGlob` | The diff is git's; one glob dialect, no dependency. |
| Lockfile presence | **Build**, ~20 lines of `JSON.parse` | `@npmcli/arborist`; OSV-Scanner | A presence test needs no resolver; other ecosystems are the detector COULD. |
| Advisory data | **Buy** (COULD): `npm audit --json`, OSV-Scanner when installed; MUST uses labelled reviewer knowledge | Embedding an advisory database | Commodity, changes daily, owned by others; degrades honestly offline. |
| Finding schema | **Build**, small zod schema | SARIF as the native schema | Needs plain-language fields SARIF lacks; SARIF stays the edge format. |
| Schema validation and JSON Schema | **Reuse-estate**: zod 4 `z.toJSONSchema` | `ajv` + hand-written schema | One source; precedent `src/report/json-schema.ts`. |
| SARIF import/export | **Build**, thin mapper (COULD) | A SARIF library (.NET multitool) | The subset used is a mapper, not a library. |
| Severity vocabulary | **Reuse (standard)**: CVSS qualitative bands as words | Own scale; numeric CVSS | Matches the roadmap, GitHub and npm; an LLM cannot honestly supply CVSS vectors (research §3.2). |
| Structured agent output | **Reuse-estate**: SDK `json_schema` output, `invoke` core | Free-text parsing; MCP tool output | Already enforced and re-validated per role. |
| Read-only agent authority | **Reuse-estate**: `READ_ONLY_TOOLS`, tool guard, `validateRoleConfig` | A container sandbox | Triage already has exactly this guarantee. |
| Crash-safe ledger | **Reuse-estate**: `journal.ts` | SQLite; a JSON blob | Same discipline as case and run files; no second source of truth or native dependency. |
| Fingerprint | **Reuse (platform)**: `node:crypto` sha256 | SARIF fingerprint libraries | Four fields hashed. |
| Owner decisions | **Build**, thin: ledger entries and CLI verbs | GitHub issue labels; Dependabot-style PR review | Must work without GitHub and be replayable; the PR stays available as a landing (`open-pr`). |
| Interactive choice | **Reuse-estate**: `@inquirer/prompts` (already used by `delivery init`) | A TUI library | A checkbox list and a three-way choice. |
| Plain-language rendering | **Reuse-estate**: phrase tables over closed enums (`src/report/plain.ts`) | LLM summaries | Deterministic and cannot contradict the evidence. |
| Pack manifest format | **Build**: JSON + zod | YAML; a TS module | Matches `delivery.config.json`, no parser dependency, executes nothing. |
| Pack distribution | **Reuse (platform)**: folders and npm packages | A hosted registry; git submodules | Registry is a non-goal; npm already versions and hosts. |
| Authority escalation | **Build**, as ledger sign-off over existing closers | A real `ESCALATED` outcome | An escalation cannot resume, blocks sequential lists and discards a passed gate. |
| Test double for scans | **Reuse-estate**: claude-mock, `DELIVERY_TEST_MOCK_SCRIPT` | A pack-specific fake | One harness for every behaviour. |
| Weekly scheduling | **Not built**: Item 13 | cron here | Out of scope; the library functions are the seam. |

## Operability / DX

**Environment.** Packs are a capability of the existing `delivery` CLI (Node 22+, TypeScript
ESM, commander, zod 4, `git`) and its library. No service, daemon, database or new
credential: a scan and a fix use the agent runtime the CLI already requires, and everything
else runs offline. Optional detectors (COULD) are used when present and reported honestly
when absent. It runs wherever `delivery` runs: a developer's machine, CI, an autoloop
worker, and Item 13's scheduler on the same host. State lives in `.delivery/packs/` inside
the target repository, self-ignored.

**Harness.** The existing one: claude-mock through `mock-session.ts` and `mock-script.ts`,
`runSurfaceAgainstMock`, `runSupervisorAgainstMock`, and the `DELIVERY_TEST_MOCK_SCRIPT` seam.
A scripted scan is a JSON envelope in the same `MockScript` as every other behaviour; a
scripted cheating fix is `effects`. The pack **conformance suite**, exported from
`delivery-service/testing`, is the one harness for built-in and third-party packs, driven
by each pack's `fixtures/`. Time is injected; no fold reads a clock.

**Scaffolding.** The two built-in packs are the templates: a new pack is a copy of a
built-in folder, proved against its `fixtures/` by `delivery packs check`. The manifest has
a published JSON Schema (`delivery packs --schema`), so an editor validates it as it is
typed. A fixture repository with planted flaws ships under `examples/`, as
`examples/project-configuration-example` does, so "try it" is real. Owner and author guides
are `docs/task-packs.md` (Dana: first review to report) and `docs/writing-a-pack.md`
(Priya), in the style of `docs/writing-a-gate.md`. There is no new `init` step and no
configuration key for the owner. `delivery packs new` is COULD.

**Local-run story.** An owner points the review at a repository by pack name or path, reads
the numbered findings with their plain explanation and verification level, chooses, and the
fixes run in worktrees as gated tasks; `status`, `report` and `findings` read the same
on-disk record at any moment, from another terminal or after a crash, because each is a pure
fold of what is on disk. A pack author does the same against `fixtures/` with the scripted
agent and no API key, and can copy a failing `.delivery/packs/<review-id>/` folder to
reproduce it.

**Deploy target.** The npm package `delivery-service` (bin `delivery`, exports `.` and
`./testing`) is the only artefact. Built-in packs ship in it under `packs/`; the engine is
in `dist/`. The stability-promised surfaces are `delivery.pack/1`, `delivery.findings/1` and
the additive report `tags`. Third-party packs deploy as a folder in a repository or an npm
package; nothing is hosted.

**Verification.** `npm test` (lint, build, vitest) stays the single gate. The conformance
suite for both built-in packs, the adversarial gate tests, the prompt-injection tests and
the report golden for `tags` run inside it, offline, with no key.

## What this design does not include

- **Scheduling and recurring runs** (Item 13); repository, webhook or PR **triggers** (Item
  14). A `pack` key in `DeliveryConfig` is deferred to Item 13.
- A **hosted pack registry** or marketplace; a web console or dashboard; notifications.
- **Per-task gates and closers** as a general project-configuration feature. Per-finding
  variation is delivered inside the one pack gate and closer.
- Packs that change harness control flow beyond the sign-off hold, or widen any role's
  tool authority.
- Changing what triage decides; changing the delta rule.
- A second LLM judging whether a fix is good. The agent's word is never proof.
- Automatic merging of fixes at or above the threshold; fixing anything the owner has not
  approved.
- Advisory-database dependency scanning and non-npm lockfiles (COULD detectors).
- Dependency-aware scheduling of fixes that touch the same file (inherited supervisor
  limit, mitigated by plan ordering and the precondition re-check).
- Owner approval or refusal of **gate-maintenance repairs** in general (the seeding idea's
  wider questions); this phase answers them only for pack fixes.

## Assembly resolutions

Points where the approved artefacts disagreed or were silent, resolved at assembly:

1. **Sign-off on a moved base.** An early product-design passage said a moved base would
   give "the existing plain failure". The architecture's round-2 revision (rebase, re-gate,
   then land under the repo lock) supersedes it; this spec uses the architecture's
   mechanism throughout, and the product design's state table already reflected it.
2. **Configurable threshold location (SHOULD).** The product design said "via the project
   configuration and a flag"; the architecture adds no configuration key for packs and
   defers a `pack` key to Item 13. Resolved: the SHOULD is a flag on `delivery fix`
   (recorded in the `authorise` entry); a config setting arrives with Item 13's `pack` key.
3. **Malformed scan output.** The product design proposed one automatic retry of an
   unreadable scan within a budget; the architecture treats an invalid envelope as an
   incomplete, as for every role. Resolved: no special retry; an invalid envelope is a
   failed scan with a plain next step ("run it again"), and per-finding invalidity within
   a valid envelope is `unconfirmed`.
4. **Confidence (SHOULD 18).** The finding schema has no confidence field. When the SHOULD
   is built it adds an optional `confidence` (`low | medium | high`) to the scanned finding,
   additive within `delivery.findings/1`.
5. **Report sections.** The product design's report sections for pack states are rendered
   from `deriveFindings`, not by adding states to the report's own standing model; the
   report document gains only `tags`.
6. **The no-tests level wording.** The UX table and §7 quote the level as "finding check only,
   no regression tests", but "finding" is in the vocabulary's never-say column, which the
   forbidden-word test enforces over every owner-facing phrase. Resolved at slice 6: the owner
   reads "this problem's own check only, no regression tests"; the meaning is unchanged.

## Open questions

- **Judgement-finding check strength.** `anchor-gone` can be evaded by renaming; the upgrade
  path is `test-red-green` and detector re-run (COULD). Whether real scans produce enough
  `pattern-absent` findings to make the targeted level common is unknown until real runs.
- **Plan fallback in config lookup.** If an explicit `--config` is preferred instead, the cost
  is that a no-config owner must type it for `report` and `status`.
- **Secret detection patterns** are designed, not specified to the pattern level.
- **Personas** remain team-derived and unratified.
