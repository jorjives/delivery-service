# Delivery Service: Course Correction — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-06-course-correction-design.md`
> Next step: invoke writing-plans with this document

**Audience note:** as with the task-packs item, this item's product surface is the `delivery`
command, so the terminal is the product UI. UAT is written for the operator persona
(`docs/personas.md`): typing a `delivery` command and reading what it prints or what it does to
the repository is using the product. A real review needs the Claude Code CLI and a sign-in on
the demo machine; recorded regression tests route the agent through the vendored `claude-mock`
instead.

**Decided with the user (2026-10-13):** two boundaries were set before slicing:

- **§6, replacing Autoloop (config migration, backlog import, per-project cutover), is out of
  scope here.** It is a later piece of work, once the mechanism below is delivered and proven.
  Nothing in this scope depends on it.
- **§5.13 (packs converge on the backlog) and the tracker-backed backlog half of §5.5 (GitHub
  issues as a backlog) are in scope**, rather than deferred to a later spec, because they are the
  parts of the design that most directly replace machinery operators already depend on.

**Ordering rationale:** Slice 1 is the one non-negotiable foundation — full tool access, the
operator's own hooks and plugins, and unattended runs are not safe to ship before the write fence
and the landing boundary exist. After that, the order follows the operator's own journey: express
work as more than one step (2), keep a backlog of it (3), see it land coherently (4), have
something happen once it lands (5), stop running it by hand (6), then the two extensions that
build on all of the above: a tracker as the backlog (7) and packs converging on it (8). §5.3 (the
prompt), §5.6 (triage and gate maintenance) and the revised invariants (§4) are folded into
whichever slice first depends on them, since none is independently observable.

---

## Slice 1: Run Tasks With Your Own Claude Code Setup, Safely Contained

**Status:** ✅ Complete — 2026-10-15 — `d30dfb2`
**Delivers:** A task's agent session runs with the operator's own Claude Code settings, CLAUDE.md,
skills, plugins, hooks, MCP servers and full tool access — as the operator's own session would —
while a write fence keeps the operator's main checkout untouched and a landing boundary stops the
agent from merging, pushing or opening a pull request itself.

**Operational note:** `delivery preview` shows the complete context a step's agent will receive
and the effective agent options, noting that the operator's own settings and CLAUDE.md also load.
`delivery report` gains visible fields for whether the write fence was present on a run, and for a
task flagged because it was found landed outside the closer. The Acceptance section of the
agent's instructions changes from telling it the gate is hidden to describing the gate and how to
run it; the test-weakening guards it must satisfy apply to every run now, not only to pre-built
packs.

**Build note:** Reuses the SDK's own setting loading (`settingSources` default, the `claude_code`
system-prompt preset, skills, plugins) instead of rebuilding an operator environment. The write
fence ports Autoloop's existing bubblewrap fence rather than adopting the runtime's own broader
sandbox, which was assessed and rejected: it isolates further than a write fence needs and cannot
leave the checkout's own git directory writable. The anti-weakening guards are the harness's
existing guards, now applied by default to every run instead of only inside packs.

### Prerequisites

- None — this is the foundation the rest of this scope builds on.

### Acceptance Criteria

- [ ] A run's agent session loads the operator's own Claude Code settings, CLAUDE.md, skills,
  plugins, hooks and MCP servers, and uses the operator's own system prompt with the harness's
  own context appended, not a prompt that replaces it
- [ ] The agent session has every tool available, with no fixed allowlist; a tool call the
  operator's own settings deny is refused by that setting, not by the harness
- [ ] The agent can read the gate's own definition and run it itself; its instructions no longer
  say it cannot see or run the gate
- [ ] A write made anywhere outside the operator's main checkout (the task's own working copy)
  succeeds; the same kind of write aimed at the main checkout fails, including one attempted
  through a shell command the agent runs itself
- [ ] On a machine where the write fence is unavailable, the run still goes ahead, with a plain
  warning at the start telling the operator to save or commit their own work first, and the run's
  record shows the fence was absent
- [ ] An agent session that tries to merge into another branch, move another branch's pointer,
  push to a remote, or create a tag is refused with a plain sentence saying the branch is the
  deliverable and the harness lands it; committing, rebasing, stashing and reading history inside
  its own branch still work
- [ ] If a pull request is nonetheless found open for the task's branch after a session, the task
  is flagged for the operator's attention with the pull request and the session named, rather than
  treated as merged
