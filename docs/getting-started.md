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
```

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
```

`delivery status` only ever reads, so it is safe while a run is still going. If a
run stopped because it needs a decision from you, that decision is the first thing
it prints, with the evidence behind it underneath.

## Where to go next

- Settings that belong to a project, such as the check, the closing action and the
  attempt limits, live in a `delivery.config.json` beside your code: see the
  [readme](../README.md).
- [Writing a gate](writing-a-gate.md): use a check other than `npm test`, or write
  your own.
- [Writing a closer](writing-a-closer.md): merge the work back, open a pull
  request, or deliver it your own way.
- [Testing your delivery pipeline](testing-your-pipeline.md): test your gate,
  closer and role configurations against a scripted agent.
