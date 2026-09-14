# Personas

**Status: team-derived and assumed, not human-confirmed.** No `docs/personas.md`
existed before this run. These personas were inferred by the design team
(`triage-and-router-design`, autonomous run `20260910T141630Z`) from the roadmap's
two-audience framing (`docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`)
while designing Item 5 (Triage and Deterministic Router). No human has ratified
them. Future runs and specs inherit this file as a working assumption — treat it
as a first draft to correct, not a settled fact, and update it in place if a later
phase's evidence contradicts it rather than forking a second personas file.

Grounding: the roadmap names two audiences throughout — "harness extenders" (engineers
wiring gate/closer/agent config) and "non-technical project owners" (people who use
the harness to deliver work but do not read source or `role_cfg`). Triage's two
output artefacts (`SharpenedBrief`, `EscalationPacket`) and its two-tier packet
readership (roadmap Item 5 MUST vs. COULD, see `docs/prd/2026-09-10-triage-and-router/review-log.md`)
split the "human reads an escalation" audience into two distinct people with different
literacy and different jobs-to-be-done, which is why there are three personas below,
not two.

---

## 1. Priya Shah — Harness Extender

**Context**: A backend engineer integrating the delivery harness into her team's
service repo. She has already written a gate and (once Item 6 ships) a closer for
her project. She is comfortable with TypeScript, zod schemas, and reading a design
doc, but she does not want to read `src/*.ts` to get a role working — that is the
harness's job to make unnecessary, per `docs/configuring-a-role.md`'s existing
"no source-reading" bar for the worker and gate-maintenance roles.

**Primary goal**: Wire a triage `role_cfg` for her project (or accept the shipped
reference one unmodified) and trust that when a worker gets stuck or a gate fails
repeatedly, the harness routes sensibly without her hand-holding each surface.

**What success looks like**: She can point to the reference triage `role_cfg` and
a "configuring triage" guide chapter, understand what triage can and cannot decide
(never overturns a gate, cannot push a completion into a failure), and — when a
surface loops or misbehaves — read the case file's `triage` log entries (verdict +
rationale, per surface state's `Entry` schema) and understand *why* triage made
each call without asking a colleague or reading `src/triage*.ts`.

---

## 2. Marcus Webb — On-call Engineer (technical triage reader)

**Context**: A senior engineer on rotation who gets pulled in when a surface
reaches `ESCALATED`. He did not write the task, the gate, or the triage config for
this particular project — he is triaging someone else's run, often at short notice,
often for a project he has only partial context on. He is technical (can read a
diff, a stack trace, a gate assertion ID) but has zero patience for reconstructing
what already happened from raw session transcripts.

**Primary goal**: Given an `EscalationPacket`, decide what a human must do next
(approve a destructive action, provide a credential, fix a systemic problem the
harness can't) *without* first reading every prior attempt's transcript.

**What success looks like**: The packet alone tells him the decision he must make,
the evidence behind it (verbatim gate failures, not paraphrase), what already failed
and why (`dead_ends`, carried into the packet the same way it feeds a `SharpenedBrief`,
per `docs/single-surface-control-flow.md` §Triage), and where to go for more
(`session_key` references) if the packet genuinely isn't enough. This is the MUST-tier
reader: the packet must be legible to him without a plain-language rewrite.

---

## 3. Dana Okafor — Non-technical Project Owner

**Context**: Runs a small product team and uses the harness to get work done (per
the roadmap's framing of this audience: "may be non-technical," "encounters the
harness only through run output"). She does not read `role_cfg`, gate assertion
IDs, or session transcripts, and would not know what a "budget" or "correction
slot" means without translation. She checks in on runs to know whether something
needs her attention.

**Primary goal**: Look at an escalated run and know, in plain language, whether it
needs her (a decision, an approval, a credential) or whether it's something the
engineering team should look at instead — without learning the harness's internal
vocabulary.

**What success looks like**: A short, jargon-free summary sits at the top of (or
alongside) the `EscalationPacket` stating what happened and what decision is being
asked of a human, in the same spirit as the roadmap's Item 3 DX principle applied
to a non-technical reader. This is the roadmap's COULD-tier ask for Item 5 (full
non-technical authoring/reporting is Item 9/11's build) — Dana's bar today is "the
packet doesn't actively mislead or block her if she's the one who opens it," not
"the packet is written for her by default."

**Goal extension (added by `cli-and-configuration-design`, autonomous run
`20260914T200704Z`, for Item 8 — CLI and Configuration):** the goal above was
written before a CLI existed and only covers Dana *reading* run output. Item 8's
roadmap text promotes her to first-touch user of the tool itself: "The CLI is the
first thing a non-technical user touches... a user who runs the tool with a repo
and a task description, and nothing else, should get a working run." Her primary
goal for this phase is extended to include **starting** a run — she should be
able to install the harness and get a working run from a repo and a task
description alone, with sensible built-in defaults, no config file, and no code.
See `docs/prd/2026-09-14-cli-and-configuration/product-design.md` for the journey
this drives. Her goal of reading escalation output, above, is unchanged.
