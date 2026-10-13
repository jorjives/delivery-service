# Writing a pack

A review pack is a folder of data that describes what a review looks for and how it proves a fix. You write one by copying a built-in pack, changing its manifest and instructions, proving it with `delivery packs check`, then running it against your projects.

## What a pack is

A pack holds only data: `pack.json` (the manifest), `scan.md` (the review instructions), `fix.md` (the fix instructions, optional), and `fixtures/` (a small project and scripted replies to prove the pack works). It cannot give the agent tools or commands, or bring code of its own for its check. A pack that tries is refused: `delivery packs check` names which field is not allowed, quoting a message like `"scan.allowedTools" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check`.

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
  "name": "mypack",
  "version": "1.0.0",
  "title": "My review",
  "summary": "Looks for issues in my code."
}
```

Replace the instructions in `scan.md` and `fix.md` with text for your review.

## pack.json, field by field

Each field of `pack.json` is optional unless noted. Bump `version` when you change a pack: each review records the version and a fingerprint of the pack's contents (see `delivery findings <n>`, the line starting "Made by").

| Field | Value | Notes |
|-------|-------|-------|
| `$schema` | `string` | Where an editor finds the schema to check this file against while it is written. Ignored by the harness. Optional. |
| `schema` | `string` | Always `delivery.pack/1`, the format this harness reads. Required. |
| `name` | `string` | Short name of the review, such as `code`. Used in sentences and `delivery review <name>`. Required. |
| `version` | `string` | Version of the pack, such as `1.0.0`. When you change this pack's manifest or instructions, bump the version. Required. |
| `title` | `string` | The review's title, such as `Code review`. Required. |
| `summary` | `string` | One sentence saying what it looks for. Required. |
| `scan` | `object` | The review phase: see below. Required. |
| `fix` | `object` | The fix phase, optional. If present, it holds `prompt` and `testGlobs`, `protectedGlobs`, `skipMarkers`. Optional. |
| `severity` | `object` | What each of `low`, `medium`, `high`, `critical` means for this pack, one plain sentence each, by consequence. The reviewer is told these. Required. |
| `hold` | `object` | `{ "atOrAbove": "high" }`: fixes of problems at or above this severity wait for sign-off. `null`, the default, holds nothing. Optional. |

### scan

The review phase. Holds:

| Field | Value | Notes |
|-------|-------|-------|
| `prompt` | `string` | Path to the instructions file, relative to the pack folder, such as `scan.md`. Required. |
| `categories` | `array` | The kinds of problem this review reports: a list of `{ id, title, description }`, each optionally with `changesTests`, `reviewerKnowledge`, `scope: "repo"` or `sensitive`. At least one. Required. |
| `maxFindings` | `number` | Limit the number of problems in one review. Defaults to `40`. Optional. |
| `consequenceLabel` | `string` | `why-it-matters` (the default) or `what-could-happen`: how each problem's consequence is introduced to the owner. Optional. |
| `requireCheck` | `boolean` | `true` sets aside every problem with no specific check for the owner's decision, in any project. Absent by default. Optional. |
| `checks` | `array` | The checks this pack's problems may use. See "The checks a problem may use" below. Defaults to all three. Optional. |

## The checks a problem may use

Every problem has a check: the way you prove the fix worked. A pack lists which checks its problems may use. If a problem suggests a check the pack does not offer, it falls back to `anchor-gone`.

| Check | Meaning |
|-------|---------|
| `anchor-gone` | Fixed when the flagged text is gone. The usual choice. Every pack must offer this. |
| `pattern-absent` | Fixed when an extended regular expression (as `git grep -E` reads it) no longer matches anywhere in the named paths. Use this when the problem is a pattern, not a single piece of code. |
| `dependency-absent` | Fixed when `package-lock.json` no longer installs the named package at the named version. Use it for a library version you know to be unsafe. |
| `none` | When nothing about the code itself can show the problem is fixed. The agent marks it unfixable; a person fixes it. |

In `pack.json`:

```json
{
  "scan": {
    "checks": ["anchor-gone", "pattern-absent"]
  }
}
```

This pack's problems may use `anchor-gone` or `pattern-absent`. The security review offers all three; the code review offers the first two.

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
- `review.json`: a claude-mock script that gives the scripted review reply. See the structure below.
- `fixes.json`: a claude-mock script that gives the scripted fixes: one honest fix per problem, and one cheat per problem that should be refused.
- `expect.json`: what the check must show: the problems found, which fix passes its check, and which cheat is refused.

### fixtures/review.json

A claude-mock script with one expectation. Its reply is the review's structured JSON:

```json
{
  "expectations": [
    {
      "json": {
        "findings": [
          {
            "title": "The total can go below zero",
            "category": "correctness",
            "severity": "high",
            "where": { "path": "total.js" },
            "problem": "A discount larger than the price makes the total negative.",
            "whyItMatters": "A negative total means paying the customer.",
            "fixedLooksLike": "A total never goes below zero.",
            "anchor": "return price - discount;",
            "check": { "kind": "anchor-gone" }
          }
        ],
        "notes": ""
      }
    }
  ]
}
```

### fixtures/fixes.json

A claude-mock script with multiple expectations. Each describes a file change (an honest fix or a cheat). The first expectation should always be for the retry after a refusal, so a refused cheat ends quickly without burning through the fix budget:

```json
{
  "expectations": [
    {
      "when": { "promptContains": "-> FAIL)" },
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

What the check must show when the scripted review and fixes run:

```json
{
  "found": ["The total can go below zero", "A missing or broken settings file gives an unhelpful error"],
  "fixed": ["The total can go below zero"],
  "refused": ["A missing or broken settings file gives an unhelpful error"]
}
```

- `found`: the problems the scripted review must find (in any order).
- `fixed`: the problems whose honest fix must pass its check.
- `refused`: the problems whose cheat must be refused (fail its check).

A fix at or above the pack's `hold` severity counts as passing its check when it waits for sign-off.

## Run the check

```bash
delivery packs check ./my-review
```

Running the fixtures runs the fixture project's own tests on your machine, as `delivery fix` runs a project's tests. Only check a pack whose `fixtures/project` you have read or trust, as you would only run the tests of a project you trust.

If there are problems with the manifest or fixtures, they are named by file and field:

```
my-review/pack.json: "scan.checks.1" is "page-contains" but the available checks are: anchor-gone, pattern-absent, dependency-absent.
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
- `"The scripted review did not find X"`: the review did not report this problem. If the problem was reported but could not be placed in the code, you see why: `"it could not be placed in fixtures/project (anchor not found in the code)"`.
- `"The scripted review also found X, which found does not list"`: an unexpected problem.
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

Proves the folder against your project.

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

## What a scripted check cannot prove

A scripted check proves:

- Your pack's manifest is valid.
- Your instructions are complete enough for the scripted agent to find the problems you wrote.
- Your honest fix actually fixes the problem (the check passes).
- Your cheat is caught by the check (it fails).

A scripted check cannot prove:

- How good your review is on real code. A person must read your instructions and decide if they lead to useful findings.
- Whether a real agent follows your `scan.md`. As `docs/testing-your-pipeline.md` explains, a real agent may follow the instructions differently.
- Your review catches real problems in your area.

Also: unlike `delivery review`, `delivery packs check` runs `fixtures/project/`'s own `test` script (the way it proves a fix broke nothing). Only check a pack someone else wrote after reading and understanding what their `fixtures/project/` tests, and what their fixtures claim the review should find.

## Try it

To see a pack being written and checked, run the demo:

```bash
npm run demo:packs-slice-7
```

This copies the built-in code review to a scratch folder, breaks one field to show an error, fixes it, and shows a passing check.
