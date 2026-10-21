# Get started

This guide takes you from nothing to a finished run. You install the `delivery`
command, point it at a small sample project, and watch an agent do a task that
your own tests check. It takes about ten minutes, and you need not read any
harness source.

## What you need

- Node.js 22 or later, and `git`.
- Claude Code, signed in. Check with `claude auth status`; if it says you are not
  signed in, run `claude auth login`, or set `ANTHROPIC_API_KEY`.
- A clone of the harness repository, to build the package from.

## 1. Install the command

The harness is not published to the public npm registry yet, so you install it from
a package you build yourself. The rest of this guide assumes you have.

In the harness checkout:

```bash
npm install
npm pack
```

That writes `delivery-service-<version>.tgz` in the checkout. Install it:

```bash
npm install -g ./delivery-service-*.tgz
```

If that fails with a permission error, npm's global folder belongs to the system
(common on Linux). Install into your home folder instead, with no `sudo`:

```bash
npm install -g --prefix ~/.local ./delivery-service-*.tgz
```

This puts `delivery` in `~/.local/bin`. If your shell does not find it, add that
folder to your `PATH`.

Check that the command is there. It prints the version you packed:

```bash
delivery --version
```

```text
<version>
```

### Importing the library in your own project

You can skip this section for now: step 1 puts `delivery` on your `PATH`, which is all this guide
needs. The guides to [write a gate](writing-a-gate.md) and
[test your pipeline](testing-your-pipeline.md) `import` the library in a project of your own, and a
global install does not support that: a bare `import "delivery-service"` resolves through a
project's own `node_modules`. Install the same packed file there too, without `-g`:

```bash
npm install /path/to/your/harness-checkout/delivery-service-*.tgz
```

Now `import { ... } from "delivery-service"` resolves in that project.

## 2. Get a project to try it on

The harness ships a sample project: one function, one test and a `test` script.
That is all a run needs. From the harness checkout, copy it outside the checkout
and make it a git repository:

```bash
cp -r examples/sample-project ~/sample-project
cd ~/sample-project
git init -b main
git add -A
git commit -m "Start the sample project"
```

## 3. Run your first task

Say what you want in plain English:

```bash
delivery run --task "add a function that greets a name, with a test"
```

The agent works on its own copy of your project. `npm test` decides whether the
change is good, and the work is committed to a new branch. You will see:

```text
Starting run <run-id>: add a function that greets a name, with a test
- setting up
- checking the starting point
- the agent is working
- checking the agent's work
- wrapping up
- done
Done: the change for "add a function that greets a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
main was not changed. To look at the work: git log surface/<run-id>
This run: 1 of 1 task completed and committed to its own branch.
Run `delivery report <run-id>` for what to do.
```

`<run-id>` is made from your task and the time the run started, such as
`add-a-function-that-greets-20260917T090000Z`. The last two lines summarise the run and name the
command that prints the full report. The same report is kept in `.delivery/last-report.txt` until
the next run replaces it.

Your `main` branch is untouched. Read what the agent did with
`git log -p surface/<run-id>`, and merge it yourself if you approve.

If the run stops early, because you closed the terminal or pressed
Ctrl-C, run `delivery run` again in the same folder. It picks the run up where it
left off; see [Pick up an interrupted run](resume-a-run.md). If the command
refuses to start, see [Troubleshooting](troubleshooting.md).

## 4. Read what happened, later

You do not need to watch a run. In the same folder, at any time afterwards:

```bash
delivery status
```

```text
Run <run-id>, started <when>: add a function that greets a name, with a test
Done: the change for "add a function that greets a name, with a test" passed `npm test` and is committed on branch surface/<run-id>.
It finished <when>.
main was not changed. To look at the work: git log surface/<run-id>

How it got here: no triage rounds.

Retry budgets when it finished, after 1 attempt:
  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3

Time and cost, recorded for 1 of 1 agent session: 0 s of session time; USD 0.00, estimated by the agent runtime.

Repairs: none ran for this task.

No stop: this run finished.

Next: delivery report (your task list)
```

`<when>` stands for a date and time in UTC, such as `2026-09-17 09:00 UTC`. The time and cost
figures differ on every run. `delivery status` only reads the record and changes nothing, so it is
safe while a run is going. If a run stopped because it needs a decision from you, that decision
comes first, with the evidence beneath it. For the rest, run `delivery status --help` or see
[See what happened to a run](check-a-run.md).

## Next steps

- [Set up a project](project-configuration.md): the next step. Describe your project
  once and list what you want done, in a complete example project. For a project of your own,
  [`delivery init`](set-up-with-init.md) writes a `delivery.config.json` by asking questions; the
  [configuration reference](configuration-reference.md) lists every setting.
- [Check your setup](check-your-setup.md): validate the file and preview what the agent is told.
- [Run a task](run-a-task.md) and [Work through a task list](run-a-task-list.md): hand the agent
  one task, or a list.
- [Work through a backlog](work-a-backlog.md): have the harness work through a backlog of items
  on its own, each landing on one delivery branch you review once.
- [Run on a schedule](run-on-a-schedule.md): start runs on a timer.
- [Read the report](read-a-report.md): what landed, what needs you, and what to do about each.
- [Write a gate](writing-a-gate.md): use a check other than `npm test`, or write
  your own.
- [Write a closer](writing-a-closer.md): merge the work back, open a pull
  request, or deliver it your own way.
- [Test your pipeline](testing-your-pipeline.md): test your gate,
  closer and role configurations against a scripted agent.
