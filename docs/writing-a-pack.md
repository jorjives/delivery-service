# Write a pack

This guide is for you if you want a pack of your own. A pack is a repeatable find-then-act job: one workflow reads your project and adds ideas, and others change the project to fix each approved idea. A review is one kind of pack. This guide starts you from the built-in `deprecations` pack, the worked example of a pack that is not a review. You copy it, change its manifest and instructions, prove it with `delivery packs check`, then run it against your projects. It takes about half an hour.

## Before you start

- Install the command and run a task once: [Get started](getting-started.md).
- Know what an [idea](glossary.md#idea) and the [backlog](glossary.md#backlog) are, and what a review does: [Review your project](task-packs.md).

## What a pack is

A [pack](glossary.md#pack) holds only data: `pack.json` (the manifest), one prompt file per workflow (such as `scan.md`, `code.md` and `tests.md`), and `fixtures/` (a small project and scripted replies that prove the pack works). It cannot give the agent tools or commands, or bring code of its own for its check. A pack that tries is refused: `delivery packs check` names which field is not allowed, quoting a message like `"scan.allowedTools" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check`.

A `delivery.pack/3` pack names its own workflows. It holds exactly one `find` workflow, which reads the project and may only add ideas, and one or more `act` workflows, each of which changes the project to fix one idea. A workflow's full name is `<name>:<workflow>`, such as `mymoves:scan`.

## Start from the deprecations pack

The built-in `deprecations` pack finds code your team has marked as replaced, and its acts move each place off it. Copy it. If you installed the command globally, as [Get started](getting-started.md) does:

```bash
cp -r "$(npm root -g)/delivery-service/packs/deprecations" ./my-pack
```

If you installed it in this project instead (see [Extending delivery with TypeScript](getting-started.md#extending-delivery-with-typescript-optional)):

```bash
cp -r "$(npm root)/delivery-service/packs/deprecations" ./my-pack
```

Or, in a checkout of the harness repository:

```bash
cp -r packs/deprecations ./my-pack
```

Its manifest ships like this:

```json
{
  "schema": "delivery.pack/3",
  "name": "deprecations",
  "version": "1.0.0",
  "title": "Move off deprecated code",
  "summary": "Finds places that still use code your team has marked as replaced, and moves them.",
  "workflows": {
    "scan": {
      "kind": "find",
      "prompt": "scan.md",
      "ideasFor": ["code", "tests"]
    },
    "code": {
      "kind": "act",
      "summary": "Code of the project's own that still calls the deprecated code.",
      "prompt": "code.md",
      "guards": {
        "add": ["tests-unchanged"]
      },
      "hold": {
        "atOrAbove": "high"
      }
    },
    "tests": {
      "kind": "act",
      "summary": "A test file that still calls the deprecated code.",
      "prompt": "tests.md"
    }
  }
}
```

Then make the folder yours:

1. Change `name` in `pack.json` to `mymoves`, and change `title` and `summary` to say what your moves are. The `name` must not be one that is already taken: `code`, `security` and `deprecations` are built in, and the check stops with a sentence naming your `pack.json` as having the name of a pack that comes with the harness.
2. Rewrite `scan.md`, `code.md` and `tests.md` for your moves. `scan.md` is the find's instructions: it writes one idea per place, and names the act each idea goes to. `code.md` and `tests.md` are the acts' instructions.
3. In `fixtures/review.json`, change every `workflow: deprecations:code` to `workflow: mymoves:code`, and every `workflow: deprecations:tests` to `workflow: mymoves:tests`.
4. Replace the contents of `fixtures/` to match your moves: see [Fixtures](#fixtures).

### Why it has two acts

- `code` changes the one source file an idea names, so it uses the replacement the project names. Its `"guards": { "add": ["tests-unchanged"] }` turns on the `tests-unchanged` check, so a change that touches a test is refused. Its `"hold": { "atOrAbove": "high" }` makes ideas rated high or critical wait for the owner's sign-off before they are applied.
- `tests` changes only a test file's own calls, so it is the one act that may change a test file. It has no `hold`, so its changes apply without waiting.

The find offers both: `"ideasFor": ["code", "tests"]` says which acts its ideas may name. Because the find offers more than one act, each act has a one-sentence `summary`, so the find can choose between them.

## The delivery.pack/3 manifest, field by field

Every key a `delivery.pack/3` `pack.json` may hold is listed here, and any other key is refused. Bump `version` when you change the pack's manifest or instructions.

| Field | Value | Notes |
|-------|-------|-------|
| `$schema` | `string` | Where an editor finds the schema to check this file against while it is written. Ignored by the harness. Optional. |
| `schema` | `string` | Always `delivery.pack/3` in this format. Required. |
| `name` | `string` | Short name of the pack, such as `mymoves`: lower-case letters, digits and dashes, starting with a letter or digit. Its workflows are `<name>:<workflow>`. Required. |
| `version` | `string` | Three numbers separated by dots, such as `1.0.0`. Required. |
| `title` | `string` | The pack's title, such as `My moves`. Required. |
| `summary` | `string` | One sentence saying what the pack is for. Required. |
| `workflows` | `object` | The workflows, each named by its key: exactly one find, and one or more acts, as described below. Required. |
| `settings` | `object` | Values the pack asks the project owner for, each named by its key in lower-case letters, digits and dashes. Optional. See [Settings](#settings) below. |

### A find workflow

The find workflow reads your project and may only add ideas to `.delivery/backlog/`. Holds:

| Field | Value | Notes |
|-------|-------|-------|
| `kind` | `"find"` | Required. |
| `prompt` | `string` | Path to the instructions file, relative to the pack folder, such as `scan.md`. The harness adds its own description of an idea after your instructions. Required. |
| `ideasFor` | `array` | The names of the act workflows this find's ideas may name, such as `["code", "tests"]`. At least one. Required. |

### An act workflow

An act workflow changes the project to fix one idea. Holds:

| Field | Value | Notes |
|-------|-------|-------|
| `kind` | `"act"` | Required. |
| `prompt` | `string` | Path to the instructions file, relative to the pack folder, such as `code.md`. Required. |
| `summary` | `string` | One sentence saying what the act is for, in the words the scanner is shown. Required when the find offers more than one act, so the scanner can choose between them. |
| `guards` | `object` | `{ "add": ["tests-unchanged"] }`: [guards](glossary.md#guard) this act turns on. Each name must be one that `delivery packs --schema` lists. Holds only `add`. Optional. |
| `hold` | `object` | `{ "atOrAbove": "high" }`: fixes of ideas rated this or more serious wait for the owner's sign-off. `atOrAbove` is `critical`, `high`, `medium` or `low`. Holds only `atOrAbove`. Optional. |

### Settings

A setting is a value the pack asks the project owner for. Each one is declared under `settings`, named by its key:

| Field | Value | Notes |
|-------|-------|-------|
| `type` | `"text"`, `"path"`, `"paths"` or `"severity"` | Required. |
| `summary` | `string` | One line saying what the setting is for. Required. |
| `default` | by `type` | The value used when the owner gives none. Optional: with no default, the owner must give a value. |

A prompt uses a setting as `{{settings.<name>}}`, and the owner gives values under `packSettings` in `delivery.config.json`.

### The rules a pack keeps

- Exactly one workflow has `"kind": "find"`.
- Every name in a find's `ideasFor` is an act workflow in the same pack.
- Every act workflow is named in some find's `ideasFor`, so an idea can reach it.
- An act that a find chooses between has a `summary`.
- A prompt's `{{settings.<name>}}` is replaced by the owner's value, or the default, when the project loads the pack.
- Every `{{settings.<name>}}` names a declared setting.
- Every declared setting is used by a prompt, so the owner is never asked for a value nothing reads.
- A pack declares at most 32 settings.
- Each setting has a `summary`.
- A pack cannot name a gate, an agent, tools, a closer, `after` steps or commands. A key that tries is refused with a sentence such as `"gate" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check`.

### The sentences you may see

`delivery packs check` names each mistake by its file and field, in one sentence. Among the sentences a `delivery.pack/3` pack may draw:

| Sentence | What to change |
|----------|----------------|
| `"workflows" must hold exactly one workflow with "kind": "find", but it holds 2 ("scan", "other")` | Keep one find; make the other an act workflow, or remove it. |
| `"workflows.scan.ideasFor.0" is "fix", but this pack's act workflows are: code, tests` | Name one of the act workflows the pack holds. |
| `"workflows.scan.ideasFor.0" is a find workflow; it can only offer act workflows` | Name an act workflow, not a find. |
| `"workflows.tests" is not listed in any find workflow's "ideasFor", so no idea could reach it` | Add it to a find's `ideasFor`, or remove it. |
| `"workflows.code.summary" is missing: the find workflow "scan" needs it to choose between "code" and "tests"` | Add a one-sentence `summary` to the act. |
| `"workflows.scan.summary" is only for act workflows` | Remove the key from the find. |
| `"settings.docs-folder" has no summary. Say in one line what it is for` | Add a one-line `summary` to the setting. |
| `docs.md uses {{settings.docs-foldr}}, but pack.json declares no setting of that name. Declared: docs-folder` | Correct the name in the prompt to a declared setting, or declare it under `settings`. |
| `code.md: is not valid UTF-8 text, so what is shown could differ from what the agent is given.` | Save the file as UTF-8 text. |
| `tests.md: is a folder, not a file.` | Name a file, not a folder. |
| `"schema" is "delivery.pack/4", a newer pack format than this harness reads (delivery.pack/2 and delivery.pack/3): upgrade delivery-service to read this pack` | Upgrade delivery-service. |

## Check it as you type

Get the JSON Schema so your editor can check your `pack.json`:

```bash
delivery packs --schema > pack.schema.json
```

Then put `"$schema"` first in `pack.json`:

```json
{
  "$schema": "./pack.schema.json",
  "schema": "delivery.pack/3",
  "name": "mypack",
  "version": "1.0.0",
  "title": "My review",
  "summary": "Looks for issues in my code.",
  "workflows": {
    "scan": { "kind": "find", "ideasFor": ["code"], "prompt": "scan.md" },
    "code": { "kind": "act", "prompt": "code.md" }
  }
}
```

Your editor flags unknown keys and invalid values as you type. Existing delivery.pack/2 packs keep working with no edit; keep the schema file you printed earlier for them.

## Fixtures

The fixtures prove your pack works before you run it against a real project. They live in `fixtures/`:

- `fixtures/project/`: a small project with a `test` script (for example, `"test": "node --test"` in `package.json`). Committed fresh for each check run. It must not be empty or hold a `.git` folder.
- `fixtures/review.json`: a claude-mock script for the find. claude-mock is the scripted stand-in for the agent (see [Test your pipeline](testing-your-pipeline.md)). Its session writes your ideas into `.delivery/backlog/` with `effects`, naming the act each idea goes to in `workflow:`, and replies `completed`. See `packs/deprecations/fixtures/review.json` in the harness repository for a worked one.
- `fixtures/fixes.json`: a claude-mock script for the acts, honest and cheating: one honest change per idea, and one cheat per idea that should be refused.
- `fixtures/expect.json`: names the titles the find adds (`found`), the changes that pass (`fixed`) and the cheats that are refused (`refused`). Each list needs at least one title.

`delivery packs check ./my-pack` runs the find, approves every idea and runs each under the act workflow it names, against those scripts in a scratch copy of `fixtures/project`, with nothing sent to a real agent.

The deprecations pack's `expect.json` is what its check must show when its scripted find and acts run, with each title written exactly as the scripted find writes it:

```json
{
  "found": [
    "Invoices still use the old date handling the team marked as replaced",
    "Receipts still use the old date handling the team marked as replaced",
    "The receipt test still uses the old date handling the team marked as replaced"
  ],
  "fixed": [
    "Invoices still use the old date handling the team marked as replaced",
    "The receipt test still uses the old date handling the team marked as replaced"
  ],
  "refused": [
    "Receipts still use the old date handling the team marked as replaced"
  ]
}
```

- `found`: the ideas the find must add (in any order).
- `fixed`: the ideas whose honest change must pass its check.
- `refused`: the ideas whose cheat must be refused (fail its check).

A change at or above the pack's `hold` severity counts as passing its check when it waits for sign-off.

### fixtures/fixes.json

This script holds one expectation for each scripted change, honest or cheating. Give each expectation a `when`: the first one that matches the prompt is used. Without it, every idea gets the same reply and the check stops showing what you wrote. Put the retry after a refusal first, so a refused cheat ends quickly without burning through the fix budget. The shipped script has four expectations; this excerpt holds the retry and the cheat that the check refuses:

```json
{
  "expectations": [
    {
      "when": { "promptContains": "still there" },
      "json": { "status": "escalate", "category": "authority", "rationale": "Told its fix was refused, the scripted agent gives up." }
    },
    {
      "when": { "promptContains": "Receipts still use the old date handling the team marked as replaced" },
      "effects": [
        {
          "write": {
            "path": "src/receipt.js",
            "content": "import { isoDate } from \"../lib/dates.js\";\n\nexport const receiptLine = (amount, paidOn) => `Paid ${amount} on ${isoDate(paidOn)}`;\n"
          }
        },
        { "edit": { "path": "src/receipt.test.js", "old": "\"Paid 12 on 1/2/2026\"", "new": "\"Paid 12 on 2026-02-01\"" } }
      ],
      "json": { "status": "completed", "rationale": "src/receipt.js now uses isoDate, and I changed the test to match the new date text." }
    }
  ]
}
```

The first entry answers the retry that follows a refusal: its prompt says the problem is still there, so the scripted agent gives up at once. The second is the cheat. It changes the test to match its new output, and the `code` act may not change a test, so the check refuses it. The shipped file also holds the honest changes for the invoice and the receipt test, which pass.

## Run the check

```bash
delivery packs check ./my-pack
```

Running the fixtures runs the fixture project's own tests on your machine, as a run runs a project's tests, so in a terminal the command asks you to confirm you trust the pack's code before anything runs: `y` to continue, Enter or `n` to leave it alone. It runs that test command with none of your credentials and a scratch `HOME` in place of your own. It is still real code with your real filesystem and process access, and this is not a sandbox against hostile code, so only check a pack whose `fixtures/project` you have read or trust. In a script or CI, where nothing can ask, pass `--yes` once you do. Without a terminal and without `--yes`, the command prints `This isn't a terminal, so I can't ask whether you trust this pack's code. Pass --yes once you do.` and exits 2.

Declining leaves the pack unchecked and exits 0. The command prints `Left my-pack alone: I only run a pack's own code once you say you trust it.`

If the pack is ready, the check runs the fixtures. The output below is what `--yes` prints, with no question asked first:

```text
Checking the pack in my-pack…
✓ pack.json: the mymoves pack, version 1.0.0.
✓ The scripted find mymoves:scan added 3 ideas, as fixtures/expect.json expects: "Invoices still use the old date handling the team marked as replaced", "Receipts still use the old date handling the team marked as replaced", "The receipt test still uses the old date handling the team marked as replaced".
✓ Every idea was approved and run under the act workflow it names: mymoves:code, mymoves:tests.
✓ The scripted change for "Invoices still use the old date handling the team marked as replaced" passed its check under mymoves:code.
✓ The scripted change for "The receipt test still uses the old date handling the team marked as replaced" passed its check under mymoves:tests.
✓ The scripted cheat for "Receipts still use the old date handling the team marked as replaced" was refused under mymoves:code: it removed, changed or skipped tests.
Nothing was sent to a real agent: every reply came from the pack's fixtures.
Ready to use: list ./my-pack under "packs" in delivery.config.json, then start it with: delivery review mymoves
```

Exit code 0.

### When the check finds a problem

Each problem is printed as `<file>: <what is wrong>.` and the command exits 2. For example, when `expect.json` lists a title the scripted find did not write:

```text
Checking the pack in my-pack…
my-pack/fixtures/expect.json: the scripted find mymoves:scan did not add "The login page is slow".
Nothing was sent to a real agent: every reply came from the pack's fixtures.
```

What each message means, and the fix:

- `pack.json: "<field>" is not part of the pack format ...`, or a missing or invalid field: correct the manifest. A manifest with a mistake stops the check before any fixture runs.
- `<fixture file>: is missing: it holds ...`, `is not valid JSON`, or `fixtures/project: is empty`: add or repair that file. A `.git` folder inside `fixtures/project` is refused.
- `expect.json: ... must name at least one problem`: each of `found`, `fixed` and `refused` needs a title, and every title in `fixed` and `refused` must also be in `found`.
- `the scripted find <name>:<find> could not be used: ...`: the find did not run, for example because the pack name is already taken.
- `the scripted find <name>:<find> did not add "X"` and `the scripted find <name>:<find> also added "X", which "found" does not list`: `review.json` and `found` disagree. Make them name the same titles.
- `the scripted find <name>:<find> added no idea for the act workflow "X", so the check never ran it`: every act workflow needs at least one idea in `review.json` naming it in `workflow:`. Check that each `workflow:` is `<name>:<act>` with your pack's own name, since an idea that names another pack's workflow does not count.
- `the scripted acts could not run: ...`: the acts did not run; the rest of the message says why.
- `the scripted change for "X" under <name>:<act> did not pass its check: it ended ...`: the change did not make the edit it claimed, or broke a test.
- `the scripted cheat for "X" under <name>:<act> was not refused: it ended ...`: the cheat passed its check when the fixtures say it should fail.

### With --json

```bash
delivery packs check ./my-pack --json
```

Prints the whole result as one JSON document, with the same exit codes. Its keys are `ready`, `pack` (`name`, `version` and `hash`), `problems`, `run` (`found`, `fixed`, `refused`, `find` and `workflowOf`) and `sentToAgent`, which is always `false`. `find` is the full name of the find workflow that ran, and `workflowOf` maps each found title to the full name of the act workflow its idea names.

## Use it

Once the check passes, list the folder under `packs` in `delivery.config.json`, so the pack's workflows exist:

```json
{ "packs": ["./my-pack"] }
```

See [`packs`](configuration-reference.md#packs). Then start it by name:

```bash
delivery review mymoves
```

Before you share it, run `delivery packs inspect ./my-pack` to see it as an owner will, and to be told about any file in the folder a pack should not hold.

`delivery review <name>` starts a pack's find, whatever it is called. This runs a real review of your project with a real agent, so Claude Code must be signed in. It adds ideas to your backlog. To have them changed with `delivery approve` and `delivery run --sources`, the acts the ideas name run as the pack's `<name>:<act>` workflows. See [Review your project](task-packs.md).

## From your own test suite

Import the check from the testing export, in a Vitest or Jest test file. The path is relative to the directory you run the tests from:

```typescript
import { describe, it, expect } from "vitest";
import { checkPack } from "delivery-service/testing";

describe("my pack", () => {
  it("passes the pack check", async () => {
    expect((await checkPack("./my-pack")).problems).toEqual([]);
  });
});
```

This needs the project-local install (see [Extending delivery with TypeScript](getting-started.md#extending-delivery-with-typescript-optional)). `checkPack` asks no questions; the confirmation in [Run the check](#run-the-check) is the command's, for a person checking a pack they did not write. Your own test suite calls it directly on your own pack, with the same sandboxed environment but no prompt.

## Packs in delivery.pack/2

delivery.pack/2 packs still work with no edit. A `delivery.pack/2` pack has a fixed `scan` and `fix` instead of named workflows, and the built-in `code` and `security` reviews are `delivery.pack/2` packs. To start a review of your own in that format, copy `packs/code-review` the way you copied `deprecations` above, then follow the same steps: change `name`, the instructions and `fixtures/`. A `delivery.pack/2` check names its problems as "the scripted review" and "the scripted fixes".

### The delivery.pack/2 manifest, field by field

Every key a `delivery.pack/2` `pack.json` may hold is listed here, and any other key is refused. Bump `version` when you change the pack's manifest or instructions.

| Field | Value | Notes |
|-------|-------|-------|
| `$schema` | `string` | Where an editor finds the schema to check this file against while it is written. Ignored by the harness. Optional. |
| `schema` | `string` | Always `delivery.pack/2` in this format. Required. |
| `name` | `string` | Short name of the review, such as `code`: lower-case letters, digits and dashes, starting with a letter or digit. Its two workflows are `<name>:scan` and `<name>:fix`. Required. |
| `version` | `string` | Three numbers separated by dots, such as `1.0.0`. Required. |
| `title` | `string` | The review's title, such as `Code review`. Required. |
| `summary` | `string` | One sentence saying what it looks for. Required. |
| `scan` | `object` | The scan workflow: see [scan](#scan). Required. |
| `fix` | `object` | The fix workflow: see [fix](#fix). Required. |
| `hold` | `string` | The severity from which fixes wait for the owner's sign-off: `critical`, `high`, `medium` or `low`. Optional; when absent, nothing is held. |

### scan

The scan workflow reads your project and may only add ideas to `.delivery/backlog/`. Holds:

| Field | Value | Notes |
|-------|-------|-------|
| `prompt` | `string` | Path to the instructions file, relative to the pack folder, such as `scan.md`. The harness adds its own description of an idea after your instructions. Required. |

### fix

The fix workflow changes the project to fix one idea. Holds:

| Field | Value | Notes |
|-------|-------|-------|
| `prompt` | `string` | Path to the instructions file, relative to the pack folder, such as `fix.md`. Required. |
| `guards` | `object` | `{ "add": ["backlog-only"] }`: [guards](glossary.md#guard) this pack turns on beside `tests-unchanged`, which every fix already has. Each name must be one that `delivery packs --schema` lists; the guards are described in the [configuration reference](configuration-reference.md#guards). Optional. |

### The checks an idea may use

The harness, not your pack, writes each idea's check. Every idea a scan adds names one of these, and the reviewing agent is told the list:

| Check | Meaning |
|-------|---------|
| `anchor-gone` | Fixed when the flagged code is gone from its `path`. The usual choice. |
| `pattern-absent` | Fixed when an extended regular expression (as `git grep -E` reads it) no longer matches anywhere in the named `paths`. Use this when the problem is a pattern, not a single piece of code. |
| `dependency-absent` | Fixed when `package-lock.json` no longer installs the named package at the named version. Use it for a library version you know to be unsafe. |

An idea whose check cannot find its problem in the project as it stands now is refused, so an idea is only offered when its fix can be proved.

## What a scripted check cannot prove

A scripted check proves:

- Your pack's manifest is valid.
- Your honest change makes the check pass.
- Your cheat is caught by the check (it fails).

It cannot prove:

- Anything about the find's and the acts' prompts (`scan.md`, `code.md`, `tests.md`): the scripted agent never reads them.
- Whether a real agent sends each idea to the right act workflow. The fixtures name the act in `review.json` by hand, so a real agent may choose differently.
- How well the find's severity rating decides what waits for sign-off. The fixtures set each rating, so the check shows the hold works, not that the ratings are right.
- How good your find is on real code. A person must read your instructions and decide if they lead to useful ideas.
- Whether a real agent follows your `scan.md`. As [Test your pipeline](testing-your-pipeline.md) explains, a real agent may follow the instructions differently.
- Whether your pack catches real problems in your area.

## See also

- [Review your project](task-packs.md): run a review and choose what to fix.
- [Test your pipeline](testing-your-pipeline.md): the scripted agent behind the fixtures.
- [Command reference](cli-reference.md): `delivery review` and `delivery packs check`.
