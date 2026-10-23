# Pluggable Architecture — Roadmap

> **Type:** cross-cutting-change
> **Created:** 2026-10-22

## Context

delivery-service is extended today only by editing a project's own configuration, by
pointing `packs` at a local folder, or by pointing a `custom` gate or closer at a local
module. Nothing can be shared, installed or trusted. People will want to share the packs
they build, and other people will want to extend the harness without us writing every
piece.

This roadmap makes the architecture pluggable in two phases:

1. **Shareable packs (data only).** Broaden what a pack is, then let people inspect,
   install, adapt and publish packs. Packs stay data (prompts, guards, hold policy,
   choices from built-in gates and closers). Sharing data is safe to open up first.
2. **Code plugins.** Settle a trust model, then open the code-bearing extension points
   (custom gates and closers inside packs, scheduler backends, work sources, triggers,
   notifiers, agent backends). Packs gain the ability to reference custom items here.

Success at the roadmap level: a project owner can find a pack someone else wrote, see
exactly what it will do, install it at a pinned version, adapt it to their project and run
it; a stranger can publish a pack the same way; and, in phase 2, an extender can add a
new scheduler backend, work source or gate without changing delivery-service itself.

The phases are not a strict serial gate. Phase 2 starts once packs can be inspected and
installed (Items 2 and 3); Items 4 to 6 can run alongside it.

### Decisions reversed

This roadmap reverses the non-goal of a plugin distribution mechanism (CLI and
configuration spec), and promotes task-packs COULD 23 (package discovery, `delivery packs
add`, trust prompts, packs carrying code) into scope as Items 3, 8 and 9. It keeps the
hosted-registry non-goal (task-packs spec) and the no-runtime-registry decision (gate and
closer specs): discovery goes through an existing package ecosystem, and loading stays
explicit.

### Audiences

As in the harness roadmap: **project owners** install and run packs and should never need
to write code; **extenders** publish packs and, in phase 2, code plugins.

### Prior art in this estate

- `loadPlugin` and `guardMethod` (`src/plugin-loader.ts`) already load and guard
  third-party modules for custom gates and closers. Phase 2 builds on that seam.
- The named-schedules draft spec (`2026-10-21-named-schedules-design.md`, §7) plans a
  scheduler backend port with a contract test suite. That is the pattern later adapters
  follow, as a pattern and not a prerequisite.
- The AI workflow examples (branch `claude/ai-workflow-examples-gaps-40kgns`, not yet
  merged) show many non-review workflows with the find-then-act shape, and name gaps that
  later items address: event triggers, task fields visible to command gates, and a second
  vendor's model. The unmerged branch is a source for Items 1 and 5, not a dependency of
  the roadmap.

### Not in this roadmap

A hosted registry or marketplace; paid or signed distribution; plugins that change the
state machine itself. Whether third-party code is contained at all is decided by Item 7.

---

## Phase 1: Shareable packs

### Item 1: Packs for any workflow

**Status:** ✅ Complete — 2026-10-23 — spec: `docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md`
**Spec:** `docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md`
**Delivers:** A project owner can use a pack for any find-then-act job, such as a
dependency upgrade, a migration sweep or a docs-drift check, not only a code or security
review.

**Success criteria:**
- A new user can tell from the documentation that packs cover more than reviews.
- A pack can define workflows other than a scan followed by a fix, each with its own
  prompts, guards and hold policy.
- At least one built-in pack that is not a review ships and can be run by a project owner.
- Existing review packs, and projects that name them, keep working unchanged.

**Dependencies:**
- Review packs can be selected and run from project configuration (exists today)

**Detail level:** brief

**Constraints:** Packs remain data only in this phase.

**Notes:** The pack format is strict and shaped around scan and fix, so its version will
change; the spec decides how old packs are read. The name "pack" is kept. The AI workflow
examples are the source for the first non-review packs and their tests, once that branch
merges. The built-in non-review pack should run end to end against the scripted agent.

---

### Item 2: Inspect a pack before trusting it

**Delivers:** A project owner can see exactly what a pack will tell the agent to do and
what it is allowed to touch, before it is installed or run.

**Success criteria:**
- Before installing or running, the owner can see a pack's workflows, full prompts,
  guards, hold policy, and the gates and closers it selects.
- Anything that widens what an agent may do beyond the project's own defaults is flagged.
- A pack that carries something the format does not name is refused with a plain
  explanation.
- A project owner who did not write the pack can say, from the output alone, what it will
  do.

**Dependencies:**
- Packs can describe workflows of any shape (Item 1)

**Detail level:** brief

**Notes:** A pack is prompts that run with the agent's powers, so prompt injection is the
real risk of sharing. Inspection is the first control and comes before install.

---

### Item 3: Install a pack from elsewhere, pinned

**Delivers:** A project owner can add a pack published by someone else and get the same
pack on every machine and every run.

