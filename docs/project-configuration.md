# Set up a project

This guide takes you through setting up a project with the example in
`examples/project-configuration-example`. [Get started](getting-started.md) ran one task you
typed on the command line; a project has more to it. You describe the project, list tasks,
choose a check and a closer, validate the setup, preview what the agent will be told, run the
list and extend it. By the end you can write a `delivery.config.json` for your own project.

All of it lives in one file of plain settings, `delivery.config.json`, checked in beside
your code. You write no code. To have the file written for you instead, see
[Set up with questions](set-up-with-init.md).

## What you need

- The `delivery` command, installed as [Get started](getting-started.md) describes, and a
  checkout of the harness: step 1 copies the example from its `examples/` folder.
- Node.js 22 or later, and `git`.
- For steps 8 and 9, Claude Code, signed in. Check with `claude auth status`. If it says
  you are not signed in, run `claude auth login`, or set `ANTHROPIC_API_KEY`. Checking and
  previewing your setup need no sign-in and no network.

## 1. Get the example project

The harness ships an example project: a small library of text helpers with one function,
its test and a finished `delivery.config.json`. From the root of
your harness checkout, copy it outside the checkout and make it a git repository:

```bash
cp -r examples/project-configuration-example ~/text-helpers
cd ~/text-helpers
git init -b main
git add -A
git commit -m "Start the example project"
```

This is its whole configuration file. The next four steps explain it one setting at a time.

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
keeps the description it started with. Editing it changes the next run, not one already
going.

For a description of several paragraphs, use a `delivery.config.js` that
exports the same settings, with the description in a template literal. The
[configuration reference](configuration-reference.md) shows that form.

## 3. List what you want done

`tasks` is your list, in the order you want it done, one plain sentence per thing. Write
each the way you would ask a colleague: what you want, and that it should come with a
test. `delivery run` works down the list one task at a time, and the work for each task
ends up on a branch of its own.

You can edit the list between runs. A new sentence runs in its place. Rewording a
sentence makes it a new task, which is also how you ask for a finished one again.
Deleting a sentence leaves what already ran in the history. Before anything runs, the harness
refuses an empty sentence, and two sentences that say exactly the same thing.

The harness also guards every task against weakened tests, whatever your check says. It
refuses:

- a deleted or renamed test (`tests-untouched`);
- a change to how tests run, such as a test-runner setting or a CI file (`check-untouched`);
- a new skip marker (`no-skips`);
- a test setting, or a skipping test, hidden from git (`ignored`).

Editing an existing test is allowed, because test-first work and refactoring do it. A task
written as an object can change this with `guards`:

```json
{ "intent": "rewrite the slug tests to use node:test subtests", "guards": { "off": ["tests-untouched"] } }
```

`"add": ["tests-unchanged"]` also refuses edits to existing tests, and `"off"` turns a guard off
for a task whose job is to change tests. The report shows any task whose guards differ.

## 4. Choose how the work is checked, and what happens to it

`gate` is your check: it decides whether the agent's work is good, and the harness never takes
the agent's own word as proof. Later steps call it the check. The simplest way to choose one is
by name:

```json
{ "gate": { "type": "test-runner" } }
```

That runs your project's `test` script from `package.json` and passes when it succeeds. If
there is no `test` script and you gave no `command`, the harness refuses and says so. There are
five ready-made checks, and each takes only the detail it needs:

- `test-runner` runs your tests. Add `"command"` if they are not run by a `test` script.
- `file-exists` checks that a file is there once the work is done: `{ "type": "file-exists", "path": "CHANGES.md" }`.
  The harness judges it only after the work, so a file that is still missing fails the check.