- [ ] A task whose change deletes or renames a test, edits test configuration or CI files, or adds
  a new "skip" marker is rejected with the specific problem named, by default, on every run — not
  only when using a pre-built pack
- [ ] A task that only edits the wording or assertions of an existing test is accepted by default;
  an operator can turn that off for a specific task type whose job is explicitly to change tests
- [ ] `delivery preview` for a task shows the complete context the agent will receive, including
  the Acceptance section's plain description of what will judge the work, and notes that the
  operator's own settings and CLAUDE.md also apply
- [ ] A finished run's report shows whether the write fence was present, and shows plainly when a
  task was flagged for merging, pushing or opening a pull request outside the harness

### UAT

**What you can now do:** Run a task and see it work with your own tools, skills and settings
switched on, with nothing you own at risk and nothing landing without the harness's say.

**How to try it:**
1. Open a terminal in a project you already have `delivery` set up for, with one of your own
   skills installed in your normal Claude Code setup.
2. Type `delivery run --task "..."` for a small task that would naturally use that skill.
3. While it runs, edit a file in your own checkout from another terminal tab, and watch
   `delivery status` continue without complaint.
4. When it finishes, open `delivery report` and look at the entry for the task: it shows whether
   your main folder was protected during the run.
5. Look at what the task actually produced: a branch, not something merged into your main
   project.

**What you should see:** The task finishes using your own familiar setup, your main project is
untouched the whole time, and the result sits on its own branch waiting for the harness, not
pushed or merged by the agent.

**Why this matters:** This is the course correction's central promise: the agent is trusted with
everything you already trust it with, and the one thing it cannot do is land work without being
checked.

---

## Slice 2: Define Workflows With More Than One Step

**Status:** ✅ Complete — 2026-10-16 — `7086afb`
**Tests:** ✅ Recorded — 2026-10-16 — `152e013` — cli (vitest) — 1 UAT + 5 AC, 2 skipped

**Delivers:** An operator defines a named workflow as an ordered list of steps instead of being
limited to one fixed worker step, and runs any task through any named workflow.

**Operational note:** `delivery preview --step <name>` shows exactly what a named step's agent
will receive. A command-type gate gains optional setup and teardown commands, run around the
check and shown in the gate's own description.

### Prerequisites

- Tasks run through the existing single-surface machine (provisioning, gate, agent, triage,
  budgets) with full agent capability and a landing boundary (Slice 1)

### Acceptance Criteria

- [ ] An operator defines a workflow in config as a named ordered list of steps, each with its own
  instruction; `delivery run --task "..." --workflow <name>` runs the task through that workflow's
  steps in order
- [ ] A step can resume the previous step's session instead of starting fresh, when the workflow
  says so, so a step can continue the reasoning of the one before it
- [ ] Each step is checked by the project's own gate unless the step names a different one; a step
  can instead be checked by whether a named file now exists, or by whether it added at least one
  commit, for steps whose job is to produce something other than passing tests
- [ ] A step that fails is corrected on its own; later steps in the workflow do not start until
  the one before them is accepted
- [ ] A step can turn off a default anti-weakening guard, or turn on the guard against changing an
  existing test, for exactly that step
- [ ] A task given no workflow runs exactly as before: one step, the task as the instruction, the
  project's own gate
- [ ] `delivery preview --step <name>` prints the exact text and effective agent settings a named
  step will receive, before any run happens
- [ ] A command-type gate's setup command runs before the check and its teardown runs afterwards
  regardless of outcome; a setup that fails is reported as a gate problem, not as the task failing
  its checks

### UAT

**What you can now do:** Build a task out of more than one checked step, for example "write the
plan, then implement it", instead of being limited to a single instruction.

**How to try it:**
1. Add a two-step workflow to your project's configuration: a first step that asks for a short
   written plan, and a second that asks the agent to carry it out, continuing from the first
   step.
2. Run `delivery run --task "..." --workflow <your-workflow-name>`.
3. Watch `delivery status` show the first step completing and being checked — it only needs the
   plan document to exist — before the second step starts.
4. When it's done, read the result: a plan document followed by the implementation that followed
   it, both checked.

**What you should see:** Two distinct, separately-checked pieces of work landing as one task, in
the order and relationship you defined — nothing the harness decided on your behalf.

**Why this matters:** Work that doesn't fit Autoloop's fixed five-leg shape — a design-then-build
task, a report that must simply exist — is now expressible without changing the harness itself.

