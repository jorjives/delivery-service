# Check your setup

This guide shows how to check your configuration file and see what the agent will be told, before anything runs. Neither command starts an agent, needs a sign-in or needs a network, and neither changes anything on disk, so both are safe in CI on every push and while a run is going. It assumes you have [set up a project](project-configuration.md) or answered the questions in [Set up with questions](set-up-with-init.md).

## Validate your configuration

```bash
delivery validate
```

It reads your `delivery.config.json` the way `delivery run` would, says what it found, and stops:

```text
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

The `domain` line is your project description. The `gate` line is the [check](glossary.md#check)
that decides whether the agent's work is good, and the `closer` line is what happens to work that
passes. [Configuration reference](configuration-reference.md) lists every setting.

If something is wrong, it prints the one thing to fix instead, such as an empty task or two
tasks that say the same thing, and exits 2. `--config <path>` and `--repo <path>` mean what they
mean on `delivery run`. If there is no configuration file, it says so and exits 2:

```text
No delivery.config.json found. Run `delivery init` to create one, or see the getting-started guide (docs/getting-started.md).
```

For CI, add `--json` to get every problem at once, instead of only the first, as one JSON document:

```bash
delivery validate --json
```

```json
{
  "ready": false,
  "problems": [
    { "field": "tasks.1", "message": "I can't use …/delivery.config.json: `tasks` item 2 is empty. Add a sentence describing what you want done, or remove it." },
    { "field": "domain", "message": "I can't use …/delivery.config.json: `domain` is empty. Describe your project in a sentence or two, or remove it." }
  ]
}
```

Each problem names the setting it concerns (list positions count from 0, and `null` means the
file as a whole) and uses the same words as the plain form. A clean file gives
`{ "ready": true, "problems": [] }`. The exit codes match those without `--json`.

## Preview what the agent will be told

```bash
delivery preview
```

It prints the instructions the harness adds for the next task on your list, word for word, with
your project description in place, and then what else applies to the agent. The sample is shortened
here:

```text
Next up is Task 1 of 3: add a page that shows who's on call today

What the worker will be told (before any run starts), added to Claude Code's own instructions:
─────────────────────────────────────────────────────
You are carrying out one task for a delivery harness, in a working copy and branch it made for this task.
…
A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.

## Task
{
  "intent": "add a page that shows who's on call today"
}
…
─────────────────────────────────────────────────────
Your own Claude Code settings, CLAUDE.md, skills, plugins, hooks and MCP servers also apply.
It can use every tool your setup allows.
Agent options: none.
```

Unlike `validate`, `preview` works without a configuration file: it uses the defaults, and
asks for a task with `--task "<task>"` when there is no list. A configuration problem is reported
in the same words as `validate` uses, and `--config` and `--repo` work as they do there.

- `--queue-index 3` shows the third task on your list instead, numbered as in "Task 3 of 3".
- `--role gate-maintenance` shows what the agent that repairs your check is told when the check
  cannot run.
- A project with a single `task` shows that one.
- `--task "<task>"` previews a task you would type.
- `--step <step-name>` shows what that step of a [workflow](project-configuration.md#workflows)
  will be told, with its own instruction and check, and the agent options it runs with (yours,
  with the step's laid over them). Add `--workflow <name>` when two workflows have a step of that
  name.

## Next steps

- [Work through a task list](run-a-task-list.md): run the whole list
- [Configuration reference](configuration-reference.md): every setting
