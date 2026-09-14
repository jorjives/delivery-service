# Testing your delivery pipeline

This guide gets you from nothing to passing, scripted tests of your own
delivery pipeline: your gate, your closer and your role configurations, run
together through a whole surface against a scripted stand-in for the agent. You
do not need to read any source to follow it.

A scripted test proves your pipeline does the right thing with what the agent
does: that your gate judges the change, your closer lands it, and a bad reply is
retried or escalated as your budgets say. It proves nothing about how well a
real agent would do the work.

Everything below is imported from the harness's two entry points, from the
repository root: `./src/index.js`, and `./src/testing.js` for the testing API
(the harness is not published as a package yet). Run the snippets with
`npx tsx`.

## What you need

- Node.js 22 or later, and `git`.
- A clone of the harness with `npm install` run in it. The scripted agent,
  `claude-mock`, is vendored in `vendor/claude-mock` and installed with
  everything else.

Nothing else: no global setup, nothing to link or put on your `PATH`, no
network and no API key. Every session the testing API starts runs the scripted
agent and is given no credentials, even when your shell has some.

## Choosing a stand-in

The harness talks to agents through one agent port. There are two ways to stand
in for the agent behind it, and they answer different questions:

| | `fakeAgentPort` (in-process stand-in) | The scripted agent (`runSurfaceAgainstMock`, `mockSessionEnvironment`) |
|---|---|---|
| What it runs | Nothing below the agent port: no prompt assembly, no reply validation, no Agent SDK | The real invocation, the real Agent SDK over the real command-line protocol, and real reply validation |
| Cost | No process is started | One short-lived process per agent session |
| Proves your role configuration | No | Yes: the only stand-in that runs your `systemPromptFragment` and `envelopeSchema` through the real wiring (but not your `allowedTools`: see "What the scripted agent cannot prove") |
| Right for | Fast tests of the surface driver, triage or routing that need exact control over each reply | Tests of your own pipeline: your gate, closer and role configurations together |

If you are testing your gate, closer or role configurations, use the scripted
agent. The rest of this guide is about that.

For the other job, build the stand-in from a reply for each role your test
reaches:

```ts
// fake-agent.ts
import { fakeAgentPort } from "./src/testing.js";

const agent = fakeAgentPort({
  worker: async () => ({ status: "completed", rationale: "made the change" }),
});
```

Pass `agent` wherever the harness takes an agent port, such as the `agent` in
`run`'s ports. Each reply is type-checked against its role, so a worker reply
shaped like a triage verdict does not compile. Never cast to
`AgentPort["invoke"]` instead: the cast lets exactly that mistake through, and
the linter rejects it.

## Worked example: the happy path

This test scripts a worker that writes one file and reports completion, then
runs a whole surface, worker to gate to close, in a throwaway git repository.
The gate and closer are real, so the test only passes if the gate accepts the
change and the closer lands it on `main`.

```ts
// happy-path.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deterministicRouter, gateMaintenanceRoleConfig, triageRoleConfig, workerRoleConfig,
  type BudgetSet, type CloserRef, type GateRef,
} from "./src/index.js";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSurfaceAgainstMock, type MockScript } from "./src/testing.js";

// Your pipeline: put your own gate, closer, role configurations and budgets here.
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };
const budgets: BudgetSet = {
  correction: { used: 0, max: 2 },
  gateError: { used: 0, max: 2 },
  gateMaintenance: { used: 0, max: 1 },
  terminus: { used: 0, max: 2 },
  close: { used: 0, max: 2 },
};
const intent = "add a greeting file that says hello";

// Git sets GIT_DIR and friends when it runs hooks; left in place they would point
// these commands at the wrong repository.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

/** A throwaway git repository on main, holding `files` in one commit. */
function scratchRepo(files: Record<string, string>): string {
  const repoPath = mkdtempSync(join(tmpdir(), "pipeline-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoPath, env });
  git("init", "-b", "main");
  git("config", "user.email", "pipeline-test@example.invalid");
  git("config", "user.name", "Pipeline test");
  for (const [name, content] of Object.entries(files)) writeFileSync(join(repoPath, name), content);
  git("add", "-A");
  git("commit", "-m", "seed");
  return repoPath;
}

test("a scripted worker's change is judged by the real gate and landed by the real closer", async () => {
  const repoPath = scratchRepo({ "report.tap": "1..1\nok 1 - greets\n" });
  const scratch = mkdtempSync(join(tmpdir(), "pipeline-run-"));
  const dir = join(scratch, "case");
  mkdirSync(dir);

  const script: MockScript = {
    expectations: [
      {
        when: { promptContains: intent },
        effects: [{ write: { path: "greeting.txt", content: "hello\n" } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "wrote greeting.txt" }),
      },
    ],
  };

  const { result, journal } = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: join(scratch, "worktree") },
    header: { surfaceId: "greeting", taskDef: { intent }, gateRef, closerRef },
    budgets,
    roleConfigs,
    triage: () => deterministicRouter,
    script,
  });

  // First, so a script that went wrong fails with the prompts actually sent.
  assertFullyConsumed(journal, script);
  const [workerPrompt = ""] = promptsSent(journal);
  assert.ok(workerPrompt.includes(intent), `the worker was never told the task:\n${workerPrompt}`);

  assert.equal(result.state, "CLOSED");
  assert.equal(execFileSync("git", ["show", "main:greeting.txt"], { cwd: repoPath, env, encoding: "utf-8" }), "hello\n");
});
```

