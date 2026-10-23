# Delivery Console — Roadmap

> **Type:** new-project (a graphical front end for an existing tool)
> **Created:** 2026-10-22
> **Revised:** 2026-10-23 (aligned with delivered named schedules and the pluggable architecture roadmap; riskiest items moved earlier)

## Context

delivery-service began as the successor to the autoloop idea, and its purpose is to let
non-technical creators apply deterministic working to what they build with AI: an agent does the
work, the project's own check decides whether it is good, and nothing lands unchecked. Today every
part of that is driven from a command line: `delivery init`, `delivery schedule enable`,
`delivery status`, `delivery approve`. That suits engineers. A creator who has never opened a
terminal cannot set it up, cannot see what it is doing, and cannot tell when it needs them.

This roadmap orders the capabilities that give delivery-service a cross-platform graphical
console: a fleet view over every project on the machine, where a person can browse projects, see
their schedules, workflows and tasks, read run history, see what runs next, start a run (looking
at what the agent will be told first), and set a project up without touching JSON.

Success at the roadmap level: a person who has never used a terminal installs one app, adds their
projects, and from then on can answer "what has it been doing, what is it about to do, and does it
need me?" for every project from one window, on macOS, Windows or Linux.

Relationship to the harness roadmap (`2026-09-04-delivery-harness-roadmap.md`): that roadmap
promised a guided experience for non-technical project owners (its Item 9) and named launchd as a
possible scheduling mechanism (its Item 13). This roadmap delivers the guided experience in
graphical form; it supersedes neither, and the CLI remains the contract they sit on.

Relationship to the pluggable architecture roadmap (`2026-10-22-pluggable-architecture-roadmap.md`):
scheduling on macOS and Windows is that roadmap's Item 10, delivered as a scheduler plugin behind
the scheduler backend port. This roadmap does not build it and no longer carries an item for it.
Until it lands, the console says plainly, with the reason, that scheduling is unavailable on a
machine whose operating system has no scheduler adapter (Items 3, 5, 8 and 9). That roadmap also
defers "dashboard and console plugins" until this one exists; so does this one (see Deferred).

Status of what it builds on: the named-schedules design
(`2026-10-21-named-schedules-design.md`) is delivered (2026-10-23, all six slices). `--name`
schedules, `run --if-idle`, a repository lock on every run and the scheduler backend port, with
systemd as its only adapter, now exist. Still missing, and closed inside the items that need
them: `--json` on `schedule status`, `backlog` and a config summary, and a list of known projects.
Packs for any workflow are also delivered; inspecting a pack
(`2026-10-23-inspect-a-pack-design.md`) is specified but not built.

### Principles that bound every item

- **The console is a client, not a second implementation.** The command line stays the one place
  behaviour lives. The console reads the versioned data the CLI already publishes
  (`delivery.report/1`, `delivery.event/1`, `--json` on `status`, `report`, `validate`) and acts
  by invoking the same commands. Where the CLI lacks something the console needs (a list of
  projects, schedules as data, config as data), that gap is closed in the CLI first, inside the
  item that needs it, so a script gets it too.
- **Deterministic and inspectable.** The console shows what happened and what will happen; it
  never guesses. A figure it cannot read is shown as unknown, never inferred, as the report
  document already does for `live`.
- **Appearance from Ember, behaviour from libraries.** Ember (`~/dev/design-systems/ember/`)
  governs how it looks: tokens, light and dark themes, density. Behaviour (tables, drag, dialogs,
  calendars) comes from third-party libraries styled with Ember tokens. Where Ember lacks a
  component the console needs, it is flagged for design in Claude Design and re-pulled; it is not
  hand-rolled (see "Ember gaps" below).
- **Plain words.** The audience is the non-technical project owner persona, Dana Okafor, in
  `docs/personas.md`. Voice follows
  Ember's content rules: terse, sentence case, counts over adjectives, machine things in mono.
  No cron syntax, no state-machine names, no exit codes on the main path.
- **Proven on all three platforms from the start.** Success is stated for macOS, Windows and
  Linux, so the walking skeleton runs on all three and every later item is checked on all three.
  Platform cost (shell, signing, detached runs, paths) is found in Item 1, not at install time.
- **Tested with the audience early.** The roadmap's premise is that a non-technical person can
  use this. Someone like Dana tries the product after Items 1, 3 and 7, not only at the end;
  findings are fixed in the item that owns the screen.
