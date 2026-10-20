# delivery-service

A deterministically gated agent delivery harness. Hand an AI agent a task in plain English: it
works on a copy of your repository, your own tests check the result, and the work is left on a
branch for you.

```bash
delivery run --task "add a function that says hello to a name, with a test"
```

You need Node 22 or later, git, and a signed-in Claude Code (`claude auth login`, or set
`ANTHROPIC_API_KEY`).

## Documentation

The documentation is a site, built from [`docs/`](docs/) with MkDocs: <https://jorjives.github.io/delivery-service/>.

- [Getting started](docs/getting-started.md): install the command and finish your first run
- [Setting up a project](docs/project-configuration.md): describe a project, list its tasks, check, preview and run them
- [How it works](docs/concepts.md): the agent proposes, your check decides
- [Command reference](docs/cli-reference.md) and [configuration reference](docs/configuration-reference.md)
- [Reports as data](docs/reporting.md): the report and the watch as versioned JSON, their schema, and what is promised not to change
- [When the shared environment breaks](docs/shared-environment.md): what a run of several tasks at once does when the environment its tasks share breaks
- [Reviewing your project](docs/task-packs.md): ask for a code review with no setup and read what it found
- [Configuring a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Writing a gate](docs/writing-a-gate.md): configure the command gate or write your own
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Writing a pack](docs/writing-a-pack.md): write a review of your own and prove it with `delivery packs check`, no real agent needed
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent

To preview the site while you edit it:

```bash
uvx --with 'mkdocs-material~=9.7' mkdocs serve
```

`make docs` builds it with warnings as errors, the same as the Docs workflow.

## Working on the harness

See [CONTRIBUTING.md](CONTRIBUTING.md).
