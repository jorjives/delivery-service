# Review log — project-configuration-design (autonomous run 20260917T121214Z)

## Selected phase (derived) — team-lead discovery

**Selected:** Roadmap Item 9, Project Configuration.

**Survey.**
- Specs: roadmap Items 1–8 all carry ✅ Complete banners with design + slices pairs.
  Item 9 is the first unstarted item and its dependencies (Items 2, 4, 6, 8) are complete.
- Ideas pool (3 files): `agent-port-test-doubles-need-a-cast` already seeded Item 7;
  `choose-a-licence-before-open-sourcing` already seeded Item 8 and remains a
  human-gated decision; `dedupe-remaining-hand-rolled-git-test-wrappers` is a test-tidy
  chore, not PRD material. None seeds this phase, so the design carries no `seeded_by`.
- Non-goals backlog: Items 4, 5, 6, 7 and 8 each defer "declarative / natural-language
  authoring" of role config, triage config, closer refs, mock scripts and task
  structuring explicitly to Item 9. Item 8 names the exact residue: natural-language
  task structuring, domain system-prompt authoring or preview, role-config fields in the
  config file, a task queue, a standalone validation command.

**Why now.** Item 8 made the harness invocable for one task. A project owner still cannot
describe their project, queue several tasks, preview what agents will be told, or check a
configuration before spending agent budget. Items 10–14 (supervisor queue, reporting,
task packs, scheduling) all consume the project configuration, so it unblocks the rest.

**Not a duplicate.** Item 8's `delivery.config.json` holds four keys (`task`, `gate`,
`closer`, `budgets`) and declares Item 9 a superset: same keys, new producers, new keys
alongside. This phase must extend that file, not replace it.

**Intended tier shape (derived minimum scope = MUST; assumed, not human-confirmed).**
- MUST: checked-in project configuration extending `delivery.config.json` (domain context
  in prose, a task queue, role-config overrides); natural-language task definitions
  structured into `TaskDef`; `delivery validate`; prompt preview before a run; running
  tasks from the queue (sequentially, single-surface); a complete example project;
  unified onboarding documentation stitching the gate/closer/role guides.
- SHOULD: `init` extended to the new keys; named presets for built-in gates; `--json`
  validation output.
- COULD: agent-driven onboarding that proposes a configuration for owner approval.
- Non-goals: concurrency (Item 10), reporting (Item 11), packs (12), scheduling (13/14),
  licence choice, plugin distribution, YAML/TOML.

The critic's remit includes challenging this selection and tier split.

## Assumptions
- Minimum scope was derived by the team-lead from roadmap Item 9's success criteria; no
  human confirmed it.
- `TaskCreate`/`TaskUpdate` are not available in this session; task numbers (#1–#6) are
  tracked by convention in briefs and this log.

## Critic — phase-choice verdict (Task #4)

**Verdict: APPROVED.** Roadmap Item 9 is the right next phase.

Checked against:
- **Not a pivot.** Item 9 is the first unstarted roadmap item; its four
  dependencies (Items 2, 4, 6, 8) all carry ✅ Complete banners. The derived
  scope's seven MUST capabilities trace one-to-one onto all eight success
  criteria listed under roadmap Item 9 (gate/closer/queue definition, prompt
  preview, task-def authoring+validation, checked-in versioned config, a
  validation command, an end-to-end example, and natural-language task
  structuring) — no criterion is dropped, none invented.
- **Not scope-starved to one slice.** The MUST tier spans config schema
  extension, NL task structuring, a new `validate` command, prompt preview,
  queue execution, a worked example, and unified docs — a full PRD phase,
  not a single vertical slice. SHOULD/COULD sensibly defer polish (`init`
  extension, gate presets, `--json` output) and the roadmap's explicitly
  optional stretch (agent-driven onboarding proposing a config — the roadmap
  says only "the spec should also consider" this, so COULD is the right
  altitude, not a shortfall).
- **No duplication with Item 8.** Verified directly against Item 8's spec
  (`docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`,
  "What this design does not include", lines 601–618): its non-goal list
  names Item 9's declarative config, NL task structuring, domain
  system-prompt authoring/preview, role-config fields, task queue and
  validation command as exactly the residue this phase must pick up. The
  derived MUST tier is that residue, word for word — no re-specification of
  Item 8's four existing keys (`task`, `gate`, `closer`, `budgets`), only
  extension alongside them.
- **Sound boundary against later items.** Non-goals correctly exclude
  multi-surface concurrency (10), reporting (11), task packs (12),
  scheduling (13/14) and the human-gated licence decision — all named
  explicitly rather than left to drift in scope during drafting.

One open watch-point carried into artefact review (not a phase-choice
blocker): roadmap Item 9 success criterion 7 — "a non-technical project
owner can set up a project using only declarative configuration and
built-in components, without writing any code" — must be demonstrably true
of the MUST tier as drafted, not just aspirationally true of the tier list.
The derived scope's role-config overrides (`systemPromptFragment`,
`allowedTools`) are explicitly scoped to the *programmatic* altitude; the
product design and architecture must show a working declarative-only path
(sensible defaults, no overrides required) that still satisfies criterion 7
end to end, per the roadmap's Accessibility note. Will check this against
the personas in `docs/personas.md` when reviewing the drafts.