- `command-succeeds` checks that a command succeeds: `{ "type": "command-succeeds", "command": "npm run lint" }`.
- `schema-validates` checks that a JSON file has the shape another file describes:
  `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. It
  fetches its checker the first time it runs, so that run needs the network.
- `commits-ahead` checks that the work added at least one commit: `{ "type": "commits-ahead" }`.
- `fails-with-new-test` checks that the work committed a test that fails, where your tests passed before: `{ "type": "fails-with-new-test" }`. Use it on the first step of a reproduce-then-fix workflow.
  Use it for a [workflow](use-workflows.md) step whose job is to commit something other than
  passing tests.

`delivery validate` says in plain words what the check you chose does. If you misspell a
name, it lists the five.

The example writes its check out in full instead, which does the same as
`test-runner`. `"command": "npm test"` runs the tests, and `"parseMode": "exitcode"` means the
check passes when the command succeeds. Any command that succeeds when the work is good and
fails when it is not will do.

`closer` is what happens to work that passes the check. The example's `commit-to-branch`
commits it to a new branch and leaves `main` alone, so you can look at it before you merge
it. The other built-in choices are `merge-back`, which merges it into your main branch,
and `open-pr`, which opens a pull request. See [closer](glossary.md#closer).

## 5. Tell the agent how you like things done

`agent` holds options for the agent's sessions. `append` is text added to what every agent is
told; the example asks for small, explained changes. The agent already works with your own
Claude Code setup: it loads your settings, CLAUDE.md, skills and plugins, and has every tool
they give it. To keep it from a tool, add the tool to `permissions.deny` in your Claude settings.

`fence` says whether the agent works inside a fence that keeps your main folder read-only while
it works in its own copy: `"preferred"` (the default, used wherever it works), `"required"` (a
run refuses to start without it), or `"off"`. It needs bubblewrap (`bwrap`) on Linux. Where
bubblewrap is unavailable, a `"preferred"` run goes ahead and says so first.

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

Each tick is one thing it read. If something is wrong, it prints the one thing to fix
instead, exits with code 2 and starts nothing. It needs no sign-in and no network and changes nothing, so
run it as often as you like, including in CI on every push. In CI, `delivery validate --json` lists every problem at once, each with the setting it concerns, as one JSON document a script can read.

## 7. See what the agent will be told

```bash
delivery preview
```

It prints the instructions the first task on your list will be given, word for word, with
your description in place. The middle is long, so this output shortens it:

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

The harness also checks your change against the commit this task started from: no existing test deleted or renamed; no change to how tests run (test-runner settings, CI files, the test command, .gitignore, and the Makefile or equivalent build file, since each can hide or redefine what the tests do); no new skip or only marker added to a test file; no test setting, or test that switches others off, left out of git; no existing item in .delivery/backlog/ edited or removed, and any new item you add there (a follow-up) in the item format. A failure names what it found.

Your branch is the deliverable. The harness merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to.
…
─────────────────────────────────────────────────────
Your own Claude Code settings, CLAUDE.md, skills, plugins, hooks and MCP servers also apply.
It can use every tool your setup allows.
Agent options: none.
```

`append` is in the instructions above, so the last line lists only other agent options.
`delivery preview --queue-index 2` shows the second task instead. Like `delivery
validate`, it needs no sign-in and changes nothing.

For a workflow, `delivery preview --step build` shows what that step's agent will be told, with its own instruction and check, and the agent options it runs with (yours, with the step's laid over them). Add `--workflow <name>` when two workflows have a step of that name. Add `--task "..."` to preview a task you would type.

## 8. Run the list

```bash
delivery run
```

If it stops at once, the message says why. Outside a git repository it says "This isn't a git
repository yet" and exits with code 2; if Claude Code is not signed in it says so and exits with
code 3.

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

`<run-id>` stands for the id the harness printed for that run. Each task ends by naming the
branch its work is on, and your `main` branch is untouched. Read what the agent did with `git log -p <branch>`, and merge what you like.

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

Only your new task runs. The first two already have finished runs. The harness works out what is left to do
afresh each time from what has already run, so nothing is stored that could
fall out of step with your file. The count is always the list as it is written now.

## Next steps

- [Do a task in steps](use-workflows.md): split one task into checked steps.
- [Work through a backlog](work-a-backlog.md): keep work as items in the repository.
- [Take work from other sources](work-sources.md): read work from a command or GitHub issues.
- [Run steps after landing](run-after-landing.md): deploy or announce once work has landed.
- [Check your setup](check-your-setup.md) and [Work through a task list](run-a-task-list.md).
- [Configuration reference](configuration-reference.md): every setting.
- [Write a gate](writing-a-gate.md): a check of your own, written in code, in place of a command.
- [Write a closer](writing-a-closer.md): your own way of handling work that passes, such as notifying a channel.
- [Configure a role](configuring-a-role.md): change an agent's instructions as well as its tools.
- [Test your pipeline](testing-your-pipeline.md): prove your own check, closer and roles against a scripted agent.
