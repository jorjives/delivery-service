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
2. **Code plugins.** Add a trust model, then open the code-bearing extension points
   (custom gates and closers inside packs, scheduler backends, work sources, notifiers,
   triggers, agent backends). Packs gain the ability to reference custom items here.

Success at the roadmap level: a project owner can find a pack someone else wrote, see
exactly what it will do, install it at a pinned version, adapt it to their project and run
it; a stranger can publish a pack the same way; and, in phase 2, an extender can add a
new scheduler backend, work source or gate without changing delivery-service itself.

### Decisions reversed

Earlier specs recorded these as non-goals: a plugin distribution mechanism (CLI and
configuration spec), a hosted registry (task-packs spec), and a runtime registry (gate and
closer specs). This roadmap reverses the first deliberately. It keeps the other two:
discovery goes through an existing package ecosystem, not a registry we host, and loading
stays explicit and path- or package-based, not a global runtime registry.

### Two audiences

Matching the harness roadmap: **project owners** install and run packs and should never
need to write code; **extenders** publish packs and, in phase 2, code plugins.

### Prior art in this estate

- `loadPlugin` and `guardMethod` already load and guard third-party modules for custom gates
  and closers. Phase 2 extends that seam; it does not add a second loader.
- The named-schedules draft spec already plans a scheduler backend port with a contract
  test suite. That is the pattern for every later adapter.
- The AI workflow examples (branch `claude/ai-workflow-examples-gaps-40kgns`, not yet
  merged) show many non-review workflows with the find-then-act shape, and name the gaps
  that later items address: event triggers, answer-only tasks, task fields visible to
  command gates, and a second vendor's model.

### Not in this roadmap

A hosted registry or marketplace; paid or signed distribution; a sandbox for arbitrary
third-party code (phase 2 decides the trust model first); plugins that change the state
machine itself.

---

## Phase 1: Shareable packs

## Item 1: Packs for any workflow

**Delivers:** A project owner can use a pack for any find-then-act job, such as a
dependency upgrade, a migration sweep or a docs-drift check, not only a code or security
review.

**Success criteria:**
- The documentation describes a pack as a shareable bundle of workflows, and review is one
  example among several.
- A pack can define workflows other than a scan followed by a fix, each with its own
  prompts, guards and hold policy.
- At least one built-in pack that is not a review ships and runs end to end against the
  scripted agent.
- Existing review packs, and projects that name them, keep working unchanged.

**Dependencies:**
- Review packs can be selected and run from project configuration (exists today)

**Detail level:** brief

**Constraints:** Packs remain data only in this phase. A pack may choose among built-in
gate presets and closer kinds but may not reference custom modules.

**Notes:** The pack format is currently strict and shaped around scan and fix, so the
format version will change; the spec decides how old packs are read. The name "pack" is
kept. The merged AI workflow examples are the source for the first non-review packs and
for test cases.

---

## Item 2: Inspect a pack before trusting it

**Delivers:** A project owner can see exactly what a pack will tell the agent to do and
what it is allowed to touch, before it is installed or run.

**Success criteria:**
- One command shows a pack's workflows, the full prompts, guards, hold policy, and the
  gates and closers it selects.
- The same command flags anything that widens what an agent may do beyond the project's
  own defaults.
- A pack that carries a key the format does not name is refused with a plain explanation.
- The output is readable by a non-engineer.

**Dependencies:**
- Packs can describe workflows of any shape (Item 1)

**Detail level:** brief

**Notes:** A pack is prompts that run with the agent's powers, so prompt injection is the
real risk of sharing. Inspection is the first control and comes before install.

---

## Item 3: Install a pack from elsewhere, pinned

**Delivers:** A project owner can add a pack published by someone else and get the same
pack on every machine and every run.

**Success criteria:**
- A pack can be added from a package or a repository, not only a local folder.
- The version is recorded, and a later run uses that version until the owner deliberately
  updates it.
