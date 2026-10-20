# Check your setup before a run

This guide shows how to check your configuration and see exactly what the agent will be told, before anything runs. Neither command starts an agent, needs a sign-in or needs a network.

```bash
delivery validate
```

It reads your `delivery.config.json` the way `delivery run` would, says what it found, and stops:

```
Checking delivery.config.json…
✓ domain description: present
✓ 3 tasks queued
✓ gate: runs `npm test`
✓ closer: commits to a new branch
Ready to run.
```

If something is wrong it prints the one thing to fix instead, such as an empty task or two
tasks that say the same thing, and exits 2. It never starts an agent, needs no sign-in and no
network, and changes nothing on disk, so it is safe in CI on every push and safe while a run
is going. `--config <path>` and `--repo <path>` mean what they mean on `delivery run`.

For CI, add `--json` to get every problem at once instead of the first, as one JSON document:

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
file as a whole) and says it in the same words as the plain form. A clean file gives
`{ "ready": true, "problems": [] }`. The exit codes are the same as without `--json`.

# See what the agent will be told

```bash
delivery preview
```

It prints, before anything runs, the instructions the next task on your list would be given,
word for word, with your project description in place, and then what the agent may do:

```
Next up is Task 1 of 3: add a page that shows who's on call today

What the worker will be told (before any run starts):
─────────────────────────────────────────────────────
You are the worker on a gated delivery harness.
…
A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.

## Task
…
─────────────────────────────────────────────────────
Tools it can use: read files, look through the project, edit files, run commands.
```

`--queue-index 3` shows the third task on your list instead, numbered as "Task 3 of 3" numbers
it. `--role gate-maintenance` shows what the agent that repairs your check is told when the
check can't run. A project with a single `task` shows that one. Like `delivery validate`, it
needs no agent, no sign-in and no network, changes nothing on disk, reports a problem with your
configuration in the same words, and takes `--config` and `--repo`.

For a workflow, `delivery preview --step build` shows what that step's agent will be told, with its own instruction and check, and the agent options it runs with (yours, with the step's laid over them). Add `--workflow <name>` when two workflows have a step of that name, and `--task "..."` to preview a task you would type.

## Next steps

- [Work through a task list](run-a-task-list.md): run what you have set up
- [Configuration reference](configuration-reference.md): every setting
