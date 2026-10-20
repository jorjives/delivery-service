# Writing a pack

A review pack is a folder of data that describes what a review looks for and how it proves a fix. You write one by copying a built-in pack, changing its manifest and instructions, proving it with `delivery packs check`, then running it against your projects.

## What a pack is

A pack holds only data: `pack.json` (the manifest), `scan.md` (the review instructions), `fix.md` (the fix instructions), and `fixtures/` (a small project and scripted replies to prove the pack works). It cannot give the agent tools or commands, or bring code of its own for its check. A pack that tries is refused: `delivery packs check` names which field is not allowed, quoting a message like `"scan.allowedTools" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check`.

## Start from a built-in pack

Copy a built-in pack as a starting point:

```bash
# In your repository
cp -r "$(npm root)/delivery-service/packs/code-review" ./my-review
```

Or, in a checkout of the harness:

```bash
cp -r packs/code-review ./my-review
```

Then change `pack.json`:

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

Replace the instructions in `scan.md` and `fix.md` with text for your review.

## pack.json, field by field

Every key `pack.json` may hold is listed here, and any other key is refused. Bump `version` when you change the pack's manifest or instructions.

| Field | Value | Notes |
|-------|-------|-------|
| `$schema` | `string` | Where an editor finds the schema to check this file against while it is written. Ignored by the harness. Optional. |
| `schema` | `string` | Always `delivery.pack/2`, the format this harness reads. Required. |
| `name` | `string` | Short lower-case name of the review, such as `code`. Its two workflows are `<name>:scan` and `<name>:fix`. Required. |
| `version` | `string` | Version of the pack, such as `1.0.0`. Required. |
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
| `guards` | `object` | `{ "add": ["backlog-only"] }`: guards this pack turns on beside `tests-unchanged`, which every fix already has. Each name must be one the schema lists. Optional. |

Your pack becomes two workflows, `<name>:scan` and `<name>:fix`: list its folder under `packs` in `delivery.config.json` to use it.

## The checks an idea may use

The harness, not your pack, writes each idea's check. Every idea a scan adds names one of these, and the reviewing agent is told the list:

| Check | Meaning |
|-------|---------|
| `anchor-gone` | Fixed when the flagged code is gone from its `path`. The usual choice. |
| `pattern-absent` | Fixed when an extended regular expression (as `git grep -E` reads it) no longer matches anywhere in the named `paths`. Use this when the problem is a pattern, not a single piece of code. |
| `dependency-absent` | Fixed when `package-lock.json` no longer installs the named package at the named version. Use it for a library version you know to be unsafe. |

An idea whose check cannot find its problem in the project as it stands now is refused, so an idea is only offered when its fix can be proved.

## Check it as you type

Get the JSON Schema so your editor can check your `pack.json`:

```bash
delivery packs --schema > pack.schema.json
```

Then at the top of `pack.json`:

```json
{
  "$schema": "./pack.schema.json",
  ...
}
```

Your editor will flag unknown keys and invalid values as you type.

## Fixtures

The fixtures prove your pack works before you run it against a real project. They live in `fixtures/`:

- `project/`: a small project with a `test` script (for example, `"test": "node --test"` in `package.json`). Committed fresh for each check run.
- `review.json`: a claude-mock script for the scan: its session writes your ideas into `.delivery/backlog/` with `effects` and replies `completed`. See `packs/code-review/fixtures/review.json` for a worked one.
- `fixes.json`: a claude-mock script for the fixes, honest and cheating: one honest fix per problem, and one cheat per problem that should be refused.
- `expect.json`: names the titles the review adds (`found`), the fixes that pass (`fixed`) and the cheats that are refused (`refused`).

`delivery packs check ./my-review` runs `delivery review`, `delivery approve --all` and `delivery run --sources` against those scripts in a scratch copy of `fixtures/project`, with nothing sent to a real agent.

### fixtures/fixes.json

This claude-mock script holds several expectations, each describing a file change (an honest fix or a cheat). Put the retry after a refusal first, so a refused cheat ends quickly without burning through the fix budget:

