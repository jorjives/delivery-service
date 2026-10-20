# Reviewing your project

A review is an agent that reads your project and reports what is wrong with it. Each problem
becomes an idea in your backlog. Nothing is fixed until you choose which ideas to fix.

## Ask for a review

In your project's folder, with Claude Code signed in (`claude auth status`), type:

```bash
delivery review code
```

Or ask for a security review, which looks for weaknesses an attacker could exploit:

```bash
delivery review security
```

The review is an ordinary run. Its agent reads your project and adds one idea to your backlog for each
problem it finds, in plain words. It changes nothing else, and a problem the harness cannot find in your
project is not added. The ideas land on your current branch.

- `delivery review code --path src/auth` reviews only that part of your project.
- `delivery review code --preview` shows what the review agent would be told, with no sign-in and no network, and starts nothing.

A review's list is an agent's opinion. "Nothing to add" means the agent found no problems, not that none exist.

## Read what it found

`delivery backlog` lists what is waiting: ideas for you to choose, open items to work, held fixes awaiting your sign-off, and parked items that stopped for you. `delivery backlog <id>` shows one in full, with a FOR ENGINEERS block naming its file, the workflow that fixes it and what the harness checks. A password or key found by a review is never shown in full.

## Choose what to fix

Approve the ideas you want fixed by name:

```bash
delivery approve total-below-zero settings-error
```

or all of them with `delivery approve --all`. Set the rest aside with `delivery decline <ids>`. Both commit only
those item files on your current branch, and refuse if you have changed one of them without committing.
After an approval the harness says: "They are fixed the next time you run: delivery run --sources".

## Have them fixed

```bash
delivery run --sources
```

fixes each approved idea through the review's fix workflow. An idea is accepted only once its problem is gone
and your tests pass.

## Serious fixes wait for you

The harness finishes and checks the fix of a serious problem, then holds it on its own branch. Nothing builds on it.
`delivery backlog` lists it under "Held". Read it with `delivery backlog <id>`, then:

- `delivery sign-off <id>` checks it again where it lands, lands it, then hands the delivery branch to your closer;
- `delivery reject <id>` sets it aside; its work stays on its branch.

## On GitHub

On a project whose backlog is GitHub issues, the review raises each idea as an issue without your label. On GitHub, adding the label is the approval: the next `delivery run --sources` fixes each one you label.

## Your own reviews

`delivery packs` lists the available reviews, each with a sentence saying what it looks for. List a review folder of
your own under `packs` in `delivery.config.json`, then run it by name with `delivery review <name>`.
To write one, see [Writing a pack](writing-a-pack.md).
