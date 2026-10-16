# Setting up a project

[Getting started](getting-started.md) ran one task you typed on the command line. A
project is more than that: it has things an agent should know before it starts, more
than one thing to do, and an owner who wants to check the setup before any agent time
is spent. This guide sets one up from start to finish, in a complete example project
that ships with the harness. You describe the project, list what you want done, choose
how the work is checked and what happens to it, check the setup, read what the agent
will be told, run the whole list, and then add to it.

All of it lives in one file of plain settings, `delivery.config.json`, checked in beside
your code. You write no code and read no harness source.

## What you need

- The `delivery` command, installed as [Getting started](getting-started.md) describes.
- Node.js 22 or later, and `git`.
- For steps 8 and 9, Claude Code, signed in. Check with `claude auth status`; if it says
  you are not signed in, run `claude auth login`, or set `ANTHROPIC_API_KEY`. Checking and
  previewing your setup need no sign-in and no network.

## 1. Get the example project

The harness ships an example project: a small library of text helpers with one function,
its test, and a finished `delivery.config.json`. Copy it somewhere outside the harness
checkout and make it a git repository:

```bash
cp -r examples/project-configuration-example ~/text-helpers
cd ~/text-helpers
git init -b main
git add -A
git commit -m "Start the example project"
```

This is its whole configuration file. The next four steps explain it a setting at a time.

```json
{
  "domain": "A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.",
  "tasks": [
    "add a function that turns a title into a URL slug, with a test",
    "add a function that shortens long text to a given length, with a test"
  ],
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "agent": { "append": "Keep changes small and explain each one in the commit message." }
}
```

## 2. Describe your project

`domain` says what your project is, in your own words: a sentence or two about what it
does, what it is built with, and anything an agent should know before it starts. Every
agent on every run is told it before its own instructions, so you never retype it. A run
keeps the description it started with: editing it changes the next run, not one already
going.

