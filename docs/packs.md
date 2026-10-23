# Packs

A pack is a shareable, repeatable find-then-act job: an agent finds work in your project and adds it to your backlog as ideas, you choose which to act on, and an agent acts on each, checked by your own tests. A review is one kind; moving off code your team marked as replaced is another. The built-ins are `code`, `security` and `deprecations`.

## The packs that come with the harness

Three packs come with the harness, and every project can use them without setting anything up:

- **`code`**: Looks for code that gives wrong results, code nothing uses, missing handling of things going wrong, the same job done different ways, and shortcuts the code admits to. Start it with `delivery review code`.
- **`security`**: Looks for passwords and keys written in the code, outside input reaching commands or queries, missing checks on who may do what, unsafe default settings, and library versions known to be unsafe. Start it with `delivery review security`.
- **`deprecations`**: Finds places that still use code your team has marked as replaced, and moves them. Start it with `delivery review deprecations`; the [how-to](move-off-deprecated-code.md) walks through it.

`delivery packs` prints the same packs:

```text
Packs you can use:
  code          Looks for code that gives wrong results, code nothing uses, missing handling of things going wrong, the same job done different ways, and shortcuts the code admits to. Start it with: delivery review code
  deprecations  Finds places that still use code your team has marked as replaced, and moves them. Start it with: delivery review deprecations
  security      Looks for passwords and keys written in the code, outside input reaching commands or queries, missing checks on who may do what, unsafe default settings, and library versions known to be unsafe. Start it with: delivery review security

To use a pack folder of your own, list it under packs in delivery.config.json.
```

## How a pack runs

Every pack runs the same loop. You decide at two points: which ideas to act on, and which held fixes to land.

```mermaid
flowchart TD
    A[Find: delivery review pack] --> B[Ideas in your backlog]
    B --> C{You choose}
    C -->|delivery approve| D[Act: delivery run --sources<br/>fixes each idea]
    C -->|delivery decline| X([Set aside])
    D --> E{Held for sign-off?}
    E -->|no| F([Fix lands on the delivery branch])
    E -->|yes| G[Held on its own branch]
    G -->|delivery sign-off| F
    G -->|delivery reject| X
```

`delivery review <pack>` starts any pack's find, and the command keeps its name for every pack. The loop, step by step:

1. `delivery review <pack>` runs the find and adds its ideas to your backlog.
2. `delivery backlog` lists the ideas, and any held fixes waiting for you.
3. `delivery approve` chooses ideas to act on, and `delivery decline` sets them aside.
4. `delivery run --sources` acts on each approved idea.
5. `delivery sign-off` lands a held fix, and `delivery reject` sets it aside, leaving its work on its branch.
6. `delivery report` says what happened.

## What a pack cannot promise

- A find is an agent's opinion. "Nothing found" is the agent's reading of your project, not a guarantee that nothing is wrong.
- One find writes at most 40 ideas. When it reaches that cap it says `There may be more: run it again once these have landed.`, which is `MAY_BE_MORE` in the harness.
- "Done" is only as strong as the check and the tests behind it. A fix that passes weak tests is done in name only.
- Which held work waits for your sign-off depends on the severity the agent assigns to each idea.
- A pack holds only data, so it cannot run code of its own.

## Names the built-ins keep

Built-in packs load in every project, so their names are taken: `code`, `security` and `deprecations`, and the workflows inside them, `deprecations:scan`, `deprecations:code` and `deprecations:tests`. A pack of your own cannot use these names.

If a pack you list in `delivery.config.json` has the name of a built-in, the harness refuses it and says:

```text
The pack in my-deprecations/pack.json is named "deprecations", the name of a pack that comes with the harness: change its "name" so each pack is named once.
```

## Next steps

- [Review your project](task-packs.md): ask for a review, choose what to fix and sign off serious fixes.
- [Move off deprecated code](move-off-deprecated-code.md): mark code as replaced, find what still uses it and move it.
- [Write a pack](writing-a-pack.md): make a pack of your own and prove it with `delivery packs check`.