```json
{
  "expectations": [
    {
      "when": { "promptContains": "still there" },
      "json": { "status": "escalate", "category": "authority", "rationale": "Told its fix was refused, the scripted agent gives up." }
    },
    {
      "effects": [{ "edit": { "path": "total.js", "old": "return price - discount;", "new": "return Math.max(0, price - discount);" } }],
      "json": { "status": "completed", "rationale": "A total never goes below zero." }
    },
    {
      "effects": [{ "edit": { "path": "settings.js", "old": "...", "new": "..." } }, { "delete": { "path": "old-file.js" } }],
      "json": { "status": "completed", "rationale": "..." }
    }
  ]
}
```

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

Running the fixtures runs the fixture project's own tests on your machine, as a run runs a project's tests, so it asks you to confirm you trust the pack's code before anything runs: `y` to continue, Enter or `n` to leave it alone. The command runs that test command with none of your credentials and a scratch `HOME` in place of your own, but it is still real code with your real filesystem and process access; only check a pack whose `fixtures/project` you have read or trust. In a script or CI, where nothing can ask, pass `--yes` once you do.

The check names any problem with the manifest or fixtures by file and field:

```
my-review/pack.json: "scan.checks" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check.
```

Exit code 2.

If the pack is ready, the check runs the fixtures:

```
Checking the review in my-review…
✓ pack.json: the mypack review, version 1.0.0.
✓ The scripted review found 2 problems, as fixtures/expect.json expects: "The total can go below zero", "A missing or broken settings file gives an unhelpful error".
✓ The scripted fix for "The total can go below zero" passed its check.
✓ The scripted cheat for "A missing or broken settings file gives an unhelpful error" was refused: it removed, changed or skipped tests.
Nothing was sent to a real agent: every reply came from the review's fixtures.
Ready to use: delivery review ./my-review
```

Exit code 0.

### What the check can report

- `"The scripted review found X problems, as fixtures/expect.json expects"`: success.
- `"The scripted fix for X did not pass its check: it ended ..."`: the fix did not make the change it claimed, or broke a test.
- `"The scripted cheat for X was not refused: it ended ..."`: the cheat passed its check when the fixtures say it should fail.
- `"The scripted review did not add X"`: the scripted review did not write an idea with this title.
- `"The scripted review also added X, which found does not list"`: an unexpected idea.
- `"The scripted review could not be used: ..."`: the reply was valid JSON but not a valid review (wrong category name, for example).

Exit code 2 for any of these. Passing runs use exit code 0.

### With --json

```bash
delivery packs check ./my-review --json
```

The whole result as one JSON document, with the same exit codes.

## Use it

Once the check passes, use the pack exactly as you would a built-in one:

```bash
delivery review ./my-review
```

This proves the folder against your project.

## From your own test suite

Import the check from the testing export:

```typescript
import { checkPack } from "delivery-service/testing";

describe("my review pack", () => {
  it("passes the pack check", async () => {
    expect((await checkPack("./my-review")).problems).toEqual([]);
  });
});
```

`checkPack` itself asks no questions; the confirmation in [Run the check](#run-the-check) is the CLI command's, for a person checking a pack they did not write. Your own test suite calls it directly on your own pack, with the same sandboxed environment but no prompt.

## What a scripted check cannot prove

A scripted check proves:

- Your pack's manifest is valid.
- Your instructions are complete enough for the scripted agent to find the problems you wrote.
- Your honest fix actually fixes the problem (the check passes).
- Your cheat is caught by the check (it fails).

A scripted check cannot prove:

- How good your review is on real code. A person must read your instructions and decide if they lead to useful findings.
- Whether a real agent follows your `scan.md`. As `docs/testing-your-pipeline.md` explains, a real agent may follow the instructions differently.
- Whether your review catches real problems in your area.

Unlike `delivery review`, `delivery packs check` runs `fixtures/project/`'s own `test` script (the way it proves a fix broke nothing). The confirmation in [Run the check](#run-the-check), and the sandboxed environment that command runs with, guard against an accidental credential leak; they are not a sandbox against hostile code. Only check a pack someone else wrote after reading and understanding what their `fixtures/project/` tests, and what their fixtures claim the review should find.
