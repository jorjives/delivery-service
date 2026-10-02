# Getting started

This guide takes you from nothing to a finished run: you install the `delivery`
command, point it at a small sample project, and watch an agent do a task your
own tests check. It takes about ten minutes, and you do not need to read any
harness source to follow it.

## What you need

- Node.js 22 or later, and `git`.
- Claude Code, signed in. Check with `claude auth status`; if it says you are not
  signed in, run `claude auth login`, or set `ANTHROPIC_API_KEY`.
- A copy of the harness checkout, which is where you pack the command from.

## 1. Install the command

The harness is not on the public npm registry yet: its first publication waits on
a licence decision. Until then you install it from a copy you pack yourself, which
is what the rest of this guide assumes.

In the harness checkout:

```bash
npm install
npm pack
```

That writes `delivery-service-<version>.tgz` in the checkout. Install it:

```bash
npm install -g ./delivery-service-*.tgz
```

Check that the command is there. It prints the version you just packed:

```bash
delivery --version
```

If you would rather not install anything, run it straight from the packed file:

```bash
npx --package ./delivery-service-*.tgz delivery --version
```

### Importing the library in your own project

The install above puts `delivery` on your `PATH`, which is all the rest of this guide
needs. The other guides linked at the end ([writing a gate](writing-a-gate.md), for
example) have you `import` the library or the testing API in a project of your own instead.
A global install does not do that: a bare `import "delivery-service"` resolves through a
project's own `node_modules`, so install the same packed file there too, without `-g`:

```bash
npm install /path/to/your/harness-checkout/delivery-service-*.tgz
```

Now `import { ... } from "delivery-service"` resolves in that project.

## 2. Get a project to try it on

The harness ships a sample project: one function, one test, and a `test` script,
which is all a run needs. Copy it somewhere outside the checkout and make it a
git repository:

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

The agent works on its own copy of your project, `npm test` decides whether the
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

The last two lines sum the run up and name the command that says it again in full. The same
report is kept as a file, `.delivery/last-report.txt`, until the next run replaces it.

Your `main` branch is untouched. Read what the agent did with
`git log -p surface/<run-id>`, and merge it yourself if you like it.

If the run stops before it finishes, because you closed the terminal or pressed
Ctrl-C, run `delivery run` again in the same folder: it picks the run up where it
left off rather than starting over.

## 4. Read what happened, later

You do not have to watch a run. In the same folder, at any time afterwards:

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

No stop: this run finished.

Next: delivery report (your task list)
```

`delivery status` only ever reads, so it is safe while a run is still going. If a
run stopped because it needs a decision from you, that decision is the first thing
it prints, with the evidence behind it underneath.

Beneath that account it says how the task got there: the times the harness had to decide what to
do after a setback ("triage rounds"; none here, because the first attempt passed), how many
retries of each kind were used, and, for a task that stopped, what to do about it. The last line
names where to go next.

Once your project has a list of tasks (the next guide sets one up), `delivery report` is the
command to come back to: it says in plain words which tasks landed, which need you, and what to do
about each. See [Come back to your task list](../README.md#come-back-to-your-task-list).

## Where to go next

- [Setting up a project](project-configuration.md): the next step. Describe your project
  once, list what you want done, check and preview the setup, and run the whole list, in a
  complete example project. For a project of your own, `delivery init` writes a
  `delivery.config.json` by asking what the project is, what checks the work, what happens
  to work that passes, and what you would like done; the [readme](../README.md) lists every setting.
- [Writing a gate](writing-a-gate.md): use a check other than `npm test`, or write
  your own.
- [Writing a closer](writing-a-closer.md): merge the work back, open a pull
  request, or deliver it your own way.
- [Testing your delivery pipeline](testing-your-pipeline.md): test your gate,
  closer and role configurations against a scripted agent.
