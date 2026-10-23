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

**Goal extension (added by `multi-surface-supervisor-design`, autonomous run
`20260926T192253Z`, for Item 10 — Multi-Surface Supervisor; ASSUMED, not
human-confirmed):** Priya's existing goal covers wiring a working `role_cfg` for
one surface at a time. Item 10 asks more: her gate, closer and role configuration
must also behave correctly when several surfaces run at once against her
repository (shared git contention, a serialised merge, a run-level maintenance
budget). She should be able to prove this with the same scripted-agent testing
story she already has (`docs/testing-your-pipeline.md`), extended to script
several surfaces with a controlled interleaving, rather than having to run a real
concurrent session against real infrastructure to find out. Her existing goal (a
working triage `role_cfg`, proven without reading source) is unchanged.

**Goal extension (added by `observability-and-reporting-design`, autonomous run `20261001T131757Z`, for Item 11; ASSUMED, not human-confirmed):** Priya's goals so far cover wiring a working role configuration and proving it under concurrency. Item 11 adds a feedback half: after a run she should be able to see, per task and for the run as a whole, how much of each retry budget was spent and every triage decision with its rationale, so she can tune her gate and role configuration from evidence rather than by reading `log.jsonl` by hand. She should also be able to consume the same facts as versioned, machine-readable output (for her own dashboard or tooling) without parsing prose, and, when a gate-maintenance or shared-environment repair ran, see what it changed in her check. Her existing goals are unchanged.

**Goal extension (added by `task-packs-design`, autonomous run `20261003T130939Z`, for Item 12; ASSUMED, not human-confirmed):** Priya's goals so far are about her own project's gate, closer and roles. Item 12 asks her to be an *author* as well: package a repeatable review (an accessibility audit, an API-contract check) as a pack that her colleagues, or Dana, can run with one command, and prove it works with the scripted-agent story she already has, without a real agent run. She needs the pack format to be small, stable and versioned, and a pack that is malformed to be refused in her terms (which file, which field). Her existing goals are unchanged.


**Goal extension (added by `packs-for-any-workflow-design`, autonomous run `20261023T121423Z`, for pluggable-architecture Item 1; ASSUMED, not human-confirmed: there is no human to ratify this run):** Priya's pack-author goal covers a review (a scan then a fix). Item 1 asks her to author a pack whose workflows are not that shape: several named workflows, each with its own steps, prompts, checks, guards and hold, and to prove it end to end with the scripted agent as she can for a review. Her review packs written in the current format must keep working with no edit. Her existing goals are unchanged.

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

**Goal extension (added by `multi-surface-supervisor-design`, autonomous run
`20260926T192253Z`, for Item 10 — Multi-Surface Supervisor; ASSUMED, not
human-confirmed):** Item 10 adds one escalation shape Marcus hasn't seen before:
the whole run escalating because a shared-environment repair was exhausted, rather
than one surface's task failing on its own. His existing goal (decide what to do
from the packet alone, without reading transcripts) now also requires that packet
to say plainly this is a run-wide environment problem affecting every paused
surface, not a defect in any one task, so he doesn't spend time diagnosing a task
that was never the cause. His existing goal and its success bar are otherwise
unchanged.

**Goal extension (added by `observability-and-reporting-design`, autonomous run `20261001T131757Z`, for Item 11; ASSUMED, not human-confirmed):** Marcus's goal is to decide from the packet alone. Item 11 adds that the packet is not the whole story he needs on a bad night: he should also be able to read, in one place, the triage history that led to the escalation (each round's trigger, verdict and rationale), the retry budgets at the moment it stopped, and, if a repair had run, what it changed, and to watch a run that is still going without attaching to the process that drives it. His existing goal and its success bar (verbatim evidence, no transcripts first) are unchanged.

**Goal extension (added by `task-packs-design`, autonomous run `20261003T130939Z`, for Item 12; ASSUMED, not human-confirmed):** Marcus meets two new things when a pack ran: a finding the fix agent could not resolve, and a security fix held for sign-off. He needs each to say, alongside the owner's plain sentence, the technical detail (file and line, the finding's own check, what the gate saw) so he can judge a held security fix or take over an unfixable finding without re-running the scan. His existing goal and its success bar are unchanged.

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