A description that runs to several paragraphs is easiest in a `delivery.config.js` that
exports the same settings, with the description in a template literal. The
[readme](../README.md#configure-it-once) shows that form.

## 3. List what you want done

`tasks` is your list, in the order you want it done, one plain sentence per thing. Write
each the way you would ask a colleague: what you want, and that it should come with a
test. `delivery run` works down the list one task at a time, and the work for each task
ends up on a branch of its own.

The list is yours to edit between runs. A new sentence runs in its place. Rewording a
sentence makes it a new task, which is also how you ask for a finished one again.
Deleting a sentence leaves what already ran in the history. An empty sentence, or two
that say exactly the same thing, are refused before anything runs.

Every task's work is checked for weakened tests, whatever the check you set up says: a test
deleted or renamed (`tests-untouched`), a change to how tests run, such as a test-runner setting or
a CI file (`check-untouched`), a new skip marker (`no-skips`), and a test setting or skipping test
hidden from git (`ignored`). Editing an existing test is allowed, because test-first work and
refactoring do it. A task written as an object can change this with `guards`: `"add":
["tests-unchanged"]` also refuses edits to existing tests, and `"off": [...]` turns a guard off
for a task whose job is to change tests. The report shows any task whose guards differ.

## 4. Choose how the work is checked, and what happens to it

`gate` is the check that decides whether the agent's work is good: the agent's own word
is never taken as proof. The simplest way to choose one is by name:

```json
{ "gate": { "type": "test-runner" } }
```

That runs your project's own tests with `npm test` and passes when they succeed. There are
five ready-made checks, and each takes only the detail it needs:

- `test-runner` runs your tests. Add `"command"` if they are not run with `npm test`.
- `file-exists` checks that a file is there once the work is done: `{ "type": "file-exists", "path": "CHANGES.md" }`. It is judged only after the work, so a file that is still missing fails it.
- `command-succeeds` checks that a command succeeds: `{ "type": "command-succeeds", "command": "npm run lint" }`.
- `schema-validates` checks that a JSON file has the shape another file describes:
  `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. It
  fetches its checker the first time it runs, so that run needs the network.
- `commits-ahead` checks that the work added at least one commit: `{ "type": "commits-ahead" }`. Useful for a workflow step whose job is to commit something other than passing tests.

`delivery validate` says in plain words what the check you chose does, and if you misspell a
name it lists the five.

The example writes its check out in full instead, which does exactly the same as
`test-runner`: `"command": "npm test"` runs the tests, and `"parseMode": "exitcode"` means the
check passes when the command succeeds. Any command that succeeds when the work is good and
fails when it is not will do.

`closer` is what happens to work that passes the check. The example's `commit-to-branch`
commits it to a new branch and leaves `main` alone, so you look at it before you merge
it. The other built-in choices are `merge-back`, which merges it into your main branch,
and `open-pr`, which opens a pull request.

## 5. Tell the agent how you like things done

`agent` holds options for the agent's sessions. `append` is text added to what every agent is
told; the example asks for small, explained changes. The agent already works with your own
Claude Code setup: your settings, CLAUDE.md, skills and plugins all load, and it has every tool
they give it. To keep it from a tool, add it to `permissions.deny` in your Claude settings.

`fence` says whether the agent works inside a fence that keeps your main folder read-only while
it works in its own copy: `"preferred"` (the default, used wherever it works), `"required"` (a
run refuses to start without it), or `"off"`. It needs bubblewrap (`bwrap`) on Linux; where it
cannot be had, a `"preferred"` run goes ahead and says so first.

## 6. Check your setup

Before spending anything, check the file:

```bash
delivery validate
```

```text
Checking delivery.config.json…
✓ domain description: present
✓ 2 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
✓ agent options: append
Ready to run.
```

Each tick is one thing it read. If something is wrong it prints the one thing to fix
instead, and nothing starts. It needs no sign-in and no network and changes nothing, so
run it as often as you like, and in CI on every push. In CI, `delivery validate --json` lists every problem at once, each with the setting it concerns, as one JSON document a script can read.

In a project with no `delivery.config.json` of its own, after `delivery fix` has run,
`validate`, `preview`, `status` and `report` read the configuration `delivery fix` wrote
beside the review instead (`.delivery/packs/<review>/plan.config.json`), so you can check and
follow a fix like any other list. `delivery run` never uses it.

## 7. See what the agent will be told

```bash
delivery preview
```

It prints the instructions the first task on your list will be given, word for word, with
your description in place. The middle is long, so it is shortened here:

```text
Next up is Task 1 of 2: add a function that turns a title into a URL slug, with a test
What the worker will be told (before any run starts), added to Claude Code's own instructions:
─────────────────────────────────────────────────────
You are carrying out one task for a delivery harness, in a working copy and branch it made for this task.
…
A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.
…
## Acceptance
Your work is judged by the project's check: the command `npm test`, run in this working copy, where it passes or fails as a whole, by its exit code. You may read what it runs and run it yourself. A check that passed before your work must still pass.

The harness also checks your change against the commit this task started from: no existing test deleted or renamed; no change to how tests run (test-runner settings, CI files, the test command, .gitignore, and the Makefile or equivalent build file, since each can hide or redefine what the tests do); no new skip or only marker added to a test file; no test setting, or test that switches others off, left out of git; no existing backlog item in `.delivery/backlog/` edited or removed, and any new item you add there (a follow-up) in the item format. A failure names what it found.

Your branch is the deliverable. The harness merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to.
…
─────────────────────────────────────────────────────
Your own Claude Code settings, CLAUDE.md, skills, plugins, hooks and MCP servers also apply.
It can use every tool your setup allows.
Agent options: none.
```

`delivery preview --queue-index 2` shows the second task instead. Like `delivery
validate`, it needs no sign-in and changes nothing.

For a workflow, `delivery preview --step build` shows what that step's agent will be told, with its own instruction and check, and the agent options it runs with (yours, with the step's laid over them). Add `--workflow <name>` when two workflows have a step of that name, and `--task "..."` to preview a task you would type.

## 8. Run the list

```bash
delivery run
```

```text
Task 1 of 2: add a function that turns a title into a URL slug, with a test
Starting run <run-id>: add a function that turns a title into a URL slug, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that turns a title into a URL slug, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Task 2 of 2: add a function that shortens long text to a given length, with a test
Starting run <run-id>: add a function that shortens long text to a given length, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that shortens long text to a given length, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 2 of 2 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

Each task ends by naming the branch its work is on. Your `main` branch is untouched: read
what the agent did with `git log -p <branch>`, and merge what you like.

If the run stops part way, because you closed the terminal or pressed Ctrl-C, run
`delivery run` again in the same folder. It carries on with the task it was on, then the
rest of the list. `delivery status --all` lists every run so far.

## 9. Add to the list

Add one more sentence to the end of `tasks`, in your own words. For example:

```json
{
  "domain": "A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.",
  "tasks": [
    "add a function that turns a title into a URL slug, with a test",
    "add a function that shortens long text to a given length, with a test",
    "add a function that counts the words in a sentence, with a test"
  ],
  "gate": { "type": "command", "command": "npm test", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "agent": { "append": "Keep changes small and explain each one in the commit message." }
}
```

The file is part of your project, so commit the change, then run the list again:

```bash
git commit -am "Add a task to the list"
delivery run
```

```text
Task 3 of 3: add a function that counts the words in a sentence, with a test
Starting run <run-id>: add a function that counts the words in a sentence, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that counts the words in a sentence, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
Every task on your list is done. Add another under `tasks` to keep going, or `delivery status --all` to review what ran.
Your task list: 3 of 3 tasks completed and committed to their own branches.
Run `delivery report` for what to do.
```

Only your new task runs. The first two already have finished runs, and what is left to do
is worked out afresh each time from what has already run, so nothing is stored that could
fall out of step with your file. The count is always the list as it is written now.

## Going further

Everything above uses the harness's built-in pieces. When you need your own, each has a
guide of its own:

- [Writing a gate](writing-a-gate.md): a check of your own, written in code, in place of a command.
- [Writing a closer](writing-a-closer.md): your own way of handling work that passes, such as notifying a channel.
- [Configuring a role](configuring-a-role.md#from-the-configuration-file): changing an agent's instructions as well as its tools, and why a misspelled tool name only shows up during a run.
- [Testing your delivery pipeline](testing-your-pipeline.md): proving your own check, closing action and roles together against a scripted agent.

### Workflows

A workflow does a task in more than one checked step, in the order you give. Name it under
`workflows`:

    "workflows": {
      "plan-then-build": {
        "steps": [
          { "name": "plan", "prompt": "Write a short plan to PLAN.md.",
            "gate": { "type": "file-exists", "path": "PLAN.md" } },
          { "name": "build", "prompt": "Carry out PLAN.md.", "continue": true }
        ]
      }
    }

and run a task through it with `delivery run --task "add a rota page" --workflow plan-then-build`.

Each step is told the task and its own `prompt`. A step is checked by the project's `gate` unless it
names its own (any ready-made check works, including `commits-ahead`). A step that fails is
corrected on its own, on its own limits; the next step starts only once it is accepted, from the
commit its work was saved in. The task is delivered once, after the last step. A step may also set
`agent` options (laid over the project's), `guards` (`add` or `off`, for that step only), and
`continue: true` to pick up the previous step's agent session. `delivery preview --step <name>`
shows what a step will be told. A task run without `--workflow` is one step, as before.

To start a configuration for a project of your own, run `delivery init` in it: it asks what the
project is, what checks the work, what happens to work that passes, and what you would like
done, one thing at a time, and writes the file for you. The [readme](../README.md#configure-it-once)
lists every setting.

### A backlog of work items

Rather than a fixed list, a project can keep its work as items in `.delivery/backlog/`. Each item
is a markdown file, committed to the repository, named `<timestamp>-<slug>.md` (for example
`20261016T090000Z-greet-people.md`) so that items added at the same time never collide. Its front
matter says how it is done, and the text below it is the brief the agent receives:

    ---
    status: open
    workflow: plan-then-build
    priority: 10
    cadence: 7d
    spec: docs/greeting-spec.md
    ---
    Tidy the greeting copy so it matches the spec.

`status` is one of `open`, `idea`, `resolved` or `declined`; only `open` items are worked, and an
`idea` is material for other work rather than a task. `workflow` names the workflow that delivers
it. `priority` orders items, lower first, with unprioritised items last. `cadence` (`30m`, `12h`,
`7d` or `2w`) makes an item recur: it is due again once that long has passed since it last closed.
Any other field is available to the step prompts as `{{task.<field>}}`, such as `spec` above.

Items are read from your base branch's last commit: `origin`'s, when the project has one. So commit
an item, and push it if there is an origin, for it to be worked. Item files on disk that the base
does not yet hold are named, and not worked.