**Success criteria:**
- A pack can be added from a public source, not only a local folder.
- The version is recorded, and later runs use that version until the owner deliberately
  updates it.
- The owner sees what changed when updating a pack.
- A pack that has changed since the owner approved it is refused until they approve the
  change.
- Two packs that define the same workflow name are reported plainly, as for local packs.

**Dependencies:**
- A pack can be inspected before it is trusted (Item 2)

**Detail level:** brief

**Constraints:** Discovery uses an existing package ecosystem; no registry is hosted.

**Notes:** Task-packs COULD 23 already sketches this (a `delivery-pack` package field,
`delivery packs add`, trust prompts). Start from it.

---

### Item 4: Adapt a shared pack to my project

**Delivers:** A project owner can make a pack written for someone else's project work in
theirs, without editing or forking the pack.

**Success criteria:**
- A pack can declare settings it needs, such as the test command, the file layout or the
  hold severity, with defaults.
- The owner supplies values in the project's configuration, and an unset required setting
  is refused with a message naming it.
- The values reach the pack's prompts and checks.
- Inspection (Item 2) shows the settings and the values that would apply.

**Dependencies:**
- Packs can describe workflows of any shape (Item 1)
- A pack can be inspected before it is trusted (Item 2)

**Detail level:** brief

**Notes:** Settings are part of the pack format, so they are designed with Item 1's format
change and not as a second one. The AI workflow research found that examples need task
fields, such as a file or package name, visible to command gates; this item decides whether
settings and task fields share one mechanism. If they do, this removes the commonest reason
for a custom gate (see Item 9).

---

### Item 5: Publish a pack

**Delivers:** An extender can write, test and publish a pack that others can install.

**Success criteria:**
- An extender can start a new pack from a working starting point.
- An extender can check a pack, and see it work end to end, before publishing it.
- The documentation walks through writing and publishing a pack, using the non-review
  built-in as a worked example.
- A published pack installs (Item 3) with no extra steps.

**Dependencies:**
- A pack can be installed from elsewhere (Item 3)
- A pack can declare settings (Item 4)

**Detail level:** brief

**Notes:** Built-in packs already ship `fixtures/`; this item makes that the contract for
everyone. Start from `docs/writing-a-pack.md` and confirm what it already covers; no
scaffold or validate command exists today.

---

### Item 6: Editor support for project configuration

**Delivers:** A project owner gets completion and errors for `delivery.config.json` in their
editor before running anything, including settings that packs contribute.

**Success criteria:**
- The editor offers completion and flags unknown keys or wrong values in the project
  configuration.
- The editor's complaints match what `delivery validate` reports.
- Settings contributed by the packs the project names are included.

**Dependencies:**
- A pack can declare settings (Item 4), for the last criterion only

**Detail level:** brief

**Notes:** The first two criteria need nothing else and can land at any time. Packs and
reports already generate a machine-readable schema; the project configuration is validated
only by its in-code definition.

---

## Phase 2: Code plugins

### Item 7: Know what a plugin can do before enabling it

**Delivers:** A project owner can see what a code plugin is able to do, and decide whether
to run it.

**Success criteria:**
- Before enabling a plugin, the owner sees which parts of delivery-service it extends and
  what access it needs.
- The documentation states plainly how far third-party code is contained, and what the
  owner is trusting when they enable one.
- A plugin that needs more access than its declaration is stopped, and the owner is told
  which plugin.

**Dependencies:**
- A pack can be inspected before it is trusted (Item 2)

**Detail level:** brief

**Notes:** Whether to contain third-party code at all, given the existing sandbox, is the
central decision of this spec and gates every later item in this phase.

---

### Item 8: Install and enable plugins

**Delivers:** A project owner can add a code plugin pinned to a version, enable it
deliberately, and stay safe when it misbehaves.

**Success criteria:**
- Installing a plugin does not run it; it is enabled explicitly, per project.
- The version is recorded, and updating shows what changed.
- A plugin built for an incompatible version of delivery-service is refused with a clear
  reason.
- A plugin that fails to load, or breaks its contract during a run, is reported by name and
  the run carries on, as it does for custom gates and closers today.

**Dependencies:**
- A pack can be installed from elsewhere, pinned (Item 3)
- The owner can see what a plugin can do before enabling it (Item 7)

**Detail level:** brief

**Constraints:** Builds on how custom gates and closers are loaded today.

---

### Item 9: Packs that carry custom gates and closers

**Delivers:** An extender can publish a pack that includes its own check or its own way of
landing work, and a project owner can install it as one thing.

**Success criteria:**
- A pack can reference a custom gate or closer shipped with it.
- Installing such a pack shows the code, requires explicit enabling and records a pinned
  version.
- A pack with no custom items stays data only and needs no enabling.
- Inspection shows which workflows depend on custom code.