**Goal extension (added by `project-configuration-design`, autonomous run
`20260917T121214Z`, for Item 9 — Project Configuration; ASSUMED, not
human-confirmed):** Item 8 got Dana a single working run from a repo and a task
description, with no config file. Item 9's roadmap text asks more of her: "a
non-technical project owner can set up a project using only declarative
configuration and built-in components, without writing any code." Her goal is
extended again to cover **authoring and running a small project**, not just one
task: she describes her project in prose, lists a few tasks in her own words,
picks a way to check the work and a way to land it from built-in options, and
can see — before anything runs — what the agent will be told and whether her
setup is complete. She never opens `delivery.config.json` by hand, never sees
the words "worktree", "envelope", "surface" or "role config", and a broken setup
tells her the one thing to fix in her own words, not the harness's. See
`docs/prd/2026-09-17-project-configuration/product-design.md` for the journeys
this drives. Her goals above (first run, reading escalation output) are
unchanged.

**Goal extension (added by `multi-surface-supervisor-design`, autonomous run
`20260926T192253Z`, for Item 10 — Multi-Surface Supervisor; ASSUMED, not
human-confirmed):** Item 9 got Dana a project she describes once and a task
list the harness works through for her, one at a time. Item 10 lets several of
her listed tasks run at once against the same project. Her goal is extended
once more: when several tasks are running together she should still be able to
tell, from the terminal or `delivery status` and without learning new
vocabulary, roughly what is happening to each one — and, if something goes
wrong with the project itself rather than with any one task (the harness's
shared-environment "breaker"), that the whole run has paused itself to fix it,
said in the same plain-language spirit as her existing goals, not "the breaker
tripped to DEGRADED". Her goals above (first run, running a project, reading
escalation output) are unchanged.

**Goal extension (added by `observability-and-reporting-design`, autonomous run `20261001T131757Z`, for Item 11; ASSUMED, not human-confirmed):** Dana's goals so far are starting a run, describing a project, and reading one task's output. Item 11 asks her to come back to a whole list of tasks (often run unattended overnight) and know three things from the first screen, in her own words: what was done and landed, what needs her and what the decision is, and what to do about each one next. She should be able to glance at a run in progress and tell which tasks are working, waiting or stuck, and to keep a durable copy of the summary to read later or forward. She still never needs the words "surface", "budget", "triage", "verdict" or "breaker". Her existing goals are unchanged.

**Goal extension (added by `task-packs-design`, autonomous run `20261003T130939Z`, for Item 12; ASSUMED, not human-confirmed):** Dana's goals so far are starting, describing, running and reading. Item 12 is the roadmap's answer to "what can this tool do for me right now?": she should be able to point the harness at her repository, with no configuration at all, ask for a code review or a security review, and within minutes read a list of problems written for her ("this page shows a customer's details without checking they are logged in"), choose which to have fixed, and come back to a report of what was fixed, what is waiting for her sign-off, and what could not be fixed and why. She never needs to read a finding's file path to understand its risk, never needs words like "CVE", "lockfile" or "authority", and is never asked to approve something she cannot understand: where she is asked to sign off a security fix, the page says in plain words what changed and what the risk was. Her existing goals are unchanged.

**Goal extension (added by `packs-for-any-workflow-design`, autonomous run `20261023T121423Z`, for pluggable-architecture Item 1; ASSUMED, not human-confirmed: there is no human to ratify this run):** Dana's goals so far treat a pack as a review. Item 1 asks her to use a pack for any find-then-act job, starting with keeping her documentation in step with her code: she finds the pack with `delivery packs`, starts it with one command, chooses what to correct, and reads the same report as for a review, in the same plain words. She should learn from the documentation, in its first paragraph, that packs cover more than reviews. Her existing goals are unchanged. See `docs/prd/2026-10-23-packs-for-any-workflow/product-design.md`.
