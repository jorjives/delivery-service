# Review log — cli-and-configuration-design

Autonomous run `20260914T200704Z` (design-team-auto). No human reviewed this run.

## Selected phase (derived)

**Phase:** Roadmap Item 8, CLI and Configuration: make the delivery harness a tool rather
than a library. A user installs one package, points it at a repo with a gate, a closer and a
task, and gets a completed single-surface run (or a structured escalation), with progress in
the terminal and resume after a crash.

**Discovery survey (team-lead):**

- Roadmap `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`: Items 1-7 are
  marked complete with specs. Item 8 (detail level `brief`) is the next item in sequence; its
  dependencies (Items 2, 3, 6) have all shipped. The roadmap calls it "the adoption gate.
  Everything before this item is usable only as a library; this item makes it a tool."
  Items 9, 11, 12, 13 all depend on it directly or transitively.
- Existing specs' non-goals repeatedly defer to Item 8: agent-invocation ("A CLI or
  project-level configuration surface for registering `role_cfg`"), triage ("CLI surfaces for
  inspecting triage output"), close interface ("A CLI for registering closers or inspecting
  close outcomes"), agent mock ("A CLI"; "Making the mock reach consumers of a future
  published harness package (the Items 8/9 residual)").
- `seeded_by`: only `2026-09-13-agent-mock-design.md` draws on the ideas pool (the AgentPort
  cast idea). No spec covers CLI, packaging, or release.
- Ideas pool (two files): `50-20260913T211119Z-choose-a-licence-before-open-sourcing.md` bears
  directly on Item 8 (packaging and publishing force the licence decision; no `LICENSE`, no
  `license` field). It seeds this phase. The AgentPort-cast idea is already consumed by Item 7
  (`fakeAgentPort` in `src/testing.ts`) and is set aside.
- Current state: `package.json` is `delivery-service@0.0.1`, no `bin`, no `license`, no
  `files`/`exports`; `src/index.ts` exports a library API (`run`, `advance`, gate/closer
  factories and resolvers, case-file functions); demos invoke it via `tsx`. No CLI exists.

**Why now / what it unblocks:** no user can run the harness today without writing TypeScript
against `src/index.ts`. Every later item (project configuration, reporting, packs,
scheduling) presumes an invocable tool.

