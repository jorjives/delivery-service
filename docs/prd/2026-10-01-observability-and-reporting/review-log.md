# Review log — Observability and Reporting (roadmap Item 11)

Team: `observability-and-reporting-design`. Autonomous run `20261001T131757Z`
(`design-team-auto`); no human reviewed any decision recorded here.

## Selected phase (derived)

**Selection: roadmap Item 11, Observability and Reporting.** Chosen by the team-lead
during discovery, before the team was spawned. The critic's remit includes this choice
and its scoping.

### Survey

1. **Committed specs** (`docs/superpowers/specs/`): roadmap Items 1 to 10 each have a
   `*-design.md` and `*-slices.md`, and the roadmap marks all ten ✅ Complete (Item 10,
   Multi-Surface Supervisor, on 2026-10-01). Items 11 to 14 have no spec.
2. **Ideas pool** (`.autoloop/ideas/`, five files):
   - `50-20260912T085724Z-agent-port-test-doubles-need-a-cast.md`: already seeded the
     Agent Mock design (`seeded_by`). Set aside.
   - `50-20260913T211119Z-choose-a-licence-before-open-sourcing.md`: already seeded the
     CLI design; the decision itself is recorded as human-gated in three specs. Set aside.
   - `50-20260916T154418Z-dedupe-remaining-hand-rolled-git-test-wrappers.md`: a test
     tidy-up, not a product phase. Set aside.
   - `50-20260918T183944Z-claude-mock-ignores-all-cli-arguments.md`: a test-infrastructure
     direction, serves no persona journey on its own. Set aside.
   - `50-20260930T212043Z-gate-maintenance-can-weaken-the-check.md`: raises three
     directions. The first ("should a repair's change to the check be shown to the
     owner") is a visibility question and belongs in a reporting phase. The other two
     (owner approval before the run carries on; refusing a repair that drops assertions)
     change control flow and are NOT in this phase. **Drawn on, for the visibility part
     only.**
3. **Known backlog** (existing specs' "does not include" sections): five specs defer to
   Item 11 by name: triage-and-router ("reporting surfaces, dashboards, cross-run
   escalation metrics, and Dana's plain-language experience beyond the COULD summary"),
   close-interface ("plain-language cross-run reporting"), cli-and-configuration ("live
   dashboards, cross-run summaries, plain-language summaries generated at triage time"),
   project-configuration ("reporting beyond the terminal renderer and `status`"),
   multi-surface-supervisor ("TUI, dashboards, cross-run trends, plain-language packet
   summaries beyond today's"; §12 "No new observability subsystem (Item 11)").

### Rationale

- **Well-sequenced.** Item 11's dependencies (Item 10, Item 1) are complete. Items 13
  and 14 depend on Item 11; Item 12's accessibility note routes its fix-phase progress
  through Item 11's reporting surface. It is the next roadmap item and it unblocks the
  rest.
- **Valuable.** With Item 10 shipped an owner can run several tasks at once unattended.
  The roadmap's own framing: "An adopter running 20 tasks overnight needs to come back
  to a clear summary: what succeeded, what escalated, why, and what to do about the
  escalations." For the non-technical owner "the reporting surface may be the only
  window into what the harness did."
- **Non-duplicate.** A terminal renderer (`src/cli/report.ts`: `plainReporter`,
  `jsonReporter`), `delivery status` (one run, `--all`, `--json`, supervised view with
  task standings) and a verbatim escalation packet rendering already exist. This phase
  builds on them; it must not re-specify them. What the roadmap's Item 11 success
  criteria ask for that is not there today, as far as discovery could tell (the
  researcher verifies this against the code): budget consumption per surface and per
  run; inspectable triage decisions and rationales; a live view of every active
  surface's state; a returning-owner summary across a whole run with what to do about
  each escalation; a plain-language decision summary on the escalation packet.
- **Not a pivot.** It is the roadmap's own next item, in the roadmap's own terms.

### Intended shape (team-lead's starting point; the designers own the final tiering)

- **MUST (the derived minimum scope; assumed, not human-confirmed):** the roadmap's five
  Item 11 success criteria, each reachable by a named persona without reading the case
  file by hand: (1) current state of every active surface during a run; (2) budget
  consumption per surface and per run; (3) triage decisions and rationales inspectable;
  (4) terminal outcomes summarised with reasons, across a whole run; (5) escalation
  packets accessible for human review, presenting the decision the owner must make in
  plain language.
- **SHOULD:** machine-readable output for everything the human-readable report says;
  showing what a gate-maintenance or shared-environment repair changed (seeded by the
  gate-maintenance idea, visibility part only); a durable post-run report artefact.
- **COULD:** a live full-screen terminal view; cross-run trends.
- **Non-goals:** task packs (12); scheduling and triggers (13, 14); a hosted dashboard or
  daemon; owner approval of repairs or refusing weakened checks (control-flow changes);
  licence choice and first publication (human-gated).

### Assumptions logged

- **Minimum scope is derived, not human-confirmed.** The MUST tier above is the
  team-lead's inference from roadmap Item 11's success criteria. The product-designer
  records it under "Derived minimum scope (assumed, not human-confirmed)" in
  `product-design.md`; the critic scrutinises it.
- **No task-tracking tool is available in this session**, so the six-task wiring the
  skill describes is carried by `SendMessage` alone: #1 research (blocks #2, #3), #2
  product design, #3 architecture, #4 critic gate (both approved), #5 assembly
  (team-lead), #6 final spec review.

---

## Critic's running log

_(The critic appends below.)_

### Round 0: phase choice and scoping (critic)

**Verdict: PASS.**

1. Item 11 is the right next phase: Items 1 to 10 are complete, Items 13 and 14 depend on it, and five shipped specs defer to it by name. It is not a pivot.
2. Ambition is grounded: MUST is the roadmap's five success criteria, and each needs a named persona journey. This is not scope-starved to one slice.
3. The MUST/SHOULD/COULD split is sound. Repair visibility is correctly visibility-only; approval gates and refusing weakened checks are correctly excluded.
4. Non-duplication spot-check: `src/cli/status-command.ts` and `src/cli/supervised-view.ts` contain no budget or rationale output, which is consistent with the claimed gaps. The researcher should confirm in full.
5. Watch-point for the drafts: the "derived/assumed" MUST tier must be usable end-to-end for both Dana and Marcus, not merely small.

### Round 1: architecture.md draft 1 (critic): REVISE
Strengths: reuses the resume fold, read-only live view, optional-only schema additions, full ledger and operability sections.
Findings sent: (1) Dana's `plain` quotes `packet.decision`, which contains "budget", "gate repair session" and "authority" (blocking: needs its own phrase table plus a who-acts classification); (2) `OutcomeCause` kinds exceed `EscalationCause` (5 kinds, never persisted), so the cause-to-site mapping is unspecified (blocking); (3) `--watch` behaviour for `live: null` unspecified; (4) repair patch omits untracked files; (5) control-char stripping versus verbatim evidence; (6) unfilled research citations and command names; (7) wrong cross-reference and ordering text; (8) unverified claims routed to researcher.
Claims sent to researcher (pending): SDK cost fields; torn tail; non-strict schemas; `appendEntry` choke point and deep-equality risk; single-run lock; abort-site causes; repair edit lifetime and untracked diff; `z.toJSONSchema`.

Claims verified with researcher (research.md F1), round 1:
- SDK cost/duration fields exist and invoke() holds them (confirmed); the claude-mock emits constant zeros and scripts cannot set them (gap).
- Torn tail: any exception on the final line is swallowed (confirmed, wider than claimed).
- Rollback compatibility: PARTLY. Entry-level optional keys survive an older build; document-level keys in case.json and run.json are dropped on rewrite by an older build; new `t` variants on the last line are silently dropped.
- `appendEntry` and `appendRunEntry` are the only write choke points (confirmed); `at` will break `toEqual` exact-shape tests.
- Lock is taken only when concurrency > 1: single and sequential runs have no liveness signal (confirmed).
- `EscalationCause` is never persisted; abort has no cause; task-level usage limit is not recorded as such (confirmed). Fed back to architect.
- Bare `git diff` omits untracked files (confirmed); `z.toJSONSchema` exists in zod 4.5.4 (confirmed).

### Round 1: product-design.md draft 1 (critic): REVISE
Strengths: MUST tier traces to personas and gives a usable end-to-end floor; the derived-scope floor (list report, timestamps, cause, durable report) is justified; cost as SHOULD accepted; repair visibility stays visibility-only; vocabulary table plus scan test.
Findings sent: (1) F1/F2 text contains task-specific sentences a deterministic table cannot produce, contradicting D2 (blocking); (2) "agent's work was not kept" contradicts F4's kept branch; (3) exit-code contradiction with architecture (report exits 4 versus ok); (4) no needs-you versus engineering audience tag for Dana; (5) coherence: `resume` versus `run` advice, no list kind in the architecture document, `--full` missing, `--watch` exit when liveness unknown; (6) 200-task collapse is speculative; (7) vocabulary scan scope for the tuner block.
Claims sent to researcher (pending): D3 re-run semantics and branch clash; what is kept after an escalated or aborted surface.

### Round 2: architecture.md draft 2 (critic): REVISE (narrow)
Resolved from round 1: Dana's `plain` is a separate total phrase table with an owner/engineer audience; cause-per-site table is accurate; liveness stated honestly with `--watch` behaviour per value; untracked repair files covered; compatibility restated honestly; no new entry kinds; citations filled.
Findings: (1) BLOCKING: `next` advice "run `delivery run`" is false for a listed, unchanged task (researcher: `findQueueRun` returns the old run and `drive` retells the outcome; a fresh run needs an amended or removed entry). Same error in product D3. (2) "Nothing changed on main" holds only for built-in closers and per task; the working copy is normally already cleared. (3) Ordering text in 2.3 (test-helper-first) to remove. (4) Cross-document: artefact path and report exit code disagree with product draft 1. (5) Two claims pending researcher (`total_cost_usd` subagent-inclusive; `git diff --no-index`). (6) Group mapping between product sections and architecture groups.
Claim verified with researcher (round 2): re-run semantics (D3 half wrong; see above); closers tear down the worktree with no commit, the branch kept holds only the base unless the worker committed; "nothing changed on base" holds only for built-in closers.

Claims verified with researcher (round 2, cont.): `total_cost_usd` is cumulative per `query()` call and covers subagents and sidechains; `usage` is main-loop only; the harness never resumes sessions, so per-invoke totals hold (confirmed). `git diff --no-index -- /dev/null <path>` renders an added file as a new-file patch, exit 1 meaning "differs" (confirmed; capture must accept 0 and 1).

### Round 3: architecture.md draft 3 (critic): APPROVED
All round 1 and 2 findings resolved: `next` advice matches verified re-run semantics; closer-keyed "where your work is"; ordering text removed; one exit-code rule (`status`/`report` ok, `run`/`resume` keep 4, `--watch` mirrors); owner/engineer audience mapped to report sections; claims verified (cost cumulative per query; no-index diff exit 0/1). Condition: product-design.md must stay coherent on command names, shapes, exit codes and artefact path.

### Round 2: product-design.md draft 2 (critic): REVISE (narrow)
Resolved from round 1: F1/F2 derivable from phrase tables with task-specific words only in labelled quotes; closer-keyed "where the work is"; one exit-code rule; owner/engineer audience and section mapping; D3 amend-or-remove then `delivery run`; `.delivery/last-report.{json,txt}`; `--full` and large-run collapse moved to COULD; vocabulary scan covers the tuner block; coherent with architecture draft 3.
Remaining: (1) J2 says watch exits when not live with no outcome, contradicting F3 and the architecture; (2) "Effort" versus "FOR WHOEVER TUNES THIS" naming; (3) optional: example task-3 clash in F1.

### Round 3: product-design.md draft 3 (critic): APPROVED
J2 now matches F3 and the architecture; one block name; separate engineer example. Coherent with architecture.md draft 3 on command names, shapes, exit codes, artefact path and plain-language source.

### Gate complete
Both artefacts APPROVED (architecture after 3 drafts, product design after 3 drafts; no unresolved disagreement). Phase choice passed in round 0. Lenses: buy-vs-build ledger and operability/DX present and verified against the code via the researcher. Persona journeys end to end: Dana (report, audience, amend-or-remove then run), Marcus (status, decisions, repairs, verbatim), Priya (JSON, schema, events). Repair visibility stays visibility-only. Residual notes for assembly: owner-facing decisions "assumed, not human-confirmed" labels must be kept; the mock needs scriptable usage for non-zero cost tests (SHOULD tier).