- **Prior art in the estate.** `autoloop` already ships a fleet console (an Ink terminal view and a
  web view: attention-first ordering, per-target detail, backlog, config). `spec-view` and
  `systemd-viewer` are Ember-styled list-and-detail tools over local files and timers, and
  Ember has UI kits for both. The console should conform to their shapes (attention-first fleet,
  grouped-by-health lists, detail drawers) unless a right-choice check at spec time says otherwise.

### Decisions deliberately left to the specs

These are choices for the item that first needs them, not for this roadmap. Biases are recorded so
brainstorming starts informed.

| Decision | Decided in | Bias |
|---|---|---|
| Shell: local web app opened in a browser, or a packaged desktop app (Tauri, Electron) | Item 1 spec, with signing and notarisation priced there; built in Item 8 | Local web app served by the CLI first (no new runtime, matches `spec-view`, `tmob`, autoloop web). Wrap it in a desktop shell only when Item 8 needs a tray, background notifications and double-click install. Buy the shell, do not build one. |
| How projects are known to the console: an explicit registry or discovery from the machine's run state | Item 2 spec | Explicit registry written by the CLI, with discovery as a suggestion, because run state is keyed by repository path and a project that has never run leaves none. |
| How the console talks to the CLI: spawning commands, or a long-lived local API | Item 1 spec | Spawn commands and read their `--json`; add a local API only if watch performance demands it. |

---

## Item 1: See One Project's State in a Window

A walking skeleton: the thinnest end-to-end path, with every internal part stubbed to the crudest
thing that works. Later items replace one stub at a time.

**Delivers:** A person can run one command, see a window open, and read in plain words where a
single project stands: the latest run's outcome, what is waiting on them, and whether anything is
running now.

**Success criteria:**
- Running the console command opens a window or browser tab on this machine within a few seconds
  and shows the project in the current folder
- The window shows the latest run's outcome, the count of tasks closed, escalated and queued, and
  whether a run is going now, matching what `delivery report` says in words for the same project
- When the project has no runs yet, the window says so in one line and says how to start one,
  rather than showing an empty screen
- The window uses Ember light and dark themes and follows the system setting, and is readable at
  phone width
- Closing the window or stopping the command leaves no process running
- The same walkthrough passes on macOS, Windows and Linux, and the spec lists what in the CLI
  is Linux-specific (gate commands run through a shell, path handling, detaching a process)
- The spec prices the desktop shell options, including code signing and notarisation on macOS
  and Windows, so the shell decision is made knowing the cost
- One person who does not use a terminal is watched using it, and what they could not do is recorded

**Dependencies:**
- A project owner can read where a project stands as versioned data (exists: `delivery report --json`)

**Detail level:** brief

**Notes:** Stubs on purpose: one project given by folder path, no registry, no actions, no
history beyond the latest run, desktop shell absent. Proves the shell choice, the CLI-as-API
principle and the Ember pipeline (token CSS and components copied from the mirror, never linked
into `~/dev/design-systems`) before anything depends on them. Also the right moment to confirm
that the existing `delivery.report/1` document carries everything a status screen needs.
This item carries the platform and audience risk the roadmap would otherwise meet at the end:
if it cannot run on all three systems, or a non-terminal person cannot read it, the later items
are revised now, while they are cheap.

---

## Item 2: See Every Project in a Fleet View

**Delivers:** A person with several projects can add them to the console and see them all in one
list, with the ones that need attention first.

**Success criteria:**
- A person adds a project by choosing its folder, and removes it again, without a terminal
- The fleet list shows, for each project: its name, whether it is running now, its latest
  outcome and when, how many items wait on the person, and whether a schedule is on
- Projects are ordered attention-first (needs you, then failing, then running, then healthy,
  then idle), with the grouping visible, and the ordering is identical on every load for
  the same data
- A project whose folder has moved, been deleted or is not a git repository is shown as
  unreachable with the reason, and does not hide the others
- A project that has never been set up for delivery can still be listed, and says it needs setup
- The list stays usable with fifty projects: filtering by name and by state

**Dependencies:**
- The console shows one project's state
- A project owner can list the machine's delivery projects as data (a gap in the CLI to close
  here, so `delivery` gains a way to list and manage the set of known projects)

**Detail level:** brief

**Notes:** Mirrors the shape of the autoloop fleet console and the `systemd-viewer` grouped list.
The registry decision is made here (see the table above). The dedicated CLI addition is part of
this item, not a separate layer, because the first thing it enables is this screen.

---

## Item 3: Browse a Project's Schedules, Workflows and Tasks