---

## Slice 3: Work Through a Backlog of Items Instead of a Fixed List

**Status:** ✅ Complete — 2026-10-17 — `0d806aa`
**Tests:** ✅ Recorded — 2026-10-17 — `f3b68ad` — cli (vitest) — 2 UAT + 5 AC, 3 skipped
**Delivers:** An operator keeps a backlog of work items in their project, and `delivery run
--sources` works through them in priority order on its own, carrying each item that needs more
attempts or a decision through to the next run instead of losing track of it.

**Operational note:** Introduces a new tracked folder in the project for backlog items, committed
like any other project file, and a new machine-local state location beside the worktrees for the
item ledger (attempts, parked flag, preserved worktree and session), which describes this
machine's runs and is not shared between clones. The project's existing self-ignoring folder flips
from ignoring everything to ignoring everything except the backlog.

**Build note:** The backlog is Delivery Service's own tracked store — markdown files with front
matter, the format Autoloop already proved — kept in the project rather than reading Autoloop's
own folder. The item ledger ports Autoloop's existing per-item ledger semantics (attempts,
outcome, parking) instead of inventing new tracking.

### Prerequisites

- Tasks run through the harness's existing queue, with budgets, retries and triage already in
  place (today's behaviour)

### Acceptance Criteria

- [ ] An operator adds a work item as a small file in the project's backlog, written for people to
  read, naming which workflow delivers it; `delivery run --sources` picks it up and runs it
- [ ] Items are worked in order: due recurring items first, then each configured source in turn,
  then any source marked as a fallback, used only when nothing else has work
- [ ] An item that fails its checks repeatedly, or escalates, is set aside ("parked") after a
  configured number of unsuccessful runs, shown in `delivery status`, and skipped by later runs
  until the operator explicitly un-parks it
- [ ] An agent working one item can add a new backlog item of its own, a follow-up; an attempt to
  edit or delete an existing item is rejected as a failing check, not silently allowed
- [ ] A run interrupted partway (a crash, a usage limit) picks the same item back up where it left
  off on the next `--sources` run; a run that used up all its correction attempts starts that item
  fresh on its next run, keeping the unsuccessful attempt's branch to look at
- [ ] An item whose work escalates because the agent needs the operator's decision is parked with
  the question attached; `delivery status`, the report and the notify command show it;
  `delivery answer <item> "..."` records the operator's answer and the next run continues the work
  with that answer
- [ ] A recurring item becomes available again once its configured interval has passed since it
  last finished, with no action from the operator
- [ ] An operator can point a source at a script of their own that lists tasks in a simple format
  and marks them done, so a non-repository backlog feeds the same mechanism
- [ ] `delivery run --sources --max N` takes up to N items per run; a source that fails to list
  items, or returns something unreadable, is skipped for that run with the reason shown, without
  stopping the other sources

### UAT

**What you can now do:** Keep a running backlog of work for the harness, and have `delivery run
--sources` work through it unattended, remembering what's been tried, what's parked, and what's
waiting on you.

**How to try it:**
1. Add two or three small backlog items to your project, each a short plain-language brief naming
   a workflow.
2. Run `delivery run --sources`.
3. Watch `delivery status` show which item is being worked, then check the backlog afterwards: the
   finished item is marked resolved.
4. Add an item deliberately worded so the agent will need to ask you something, and run
   `delivery run --sources` again: see it parked with its question.
5. Answer it with `delivery answer <item> "..."` and run once more to see it pick back up.

**What you should see:** Work moves through your backlog on its own, in a sensible order, and
nothing silently gets lost, retried forever, or thrown away when it needs you.

**Why this matters:** This replaces Autoloop's fixed dispatch ladder with something an operator
can actually read, edit and extend.

---

## Slice 4: Land Several Tasks in Turn on One Branch You Review Once

**Status:** ✅ Complete — 2026-10-17 — `8336ca3`
**Tests:** ✅ Recorded — 2026-10-17 — `cdc56c5` — cli (vitest) — 1 UAT + 2 AC, 4 skipped
**Delivers:** Accepted tasks land one after another on a single open delivery branch for the
project, each built on the work before it and re-checked if the branch moved underneath it, so the
operator reviews and merges one clean branch per base branch instead of reconciling several
conflicting ones.

**Operational note:** Introduces one long-lived delivery branch per base branch, which stays open
across runs until the owner's closer lands it, instead of each task's branch being disposed of
immediately; its current tip and accepted state are kept in the ledger so later runs and reports
can refer to it.

**Build note:** Landing a task reuses the existing merge-back closer's fast-forward-only merge,
now aimed at the delivery branch instead of the base. The one new piece — re-checking a task whose
branch has moved since it started — follows the same principle merge queues use elsewhere:
re-check, never auto-resolve a conflict.

### Prerequisites

- Tasks can be dispatched several at a time in one run (the existing concurrent supervisor)
- Accepted work already lands through a project's existing closer (merge-back, open-PR,
  commit-to-branch)

