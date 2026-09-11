# Review log: close-interface

## Selected phase (derived) — team-lead, 2026-09-11

**Selection:** Roadmap Item 6, Close Interface
(`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`).

**Rationale:**
- Items 1 to 5 are complete; Item 6 is the next roadmap item marked `ready-to-spec`
  whose only dependency (Item 3, single-surface state machine) has shipped.
- The ideas pool (`.autoloop/ideas/`) is empty, so no idea seeds this; the roadmap and
  the backlog sections of shipped specs ground it instead.
- Two shipped specs explicitly defer to it: the state machine ships a no-op
  `CloserPort` ("Item 6 builds real closers"), and triage-and-router lists "Real
  closers and what `retry_close` actually does (Item 6). The `CloseRepairBrief` is
  persisted, not threaded" under what it does not include.
- Persona value: today an accepted task is gated but nothing happens to the work.
  A project owner cannot get accepted work merged or turned into a PR; this is the
  step that makes a harness run produce something usable.
- Non-duplicate: no `*close*` design spec exists. The `CloserPort` contract and the
  CLOSING / close-triage routing already exist and are built on, not respecified.

**Intended shape (to be refined by the product-designer, gated by the critic):**
- MUST: a closer registration/resolution seam mirroring gate resolution; built-in
  merge-back and commit-to-branch closers selectable by configuration alone;
  idempotence under replay (crash between accept and close); close failure routed
  to close-triage with `retry_close` actually re-running the closer (with the
  `CloseRepairBrief` available to it); non-accept terminals invoke the closer as
  fire-and-log teardown; "writing a closer" guide with the reference closer as example.
- SHOULD: open-PR closer (buy: `gh` CLI, not a hand-rolled API client).
- COULD: to be decided.
- Non-goals: CLI (Item 8), declarative project configuration file (Item 9),
  multi-surface merge serialisation (Item 10), reporting (Item 11).

**Minimum scope:** not supplied; the MUST tier is the derived minimum scope
(assumed, not human-confirmed).

---

## Critic reviews

### product-design.md — round 1 — APPROVED

Verified every in-repo factual claim spot-checked against source: `src/surface.ts`
(`closing`, `terminate`, resume `CLOSED` branch), `src/router.ts`, `src/triage.ts`
(`legalVerdicts`), `EscalationPacket`'s five fields in `src/triage-role-config.ts`,
and the two docs quotes on the close interface and docker-teardown
(`docs/single-surface-control-flow.md`, `docs/provisioning.md`). All accurate.

Scope discipline: every MUST traces to a named persona (Priya: seam + guide;
Dana: merge-back/commit-to-branch by config; Marcus: legible close-failure
packet). No orphan MUST, no gold-plating — the one extension past the
review-log's literal MUST wording (real `git worktree remove` teardown on
ESCALATED/ABORTED, not just "the call happens") is justified: without it the
roadmap's own fire-and-log success criterion has no observable effect, and the
extension is minimal (one git call, branch kept). Dana's primary journey
(accepted work → merged or committed, plain-prose detail) completes
end-to-end without needing the SHOULD-tier open-PR closer.

Buy-vs-build lens: satisfied — `execFile` over `execa`/`simple-git`/
`isomorphic-git`, `gh` CLI over Octokit, both with alternatives named and
rejected against repo precedent (`research.md` §4.4, §6).

Operability/DX lens: satisfied — local-run story for merge-back/commit-to-
branch (real scratch git repo, no mock needed), open-PR tests skippable
without `gh`, the missing git/gh mock is stated as a known gap rather than
hidden, no new deploy target.

No revisions requested.

### architecture.md — round 1 — REVISE

Verified citations against source: `src/provision.ts` (`resolveBaseRef`,
`provisionWorktree`'s unconditional teardown-then-recreate), `src/case-file.ts`
(`setOnce`/`setBaseline`/`deriveStateFromEntry`/`closeState`), `src/triage.ts`,
`src/router.ts`. All accurate.

Two findings:

1. **Load-bearing idempotency bug.** `merge-back` and `commit-to-branch`
   (§5.1, §5.2) call `ensureCommitted(ctx.worktreePath, ...)` as their first
   step, before their own idempotency detect-then-skip check — but a
   successful prior run removes `ctx.worktreePath` in cleanup. A crash after
   full cleanup but before the surface's own `close` entry is durably written
   (the exact window `research.md §3.4` names, mirroring
   `src/surface.ts:716-721`'s own handling of it at the surface level) means a
   resumed `closing()` re-invokes the same closer against a now-nonexistent
   worktree — `ensureCommitted`'s `git add -A` fails instead of reporting
   `DONE`. The idempotency test plan described in §10.2 only exercises the
   *other* crash window ("crashed after merge, before worktree removal") and
   would not catch this. Fix: run the detect-then-skip check before touching
   the worktree (reorder merge-back's steps 1/2; add an equivalent check to
   commit-to-branch).

2. **Contradicts the already-approved product-design.md.** §5.4 has all
   built-in closers no-op on `ESCALATED`/`ABORTED` (worktree left in place),
   citing the orphan-collection deferral to Item 10. product-design.md's MUST
   tier (approved above) explicitly requires real `git worktree remove` on
   these outcomes, reasoning that a no-op teardown leaves the roadmap's
   fire-and-log success criterion unobservable — and that the Item 10
   deferral covers crash-window orphans, not the normal invoked-closer case.
   §5.4 needs to align with the approved MUST tier, or the disagreement needs
   to go back to the product-designer explicitly rather than being resolved
   unilaterally in the architecture doc.

Minor: §4's `setBaseBranch` snippet references an undefined `parsed`
variable (should be `baseBranch` — a plain string, nothing to parse).

Resolution-seam divergence (§3), `baseBranch` pinning (§2/§4), the
plugin-loader extraction (§8), security (§9), and both lens sections (§12
buy-vs-build, §13 operability/DX) are sound.

### architecture.md — round 2 — APPROVED

Both round-1 findings resolved correctly:

1. §5.1/§5.2 reordered so the idempotency check (ancestor-check for
   merge-back, worktree-existence for commit-to-branch) runs before anything
   touches `ctx.worktreePath`. The worktree-before-branch cleanup sub-ordering
   is reasoned through explicitly so "branch gone" always implies "worktree
   gone," closing the ambiguity. §10 gained the exact regression test for the
   crash-after-full-cleanup window. The one residual gap called out (a crash
   strictly between the two cleanup sub-steps, leaving one harmless orphaned
   branch) is honestly bounded, not swept under the rug.
2. §5.4 rewritten to match product-design.md's approved MUST tier: all three
   built-ins perform real `git worktree remove` (branch kept) on
   ESCALATED/ABORTED via a shared `teardownWorktree` helper. The Item 10
   orphan-sweep distinction (no-owning-case-file worktrees vs. a terminal
   surface whose own closer is invoked) is now stated correctly in the doc.

`parsed` typo fixed. Both artefacts are now APPROVED — task #4 complete.