- The owner sees what changed when updating a pack.
- A pack whose content differs from the recorded version is refused.
- Two packs that define the same workflow name are reported plainly, as for local packs.

**Dependencies:**
- A pack can be inspected before it is trusted (Item 2)

**Detail level:** brief

**Constraints:** Discovery uses an existing package ecosystem; no registry is hosted.

**Notes:** The task-packs spec already sketches npm-package discovery as a COULD.

---

## Item 4: Adapt a shared pack to my project

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
- A pack can be installed from elsewhere (Item 3)

**Detail level:** brief

**Notes:** The AI workflow research found that examples need task fields, such as a file
or package name, visible to command gates; this item should decide whether pack settings
and task fields share one mechanism.

---

## Item 5: Publish a pack

**Delivers:** An extender can write, test and publish a pack that others can install.

**Success criteria:**
- A scaffold command creates a pack with a manifest, prompts and a fixture project.
- A validate command checks a pack against the format and runs its fixtures against the
  scripted agent.
- The documentation walks through writing and publishing a pack, including the non-review
  built-in as a worked example.
- A published pack installs with Item 3 with no extra steps.

**Dependencies:**
- A pack can be installed from elsewhere (Item 3)
- A pack can declare settings (Item 4)

**Detail level:** brief

**Notes:** Built-in packs already ship `fixtures/`; this item makes that the contract for
everyone.

---

## Item 6: Published configuration schema

**Delivers:** A project owner gets editor completion and errors for `delivery.config.json`
before running anything, including keys that packs contribute.

**Success criteria:**
- A JSON Schema for the project configuration is published and referenced from generated
  configurations.
- An editor flags an unknown key or a wrong value the same way `delivery validate` does.
- Pack settings (Item 4) appear in the schema for the packs the project names.

**Dependencies:**
- A pack can declare settings (Item 4)

**Detail level:** brief

**Notes:** Packs and reports already generate JSON Schema; the project configuration is
validated only by its in-code definition.

---

## Phase 2: Code plugins

## Item 7: Trust and install for code plugins

**Delivers:** A project owner can decide whether to run code from a plugin, knowing what
it can do, and can install it pinned like a pack.

**Success criteria:**
- A plugin declares which extension points it uses and the access it needs, and the owner
  sees that before enabling it.
- A plugin is enabled explicitly per project; installing one does not run it.
- A plugin that fails to load, or breaks its contract at run time, is reported by name and
  does not crash a run (the existing guarded-call behaviour).
- Version and compatibility are checked, and a plugin built for another major version is
  refused.

**Dependencies:**
- A pack can be installed from elsewhere, pinned (Item 3)
- A pack can be inspected before it is trusted (Item 2)

**Detail level:** brief

**Constraints:** Extend the existing plugin loader; do not add a second one.

**Notes:** The sandbox question (how far to contain third-party code, given the existing
fence) is the central decision of the spec and gates every later item.

---

## Item 8: Packs that carry custom gates and closers

**Delivers:** An extender can publish a pack that includes its own check or its own way of
landing work, and a project owner can install it as one thing.

**Success criteria:**
- A pack can reference a custom gate or closer shipped with it.
- Installing such a pack follows Item 7: the code is shown, enabled explicitly and pinned.
- A pack with no custom items stays data only and needs no enabling.
- Inspection shows which workflows depend on custom code.

**Dependencies:**
- A plugin can be enabled with declared access (Item 7)
- A pack can be installed from elsewhere, pinned (Item 3)

**Detail level:** brief

**Notes:** Several surveyed examples need a custom gate only to read task fields, so
Item 4 may remove the commonest reason before this item is needed.

---

## Item 9: Schedule runs on any operating system

**Delivers:** A project owner on macOS or Windows can schedule recurring runs, and an
extender can add a scheduler for another platform without changing delivery-service.

**Success criteria:**
- Named schedules work with a second scheduler backend on another operating system.
- A backend is added by implementing one contract and passing a shared contract test suite.
- A backend ships as a plugin under Item 7.

