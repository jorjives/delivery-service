# Reviewing your project

A review is an agent that reads your project and reports what is wrong with it. Its problems are
ideas in your backlog. Nothing is fixed until you choose which ideas to fix.

## Ask for a review

In your project's folder, with Claude Code signed in (`claude auth status`), type:

```bash
delivery review code
```

Or ask for a security review, which looks for weaknesses someone could take advantage of:

```bash
delivery review security
```

The review is an ordinary run. Its agent reads your project and adds one idea to your backlog for each
problem it finds, in plain words. It changes nothing else, and a problem the harness cannot find in your
project is not added. The ideas land on the branch you are on.

- `delivery review code --path src/auth` reviews only that part of your project.
- `delivery review code --preview` shows what the review agent would be told, with no sign-in and no network, and starts nothing.

A review's list is an agent's opinion. "Nothing to add" means none were found, not that there are none.

## Read what it found

`delivery backlog` lists the ideas in your backlog, with the open, held and parked items. `delivery backlog <id>` shows one in full.

## Choose what to fix

Approve the ideas you want fixed by name:

```bash
delivery approve total-below-zero settings-error
```

or all of them with `delivery approve --all`. Set the rest aside with `delivery decline <ids>`. Both commit only
those item files on your current branch, and refuse if you have changed one of them without committing it.
After an approval the harness says: "They are fixed the next time you run: delivery run --sources".

## Have them fixed

```bash
delivery run --sources
```

fixes each approved idea through the review's fix workflow. An idea is accepted only once its problem is gone
and your tests pass.

## Serious fixes wait for you

A fix of a serious problem is finished and checked, then held on its own branch, and nothing builds on it.
`delivery backlog` lists it under "Held". Read it with `delivery backlog <id>`, then:

- `delivery sign-off <id>` checks it again where it lands and lands it, then hands the delivery branch to your closer;
- `delivery reject <id>` sets it aside; its work stays on its branch.

## On GitHub

On a project whose backlog is GitHub issues, the review raises each idea as an issue without your label. On GitHub, adding the label is the approval: the next `delivery run --sources` fixes each one you label.

## Your own reviews

`delivery packs` lists the reviews available, each with a sentence saying what it looks for. A review folder of
your own is listed under `packs` in `delivery.config.json`, then run by its name with `delivery review <name>`.
To write one, see [Writing a pack](writing-a-pack.md).