**Dependencies:**
- Plugins can be installed and enabled (Item 8)

**Detail level:** brief

**Notes:** Re-scope or defer this item once Item 4 ships, based on how many surveyed
examples still need custom code; Item 4 may remove the commonest need.

---

### Item 10: Schedule runs on any operating system

**Delivers:** A project owner on macOS or Windows can schedule recurring runs, and an
extender can add a scheduler for another platform without changing delivery-service.

**Success criteria:**
- Named schedules work on a second operating system's scheduler.
- An extender can add support for another operating system's scheduler, and it behaves the
  same as the built-in one.
- The new scheduler is delivered as a plugin.

**Dependencies:**
- Named schedules exist with a scheduler backend port (the named-schedules draft spec)
- Plugins can be installed and enabled (Item 8)

**Detail level:** brief

**Notes:** The pilot adapter. Its shared contract test suite is the pattern Items 11, 13
and 14 follow where it helps. Harness roadmap Item 13 is the user-facing schedule feature;
this item adds the second backend only.

---

### Item 11: Bring work in from any tracker

**Delivers:** A project owner can work from Linear, Jira or another tracker by installing a
source, and can have outcomes raised back there.

**Success criteria:**
- An extender can add a new tracker, and it behaves the same as GitHub for bringing in
  work.
- GitHub, backlog, list and command sources keep working unchanged.
- Raising a follow-up and reporting an outcome go back to the same tracker.

**Dependencies:**
- Plugins can be installed and enabled (Item 8)

**Detail level:** brief

**Notes:** Sources are a closed set and the tracker is entangled with the GitHub source.
The first spec may deliver only the separation, with GitHub as the one source behind it.

---

### Item 12: Runs remember their history anywhere

**Delivers:** A project owner running delivery-service from a short-lived machine, such as
a CI job, keeps the history of earlier attempts and parked work.

**Success criteria:**
- A run started on a fresh machine knows which items have been tried, parked or landed.
- Running the same project from two machines does not lose or duplicate that history.
- Existing local use is unchanged.

**Dependencies:**
- None

**Detail level:** brief

**Notes:** This history lives on one machine today. The AI workflow research names it as a
prerequisite for running in CI. It is split out because it is useful without any plugin.

---

### Item 13: Start runs from events

**Delivers:** A project owner can start a run when something happens, such as a pull request
opening, a comment, a failed check or a merge, not only from the command line or a timer.

**Success criteria:**
- An extender can add a new kind of event trigger as a plugin.
- A run started by an event remembers its earlier attempts and parked state (Item 12).
- The outcome can be sent back to the source the request came from.

**Dependencies:**
- Plugins can be installed and enabled (Item 8)
- Runs remember their history anywhere (Item 12)
- Work can come from a tracker by contract (Item 11), so an outcome can return to the
  originating source

**Detail level:** brief

**Notes:** Harness roadmap Item 14 owns the trigger behaviour: repository and webhook events,
filters, history, and queue or skip. This item makes triggers a plugin contract. Deliver
Item 14's behaviour as the first trigger, or mark Item 14 as superseded here. The AI workflow
research ranks event triggers the most-wanted missing capability; they would unlock five
surveyed workflows.

---

### Item 14: Notify and report anywhere

**Delivers:** A project owner can send run outcomes to Slack, email or a dashboard of their
choice by installing a plugin.

**Success criteria:**
- An extender can add a new notification or reporting destination.
- The existing `notify` setting keeps working.
- A plugin sees the same run outcomes the built-in reports do.

**Dependencies:**
- Plugins can be installed and enabled (Item 8)

**Detail level:** brief

**Notes:** Run outcomes are output-only today with no stability promise; the spec decides
how stable to make them.

---

### Item 15: Use a different agent or model

**Delivers:** A project owner can have a different vendor's model do a step, for example to
review another model's work.

**Success criteria:**
- An extender can add support for another agent or model as a plugin.
- A step can choose which agent it uses; the default behaviour is unchanged.
- The gate, not the agent, remains the judge of whether work is accepted.

**Dependencies:**
- Plugins can be installed and enabled (Item 8)

**Detail level:** brief

**Notes:** Sequenced last by choice, not by dependency: it touches the core loop and the
most credentials. Every run is Claude-only today.

---

## Deferred

- **Answer-only tasks, diff-scoped reviews, step approval checkpoints.** The AI workflow
  research ranks these highly, but they are new workflow capabilities, not extension points.
  They are to be added to the harness roadmap, whose Deferred section is empty.
- **Fence and sandbox backends, test-result parsers, storage backends, VCS backends.**
  Hardwired and not yet requested. Revisit after Item 10 shows what the extraction costs.
- **Dashboard and console plugins.** Wait for the delivery-console roadmap.
- **Gate presets, triage, repair coordinator.** Not planned. Packs choose among the built-in
  presets, and the others have no demand yet.