**Personas:** Priya Shah (Harness Extender) and Dana Okafor (Non-technical Project Owner)
from `docs/personas.md`. Item 8's roadmap accessibility note makes Dana the first-touch user
("a user who runs the tool with a repo and a task description, and nothing else, should get
a working run with a built-in gate and closer"). Marcus Webb reads escalation output a run
produces.

**Constraint the team must respect (autonomous run):** choosing a licence and performing a
first publish to a public registry are outward-facing, legally significant, hard-to-reverse
decisions no human has sanctioned. The design may make the package publish-ready and describe
the release process, but must not select a licence on the operator's behalf; it records the
licence choice as an open question gating first publication.

**Intended shape (team to verify and refine):**

- MUST (derived minimum scope, assumed, not human-confirmed): an installable package exposing
  a CLI binary; start a single-surface run against a repo with a gate, a closer and a task,
  supplied by config file and/or flags; sensible defaults so repo + task alone yields a run
  with a built-in gate and closer (or a plain-language explanation of the one missing thing);
  terminal progress reporting; resume a crashed run from the CLI; plain-language errors that
  do not assume harness vocabulary; a sample project and getting-started guide tested by
  executing its own instructions; semver + changelog; publish-readiness gated on a licence.
- SHOULD/COULD: interactive `init`; machine-readable (JSON) output mode; inspecting an
  escalation packet / case file from the CLI.
- Non-goals: Item 9's declarative project configuration surface and natural-language task
  structuring; multi-surface (Item 10); reporting dashboards (Item 11); packs (Item 12);
  scheduling (Items 13/14); choosing the licence or performing the first public publish.

## Critic: phase-choice verdict

**Verdict: sound. Proceed.**

Checked against the roadmap and existing specs directly (not just the team-lead's survey):

1. **Sequence correctness** — confirmed Items 1–7 are marked complete with specs in
   `docs/superpowers/specs/`, and Item 8's stated dependencies (Items 2, 3, 6) are all among
   them. Item 8 is genuinely next, not a skip-ahead or a pivot.
2. **No duplication** — grepped the existing specs' non-goals; agent-invocation, triage, close
   interface and agent-mock all explicitly defer CLI/packaging concerns to Item 8, and none of
   them claim any part of it. No existing spec covers CLI, packaging or release.
3. **Not scope-starved to a single slice** — the derived MUST set (installable CLI binary,
   config via file/flags, defaults good enough for repo+task alone, terminal progress, resume,
   plain-language errors, sample project + self-tested getting-started guide, semver +
   changelog, publish-readiness) matches the roadmap item's own success criteria and DX/
   accessibility notes essentially one-for-one. It is not trimmed down to e.g. "just a CLI
   binary with no defaults" — that would have been scope-starved. Nor does it reach into Item
   9 (declarative project configuration, natural-language task authoring — explicitly a
   non-goal here and rightly so, since Item 9 depends on Item 8), Item 10 (multi-surface),
   Item 11 (reporting dashboards), or Items 12–14 (packs/scheduling). Boundary is a clear line,
   not the smallest possible one.
4. **Licence constraint honoured** — the phase note correctly treats licence choice as an open
   question gating first publication, not a decision for this phase, matching the hard
   constraint in the brief. Publish-readiness (packaging, changelog, semver) is in scope;
   actually publishing to a public registry is correctly excluded.
5. **Factual claims verified against the repo**: `package.json` confirmed at
   `delivery-service@0.0.1`, no `bin`, no `license` field, library-style `scripts` only (no CLI
   entry point). Personas Priya Shah, Dana Okafor and Marcus Webb confirmed present in
   `docs/personas.md` with the roles the phase note ascribes to them.

No REVISE needed on the phase choice. Proceeding to review product-design.md and
architecture.md drafts as they land.

## Round 1: product-design.md and architecture.md

Both drafts read against the roadmap, personas.md, research.md, and the source files they
cite (spot-checked line numbers in `src/errors.ts`, `src/surface.ts`, `src/case-file.ts`,
`src/role-config.ts`, `src/command-gate.ts`, `src/resolve-closer.ts`, `src/agent-invoke.ts`,
`src/schema.ts`, `src/plugin-loader.ts`, `src/escalation-packet.ts`, `src/mock-session.ts`,
`vendor/claude-mock/package.json`, `vendor/README.md`, `.github/workflows/ci.yml`,
`tests/testing-your-pipeline-guide.test.ts`, `tests/helpers.ts`). Every checked citation
matched the source exactly — both authors clearly read the code rather than guessed. No
unverified factual claim found; research.md's buy-vs-build library facts (commander,
oclif, cosmiconfig, clack, changesets) carry direct external citations that match this
critic's own knowledge, so none were escalated to the researcher this round.

**Verdict: REVISE both.**

### product-design.md — REVISE

1. **Internal inconsistency — case-file directory path.** Journey 1 (step 4) and journey 3
   (step 3) both say `.delivery-service/runs/<slug>/`; the Defaults section says
   `.delivery/runs/<surface-id>/`. Pick one and use it everywhere in this document.
2. **Value-starvation — Dana's and Marcus's "checking in later" journey may not be
   deliverable at MUST tier.** Journey 4 has both personas reading an escalation "later," with
   no context and (per their own persona descriptions) no reason to assume a live terminal is
   still attached. Dana has no harness vocabulary and cannot hand-read `case.json`; Marcus's
   persona is explicitly "arrives with no context." But the only CLI capability that reads a
   finished run's outcome/escalation packet after the fact (`status`/`show`) is marked
   SHOULD-tier, not MUST. As written, a MUST-only build gives Marcus and Dana no way to
   complete this journey through the CLI at all. Per the brief: a persona who cannot complete
   their primary journey end-to-end is REVISE regardless of how lean the MUST tier looks.
   Either promote a minimal "print the terminal outcome / escalation packet for the most
   recent (or named) run" capability to MUST — it need not have `show`'s full richness — or
   explain concretely why this journey is achievable without it (e.g. if the CLI is expected
   to always run under a persistent, re-attachable session/log by convention; that assumption
   isn't stated anywhere in the doc today).
3. **Minor — flag-naming inconsistency.** The Command surface section's illustrative
   `--gate <ref>` / `--closer <ref>` flags aren't reconciled with the Error states table's
   `--gate-command "npm test"` example. `GateRef`/`CloserRef` are structured (discriminated
   union) types, not flat strings, so "a flag" for them needs at least a sketch of shape
   (one flag per common field, e.g. `--gate-command`/`--gate-parse-mode`, vs. a single
   generic `--gate <ref>` that would need its own mini-syntax). Not blocking on its own, but
   worth a sentence so the architect isn't left inventing the flag surface.

### architecture.md — REVISE

1. **Dangling cross-reference — case-file directory default undefined.** §3 and §6 (step 2)
   both point to "§5" for the case-file directory / `SurfaceLocation` default, but §5
   ("Defaults") only covers Gate, Closer, Budgets, Role configs, and Task — it never actually
   states a case-file directory convention or default path. Add it, and align the literal
   value with product-design.md once finding (1) above is resolved there.
2. **Unauthorised scope — the `roles` field in `DeliveryConfig` (§4).** product-design.md
   fixes the CLI config schema at exactly four top-level keys (`gate`/`closer`/`budgets`/
   `task`) and is explicit that "Item 8 must not invent a config format Item 9 would need to
   migrate away from." §4 adds a fifth key, `roles`, plus a new `RoleConfigOverride` type that
   lets a config file override `systemPromptFragment` and `allowedTools`. Overriding the
   domain system-prompt fragment from configuration is Item 9's own stated roadmap turf ("The
   domain system-prompt fragment... can be authored and previewed before a run" is Item 9's
   success criterion, not Item 8's). No journey or persona need in product-design.md calls for
   a role-config override in this phase — Priya's journey (§2, extender) only covers
   gate/closer module registration. Either drop `roles` from this phase's schema entirely, or
   get explicit product sign-off tying it to a concrete persona need in this phase, and update
   the Coordination record — which currently states "no open disagreement" with the
   product-designer, which is no longer accurate if this stands.

Sent to product-designer and architect via SendMessage. Awaiting round 2.

## Round 2: architecture.md re-review

Architect fixed both round-1 findings, verified directly against the file:

1. §5 now has a "Case-file directory" entry (`<repoPath>/.delivery/runs/<surfaceId>/`) that
   resolves the §3/§6 "see §5" cross-references.
2. `roles`/`RoleConfigOverride` removed entirely from `DeliveryConfig`; schema is now exactly
   the four keys product-design.md fixes (`gate`/`closer`/`budgets`/`task`) plus `dir` as a
   pure filesystem-location override. A new paragraph explains the exclusion and cites Item
   9's roadmap text as the reason it's out of scope here.

architecture.md is provisionally clear pending confirmation that product-design.md's round 2
settles on the same case-file directory value (`.delivery/runs/<surfaceId>/`) — that document
had two conflicting values in round 1; architecture.md has picked one and is internally
consistent, but final APPROVED on architecture.md waits on that cross-document check.

## Round 2: product-design.md re-review

All three round-1 findings verified fixed directly in the file:

1. Case-file directory path is now `.delivery/runs/<surface-id>/` consistently throughout
   (journeys 1/3, Defaults, MUST 10) — matches architecture.md's §5 value exactly.
2. New MUST 10: a minimal `delivery status [<surface-id> | --last]` printing a finished run's
   outcome, or the `EscalationPacket` verbatim if escalated — one run, plain text, no listing,
   no `--json`. Reasoning is sound and directly answers the round-1 finding: both Marcus and
   Dana are described in personas.md as arriving after the fact with no live terminal, and
   neither can be expected to hand-read `case.json`. SHOULD 11 (renumbered) now correctly
   scopes down to just the scale/scripting add-ons (`--json`, listing all runs). Journey 4 was
   rewritten to point at MUST 10 directly.
3. Flag shape reconciled: `--gate-command` (shorthand for the default command-type GateRef)
   and `--closer <built-in-type>` (bare type name), with an explicit statement that `custom`
   gates/closers, non-default parse modes, and `merge-back`'s `deleteBranch` are config-file
   only. Consistent across Command surface, journey 2, and the error table.

**Verdict: APPROVED — product-design.md.**

Cross-document check: architecture.md (round 2, already re-reviewed and provisionally clear)
uses the identical `.delivery/runs/<surfaceId>/` value and the identical four-key
(`gate`/`closer`/`budgets`/`task`) config schema. No remaining cross-document gap.

**Verdict: APPROVED — architecture.md** (the one open item from architecture.md's round 2 —
matching product-design.md's directory value — is now confirmed).

Both artefacts for task #4 are APPROVED. Notifying main.

## Team-lead: assembly

Assembled `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md` from the two
approved artefacts. Eleven cross-document disagreements or gaps were resolved at assembly and
are recorded in the spec's "Assembly resolutions" section: progress wording, non-TTY output,
flag names, escalation output, budget config shape, `.gitignore` handling, worktree location,
dirty-tree behaviour, resume with a different task, the `init` prompt library (changed to the
estate's `@inquirer/prompts`), and mock routing. Handed to a fresh spec-reviewer (task #6).
