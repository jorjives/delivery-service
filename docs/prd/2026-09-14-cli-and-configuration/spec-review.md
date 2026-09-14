# Spec review: CLI and Configuration (compiled design)

**Reviewer:** spec-reviewer (independent pass, first review of the compiled document).
**Target:** `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md`, compiled
from `docs/prd/2026-09-14-cli-and-configuration/product-design.md` and `architecture.md`.

## Method

Applied `critiquing-a-design-spec`: ownership, claim truth, interface fit, contradiction,
ambiguity that forks the build, missing decisions, coverage, YAGNI/scope. In addition:

- Read the compiled spec against both source artefacts for anything assembly dropped,
  contradicted, or duplicated beyond the recorded "Assembly resolutions".
- Checked the buy-vs-build ledger and the Operability/DX decisions from both source
  documents survived into the compiled spec.
- Checked every code citation (file:line) against the actual source in this worktree.

## Code citations — all verified

Checked against source: `src/agent-invoke.ts:22-27,164-170`, `src/command-gate.ts:26-30,71-72,78-82`,
`src/provision.ts:44-58`, `src/surface.ts:14-24,725-767,774-781`, `src/case-file.ts:57-81,414-434`,
`src/triage-role-config.ts:29-36`, `src/escalation-packet.ts:62-95`, `src/mock-session.ts:9-13,36-43`,
`src/resolve-closer.ts:21-38`, `src/role-config.ts:65-99`, `src/schema.ts:31-34`, `src/index.ts:16`,
`src/ports.ts` (`SurfaceLocation`), `package.json`, `tsconfig.json`, `vendor/claude-mock/package.json`,
`vendor/README.md`, `docs/personas.md` (git history confirms the Dana goal-extension paragraph
was in fact added by this run, matching the spec's claim).

Every citation checked out accurate — line numbers, quoted behaviour, and quoted prose all
matched the current source. No fabricated or stale citations found.

## Assembly diff (spec vs. the two approved artefacts)

Checked the eleven recorded "Assembly resolutions" against both source documents and found
each one applied correctly and consistently throughout the compiled spec (progress wording,
non-TTY behaviour, flag names, escalation output, budget shape, `.gitignore` handling,
worktree location, dirty-tree handling, resume/run-id collisions, `init` prompt library,
mock routing — in particular, `--mock` as a public flag is fully purged; every remaining
`mock`/`claude-mock` reference in the compiled spec is the contributor-only test seam).

One gap found beyond the recorded resolutions, now fixed directly (non-blocking):

- **`status --all` was specified in Scope (SHOULD 11) and referenced in the Error model
  table's `FileNotFound` guidance, but the Command surface section's `delivery status`
  line never mentioned the flag** — an internal coverage gap in the compiled document
  itself, present in neither source doc's command-surface section either, so this wasn't
  a resolution assembly should have recorded; it's a synthesis omission. Fixed by adding
  `[--all]` to the `delivery status` command line with a one-clause description.

No other drops, contradictions or duplications found. The buy-vs-build ledger (build
output, argument parsing, config discovery, config validation, `init` prompts, terminal
progress, release automation, default budgets, default gate/closer inference, preflight,
error mapping, worktree location) and the Operability/DX section both carried forward
intact from the architecture document, with the `init`-prompts and mock-routing rows
correctly updated to reflect the assembly resolutions.

One point noted but not treated as a defect: the product design's buy-vs-build note on
argument parsing leaned towards "no library" citing estate precedent, while architecture
chose `commander`. This isn't a contradiction requiring a resolution entry — product
design explicitly deferred the choice ("this is an architecture-level call... whatever
mechanism delivers that with the least code wins"), and architecture's ledger entry
directly rebuts the "no close analogue" precedent (the estate's other CLIs have only
one or two flags per command, unlike this one's four subcommands each with their own
flags). Sound and already justified in the spec; no action needed.

## Structural checks (ownership, contradiction, coverage, ambiguity, YAGNI)

No blocking findings. Notable points checked and found sound:

- **Ownership** is unambiguous throughout: preflight lives in the CLI, not the library;
  config schema is CLI-layer `zod` composing library schemas; `.delivery/.gitignore`
  self-ignoring is CLI-owned and never touches the user's own `.gitignore`; the case-file
  directory convention and worktree-path convention are each owned exactly once.
- **Claim truth**: "no new library API is needed beyond `DEFAULT_BUDGETS`" is honest about
  its one exception rather than silently contradicted by the `DEFAULT_BUDGETS` export
  described a few paragraphs earlier.
- **Interface fit**: the CLI's `DeliveryConfig` schema composes `TaskDef`/`GateRef`/
  `CloserRef` from `src/schema.ts` rather than re-describing them, and `resolveCloser`'s
  signature matches how the compiled spec calls it.
- **Exit codes** are stated twice (Command surface / Error and warning states, and the
  Error model table) and agree in both places.
- **Contradiction check** against the two individually-approved artefacts found none
  beyond the recorded resolutions (see Assembly diff above).
- **YAGNI/scope**: MUST/SHOULD/COULD tiering is applied consistently; nothing in the
  architecture section builds ahead of its scope tier (e.g. terminal progress stays a
  line renderer, no spinner/task-list pre-empting Item 11).
- **Missing decisions**: the open questions section correctly holds genuine unresolved,
  human-gated items (licence, default budget values, non-npm gate inference, stored-login
  credential detection) rather than deferring anything that would change the shape of the
  system if left for a plan to decide.

## Verdict

No blocking findings. One non-blocking coverage gap found and fixed directly in the spec
(`status --all` now named in the Command surface section). The compiled document is a
faithful, internally consistent assembly of the two approved source artefacts, and its
code citations are all accurate.