**Dependencies:**
- Named schedules exist with a scheduler backend port (the named-schedules draft spec)
- A plugin can be enabled with declared access (Item 7)

**Detail level:** brief

**Notes:** This is the pilot adapter: the contract test suite it creates is the template
for Items 10 to 12.

---

## Item 10: Bring work in from any tracker

**Delivers:** A project owner can work from Linear, Jira or another tracker by installing a
source, and can have outcomes raised back there.

**Success criteria:**
- A work source is added by implementing a contract and passing a shared test suite.
- GitHub, backlog, list and command sources continue to work and use the same contract.
- Raising a follow-up and reporting the outcome go back to the same tracker.

**Dependencies:**
- A plugin can be enabled with declared access (Item 7)
- A scheduler backend can be added by contract (Item 9)

**Detail level:** brief

**Notes:** Today sources are a closed union with no interface, and the tracker is entangled
with the GitHub source. Extracting the interface first is the refactor that pays here.

---

## Item 11: Start runs from events

**Delivers:** A project owner can start a run when something happens, such as a pull request
opening, a comment, a failed check or a merge, not only from the command line or a timer.

**Success criteria:**
- A trigger is added by implementing a contract, as a plugin.
- A run started by an event keeps its retry and parking history even when the runner is
  short-lived.
- The outcome can be sent back to where the request came from.

**Dependencies:**
- A work source can be added by contract (Item 10)
- A plugin can be enabled with declared access (Item 7)

**Detail level:** brief

**Notes:** The AI workflow research ranks this the most-wanted missing capability; it
unlocks five surveyed workflows. It also needs run state that survives an ephemeral runner,
which may be a separate spec.

---

## Item 12: Notify and report anywhere

**Delivers:** A project owner can send run outcomes to Slack, email or a dashboard of their
choice by installing a plugin.

**Success criteria:**
- A notifier and a reporter are each added by implementing a contract, as a plugin.
- The existing `notify` command keeps working.
- A plugin receives the same event stream the built-in reporters use.

**Dependencies:**
- A plugin can be enabled with declared access (Item 7)
- A scheduler backend can be added by contract (Item 9)

**Detail level:** brief

**Notes:** The event stream is output-only today and has no stability promise; the spec
decides how stable to make it.

---

## Item 13: Use a different agent or model

**Delivers:** A project owner can have a different vendor's model do a step, for example to
review another model's work.

**Success criteria:**
- An agent backend is added by implementing the agent contract, as a plugin.
- A step can choose its backend; the default behaviour is unchanged.
- The gate, not the backend, remains the judge of whether work is accepted.

**Dependencies:**
- A plugin can be enabled with declared access (Item 7)

**Detail level:** brief

**Notes:** Placed last: it touches the core loop and the most credentials. Every run is
Claude-only today; a second backend would also exercise the contract-test pattern against a
non-trivial adapter.

---

## Deferred

- **Answer-only tasks, diff-scoped reviews, step approval checkpoints.** The AI workflow
  research ranks these highly, but they are new workflow capabilities, not extension
  points. They belong on the harness roadmap, not this one.
- **Fence and sandbox backends, storage backends, VCS backends.** Hardwired and not yet
  requested. Revisit after Item 9 shows what the extraction costs.
- **Dashboard and console plugins.** Wait for the delivery-console roadmap.

---

## Appendix: pluggable points considered

| Point | Roadmap item |
|---|---|
| Packs | 1 to 5 |
| Custom gates, closers | 8 |
| Gate presets | Not planned; packs choose among built-ins |
| Agent backend | 13 |
| Triage, repair coordinator | Not planned |
| Reporters, notifier | 12 |
| Scheduler backend | 9 |
| Work sources, issue tracker | 10 |
| Event triggers (new) | 11 |
| Fence, test-result parsers, storage, VCS, dashboard | Deferred |
| Plugin manifest, discovery, trust | 3, 7 |
| Config contributions, published schema | 4, 6 |
