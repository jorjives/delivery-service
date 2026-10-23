# Write a pack

This guide is for you if you want a review of your own: a folder that tells an agent what to look for in a project, and that proves its fixes with the project's own tests. You copy a built-in pack, change its manifest and instructions, prove it with `delivery packs check`, then run it against your projects. It takes about half an hour.

## Before you start

- Install the command and run a task once: [Get started](getting-started.md).
- Know what a review, an [idea](glossary.md#idea) and the [backlog](glossary.md#backlog) are: [Review your project](task-packs.md).

## What a pack is

A [pack](glossary.md#pack) holds only data: `pack.json` (the manifest), `scan.md` (the review instructions), `fix.md` (the fix instructions), and `fixtures/` (a small project and scripted replies that prove the pack works). It cannot give the agent tools or commands, or bring code of its own for its check. A pack that tries is refused: `delivery packs check` names which field is not allowed, quoting a message like `"scan.allowedTools" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check`.

## Start from a built-in pack

Copy the built-in `code` pack. If you installed the command globally, as [Get started](getting-started.md) does:

```bash
cp -r "$(npm root -g)/delivery-service/packs/code-review" ./my-review
```

If you installed it in this project instead (see [Extending delivery with TypeScript](getting-started.md#extending-delivery-with-typescript-optional)):

```bash
cp -r "$(npm root)/delivery-service/packs/code-review" ./my-review
```

Or, in a checkout of the harness repository:

```bash
cp -r packs/code-review ./my-review
```

Then make the folder yours:

1. Change `pack.json`. The `name` must not be one that is already taken (`code` and `security` are built in), or the check stops with `Two things define the workflow "code:scan"`.

    ```json
    {
      "schema": "delivery.pack/2",
      "name": "mypack",
      "version": "1.0.0",
      "title": "My review",
      "summary": "Looks for issues in my code.",
      "scan": { "prompt": "scan.md" },
      "fix": { "prompt": "fix.md" }
    }
    ```

2. Replace the instructions in `scan.md` and `fix.md` with text for your review.
3. In `fixtures/review.json`, change every `workflow: code:fix` to `workflow: <name>:fix`, using the name from step 1.
4. Replace the contents of `fixtures/` to match your review: see [Fixtures](#fixtures). The copied ones describe the code review's own problems.

## Name your own workflows

A pack in `delivery.pack/3` names its own workflows, where a `delivery.pack/2` pack has a fixed `scan` and `fix`. It holds exactly one `find` workflow, which reads the project and may only add ideas, and one or more `act` workflows, each of which changes the project to fix one idea. A workflow's full name is `<name>:<workflow>`, such as `mymoves:scan`.

This is a complete `delivery.pack/3` manifest: a find called `scan` that offers two acts, `code` and `tests`.

```json
{
  "schema": "delivery.pack/3",
  "name": "mymoves",
  "version": "1.0.0",
  "title": "My moves",
  "summary": "Moves calls off retired code.",
  "workflows": {
    "scan": {
      "kind": "find",
      "ideasFor": ["code", "tests"],
      "prompt": "scan.md"
    },
    "code": {
      "kind": "act",
      "summary": "Code of the project's own that still calls the retired code.",
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
      "summary": "A test file that still calls the retired code.",
      "prompt": "tests.md"
    }
  }
}
```

Save it as `pack.json`. Put `scan.md`, `code.md` and `tests.md` beside it with your instructions, list the folder under `packs`, and `delivery packs` lists it.

`delivery review <name>` starts a `delivery.pack/3` pack's find, whatever it is called. In this release `delivery packs check` still checks only `delivery.pack/2` packs; checking a `delivery.pack/3` pack end to end comes in a later release.

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
| `settings` | (reserved) | Reserved for pack settings. This release does not read them, so a pack that has one is refused. |

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

### The rules a pack keeps

- Exactly one workflow has `"kind": "find"`.
- Every name in a find's `ideasFor` is an act workflow in the same pack.
- Every act workflow is named in some find's `ideasFor`, so an idea can reach it.
- An act that a find chooses between has a `summary`.
- `{{settings.` is reserved in prompts, for pack settings this release does not read.
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
| `"settings" is reserved for pack settings, which this harness does not read yet` | Remove `settings`. |

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

- `project/`: a small project with a `test` script (for example, `"test": "node --test"` in `package.json`). Committed fresh for each check run. It must not be empty or hold a `.git` folder.
- `review.json`: a claude-mock script for the scan. claude-mock is the scripted stand-in for the agent (see [Test your pipeline](testing-your-pipeline.md)). Its session writes your ideas into `.delivery/backlog/` with `effects` and replies `completed`. See `packs/code-review/fixtures/review.json` in the harness repository for a worked one.
- `fixes.json`: a claude-mock script for the fixes, honest and cheating: one honest fix per problem, and one cheat per problem that should be refused.
- `expect.json`: names the titles the review adds (`found`), the fixes that pass (`fixed`) and the cheats that are refused (`refused`). Each list needs at least one title.

`delivery packs check ./my-review` runs `delivery review`, `delivery approve --all` and `delivery run --sources` against those scripts in a scratch copy of `fixtures/project`, with nothing sent to a real agent.

### fixtures/fixes.json

This script holds several expectations, each describing a file change (an honest fix or a cheat). Give each expectation a `when`: the first one that matches the prompt is used. Without it, every idea gets the same reply and the check stops showing what you wrote. Put the retry after a refusal first, so a refused cheat ends quickly without burning through the fix budget. This is the shipped one, which keys each fix on the idea's title:

```json
{
  "expectations": [
    {
      "when": { "promptContains": "still there" },
      "json": { "status": "escalate", "category": "authority", "rationale": "Told its fix was refused, the scripted agent gives up." }
    },
    {
      "when": { "promptContains": "The total can go below zero" },
      "effects": [{ "edit": { "path": "total.js", "old": "return price - discount;", "new": "return Math.max(0, price - discount);" } }],
      "json": { "status": "completed", "rationale": "A total never goes below zero." }
    },
    {
      "when": { "promptContains": "A missing or broken settings file gives an unhelpful error" },
      "effects": [
        { "edit": { "path": "settings.js", "old": "return JSON.parse(readFileSync(path, \"utf-8\"));", "new": "const text = readFileSync(path, \"utf-8\");\n  return JSON.parse(text);" } },
        { "delete": { "path": "total.test.js" } }
      ],
      "json": { "status": "completed", "rationale": "Read the file first, and removed a test that got in the way." }
    }
  ]
}
```

The second expectation is the honest fix. The third is a cheat: it deletes a test, so the check refuses it.

### fixtures/expect.json

What the check must show when the scripted review and fixes run, with each title written exactly as the scripted review writes it:

```json
{
  "found": ["The total can go below zero", "A missing or broken settings file gives an unhelpful error"],
  "fixed": ["The total can go below zero"],
  "refused": ["A missing or broken settings file gives an unhelpful error"]
}
```

- `found`: the problems the scripted review must add (in any order).
- `fixed`: the problems whose honest fix must pass its check.
- `refused`: the problems whose cheat must be refused (fail its check).

A fix at or above the pack's `hold` severity counts as passing its check when it waits for sign-off.

## Run the check

```bash
delivery packs check ./my-review
```

Running the fixtures runs the fixture project's own tests on your machine, as a run runs a project's tests, so the command asks you to confirm you trust the pack's code before anything runs: `y` to continue, Enter or `n` to leave it alone. It runs that test command with none of your credentials and a scratch `HOME` in place of your own. It is still real code with your real filesystem and process access, and this is not a sandbox against hostile code, so only check a pack whose `fixtures/project` you have read or trust. In a script or CI, where nothing can ask, pass `--yes` once you do. Without a terminal and without `--yes`, the command prints `This isn't a terminal, so I can't ask whether you trust this pack's code. Pass --yes once you do.` and exits 2.

Declining leaves the pack unchecked and exits 0. The command prints `Left my-review alone: I only run a pack's own code once you say you trust it.`

If the pack is ready, the check runs the fixtures:

```text
Checking the review in my-review…
✓ pack.json: the mypack review, version 1.0.0.
✓ The scripted review found 2 problems, as fixtures/expect.json expects: "The total can go below zero", "A missing or broken settings file gives an unhelpful error".
✓ The scripted fix for "The total can go below zero" passed its check.
✓ The scripted cheat for "A missing or broken settings file gives an unhelpful error" was refused: it removed, changed or skipped tests.
Nothing was sent to a real agent: every reply came from the review's fixtures.
Ready to use: delivery review ./my-review
```

Exit code 0.

### When the check finds a problem

Each problem is printed as `<file>: <what is wrong>.` and the command exits 2. For example, when `expect.json` lists a title the scripted review did not write:

```text
Checking the review in my-review…
my-review/fixtures/expect.json: the scripted review did not add "The login page is slow".
Nothing was sent to a real agent: every reply came from the review's fixtures.
```

What each message means, and the fix:

- `pack.json: "<field>" is not part of the pack format ...`, or a missing or invalid field: correct the manifest. A manifest with a mistake stops the check before any fixture runs.
- `<fixture file>: is missing: it holds ...`, `is not valid JSON`, or `fixtures/project: is empty`: add or repair that file. A `.git` folder inside `fixtures/project` is refused.
- `expect.json: ... must name at least one problem`: each of `found`, `fixed` and `refused` needs a title, and every title in `fixed` and `refused` must also be in `found`.
- `the scripted review could not be used: ...`: the review did not run, for example because the pack name is already taken, or an idea's `workflow:` is not `<name>:fix`.
- `the scripted review did not add "X"` and `the scripted review also added "X", which "found" does not list`: `review.json` and `found` disagree. Make them name the same titles.
- `the scripted review added no idea for the act workflow "X", so the check never ran it`: every act workflow needs at least one idea in `review.json` naming it in `workflow:`. Check that each `workflow:` is `<name>:<act>` with your pack's own name, since an idea that names another pack's workflow does not count.
- `the scripted fixes could not run: ...`: the fixes did not run; the rest of the message says why.
- `the scripted fix for "X" did not pass its check: it ended ...`: the fix did not make the change it claimed, or broke a test.
- `the scripted cheat for "X" was not refused: it ended ...`: the cheat passed its check when the fixtures say it should fail.

A `delivery.pack/3` pack's messages name its find (`the scripted find <name>:<find>`) and the act an idea ran under (`under <name>:<act>`) in place of "review" and "fix".

### With --json

```bash
delivery packs check ./my-review --json
```

Prints the whole result as one JSON document, with the same exit codes. Its keys are `ready`, `pack` (`name`, `version` and `hash`), `problems`, `run` (`found`, `fixed` and `refused`) and `sentToAgent`, which is always `false`.

## Use it

Once the check passes, run the pack against your project exactly as you would a built-in one:

```bash
delivery review ./my-review
```

This runs a real review of your project with a real agent, so Claude Code must be signed in. It adds one idea to your backlog for each problem it finds. See [Review your project](task-packs.md).

To have the ideas fixed with `delivery approve` and `delivery run --sources`, list the folder under `packs` in `delivery.config.json`, so the `<name>:fix` workflow exists:

```json
{ "packs": ["./my-review"] }
```

See [`packs`](configuration-reference.md#packs).

## The delivery.pack/2 manifest, field by field

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

## From your own test suite

Import the check from the testing export, in a Vitest or Jest test file. The path is relative to the directory you run the tests from:

```typescript
import { describe, it, expect } from "vitest";
import { checkPack } from "delivery-service/testing";

describe("my review pack", () => {
  it("passes the pack check", async () => {
    expect((await checkPack("./my-review")).problems).toEqual([]);
  });
});
```

This needs the project-local install (see [Extending delivery with TypeScript](getting-started.md#extending-delivery-with-typescript-optional)). `checkPack` asks no questions; the confirmation in [Run the check](#run-the-check) is the command's, for a person checking a pack they did not write. Your own test suite calls it directly on your own pack, with the same sandboxed environment but no prompt.

## What a scripted check cannot prove

A scripted check proves:

- Your pack's manifest is valid.
- Your honest fix fixes the problem (the check passes).
- Your cheat is caught by the check (it fails).

It cannot prove:

- Anything about `scan.md` and `fix.md`: the scripted agent never reads them.
- How good your review is on real code. A person must read your instructions and decide if they lead to useful findings.
- Whether a real agent follows your `scan.md`. As [Test your pipeline](testing-your-pipeline.md) explains, a real agent may follow the instructions differently.
- Whether your review catches real problems in your area.

## See also

- [Review your project](task-packs.md): run a review and choose what to fix.
- [Test your pipeline](testing-your-pipeline.md): the scripted agent behind the fixtures.
- [Command reference](cli-reference.md): `delivery review` and `delivery packs check`.
