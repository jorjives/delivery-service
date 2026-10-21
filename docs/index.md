---
hide:
  - navigation
  - toc
---

# delivery-service

**Hand an AI agent a task in plain English.** It works on a copy of your repository, your own
tests check the result, and the work is left on a branch for you.

After you [install the command](getting-started.md), run:

```bash
delivery run --task "add a function that says hello to a name, with a test"
```

You need Node 22 or later, git and a signed-in Claude Code. [Get started](getting-started.md){ .md-button .md-button--primary }
[How it works](concepts.md){ .md-button }

<div class="grid cards" markdown>

-   **[Get started](getting-started.md)**

    Install the command and finish your first run.

-   **[Set up a project](project-configuration.md)**

    Describe your project, list its tasks, choose the check and run them.

-   **[Work through a task list](run-a-task-list.md)**

    Run tasks in order, or several at once, and edit the list between runs.

-   **[Read the report](read-a-report.md)**

    One command says what happened overnight and what to do next.

-   **[Review your project](task-packs.md)**

    Ask for a code or security review, choose what is fixed, and sign off serious fixes.

-   **[Write a gate](writing-a-gate.md)**

    Decide what counts as good work with a check of your own, called a gate.

-   **[Command reference](cli-reference.md)**

    Every command, option and exit code.

-   **[Reports as data](reporting.md)**

    The report and the watch as versioned JSON, and what will not change.

</div>

## How the documentation is organised

- **Get started** is a tutorial: one path from install to a finished run.
- **Guides** are task-led. Each one gets you to a goal, such as running a list, reading a report or resuming a run.
- **Extend** shows how to replace the parts of a run with your own: a role ([Configure a role](configuring-a-role.md)), a gate ([Write a gate](writing-a-gate.md)), a closer ([Write a closer](writing-a-closer.md)) or a review pack ([Write a pack](writing-a-pack.md)), and how to [test your pipeline](testing-your-pipeline.md).
- **How it works** explains the model, so the behaviour makes sense.
- **Reference** lists every command, setting and data format, and the [Glossary](glossary.md) defines the terms the pages use.

## Getting help

If a command stops with a message, the message names what to fix, and
[Troubleshooting](troubleshooting.md) explains the common ones. `delivery validate` finds
configuration mistakes without starting anything. For anything else, open an issue on
[GitHub](https://github.com/jorjives/delivery-service/issues).
