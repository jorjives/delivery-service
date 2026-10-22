# delivery-service

A deterministically gated agent delivery harness. Hand an AI agent a task in plain English: it
works on a copy of your repository, your own tests check the result, and the work is left on a
branch for you.

```bash
delivery run --task "add a function that says hello to a name, with a test"
```

`delivery` is a global command: install it once, then run it from inside any of your projects.
A project needs at most a [`delivery.config.json`](docs/project-configuration.md) and takes no dependency on the harness.

You need Node 22 or later, git, and a signed-in Claude Code (`claude auth login`, or set
`ANTHROPIC_API_KEY`).

## Documentation

The documentation is a site, built from [`docs/`](docs/) with MkDocs: <https://jorjives.github.io/delivery-service/>.

- [Get started](docs/getting-started.md): install the command and finish your first run
- [Set up a project](docs/project-configuration.md): describe a project, list its tasks, check, preview and run them
- [How it works](docs/concepts.md): the agent proposes, your check decides
- [Command reference](docs/cli-reference.md) and [configuration reference](docs/configuration-reference.md)
- [Troubleshooting](docs/troubleshooting.md): what each common message means and how to fix it
- [Reports as data](docs/reporting.md): the report and the watch as versioned JSON, their schema, and what is promised not to change
- [When the shared environment breaks](docs/shared-environment.md): what a run of several tasks at once does when the environment its tasks share breaks
- [Review your project](docs/task-packs.md): ask for a code review with no setup and read what it found
- [Configure a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Write a gate](docs/writing-a-gate.md): configure the command gate or write your own
- [Write a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Write a pack](docs/writing-a-pack.md): write a review of your own and prove it with `delivery packs check`, no real agent needed
- [Test your pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent

## Working on the harness

See [CONTRIBUTING.md](CONTRIBUTING.md), which also says how to preview the docs.