From the repository root, save it as `happy-path.test.ts` and run it with
Node.js's built-in test runner:

```bash
npx tsx --test happy-path.test.ts
```

It passes in a second or two. The output ends like this (timings and some
summary lines left out):

```text
✔ a scripted worker's change is judged by the real gate and landed by the real closer
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

The assertions use `node:assert`, so the test needs no test framework; the same
calls work unchanged inside a Vitest or Jest test.

What each part does:

- **The script** is what the agent does and says. Its one expectation waits for
  a prompt containing the task's intent, writes `greeting.txt` into the
  surface's worktree for real, and replies with a worker result as the `json`.
- **`expectEnvelope(workerRoleConfig, ...)`** checks that result as you write it:
  against the worker's reply type by the compiler, and against the worker's own
  `envelopeSchema` when the script is built. A slip fails there, naming the
  field, instead of as a puzzling incomplete attempt later.
- **`runSurfaceAgainstMock`** creates the case file in `dir` (an existing, empty
  directory) from `header` and `budgets`, then runs one surface to its end with
  the harness's own driver. The gate and closer named in `header` are resolved
  against `repoPath` exactly as in a live run, and the surface's worktree is
  created at `worktreePath`. Every agent session runs your `roleConfigs` through
  the real invocation, against the scripted agent.
- **`triage`** picks how setbacks are decided: `() => deterministicRouter` for
  the fixed rules alone, or `(agent) => createAgentTriage(agent)` so that
  triage's own replies come from the same script.
- **`result`** is where the surface ended (`result.state`, for example `CLOSED`
  or `ESCALATED`) and its recorded outcome (`result.outcome`). To check each step
  the surface took, read its case file with `load(dir)`.

The gate here, `cat report.tap`, stands in for your test command so the example
runs anywhere. To test your own pipeline, replace `gateRef`, `closerRef`,
`roleConfigs` and `budgets` with yours, seed the scratch repository with what
your gate needs, and script what your worker should do.

## Asserting what the harness sent, and that the script was used

`runSurfaceAgainstMock` also returns the scripted agent's **journal**: one event
per line it recorded, across every session in the run, in order.

| `event` | Fields | Recorded when |
|---|---|---|
| `"matched"` | `prompt`, `expectation` (its position in the script) | a prompt used an expectation |
| `"unmatched"` | `prompt` | a prompt matched no expectation |
| `"effect_failed"` | `prompt`, `expectation`, `error` | a scripted `write` or `edit` could not be applied |
| `"finished"` | `turns`, `unconsumed` | a session ended |

**What the harness sent.** `promptsSent(journal)` lists every prompt, matched or
not, in the order sent. A worker's prompt starts with the task as the case file
holds it:

```text
## Task
{
  "intent": "add a greeting file that says hello"
}
```

so a test that the task reached the worker is a substring check, as in the
worked example.

**That the script was used.** `assertFullyConsumed(journal, script)` returns
quietly when every expectation was used by some session, and throws otherwise.
If the happy path's trigger phrase had a typo, `"add a greting file"`, the
worker's prompt would match nothing and the test would fail with:

```text
The script was not fully used: 1 of 1 expectations never matched a prompt.
  expectation 0: waiting for a prompt containing "add a greting file"

Prompts the harness sent that matched no expectation:
--- prompt 1 ---
## Task
{
  "intent": "add a greeting file that says hello"
}
```

followed by the rest of that prompt. Call it before your other assertions, as
the worked example does: otherwise the first failure you see is the surface
ending `ESCALATED`, which says what happened but not why.
`runSurfaceAgainstMock` never calls it for you, because a script may hold
expectations for a branch a particular run does not take. Judge a whole run
with it, not a session's own `"finished"` event: every session reads the whole
script afresh, so one session's `unconsumed` includes expectations another
session used.

**How a prompt picks an expectation.** Each session reads the script from the
top and takes the first expectation whose `when` holds. `promptContains` is a
plain substring; `promptMatches` is a regular expression; give both and both
must hold; leave `when` out to match any prompt. Because every session starts
from the top, give each expectation a `when` once a run makes more than one
agent call, and put the more specific expectation first.

## When the test itself is wrong

| What went wrong | What you see |
|---|---|
| The scripted agent is not installed | `runSurfaceAgainstMock` and `mockSessionEnvironment` throw `claude-mock was not found at <path>. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.` |
| A scripted envelope is malformed by mistake | `expectEnvelope` throws `The scripted envelope is not a valid worker result:`, then one line per problem, naming the field |
| An expectation was never used | `assertFullyConsumed` throws, as above |
| A `fakeAgentPort` is asked for a role it has no reply for | the call rejects with `fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler` |

## Watch it run

Each of these runs with no network and no API key, and prints what it does:

```bash
npm run demo:mock-slice-1   # a stand-in built with fakeAgentPort, and the compile error for a wrong reply
npm run demo:mock-slice-3   # a whole pipeline against the scripted agent, then a typo in the script
npm run demo:mock-slice-4   # each way the agent can misbehave, and what the surface does
```