**Delivers:** A person can open any project and see, in plain words, what it is set up to do:
its schedules, its workflows and their steps, its task list and its backlog.

**Success criteria:**
- Opening a project shows its schedules (name, how often, on or off, last run, next run),
  its workflows (name and ordered steps), its task list and its backlog items with their status
  (open, approved, held, parked, delivered)
- Held and parked items say why in a sentence and say what the person can do about it
- The check that decides whether work is good, and what happens to accepted work (for example,
  open a pull request), are shown in words, not as raw configuration
- Everything shown agrees with the project's configuration and ledger as `delivery validate`
  and `delivery backlog` see them
- A configuration that fails validation is shown with the same plain-language message the CLI
  gives, beside the project, instead of an empty or broken page
- Nothing on this screen can change the project (read only)

**Dependencies:**
- The fleet view lists every project
- A project can have several named schedules (exists: the named-schedules design,
  `2026-10-21-named-schedules-design.md`, delivered)
- A person can read a project's schedules, configuration and backlog as data (CLI gaps closed
  here: `--json` for `schedule status`, `backlog` and a config summary)

**Detail level:** brief

**Notes:** Read only by design, so the rest of the roadmap adds actions to screens the person
already trusts. Where a project uses packs, the packs it names are listed with their workflows;
showing what a pack will tell the agent reuses the inspection output once that is built
(`2026-10-23-inspect-a-pack-design.md`), and is not a prerequisite. A person on a system with no
scheduler adapter sees schedules as unavailable, with the reason. The sentence-level wording of config concepts (gate, closer, workflow, source)
is a content task that belongs in this item's spec; `docs/glossary.md` is the starting point.

---

## Item 4: Read a Project's Run History

**Delivers:** A person can see every run a project has made, open any one, and understand in
plain words what happened and why it ended as it did.

**Success criteria:**
- A project's runs are listed newest first with start time, how long, outcome, what task or item
  it worked, and the cost where recorded
- Opening a run shows its steps in order, what the check said at each, any corrections the
  harness made, and the closing outcome in the same words as `delivery report`
- A run that is going now updates on screen as it progresses, without a manual refresh, and
  stops updating when it ends
- A run that needed a decision shows the question and who it is waiting on
- A run whose record is damaged is listed as damaged and does not stop the rest of the list
- A whole-fleet view of recent runs across all projects, filterable by outcome and project

**Dependencies:**
- A person can browse a project's schedules, workflows and tasks
- A person can follow a run as it happens (exists: `delivery status --watch --json`)
- A person can list all runs as data (exists: `delivery status --all`; `--json` coverage to be
  confirmed in the spec)

**Detail level:** brief

**Notes:** Cost and usage figures are shown only where the report records them, with the count
of sessions covered, so a total is never presented as complete when it is not.

---

## Item 5: See What Runs Next

**Delivers:** A person can see, across all projects, which runs are due and when, and spot clashes
or gaps before they happen.

**Success criteria:**
- An upcoming view lists the next scheduled runs across every project in time order, each with
  project, schedule name and what it will do
- A calendar or timeline view shows the same over the coming week
- A schedule that is off, a machine that cannot run schedules, or a missed run is shown as such,
  with the reason, rather than silently absent
- Two schedules on one project that overlap are marked, and the view says what happens when
  they do (the later run is skipped)
- The times shown are in the person's own time zone and agree with `delivery schedule status`

**Dependencies:**
- A person can browse a project's schedules
- Several named schedules per project, with overlap skipped rather than failed (exists: the
  named-schedules design, including `run --if-idle`, delivered)

**Detail level:** brief

**Notes:** Ember has no calendar or timeline component; flag it for design (see "Ember gaps").
A date-grid library supplies behaviour. This item also settles whether "next run" is read from
the scheduler or computed from the schedule model; the bias is to read it from the scheduler so
the console cannot disagree with what will actually happen.

---

## Item 6: Start a Run, After Seeing What the Agent Will Be Told

**Delivers:** A person can start a run from the console, having first read exactly what the agent
will be told, and can stop or resume one.

**Success criteria:**
- From a project, a person can choose to run a typed task, the next item from the backlog, or a
  named workflow, and starts it with one confirmation
- Before it starts, the console shows the instructions the agent will receive, the same text
  `delivery preview` prints, and the check that will decide the result
- A run already going on the project is shown, and starting a second is refused with the reason,
  not queued silently
- A run that stopped before finishing offers "pick it up" and "start fresh", each saying what it
  does to the work already done
- A run started from the console appears in the run history and the fleet view exactly as one
  started from the terminal does
