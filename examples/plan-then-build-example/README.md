# Explore, plan, build, review

The workflow Anthropic recommends for Claude Code
([best practices](https://code.claude.com/docs/en/best-practices)): explore the code without
changing it, write a plan, build from the plan with tests, then have a second session with fresh
context review the work. It also covers the "architect plans, fresh agents implement" pattern
Jesse Vincent describes, and Mitchell Hashimoto's habit of a dedicated cleanup pass after the
first working version.

The project is a small on-call rota library. Its `delivery.config.json` defines one workflow,
`explore-plan-build`, in three checked steps:

| Step | What the agent does | What checks it |
|---|---|---|
| `plan` | Reads the code and writes a plan to `plans/` | `scripts/changed.mjs --only plans/`: a plan was written, and nothing else changed |
| `build` | Carries out the plan, in the same session (`continue: true`) | The project's tests |
| `review` | A fresh session, which did not write the code, reviews and fixes it | The project's tests, with `tests-unchanged`, so the reviewer may add tests but not weaken the ones there |

The plan is committed with the work, so whoever reads the branch sees what was intended next to
what was done.

## Try it

```bash
cp -r examples/plan-then-build-example ~/on-call-rota
cd ~/on-call-rota
git init -b main
git add -A
git commit -m "Start the rota"
delivery validate
delivery preview --step plan --task "let two people swap their on-call weeks, with a test"
delivery run --task "let two people swap their on-call weeks, with a test" --workflow explore-plan-build
```

The run ends by naming the branch the work is on: `git log -p <branch>` shows the plan, the
change and the review, one step after another.

## Scout first

For a change you do not yet understand, Simon Willison sends an agent in with no intention of
keeping its code, to learn which files it touches and where it gets stuck
([The parallel coding agent lifestyle](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
The `scout` workflow does that in two steps: `attempt` (anything may change, and the tests need
not pass) and `notes`, in the same session, which writes what it learnt to `plans/scout-...`.

```bash
delivery run --task "store the rota in a file and reload it on start" --workflow scout
```

The work stays on its own branch (`commit-to-branch`). Read the notes, delete the branch, and use
the notes to write the task properly for `explore-plan-build`.

## What this does not do

In the interactive version, you read and edit the plan before any code is written. Here the
`build` step starts as soon as the plan's check passes: there is no pause for a person between
steps. To read the plan first, run the `plan` step on its own as a task (a workflow with only
that step), read the branch, then run the rest.