### Acceptance Criteria

- [ ] The first task of a run, with no delivery branch yet open, creates one from the base
  branch's current tip; every later task in that and following runs starts from the delivery
  branch's current tip, so it sees every task landed before it
- [ ] A task still at the delivery branch's current tip when it finishes lands with nothing
  re-checked, because its own acceptance already proved the tree the branch now holds
- [ ] A task that finishes after another task has already landed is automatically rebuilt on top
  of that other task's work and re-checked before landing; if that re-check passes, it lands; if
  the branch has moved again meanwhile this can happen again, up to once per other task in the run
- [ ] A task whose rebuild conflicts, or whose re-check fails, is never landed as it stands: it is
  given a fresh attempt starting from the current tip, shown the conflicting work, and corrected
  like any rejected attempt, within its own retry budget
- [ ] A task that is escalated, parked, or otherwise stopped never lands, and does not block the
  tasks after it in the same run from landing
- [ ] The project's closer — merge to base, open a pull request, or leave the branch for the
  operator — runs once per run, after the run's tasks have landed, not once per task
- [ ] Bringing the operator's own commits into the delivery branch, when they have moved the base
  branch themselves, is attempted automatically; if that is clean, the run proceeds; if it is not,
  the run starts no new task and says plainly what is blocking it, without repeating the same
  failed attempt on every later run until something changes
- [ ] `delivery status` and `delivery report` name the delivery branch and show what has landed on
  it since it opened, and what the closer has done with it

### UAT

**What you can now do:** See several separate pieces of accepted work land one after another on a
single branch, in the order they finished, instead of as several branches you have to reconcile
yourself.

**How to try it:**
1. Add three small backlog items, each editing a different part of your project, and run
   `delivery run --sources --max 3`.
2. Watch `delivery status` show each task landing on the project's delivery branch as it's
   accepted.
3. Open your repository's branch list: there is one open delivery branch, not three task branches
   needing separate review.
4. Run `delivery report`: it names the delivery branch and lists what landed on it and when.
5. If your project's closer opens pull requests, check your usual tracker: there is one pull
   request covering all three pieces of work.

**What you should see:** One coherent branch (or one pull request) carrying everything the harness
has finished and checked, built up piece by piece, ready for you to review as a whole.

**Why this matters:** This is the fix for the problem that triggered this course correction: tasks
from the same run branching independently and conflicting with each other.

---

## Slice 5: Run Something After Work Lands, and Be Told What Happened

**Status:** ✅ Complete — 2026-10-18 — `f9e154d`
**Tests:** ✅ Recorded — 2026-10-18 — `35d8408` — cli — 1 UAT + 1 AC, 4 skipped
**Delivers:** Once a run's tasks have landed, the operator's own after-landing steps run
automatically — a deploy command, an agent writing release notes, raising follow-ups discovered
during the work — and the operator is notified of the outcome through their own usual channel.

### Prerequisites

- Accepted work lands on one delivery branch and the project's closer has acted on it (Slice 4)

### Acceptance Criteria

- [ ] An operator configures one or more steps to run once per run, after the closer has
  succeeded and only if at least one task landed: a plain command, or an agent asked to do
  something such as write release notes
- [ ] A step can name a command whose success confirms it worked, such as checking a deployed
  service responds, before moving to the next step
- [ ] An agent pass run as an after-step can add new backlog items, follow-ups it noticed, which
  are checked and handled like any other new item; any other change it makes is discarded along
  with its disposable copy of the project
- [ ] A step that fails, or whose confirming command fails, stops that and the remaining steps for
  the run; what didn't run is shown as pending, and the next scheduled run tries the pending steps
  first, from the one that failed