- Closing the console does not stop a run that was started from it

**Dependencies:**
- A person can read a run's history and follow a run live
- A person can preview what the agent will be told (exists: `delivery preview`)
- Runs refuse to overlap on one project (exists: the named-schedules design, repository lock for
  every run, delivered)

**Detail level:** brief

**Notes:** Runs must outlive the window, so the spec must decide how a console-started run is
detached on each operating system. The preview-before-trigger step is the point of the item
for non-technical users: the person sees and can sanity-check what is about to be spent.

---

## Item 7: Decide What Needs You

**Delivers:** A person has one place that lists everything across their projects waiting on a
decision, and can resolve each without a terminal.

**Success criteria:**
- A "needs you" list across all projects shows every idea awaiting approval, every serious fix
  awaiting sign-off, and every parked item waiting on an answer, each with the project it
  belongs to and how long it has waited
- A person can approve or decline ideas, sign off or reject a serious fix, answer a parked
  item's question and put a parked item back in the queue
- Each action says what it will do before it is taken and confirms what it did after, and
  an action that changes shared history (landing a fix) needs an explicit confirmation
- An item that stops needing a decision (resolved from the terminal, or delivered) leaves the
  list on the next view without a manual refresh
- A person can run a pack workflow (a review, or any other find-then-act job) from a list of
  those available to the project, and the ideas it finds arrive in this list
- While the console is open, a desktop notification appears when a project needs a decision or
  a run fails, and not for routine success

**Dependencies:**
- A person can see items and their status in a project
- A person can start and follow a run
- A person can approve, decline, sign off, reject, answer and unpark from the command line
  (exists)
- Packs can describe workflows of any shape (exists: packs for any workflow, delivered)

**Detail level:** brief

**Notes:** This is where non-technical users spend most of their time once things are running,
so the "does it need me?" answer is delivered here, not at the end: notification while the
console is open comes with this item, and Item 8 extends it to a tray and to when the window is
closed. Notifications read the same run outcomes as `delivery report`, and are the console's own;
they are not the notifier plugins of the pluggable architecture roadmap (its Item 14). A person
tries this item before Item 8 (see "Tested with the audience early").

---

## Item 8: Install It Like an App

**Delivers:** A person can install the console by downloading one file and double-clicking,
with no terminal, no separate Node install, and no manual path setup, and can be told when
something needs them without keeping the window open.

**Success criteria:**
- One installer per platform (macOS, Windows, Linux) installs the console and the `delivery`
  command it drives, and an uninstall removes them cleanly
- On first launch a checklist confirms git is present, Claude Code is signed in, and the
  machine can run schedules (on an operating system with no scheduler adapter it says so, with
  the reason), and each failing item says in one sentence how to fix it
- The console can live in the menu bar or system tray, and the decision and failure
  notifications from Item 7 still arrive when the window is closed
- The app can open at login, and scheduled runs keep working when the window is closed
- Updates arrive without reinstalling, and a failed update leaves the previous version working
- The same first-launch checklist is reachable from the command line, so a support question
  has one answer in both places

**Dependencies:**
- A person can decide what needs them
- A person can start a run that outlives the window (Item 6)

**Detail level:** brief

**Notes:** Sequenced before setup so that the people who test Items 9 and 10 do so on the
installed app, as a real user would. The desktop shell is built here on the decision and costing
made in Item 1: if the local web app plus notifications and a tray is enough, the shell can be
thin. Signing and notarisation were priced in Item 1; this item pays them. A person with an
existing global npm install should not end up with two versions of the command.

---

## Item 9: Set Up a Project Without Touching JSON

**Delivers:** A person can take a folder they have been vibe coding in, and through the console
alone make it ready for delivery: what checks the work, what happens to accepted work, where
work comes from, and when it runs.

**Success criteria:**
- A guided flow covers the same ground as `delivery init` and `delivery schedule enable`:
  describe the project, choose the check that decides good work, choose what happens to
  accepted work, choose the work sources, choose how often to run
- Every choice is offered in plain words with a short description of what it means, and a safe
  default; frequency is "every hour", "every night", "every Sunday", never cron syntax
- The flow validates as the person goes, using the same checks as `delivery validate`, and
  shows any problem beside the field in the CLI's own wording
- It writes the same `delivery.config.json` a careful person would write by hand, and the same
  file produces the same screens in Items 3 and 5; opening and saving an existing project
  keeps anything the form does not understand intact
- The person is shown a preview of what the agent will be told, and can start a first run
  from the end of the flow
