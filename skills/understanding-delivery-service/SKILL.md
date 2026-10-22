---
name: understanding-delivery-service
description: Use when asked to set up, write, validate or fix a `delivery.config.json` for a project, to make a repo workable by the `delivery` command, or when you meet `delivery.config.json`, a `.delivery/` directory, "gate", "closer" or "delivery run" in a project that is not the delivery-service repo itself. Also for `delivery validate` / `delivery preview` errors.
---

# Understanding Delivery Service

## Overview

`delivery` is an agent delivery harness. An agent works on a disposable copy of a repo; **the project's own check (the gate) decides** whether the work is good, never the agent; passing work goes through a **closer** (leave on a branch, merge back, open a PR). Setting a project up means writing one file, `delivery.config.json`, at the repo root. No code needed.

The harness lives outside your project. Its docs are in the delivery-service repo: `../../docs/` relative to this skill's real directory (`readlink -f` this skill's base directory, since it is a symlink). Find the command with `command -v delivery`; if absent, it is usually `~/.local/bin/delivery`. Read only the doc for the setting in front of you.

## Set up a project

1. **Write `delivery.config.json` by hand** at the repo root (it is found from the current folder upwards). `delivery init` needs a terminal and exits 2 without one. Needs: git repo, Node 22+; real runs also need a signed-in Claude Code. Every setting is optional; an unknown setting stops every command.
2. **Choose the gate first.** A command that exits non-zero on bad work and cannot be weakened by the agent. Default is the `test` script in `package.json`; with none, you must set one.
3. **Validate, then preview.** Both are free and offline:

```bash
delivery validate && delivery preview   # validate --json lists every problem; exit 2 = fix the config
```

4. Commit `delivery.config.json`. `.delivery/` (run state) ignores itself.

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

| Decision | Setting | Read |
|---|---|---|
| Project description every agent is told | `domain` | configuration-reference.md |
| What decides "good"; heavy setup via `checkOnly` | `gate` | writing-a-gate.md |
| What happens to passing work | `closer` | writing-a-closer.md |
| Fixed list of jobs | `tasks`, `concurrency` | run-a-task-list.md |
| Work from GitHub issues or a command | `sources`, `workflows` | work-sources.md, use-workflows.md |
| Stop the agent weakening tests | `guards` (on by default) | configuration-reference.md#guards |
| Project rules for the agent | `agent.append` | configuration-reference.md |
| Retries, fence, notify, after-landing steps | `budgets`, `fence`, `notify`, `after` | configuration-reference.md |

Examples, in the delivery-service repo: `examples/project-configuration-example/` (small) and its own `delivery.config.json` (issue-driven, two-step workflow, `open-pr`). Walkthrough: `project-configuration.md`.

## Choosing well

- **Gate:** reuse the project's existing verify command rather than inventing one.
- **Closer:** `commit-to-branch` is the safe default. `open-pr` needs a remote and a signed-in `gh`. `open-pr` with `"stack": true` opens one pull request per item, stacked; needs git 2.38+. `merge-back` lands work with no human look.
- **Guards:** turn one off per task only with a stated reason.
- **Conventions:** put project rules in `agent.append` (or point it at `CONTRIBUTING.md`), not in `domain`.

## Common mistakes

- Declaring the project set up before `delivery validate` prints `Ready to run.`
- A gate that always passes (`true`, `echo ok`), or one so slow or flaky that correction rounds time out.
- Using `delivery run` to test the config: it starts a real agent and spends money.
- Editing the config mid-run and expecting the run to notice: a run keeps the `domain` it started with.
