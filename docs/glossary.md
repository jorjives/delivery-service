# Glossary

The words these docs, the `delivery` command and the library use, each in a sentence or two. Where
the command line or the library uses a different word for the same thing, both are given.

## After-landing step

A command or agent pass that runs once per run, after work has landed and the closer has taken
the delivery branch, such as a deploy. Set with `after`. See
[Configuration reference](configuration-reference.md#after-landing-steps).

## Backlog

The work items kept as Markdown files in `.delivery/backlog/`, committed to your repository and
worked by `delivery run --sources`. See [Work through a backlog](work-a-backlog.md).

## Base branch

The branch you started from, such as `main`. The agent's work starts from its last commit, and
the `merge-back` closer merges into it.

## Budget

How many times one kind of setback is retried before the run stops and asks you. There are
five; see [`budgets`](configuration-reference.md#budgets).

## Check

The command or code that decides whether the agent's work is good, such as `npm test`. Set with
`gate` in the configuration file; the command line prints it as `gate`. See
[Write a gate](writing-a-gate.md).

## Closer

What happens to work that passes the check: commit it to a branch, merge it back, or open a
pull request. Set with `closer`. See [Write a closer](writing-a-closer.md).

## Configuration file

`delivery.config.json` (or `.js`, `.mjs`) beside your code, which describes the project and its
tasks. See [Configuration reference](configuration-reference.md).

## Delivery branch

`delivery/<base>`, such as `delivery/main`: the one branch that every item from
`delivery run --sources` lands on. The closer acts on it once per run.

## Domain

Your own description of the project, told to every agent before its instructions. Set with
`domain`.

## Fence

A sandbox, made with bubblewrap on Linux, that keeps your own folder read-only while the agent
works in its working copy. Set with `fence`.

## Follow-up

A new backlog item an agent writes while working on something else, for work it found but was
not asked to do.

## Gate

The harness's name for the [check](#check), used by the `gate` setting, the command line's
output, and the library.

## Guard

A rule the harness adds to every check, which refuses work that weakens the tests, for example
by deleting one. See [Guards](configuration-reference.md#guards).

## Held

A finished fix that waits for `delivery sign-off` before it lands, because its problem is at
least as serious as its workflow's `hold`. See [Review your project](task-packs.md).

## Idea

A backlog item with `status: idea`, usually from a review. It is not worked until you choose it
with `delivery approve`.

## Item

One piece of work from a work source: a backlog file, a task from a command, or a GitHub issue.

## Pack

A review: instructions that have an agent read your project for one kind of problem and add
what it finds to the backlog as ideas. The built-in packs are `code` and `security`. See
[Review your project](task-packs.md).

## Parked

An item set aside until you act: it asked a question (`delivery answer`), or ended undelivered
too many runs in a row (`delivery unpark`).

## Record

The step-by-step account of a run, kept in `.delivery/runs/` and read by `delivery status`. The
library calls it the case file.

## Repair

An agent session that fixes a check that cannot run at all, rather than the work. Its changes
are shown to you afterwards.

## Run

One go at one task, from setting up a working copy to the closer. A run of several tasks at once
has its own id, and holds one run per task. Each run has a run id, such as
`fix-the-broken-footer-links-20261001T022000Z`.

## Scripted agent

A stand-in for Claude Code that replies from a script you write, so you can test a check,
closer or pack with no real agent and no cost. See
[Test your pipeline](testing-your-pipeline.md).

## Shared environment

Whatever several tasks running at once rely on outside their own working copies, such as a
helper file or a local service. See
[When the shared environment breaks](shared-environment.md).

## Surface

The library's name for one task's run. It appears in branch names (`surface/<run-id>`), in JSON
output and in the library's API.

## Task

One thing you want done, in plain English. Set with `task`, `tasks` or `--task`.

## Triage

The decision the harness makes after a setback: send the agent back with a sharper brief, repair
the check, try the closer again, or stop and ask you. See
[How it works](concepts.md#when-something-goes-wrong).

## Work source

A place `delivery run --sources` finds work: the backlog, the task list, a command of your own
or GitHub issues. Set with `sources`.

## Workflow

A named way of doing a task in more than one checked step. Set with `workflows`, chosen with
`--workflow`. See [Workflows](configuration-reference.md#workflows).

## Working copy

The separate git worktree the agent works in, on its own branch, so your own checkout is never
touched. The library calls it the worktree.