- A person can edit schedules, workflows and sources of an already-set-up project through the
  same forms, and a change is validated before it is saved
- On an operating system with no scheduler adapter, the flow finishes without the schedule step,
  says why in one sentence, and offers to run by hand instead; it never offers "run every night"
  it cannot keep

**Dependencies:**
- A person can see what a project is set up to do
- A person can start a run after seeing the preview
- A person can install the console like an app (Item 8), so the flow is tested as a real user
  meets it
- Schedules on the person's operating system: exists on Linux; macOS and Windows arrive with
  Item 10 of the pluggable architecture roadmap, an external dependency this item adapts to
  rather than waits for
- A person can write a project's configuration without hand-editing (a gap in the CLI to close
  here: a non-interactive way to write and validate configuration, so the console and `init`
  share one writer)

**Detail level:** brief

**Notes:** Biggest behavioural risk in the roadmap: two writers of one config file. The CLI
writer must be the only one. Editing the check and the closer is limited to the ready-made
kinds; writing a custom gate or closer in code stays a command-line and documentation path
(`docs/writing-a-gate.md`). Ember needs form, stepper and dialog components for this item
(see "Ember gaps"). If the pluggable architecture roadmap delivers a JSON Schema for
`delivery.config.json` (its Item 6), the forms take field names and descriptions from it
rather than restating them; the CLI's `validate` stays the authority either way.

---

## Item 10: A Guide That Opens With the App

**Delivers:** A first-time user is walked from a freshly installed console to a first delivered
change without reading documentation.

**Success criteria:**
- On first launch with no projects, the console offers a sample project or "add your own",
  and either path ends with a visible, completed run
- Each screen links to the matching page in the documentation site, and the documentation has
  console-first versions of "Get started", "Set up a project" and "Run on a schedule"
- A final usability pass with at least three people who do not use a terminal records where
  each got stuck, and the findings are fixed or recorded here as deferred; earlier passes
  (Items 1, 3 and 7) have already shaped the screens, so this one confirms rather than discovers
- Every empty state in the console says what it is and what to do next in one line and one
  supporting line, per Ember's content rules

**Dependencies:**
- A person can install the console like an app (Item 8)
- A person can set up a project (Item 9)

**Detail level:** brief

**Notes:** This is the item that closes the roadmap's premise. If non-technical testers cannot
get to a first delivered change, earlier items are revised rather than papered over with help
text.

---

## Ember gaps

Ember has Button, IconButton, Input, Select, Switch, SegmentedControl, Card, ActivityRow,
Disclosure, Tabs, Badge, StatusPill, StatusDot, ProgressBar, Stat, CodeBlock, EmptyState, Kbd,
Menu, ThemeToggle, DensityControl, and UI kits for `spec-view` and `systemd-viewer`. The roadmap
needs components it does not yet have. To be designed in Claude Design and re-pulled with
`~/dev/design-systems/refresh.sh ember`, not hand-rolled, ahead of the item that needs each:

| Component | Needed by |
|---|---|
| Data table with grouped and expandable rows | Items 2, 3, 4 |
| Detail drawer / side panel | Items 3, 4, 7 |
| Calendar or timeline | Item 5 |
| Confirm dialog and toast | Items 6, 7 |
| Form field with inline validation message | Item 9 |
| Stepper / guided flow | Items 9, 10 |
| Notification and tray iconography | Items 7, 8 |

---

## Deferred

- **Remote and multi-machine fleets.** A view over projects on other machines or a hosted
  service. Reason: the first audience is one person on one machine; hosting adds authentication
  and a trust model that the local console does not need.
- **Event triggers in the console** (run on a pull request, on a webhook). Reason: event
  triggers (Item 13 of the pluggable architecture roadmap) have not been built; the console
  surfaces them once they exist.
- **Scheduling on macOS and Windows as a console item.** Reason: delivered by Item 10 of the
  pluggable architecture roadmap as a scheduler plugin; building it here would make two.
- **Installing and managing packs and plugins from the console, and console extension points.**
  Reason: depends on pack installation and the plugin trust model (Items 3, 7 and 8 of the
  pluggable architecture roadmap), none built; revisit once they are.
- **Writing custom gates, closers and packs in the console.** Reason: code authoring stays on
  the command line and in the documentation; the console offers ready-made kinds only.
- **A phone-first companion.** Reason: the layout is responsive from Item 1, but runs and
  notifications are tied to the machine; a mobile app is a separate product question.
- **Multi-user sharing of a fleet.** Reason: no multi-user model exists in the harness.
