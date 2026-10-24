# Move off deprecated code

This how-to shows how to find the places in your project that still use code your team has marked as replaced, and have them moved to its replacement, one owner's step at a time. It is for a project owner who has replaced some code and wants the old calls gone. You need a [project set up](project-configuration.md), Claude Code signed in (`claude auth status`), and tests that would catch a call moved wrongly.

## Mark what is replaced

The `deprecations` pack finds only what your project marks. Mark code in one of two ways:

- a `@deprecated` note in a doc comment that names the replacement, as in this module:

```js
/**
 * Writes a date as day/month/year, such as 1/2/2026.
 * @deprecated Replaced by formatDate in lib/dates.js, which writes the same thing.
 */
export function legacyFormat(date) {
  return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()].join("/");
}
```

- a legacy module whose successor is named beside it, so a reader can see what to use instead.

Code with no named replacement is skipped. The pack will not guess one, so if you want it found, name the replacement first.

## See the pack

The pack is one of the built-in packs, so every project can use it. To see it listed with the others, type:

```bash
delivery packs
```

```text
Packs you can use:
  code          Looks for code that gives wrong results, code nothing uses, missing handling of things going wrong, the same job done different ways, and shortcuts the code admits to. Start it with: delivery review code
  deprecations  Finds places that still use code your team has marked as replaced, and moves them. Start it with: delivery review deprecations
  security      Looks for passwords and keys written in the code, outside input reaching commands or queries, missing checks on who may do what, unsafe default settings, and library versions known to be unsafe. Start it with: delivery review security

To use a pack folder of your own, list it under packs in delivery.config.json.
To add a pack someone has published on npm: delivery packs add <package>
See exactly what a pack will do: delivery packs inspect <name>
```

## Find what still uses it

Start the find from your project's folder:

```bash
delivery review deprecations
```

The find reads your project and adds one idea to your backlog for each file that still uses the deprecated code. It starts with lines like these:

```text
Starting: Move off deprecated code. This reads your project and adds to your backlog; it changes nothing else.
Finds places that still use code your team has marked as replaced, and moves them.
```

When it ends, it prints one of two lines. If it found places, it says how many ideas it added:

```text
The pack added 3 ideas to your backlog.
Read them with: delivery backlog
Choose which to act on with: delivery approve <ids>, or delivery approve --all
```

If it found nothing, it says so, and the sentence is the agent's reading of your project:

```text
Move off deprecated code found nothing to add. That is the agent's reading of your project, not a guarantee.
```

To look at one part of the project, name it with `--path`:

```bash
delivery review deprecations --path src/billing
```

To see what the find agent would be told, with no sign-in and no network, and nothing started, add `--preview`:

```bash
delivery review deprecations --preview
```

## Read and choose

List the ideas, and any held moves waiting for you:

```bash
delivery backlog
```

Read one in full, with the detail for engineers, by its id:

```bash
delivery backlog <id>
```

Approve the ideas you want moved, by id, or approve them all:

```bash
delivery approve <ids>
delivery approve --all
```

Set the rest aside with `delivery decline`:

```bash
delivery decline <ids>
```

Sometimes an idea names the wrong workflow. Its `workflow:` line says which workflow moves it: `deprecations:code` for a file of the project's own code, and `deprecations:tests` for a test file. If the idea names the wrong one, edit its `workflow:` line to the right one, commit that change, and then approve it. Approve and decline only commit item files, and they refuse an item file with uncommitted changes. If the idea is wrong altogether, decline it instead.

## Move them

Run the approved ideas:

```bash
delivery run --sources
```

Each approved idea goes through its workflow:

- `deprecations:code` changes only the one file the idea names, so it uses the replacement the project names. It keeps behaviour identical.
- `deprecations:tests` changes only the one test file the idea names, and only its own calls. It keeps what each test checks and its expected results, and never deletes or skips a test.

A move is accepted only once the old use is gone from that file and your tests pass. A code move that needs a test change is refused, and the owner is told. A test file's own calls are moved by the tests workflow, not by the code one.

## Sign off serious moves

A code move that touches a payment, a sign-in or a data write is rated high or critical, and the code workflow holds those for your sign-off. Nothing builds on a held move until you choose. `delivery backlog` lists it under "Held". Read it with `delivery backlog <id>`, then either land it or set it aside:

```bash
delivery sign-off <id>
delivery reject <id>
```

`delivery sign-off` checks the move again where it lands, then lands it. `delivery reject` lands nothing, and the move's work stays on its branch.

## See what happened

To say what happened to each idea, which moves landed, which need you and which need an engineer, type:

```bash
delivery report
```

## Limits

A find is an agent's opinion, and "found nothing" does not mean every old call is gone. A move is only as sound as the tests that check it. Which moves wait for your sign-off depends on the severity the agent gives each idea. The full list of limits is on the [packs page](packs.md#what-a-pack-cannot-promise).

## Next steps

- [Review your project](task-packs.md): the same steps for the `code` and `security` reviews.
- [What packs are](packs.md): the built-in packs and what a pack cannot promise.
- [Write a pack](writing-a-pack.md): a pack of your own, such as moves for a library you are replacing.
