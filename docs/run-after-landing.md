# Run steps after landing

This guide shows how to run a deploy, an announcement or an agent pass once a run's work has landed, what happens when a step fails, and how to get unstuck. It assumes a [project set up](project-configuration.md) that takes work with `delivery run --sources`. The fields are in the [configuration reference](configuration-reference.md#after-landing-steps).

## Add after steps

`after` lists steps to run once a run's work has landed and your closer has taken the delivery branch. They run once per run, in order, and only when at least one item landed: a deploy happens once, not once per item. Each step is a command or an agent pass.

```json
{
  "after": [
    { "name": "deploy", "run": "make deploy", "in": "base", "check": "curl -f http://localhost:8080/health" },
    { "name": "release notes", "prompt": "Write release notes for the landed commits and post them to the project's discussion." }
  ]
}
```

- A command runs in a throwaway copy of what landed, or in your own folder with `"in": "base"`. It sees the landed commit as `DELIVERY_COMMIT` and the delivery branch as `DELIVERY_BRANCH`.
- An agent pass is a session with your own Claude Code setup, in a throwaway copy of what landed. It is told what landed. It cannot change what landed: anything it changes is discarded and the run says so. The exception is a new item file in `.delivery/backlog/`, which is checked like any follow-up and then lands on the delivery branch for your closer to take next run. When the landed items come from a `github` source, or a `command` source with `"tracker": true`, it is raised in your tracker instead.
- `check` is a command, run from your folder, whose success confirms the step worked.

Follow-ups an agent raised while working items from those sources are raised in your tracker as the first after step (see [Take work from other sources](work-sources.md)).

A workflow's own `after` replaces this list for the items it delivers (see [Do a task in steps](use-workflows.md#change-what-runs-after-landing)).

## When a step fails

If a step or its check fails, the harness does not run the steps after it. The work that landed stays landed. `delivery status` and `delivery report` show the failed step and those after it as waiting, and the next `delivery run --sources` tries them first, starting from the one that failed. Until they succeed, each run ends as stopped.

## Get unstuck

- A waiting step is run as your configuration file defines it when it is tried, not as it was when the work landed. It is found by its place in its `after` list (the project's, or the workflow's), so correcting a typo in a command repairs the step on the next run. A step whose place has gone from the list is skipped.
- A later run that lands work and runs the same `after` list supersedes the waiting steps of earlier runs from that list: they are skipped, never run afterwards, so a deploy that failed for an older commit is not redone over a newer one that has since deployed. Raising held follow-ups is never superseded.

## Give up on waiting steps

```bash
delivery drop-after            # every waiting step
delivery drop-after <batch>    # only one batch
```

`<batch>` is the name `delivery status` gives it. Use this for a step you cannot fix or no longer want. The work that landed stays landed.

## Next steps

- [Work through a backlog](work-a-backlog.md): the runs that trigger these steps.
- [Run on a schedule](run-on-a-schedule.md): be told when a run ends, deployed or stopped.
- [Command reference](cli-reference.md): `delivery drop-after`.
