---
name: understanding-delivery-service
description: Use when asked to set up, write, validate or fix a `delivery.config.json` for a project, to make a repo workable by the `delivery` command, or when you meet `delivery.config.json`, a `.delivery/` directory, "gate", "closer" or "delivery run" in a project that is not the delivery-service repo itself. Also for `delivery validate` / `delivery preview` errors.
---

# Understanding Delivery Service

## Overview

`delivery` is a deterministically gated agent delivery harness. An agent works on a disposable copy of a repo; **the project's own check (the gate) decides** whether the work is good, never the agent; passing work goes through a **closer** (leave on a branch, merge back, open a PR). Setting a project up means writing one file, `delivery.config.json`, at the repo root. No code needed.

The harness lives outside your project: source and the full docs are in `/home/jorjives/dev/delivery-service` (`docs/`). The `delivery` command is installed at `~/.local/bin/delivery`, which is not on PATH in every shell: call it by full path if `delivery: command not found`. Read the doc named below for the setting in front of you, not all of them.

## Set up a project

1. **Preconditions:** a git repo; Node 22+; for real runs, a signed-in Claude Code. `validate` and `preview` need none of that.
2. **Write `delivery.config.json` by hand.** `delivery init` asks questions and exits 2 without a terminal, so it is no use to you. Every setting is optional; an unknown setting stops every command.
3. **Choose the gate first.** It must be a command that exits non-zero when the work is bad, which the agent cannot weaken. Default is the `test` script in `package.json`; with none, you must set one.
4. **Validate, then preview, both free and offline:**

```bash
delivery validate          # add --json for every problem at once; exit 2 = fix the config
delivery preview           # prints exactly what the agent will be told for the next task
```

5. Commit `delivery.config.json`. Do not commit `.delivery/` (it carries its own `.gitignore`).

## Minimal config

```json
{
  "domain": "One or two sentences: what the project is, stack, how it is tested.",
  "gate": { "type": "command", "command": "make verify", "parseMode": "exitcode" },
  "closer": { "type": "commit-to-branch" },
  "tasks": ["add X, with a test"]
}
```

## Which setting, which doc

All paths are under `/home/jorjives/dev/delivery-service/docs/`.

| Decision | Setting | Read |
|---|---|---|
| Project description every agent is told | `domain` | configuration-reference.md |
| What decides "good" | `gate` (`test-runner`, `command-succeeds`, `file-exists`, `schema-validates`, `commits-ahead`, `command`, `custom`) | writing-a-gate.md |
| What happens to passing work | `closer` (`commit-to-branch` default, `merge-back`, `open-pr`, `custom`) | writing-a-closer.md |
| Fixed list of jobs | `tasks`, `concurrency` | run-a-task-list.md |
| Work from GitHub issues or a command | `sources`, with `workflows` | work-sources.md, use-workflows.md |
| Extra instructions for the agent | `agent.append` | configuration-reference.md |
| Retry limits, fence, notify, after-landing steps | `budgets`, `fence`, `notify`, `after` | configuration-reference.md |

Worked examples: `/home/jorjives/dev/delivery-service/examples/project-configuration-example/` (small), and the repo's own `delivery.config.json` (issue-driven, two-step workflow, `open-pr` closer). Step-by-step guide: `project-configuration.md`.

## Choosing well

- **Gate:** reuse the project's existing verify command (`make verify`, `npm test`) rather than inventing one. Use `"checkOnly": true` when the command does heavy setup (e.g. `npm ci`) that should not run before the agent starts.
- **Closer:** `commit-to-branch` is the safe default. `open-pr` needs a remote and a signed-in `gh`. `merge-back` lands work with no human look.
- **Guards** (on by default) stop the agent passing by deleting tests, skipping tests or editing CI. Turn one off per task only with a stated reason.
- **Conventions:** put project rules in `agent.append` or point it at `CONTRIBUTING.md`, rather than lengthening `domain`.

## Common mistakes

- Running `delivery init` non-interactively. Write the file.
- Declaring the project set up before `delivery validate` prints `Ready to run.`
- A gate that cannot fail (`true`, `echo ok`), or one so slow or flaky that every correction round times out.
- Using `delivery run` to "test" the config. It starts a real agent and spends money; use `validate` and `preview`.
- Editing the config mid-run and expecting the run to notice: a run keeps the `domain` it started with.
- Putting the config in a subfolder: it is found from the current folder upwards to the repo top, so keep it at the root.
- Looking for harness code in the target project. It is not there.