- [ ] A follow-up an agent raised while working an item, but which did not travel with the landed
  work because the project's backlog is a tracker rather than a file, is raised in that tracker
  once the closer has succeeded, exactly once even if raising is retried
- [ ] An operator points a single command at their run's outcome to be notified every time a run
  finishes, however it finishes
- [ ] A workflow can be given its own after-landing steps that replace the project's usual ones,
  for workflows whose job genuinely has nothing to deploy or announce

### UAT

**What you can now do:** Have the harness do something useful the moment work lands, such as
deploying it or telling you it's ready, without a separate manual step.

**How to try it:**
1. Configure an after-landing step that prints a short "release notes" message (or runs your
   project's real deploy command) once a run's work has landed.
2. Configure your usual notification command to receive the run's outcome.
3. Run `delivery run --sources` with at least one backlog item ready to land.
4. Once it lands, watch the after-landing step run and your notification arrive.
5. Check `delivery report`: the after-landing step and its outcome are recorded against that run.

**What you should see:** The moment work is accepted and landed, something happens because of it
— deployed, announced, or simply logged — without you doing it by hand, and you hear about it the
way you already expect to.

**Why this matters:** Landing work is not the end of the job; this closes the loop the way
Autoloop's deploy and notify scripts did, but as something any project can configure.

---

## Slice 6: Let Delivery Run Itself on a Schedule

**Status:** ✅ Complete — 2026-10-18 — `8c33cb9`
**Tests:** ✅ Recorded — 2026-10-18 — `69dce0f` — cli (vitest) — 1 UAT + 2 AC, 2 skipped
**Delivers:** An operator turns on a recurring schedule for a project, and `delivery run
--sources` runs by itself from then on, with missed runs caught up automatically.

**Build note:** Reuses systemd user timers in the shape Autoloop's own scheduling already proves,
rather than building a scheduling daemon of its own.

### Prerequisites

- `delivery run --sources` works through a project's backlog and sources unattended (Slice 3)

### Acceptance Criteria

- [ ] `delivery schedule enable` turns on a recurring run of `delivery run --sources` for the
  current project, on an interval the operator sets
- [ ] `delivery schedule status` shows whether scheduling is on for a project and when it last and
  next ran
- [ ] `delivery schedule disable` turns it off; the project can still be run by hand at any time
- [ ] A scheduled run that was missed, because the machine was off, runs as soon as possible
  afterwards rather than being skipped
- [ ] On a machine that cannot support the harness's scheduling mechanism, `delivery schedule
  enable` refuses plainly and tells the operator the equivalent line to add to their own system
  scheduler instead

### UAT

**What you can now do:** Set a project running on its own schedule once, instead of remembering to
run it yourself.

**How to try it:**
1. In a project with a backlog item ready to go, run `delivery schedule enable`, setting the
   interval short enough for a live demo (a few minutes).
2. Run `delivery schedule status` and see it confirm scheduling is on and when it will next run.
3. Wait for that interval to pass and see the run happen on its own, with nobody typing a
   `delivery` command.
4. Turn it off again with `delivery schedule disable` and confirm `delivery schedule status`
   reflects that.

**What you should see:** The project keeps working through its backlog on its own timetable,
exactly as if you had typed the command yourself.

**Why this matters:** This is what turns "a tool I run" into "a thing that quietly keeps a project
moving", which is the whole premise of replacing Autoloop's timers.

---

## Slice 7: Use a GitHub Issue Tracker as Your Backlog

**Delivers:** On a project that already tracks its work in GitHub issues, an operator labels an
issue instead of writing a backlog file, and the harness works it, closes it (or has the pull
request close it) when it lands, and mirrors parked or escalated work back onto the issue.

**Build note:** Built on the `gh` command-line tool rather than a hand-written GitHub API client;
any other tracker (Bitbucket, Jira) is left to the operator's own small script against the same
source contract, so the harness carries no tracker-specific client code beyond GitHub.

### Prerequisites

- A project backlog and its work sources already drive runs (Slice 3)
- Follow-ups an agent raises while working are a known, checked kind of thing (Slice 3)

### Acceptance Criteria

- [ ] An operator points a source at a GitHub label; open issues carrying that label are read as
  backlog items, the issue's title and body become the task's brief, and a "workflow" label
  chooses which workflow delivers it
- [ ] An issue without the label is left alone; adding the label is what approves it for delivery
- [ ] When the work lands, the issue is closed with a comment linking to what was done, or — on a
  project that opens pull requests — closes automatically when that pull request merges
- [ ] A follow-up an agent raises while working a tracker-backed item is not left in the project's
  files; it is opened as a new issue once the work has landed, and never duplicated if that step
  is retried
- [ ] An item that gets parked, or that needs the operator's decision, shows that on the issue
  itself — a label, and the question as a comment — as well as in `delivery status`
- [ ] An issue whose text changes after it was labelled is left alone and reported as skipped,
  until the label is added again, so a public repository's issue cannot be edited after approval
  to change what the agent is asked to do
- [ ] If the `gh` tool is missing or not signed in, that source is skipped for the run with a
  plain reason shown, and the project's other sources still run

### UAT

**What you can now do:** Approve and track a piece of work for the harness entirely from your
GitHub issues, the way you already track everything else.

**How to try it:**
1. Open an issue on your project describing a small piece of work, and add the label you've
   configured as the delivery source.
2. Run `delivery run --sources` and watch `delivery status` pick up the issue.
3. When it lands, go back to the issue: it's closed, with a comment pointing at what was done.
4. Open a second issue, this time worded so the agent will need to ask you something, add the
   label, and run again: see the issue get a comment with the question and a "parked" label.

**What you should see:** Your GitHub issues become the to-do list the harness reads from and
reports back to, with no separate backlog file to maintain.

**Why this matters:** A project that already lives in GitHub gets the same automatic delivery as
one using the file-based backlog, without the operator writing any integration code.

---

## Slice 8: Review a Project, Choose What to Fix, and Hold Serious Problems for Sign-Off

**Delivers:** An operator runs a built-in or installed pack's review, reads the problems it found
as plain-language backlog ideas, approves the ones they want fixed, and anything serious enough is
held on its own branch for the operator's explicit sign-off before it reaches the delivery branch.

**Build note:** A pack becomes a small bundle of workflows that read and write the same backlog
every other item uses, rather than keeping its own separate findings, approval and fix records. A
finding's "is the problem still there?" check reuses the harness's existing closed set of check
kinds, now available to any backlog item, not only to pack findings.

### Prerequisites

- Workflows can be defined and run by name (Slice 2)
- A project's backlog, sources and item ledger already drive ordinary delivery (Slice 3)
- Accepted work lands in turn on one delivery branch (Slice 4)

### Acceptance Criteria

- [ ] `delivery review <pack>` runs the pack's scan as an ordinary workflow and adds one backlog
  idea per problem found, each with a severity and a plain-language description, without changing
  anything else in the project
- [ ] A problem the scan reports but the harness cannot independently confirm is still present is
  rejected rather than offered as an idea
- [ ] `delivery approve <ids>` (or `--all`) turns chosen ideas into open items using the pack's fix
  workflow; `delivery decline <ids>` sets the rest aside; an agent itself can never approve or
  decline an idea
- [ ] An approved item is delivered as an ordinary backlog item, through the pack's fix workflow,
  and is only accepted once the specific problem is confirmed gone, in addition to the project's
  own tests still passing
- [ ] An item whose severity is at or above a pack's configured threshold does not reach the
  shared delivery branch on its own; it waits, finished and checked, on its own branch until
  `delivery sign-off <id>` explicitly lands it; `delivery reject <id>` sets it aside instead
- [ ] `delivery backlog` lists ideas, open items, held items and parked items in plain language;
  `delivery backlog <id>` shows one item in full, including the technical detail an engineer would
  want
- [ ] On GitHub, adding the review's label to an issue is itself the approval, with no separate
  approve command needed

### UAT

**What you can now do:** Ask the harness to look over your project, see a plain-language list of
problems, choose what gets fixed, and keep a human decision in the loop for anything serious.

**How to try it:**
1. Run `delivery review <pack>` against a project (or the example project with planted problems)
   and read the numbered list of problems it reports.
2. Approve a couple with `delivery approve <ids>` and decline the rest.
3. Run `delivery run --sources` and watch the approved problems get fixed and land.
4. Find one that's serious enough to be held; confirm it sits finished but unlanded until you run
   `delivery sign-off <id>`.

**What you should see:** A readable review of your project, work only starting on the problems you
chose, and anything serious waiting for your explicit word before it reaches the branch you
review.

**Why this matters:** This folds Autoloop-era "packs" into the same backlog and workflow mechanism
as everything else, instead of maintaining a second, parallel system just for reviews.