## Critic — architecture.md, round 1

**Verdict: APPROVED** (conditional on folding one open question into a stated
decision — not a re-review trigger).

Verified independently against the checkout (not taken on the architect's
citation alone): `CaseFileHeader.domainPrompt` (`src/schema.ts`), the
domain-prepend ternary (`src/prompt-assembly.ts`), `DeliveryConfig`'s
four-key `.strict()` object (`src/cli/config.ts`), `TaskDef` as an opaque
`z.record` (`src/schema.ts`), `workerRoleConfig`/`gateMaintenanceRoleConfig`
and `validateRoleConfig`'s triage read-only `superRefine` guard
(`src/role-config.ts`), and `allRuns`/`unfinishedRuns`
(`src/cli/runs.ts`) — all match the document's description. `examples/
sample-project/` and the four guide docs named for "stitch, don't replace"
exist as claimed.

Assessed against the two lenses and two-sided scope discipline:
- **Buy-vs-build**: honest ledger. Only two genuine "build" rows
  (`structureTask`, the sequential queue loop); everything else (zod,
  commander, `assemblePrompt`, `validateRoleConfig`, `allRuns`,
  `loadPlugin`) is correctly reuse-estate, with the alternative considered
  and rejected named in each row.
- **Operability/DX**: present and specific — environment, harness layout,
  scaffolding (one new example fixture, one new doc), local-run story,
  deploy target, diagnosability all addressed, not invented beyond what a
  Node CLI needs.
- **Persona traceability**: checked `docs/personas.md`'s extended Dana goal
  (added this run) against §2.3/§5/§6 — the fully declarative path (`domain`
  + `tasks`, no `roles`) needs no role overrides, so "never sees role
  config" holds specifically for Dana; `roles` is Priya's (extender)
  surface. No MUST capability traces to no persona; nothing here reads as
  gold-plated beyond the brief's MUST tier.
- **No hand-rolled commodity**: schema validation, CLI parsing and the
  prompt renderer are all reused, not rebuilt.

One directive given (not blocking, folded into the same message): open
question #1 (`_queueIndex` placement) already has a reasoned lean towards a
`CaseFileHeader` sibling field over embedding in agent-visible `TaskDef`.
Told the architect to write that up as the decision in §6.2, not leave it
as an open question — the tie-breaker rule applies (one defensible,
reversible resolution). Open question #2 (no exported preview helper) is a
sound YAGNI default as written, left alone.

No procedure-as-defect findings raised (HARD-BOUNDARY respected) — the
document describes the system, not a build sequence, throughout.

## Critic — product-design.md, round 1

**Verdict: REVISE** — one blocking internal contradiction, otherwise sound.

1. (Blocking) Accessibility section's third bullet still reads "Dana's
   `domain.description` and Priya's `domain.descriptionFile` populate the
   same `domainPrompt`" — a leftover from the document's own first draft.
   Every other section (Coordination record, "Where I reshaped the brief",
   open question 3, Flow 1, Flow 6) confirms `domain` was resolved to one
   flat prose string, shared by both altitudes, with the
   description/descriptionFile split dropped in favour of the architect's
   shape. Two sections of the same document disagree — a genuine defect per
   the critique skill's "do any two sections disagree?" check, not
   bikeshedding, since a reader hitting the Accessibility section alone
   would build the wrong schema. Sent back for a one-line fix.

Verified independently: `drive.ts` hardcodes `workerRoleConfig`/
`gateMaintenanceRoleConfig` as static imports (line 38), confirming the
"role overrides are a TypeScript-only lever" problem statement;
`examples/sample-project/` has no `delivery.config.json` today, confirming
MUST #6's premise; Item 8's exit-code table confirms `4` = "run escalated"
as used in the empty/error-states table; `CONFIG_EXTENSIONS` in
`src/cli/config.ts` does include `.js`/`.mjs`, which I used to strengthen
(not overturn) the product-designer's own ruling on open question 3.

Cross-checked MUST #2's reshaping ("structured into what each role needs"
scoped to the one shared `TaskDef` slot) against the architecture draft's
§3.1 — the two documents reason to the same place independently verifiable
in the architecture text, not just asserted by the coordination record.

Two-sided scope discipline: every MUST traces to Dana or Priya (checked
against `docs/personas.md`); Dana's primary journey (author → validate →
preview → run, Flows 1/3/4/5) completes end-to-end within the MUST tier
alone — not value-starved. No MUST item is gold-plated: role-differentiated
task structuring explicitly *not* built because nothing downstream would
consume it (§"Where I reshaped the brief"), matching the architecture's own
restraint.

Ruled on the three open questions rather than leaving them open:
- Named gate/closer presets: stays SHOULD — Item 8's `init` already clears
  the "no code" MUST bar via prompts; presets are ergonomics, not a
  precondition.
- `domain` as a single string: stays as-is, no split — strengthened with
  the `.js`/`.mjs` escape valve already in `CONFIG_EXTENSIONS`, which
  answers the "long description" cost with existing mechanism, not a
  schema change.
- Stop-not-skip on escalation: correct, matches "no unrequested
  abstractions"; no flag this phase.

No procedure-as-defect findings (HARD-BOUNDARY respected) — document
describes the system and its flows, not a build sequence.

## Critic — product-design.md, round 2

**Verdict: APPROVED.**

Confirmed the blocking contradiction from round 1 is fixed: the
Accessibility section now states Dana and Priya write the same `domain`
field (one string, either altitude), consistent with the rest of the
document. The former "Open questions" section is replaced with "Questions
the critic has ruled on (closed)," correctly folding in all three round-1
rulings (stop-not-skip, presets stay SHOULD, single-string `domain` with
the `.js`/`.mjs` escape valve noted).

One trivial, non-blocking nit passed back for next touch, not another
round: the Non-goals section's escalation-skip bullet still says "flagged
as an open question below," stale now that section is closed — cosmetic
only, does not change the design.

Both artefacts for Task #4 are now APPROVED (architecture.md round 1,
product-design.md round 2). Notifying main.

## Team-lead — assembly review, task #4 reopened

Reading both approved artefacts side by side for assembly surfaced defects neither
individual review caught. Sent back through the critic gate rather than resolved
silently at assembly, because item 1 is an architectural decision:

1. (Blocking) Queue progress keyed on array position (`header.queueIndex`) silently
   skips or re-runs tasks when the owner inserts, reorders or deletes queue entries.
2. `_queueIndex`-inside-`TaskDef` text survives in three places, contradicting §6.2.
3. Product promises an unknown-tool-name check "reusing" validation that does not
   exist (`src/role-config.ts:100-120` checks only non-empty strings).
4. `preview` flag surface differs between the two documents.
5. Example project location differs (`examples/sample-project` vs a new fixture).
6. Duplicate-entry handling appears in one document only.

## Critic — team-lead assembly-review reopen, round 2/3 (architecture.md
round 2, product-design.md round 3)

**Verdict: both APPROVED.** Task #4 re-closed.

The team-lead's assembly review found six defects shared or disagreeing
across both approved artefacts: (1, blocking) queue progress keyed on
array position, silently skipping/re-running tasks under insert, reorder or
delete on a checked-in file; (2) `_queueIndex`-in-`TaskDef` text
contradicting the round-1 header-field resolution; (3) a promised
unknown-tool-name `validate` check claiming reuse of validation that does
not exist in `src/role-config.ts:100-120`; (4) disagreeing `preview`
flags; (5) disagreeing example-project location; (6) duplicate-entry
handling documented in only one artefact.

**Verified independently before approving, not taken on say-so:**
- Re-confirmed `src/role-config.ts:100-120` (`RoleConfigShape`) has no
  known-tool-name enumeration — `allowedTools` is
  `z.array(z.string().min(1)).min(1)` and nothing more; both documents now
  correctly describe the `allowedTools` check as structural-only.
- Confirmed `tests/getting-started-guide.test.ts` and
  `tests/sample-project.test.ts` both `cpSync`/reference
  `examples/sample-project/` directly, grounding the decision to leave that
  fixture untouched and add `examples/project-configuration-example/`
  separately instead.
- Read architecture.md §6.2's rewritten content-identity mechanism in
  full: `findQueueRun` now deep-equality-matches a queue entry's structured
  `TaskDef` against every existing run's `header.taskDef` via the existing
  `allRuns()` — no new schema field of any kind (`_queueIndex` and the
  round-1 `CaseFileHeader.queueIndex` field are both gone, kept only as
  named-and-rejected alternatives in the buy-vs-build ledger). The
  edit-by-edit table (insert/reorder/delete/reword/duplicate/deliberate
  re-run) correctly handles every case the position-keyed defect broke.
- Confirmed product-design.md's Flow 2 table and Config file shape section
  describe the identical mechanism and the identical edit outcomes.

**New observation raised during this round, resolved without burning
another round:** stress-testing the new content-identity mechanism found
it matches on `taskDef` alone, not `gateRef`/`closerRef`/`domainPrompt` —
so reworking a gate or domain description without rewording a task leaves
a queue entry "satisfied" by a run verified under the old acceptance bar.
Not one of the team-lead's six points, and not blocking (mirrors Item 8's
own `--fresh` precedent at the single-run level; a documented decision, not
a bug). Asked the architect to document it rather than leave it silent —
done, added to architecture.md §6.2 as an explicit "accepted trade, not an
oversight" paragraph. Passed to the product-designer as an FYI only, given
product-design.md is at the 3-round cap and this is a documentation
completeness nit, not a contradiction between the two artefacts.

**Cross-artefact consistency, final check:** preview's flag surface
(`--queue-index <n>`/`--role`, no `--task`, no `--verbose`), the separate
`examples/project-configuration-example/` fixture, duplicate-entry
refusal, and the content-identity mechanism all agree between
architecture.md and product-design.md. No open disagreement remains.

Both artefacts APPROVED. Notifying main: task #4 complete.

## Team-lead — assembly and final spec review (tasks #5, #6)

Assembled `docs/superpowers/specs/2026-09-17-project-configuration-design.md` from the
re-approved artefacts. Four further points settled at assembly are recorded in the
spec's "Assembly resolutions" (items 6–9), notably that only a *closed* matching run is
skipped by the queue driver, so an escalated task still stops the queue on re-invocation.
A fresh spec-reviewer returned **APPROVED** in round 1 after two direct fixes
(duplicate-entry refusal moved to load time so `run` also enforces it; a dropped open
question restored). See `spec-review.md`.

Result: `{ status: "complete", unresolved: [] }`. Assumptions: derived minimum scope;
personas extension for Dana; no idea file seeded the work.
