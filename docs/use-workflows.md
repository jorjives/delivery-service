# Do a task in steps

This guide shows how to split a task into checked steps with a workflow, run a task through it, preview a step, and hold serious work for your sign-off. It assumes a [project set up](project-configuration.md) with Claude Code signed in. Every field a workflow takes is in the [configuration reference](configuration-reference.md#workflows).

## Define a workflow

Name the workflow under `workflows` at the top level of `delivery.config.json`. Each step has a `name` and a `prompt`; a step may have its own `gate`.

```json
{
  "workflows": {
    "plan-then-build": {
      "steps": [
        { "name": "plan", "prompt": "Write a short plan to PLAN.md.",
          "gate": { "type": "file-exists", "path": "PLAN.md" } },
        { "name": "build", "prompt": "Carry out PLAN.md.", "continue": true }
      ]
    }
  }
}
```

Each step's agent is told the task and the step's own `prompt`. The project's `gate` checks a step unless the step names its own; any [ready-made check](configuration-reference.md#ready-made-checks) works, including `commits-ahead`. `"continue": true` picks up the previous step's agent session. A step may also set `agent` options (laid over the project's) and `guards`, for that step only.

## Run a task through it

```bash
delivery run --task "add a rota page" --workflow plan-then-build
```

The steps run in order. A step that fails its check is corrected on its own, within its own limits. The next step starts only once the previous one is accepted, from the commit its work was saved in. The task is delivered once, after the last step. A task run without `--workflow` is one step.

Items in a [backlog](work-a-backlog.md) choose their workflow with the `workflow` field, and a `github` source with a `workflow:<name>` label.

## Preview a step

```bash
delivery preview --step build
```

This prints what that step's agent will be told, with its own instruction and check, and the agent options it runs with. It needs no sign-in and changes nothing. Add `--workflow <name>` when two workflows have a step of that name, and `--task "..."` to preview a task you would type.

## Hold serious work for your sign-off

Set `hold` on a workflow to a severity: `critical`, `high`, `medium` or `low`.

```json
{ "workflows": { "fix": { "hold": "high", "steps": [{ "name": "fix", "prompt": "Fix the problem." }] } } }
```

The harness finishes and checks an item rated that or more serious as usual, then holds it on its own branch instead of landing it. `delivery run --sources` reports it as held. Land it with `delivery sign-off <item>`, or set it aside with `delivery reject <item>`, where `<item>` is the name `delivery backlog` shows. See [Review your project](task-packs.md).

## Change what runs after landing

A workflow may carry its own `after` list, which replaces the project's [after steps](run-after-landing.md) for the items it delivers. `"after": []` runs none, for a workflow whose work has nothing to deploy or announce.

## Next steps

- [Work through a backlog](work-a-backlog.md): choose a workflow per item.
- [Run steps after landing](run-after-landing.md): deploy once work has landed.
- [Write a pack](writing-a-pack.md): a review's scan and fix workflows.
