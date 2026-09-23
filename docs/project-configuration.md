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
  "roles": {
    "worker": { "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"] }
  }
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

## 4. Choose how the work is checked, and what happens to it

`gate` is the check that decides whether the agent's work is good: the agent's own word
is never taken as proof. The simplest way to choose one is by name:

```json
{ "gate": { "type": "test-runner" } }
```

That runs your project's own tests with `npm test` and passes when they succeed. There are
four ready-made checks, and each takes only the detail it needs:

- `test-runner` runs your tests. Add `"command"` if they are not run with `npm test`.
- `file-exists` checks that a file is there: `{ "type": "file-exists", "path": "CHANGES.md" }`.
- `command-succeeds` checks that a command succeeds: `{ "type": "command-succeeds", "command": "npm run lint" }`.
- `schema-validates` checks that a JSON file has the shape another file describes:
  `{ "type": "schema-validates", "file": "data.json", "schema": "data.schema.json" }`. It
  fetches its checker the first time it runs, so that run needs the network.

`delivery validate` says in plain words what the check you chose does, and if you misspell a
name it lists the four.

The example writes its check out in full instead, which does exactly the same as
`test-runner`: `"command": "npm test"` runs the tests, and `"parseMode": "exitcode"` means the
check passes when the command succeeds. Any command that succeeds when the work is good and
fails when it is not will do.

`closer` is what happens to work that passes the check. The example's `commit-to-branch`
commits it to a new branch and leaves `main` alone, so you look at it before you merge
it. The other built-in choices are `merge-back`, which merges it into your main branch,
and `open-pr`, which opens a pull request.

## 5. Decide what the agent may do

`roles` changes what an agent is told and which tools it may use. The example keeps the
built-in instructions for the agent that does each task, the worker, and gives it a
shorter list of tools, without `Bash`: it can read, search and edit files, but cannot run
commands. Leave `roles` out and every agent keeps its built-in instructions and tools.

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
✓ worker: your own tool list
Ready to run.
```

Each tick is one thing it read. If something is wrong it prints the one thing to fix
instead, and nothing starts. It needs no sign-in and no network and changes nothing, so
run it as often as you like, and in CI on every push. In CI, `delivery validate --json` lists every problem at once, each with the setting it concerns, as one JSON document a script can read.

## 7. See what the agent will be told

```bash
delivery preview
```

It prints the instructions the first task on your list will be given, word for word, with
your description in place, and then what the agent may do. The middle is long, so it is
shortened here:

```text
Next up is Task 1 of 2: add a function that turns a title into a URL slug, with a test
What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small library of text helpers that our team's Node.js scripts share. Plain JavaScript modules with no dependencies, each function tested with node:test.
…
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files.
```

"run commands" is missing from the last line because of the shorter tool list in step 5.
`delivery preview --queue-index 2` shows the second task instead. Like `delivery
validate`, it needs no sign-in and changes nothing.

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
  "roles": {
    "worker": { "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"] }
  }
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

To start a configuration for a project of your own, run `delivery init` in it: it asks what the
project is, what checks the work, what happens to work that passes, and what you would like
done, one thing at a time, and writes the file for you. The [readme](../README.md#configure-it-once)
lists every setting.
