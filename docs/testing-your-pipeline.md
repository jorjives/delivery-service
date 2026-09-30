# Testing your delivery pipeline

This guide gets you from nothing to passing, scripted tests of your own
delivery pipeline: your gate, your closer and your role configurations, run
together through a whole surface against a scripted stand-in for the agent. You
do not need to read any source to follow it.

A scripted test proves your pipeline does the right thing with what the agent
does: that your gate judges the change, your closer lands it, and a bad reply is
retried or escalated as your budgets say. It proves nothing about how well a
real agent would do the work.

Everything below is imported from the harness's two entry points:
`delivery-service`, and `delivery-service/testing` for the testing API. Run the
snippets with `npx tsx`.

## What you need

- Node.js 22 or later, and `git`.
- The harness installed in your project with `npm install`, as
  [Getting started](getting-started.md) describes. The scripted agent,
  `claude-mock`, is vendored in the harness checkout and installed with
  everything else there, so the sections that use it need that checkout:
  `fakeAgentPort` works from an installed copy alone.

Nothing else: no global setup, no project-local setup beyond the install above, no
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
import { fakeAgentPort } from "delivery-service/testing";

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
} from "delivery-service";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSurfaceAgainstMock, type MockScript } from "delivery-service/testing";

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

## Worked example: when the agent misbehaves

Trust in a pipeline comes from seeing it refuse bad work. These two tests
provoke that on cue: a worker that gives up for want of authority, and a worker
whose first change breaks a check the gate measures.

```ts
// misbehaviour.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deterministicRouter, gateMaintenanceRoleConfig, load, triageRoleConfig, workerRoleConfig,
  type BudgetSet, type CloserRef, type GateRef,
} from "delivery-service";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSurfaceAgainstMock, type MockScript } from "delivery-service/testing";

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
const PASSING = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

/** Run one surface with `script`, in a throwaway git repository whose gate passes before the worker starts. */
async function runScripted(script: MockScript) {
  const repoPath = mkdtempSync(join(tmpdir(), "pipeline-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoPath, env, encoding: "utf-8" });
  git("init", "-b", "main");
  git("config", "user.email", "pipeline-test@example.invalid");
  git("config", "user.name", "Pipeline test");
  writeFileSync(join(repoPath, "report.tap"), PASSING);
  git("add", "-A");
  git("commit", "-m", "seed");

  const scratch = mkdtempSync(join(tmpdir(), "pipeline-run-"));
  const dir = join(scratch, "case");
  mkdirSync(dir);
  const ran = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: join(scratch, "worktree") },
    header: { surfaceId: "greeting", taskDef: { intent }, gateRef, closerRef },
    budgets,
    roleConfigs,
    triage: () => deterministicRouter,
    script,
  });
  return { ...ran, dir, git };
}

test("a worker that escalates for authority stops the surface at once", async () => {
  const rationale = "deploying needs a production credential this worker was not given";
  const script: MockScript = {
    expectations: [{ json: expectEnvelope(workerRoleConfig, { status: "escalate", category: "authority", rationale }) }],
  };

  const { result, journal } = await runScripted(script);

  assertFullyConsumed(journal, script);
  assert.equal(promptsSent(journal).length, 1);
  assert.equal(result.state, "ESCALATED");
  assert.equal(result.outcome?.reason, rationale);
});

test("a change the gate rejects goes back to the worker, and only the passing attempt lands", async () => {
  const script: MockScript = {
    expectations: [
      // Every session reads the script from the top and takes the first expectation that matches,
      // so the retry, keyed on the failure the gate reports, comes before the first attempt.
      {
        when: { promptContains: "2 - beta (PASS -> FAIL)" },
        effects: [{ write: { path: "report.tap", content: PASSING } }, { write: { path: "greeting.txt", content: "hello\n" } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "fixed beta and wrote greeting.txt" }),
      },
      {
        when: { promptContains: intent },
        effects: [{ write: { path: "report.tap", content: FAILING } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "wrote the greeting, breaking beta" }),
      },
    ],
  };

  const { result, journal, dir, git } = await runScripted(script);

  assertFullyConsumed(journal, script);
  const { history } = await load(dir);
  assert.deepEqual(history.flatMap((entry) => (entry.t === "gate" ? [entry.status] : [])), ["FAIL", "PASS"]);
  assert.equal(result.state, "CLOSED");
  assert.equal(git("show", "main:report.tap"), PASSING);
  assert.equal(git("show", "main:greeting.txt"), "hello\n");
});
```

Save it beside the first as `misbehaviour.test.ts` and run it the same way:

```bash
npx tsx --test misbehaviour.test.ts
```

Both tests pass. The output ends like this:

```text
✔ a worker that escalates for authority stops the surface at once
✔ a change the gate rejects goes back to the worker, and only the passing attempt lands
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

What they show:

- **An escalation for authority is final.** The worker's `escalate` result with
  category `authority` ends the surface `ESCALATED` at once, with the worker's
  rationale as the outcome's reason: one agent session, no retry, no triage.
- **A change the gate rejects is retried, not accepted.** The first attempt
  breaks the `beta` check. The gate measures that against the baseline it took
  before the worker started and fails the attempt, and triage sends it back.
  The retried worker's prompt carries the gate's evidence, each newly failing
  check written as `<name> (<before> -> <after>)`, here
  `2 - beta (PASS -> FAIL)`, so the script keys the retry on that. Only the
  passing attempt reaches `main`.

With your own gate, the evidence line is whatever your gate names its failing
check; read it from `promptsSent(journal)` in a first failing run.

## Testing several tasks at once

When `delivery run` has several tasks going at once, they share one
repository: each task's working copy is made from it, and each task's finished
work is merged back into it. `runSupervisorAgainstMock` runs several scripted
tasks through the harness's own supervisor, the one `delivery run` uses when
`concurrency` is above 1, against one scratch repository, so you can prove your
gate and closer behave when tasks finish together.

Each task brings its own `header` and its own `script`, so each task's agent
does only what its own script says. `slots` is how many tasks may run at once,
as `concurrency` is for `delivery run`. The budgets, role configurations and
triage are shared by every task, as they are across one project's list.

One difference from `delivery run`: here a task whose check cannot run is
repaired on its own, as a single task is; the single repair for the whole run
that `delivery run` makes is not part of this runner yet.

**Choosing which task gets there first.** A script's `delayMs` is how long its
agent waits before each reply. Tasks that start together have their working
copies made before any agent answers, so the task whose agent answers first
reaches the merge first. Give the task you want second a delay a couple of
seconds longer than the first: each agent session takes a moment to start, and
the gap has to outlast that. Nothing else decides the order, so the same test
gives the same result every time. With `slots: 1` the delays decide nothing:
the tasks run one after another, in the order you listed them.

This test scripts two tasks that reach the merge together:

```ts
// several-tasks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deterministicRouter, gateMaintenanceRoleConfig, load, readRef, triageRoleConfig, workerRoleConfig,
  type BudgetSet, type CloseReport, type CloserRef, type GateRef,
} from "delivery-service";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSupervisorAgainstMock, type ScriptedTask } from "delivery-service/testing";

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const roleConfigs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };
const budgets: BudgetSet = {
  correction: { used: 0, max: 1 },
  gateError: { used: 0, max: 1 },
  gateMaintenance: { used: 0, max: 1 },
  terminus: { used: 0, max: 1 },
  close: { used: 0, max: 1 },
};
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

// How long each task's agent waits before it answers. Swap the two numbers to swap which task is merged.
const HELLO_DELAY_MS = 0;
const GOODBYE_DELAY_MS = 2000;

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

/** A task whose agent waits `delayMs`, writes `<name>.txt` and reports completion. */
function task(name: string, delayMs: number): ScriptedTask {
  return {
    header: { surfaceId: name, taskDef: { intent: `add a ${name} file` }, gateRef, closerRef },
    script: {
      delayMs,
      expectations: [
        {
          effects: [{ write: { path: `${name}.txt`, content: `${name}\n` } }],
          json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: `wrote ${name}.txt` }),
        },
      ],
    },
  };
}

test("two tasks reach the merge together: the first to answer is merged, the other is refused because the base moved on", async () => {
  const repoPath = scratchRepo({ "report.tap": "1..1\nok 1 - greets\n" });
  const hello = task("hello", HELLO_DELAY_MS);
  const goodbye = task("goodbye", GOODBYE_DELAY_MS);

  const [helloRun, goodbyeRun] = await runSupervisorAgainstMock({
    repoPath,
    slots: 2,
    tasks: [hello, goodbye],
    budgets,
    roleConfigs,
    triage: () => deterministicRouter,
  });
  assert.ok(helloRun && goodbyeRun);

  // Each task has its own journal, checked as for one task.
  assertFullyConsumed(helloRun.journal, hello.script);
  assertFullyConsumed(goodbyeRun.journal, goodbye.script);
  const [goodbyePrompt, ...others] = promptsSent(goodbyeRun.journal);
  assert.equal(others.length, 0);
  assert.match(goodbyePrompt ?? "", /add a goodbye file/);

  const [merged, refused] = HELLO_DELAY_MS < GOODBYE_DELAY_MS ? [helloRun, goodbyeRun] : [goodbyeRun, helloRun];
  assert.equal(merged.result.state, "CLOSED");
  assert.equal(refused.result.state, "ESCALATED");

  const [firstClose] = (await load(refused.dir)).history.flatMap((entry) => (entry.t === "close" ? [entry] : []));
  assert.ok(firstClose);
  assert.equal(firstClose.status, "FAIL");
  const report = (await readRef(refused.dir, firstClose.detailRef)) as CloseReport;
  assert.match(report.detail, /main has moved on/);

  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoPath, env, encoding: "utf-8" });
  assert.equal(git("show", `main:${merged.surfaceId}.txt`), `${merged.surfaceId}\n`);
  assert.equal(git("show", `surface/${refused.surfaceId}:${refused.surfaceId}.txt`), `${refused.surfaceId}\n`);
});
```

Save it beside the others as `several-tasks.test.ts` and run it the same way:

```bash
npx tsx --test several-tasks.test.ts
```

It passes in a few seconds. The output ends like this:

```text
✔ two tasks reach the merge together: the first to answer is merged, the other is refused because the base moved on
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

What it shows:

- **The first task to answer is merged.** Its merge-back closer fast-forwards
  `main` onto its work.
- **The other is refused because the base moved on.** Its working copy was made
  from `main` as it was before the first merge, so `main` can no longer be
  fast-forwarded onto it. Its close ends `FAIL`, and the closer's report says
  `main has moved on`. That goes through triage like any close that fails: it
  is retried while the `close` budget allows, then the task ends `ESCALATED`,
  with its work kept on its own branch, `surface/<surfaceId>`, for a person to
  bring up to date.
- **Each task has its own `journal`.** `runSupervisorAgainstMock` returns one
  result per task, in the order you listed them, whichever finished first: the
  task's `surfaceId`, its case file's `dir` (read it with `load(dir)`), its
  `result`, and its own `journal`, which `promptsSent` and
  `assertFullyConsumed` read exactly as for one task.

Swap the two delays and run it again: `goodbye` is merged, and `hello` is the
one refused because the base moved on, every time you run it.

To test your own pipeline, replace `gateRef`, `closerRef`, `roleConfigs` and
`budgets` with yours, and script what each task's worker should do.

## When a reply ends as incomplete

An agent session that produces nothing usable ends with status `incomplete` and
a plain-English `rationale`, never an exception. For the worker, these are the
ways a script provokes it:

| You script | The attempt's `rationale` | How to tell it apart |
|---|---|---|
| a `when` whose `promptContains` or `promptMatches` no prompt satisfies | `worker session did not complete: the session ended in an error before it reported a result` | the journal has an `"unmatched"` event, and `assertFullyConsumed` shows the prompt |
| a `reply` with no `json` | `worker session did not complete: the session ended without reporting a result` | |
| `json` that is not a valid result for the role, such as a triage verdict for the worker | `worker session did not complete: the session replied with something that is not a valid result for this role` | `expectEnvelope` would have refused it as you wrote it, so write it into `json` directly |
| `fail: { message }` | `worker session did not complete: the session ended in an error before it reported a result` | no `"unmatched"` event; your message is not repeated in the rationale |

Another role reads the same, with its own name first: `triage session did not
complete: ...`.

What the surface does next: each incomplete attempt above uses one slot of the
`terminus` budget and the attempt is run again. (The one incomplete a script
cannot provoke is a session the runtime would not start at all; there is no
session to script. That one is not retried: it escalates after a single attempt,
because nothing about a second could differ.) When the budget is used up the
surface ends `ESCALATED`, and `result.outcome.reason` reads
`terminus budget exhausted (<used>/<max>): ` followed by the last rationale. To
see every attempt's rationale, read the terminus entries of `load(dir)`'s
`history`, where `t` is `"terminus"`.

Expectations left unused are not an incomplete attempt: nothing in the run
notices them. `assertFullyConsumed` is how you find out.

## What the scripted agent cannot prove

**The scripted agent cannot prove that a role is refused a tool it was not
given.** It does not model `allowedTools` at all. It makes no tool calls: the
files a script's `effects` write are written by the scripted agent itself, so the
harness's permission guard never sees them. A script can change a file your
role has no tool to touch, and the test still passes. A passing scripted test is
not evidence that your `allowedTools` are enforced.

That guarantee is tested where it is enforced instead:

- **`src/tool-authority.test.ts`** tests the guard itself: it allows the tools a
  role names, refuses any other, refuses a permitted tool aimed outside the
  worktree, and reports each refusal in a sentence naming the role and what it
  tried.
- **`src/agent-invoke.test.ts`** ("the session options the primitive builds")
  tests that every real session is started with that guard as the Agent SDK's
  permission decision point, with no setting that would route around it.
- **In a live session**, the real `claude` runtime consults the guard before
  every tool call, and a refusal comes back as `incomplete`, as
  [Configuring a role](configuring-a-role.md) describes.

To watch the guard's decisions on out-of-role and out-of-worktree calls:

```bash
npm run demo:agent-slice-2
```

## When the test itself is wrong

| What went wrong | What you see |
|---|---|
| The scripted agent is not installed | `runSurfaceAgainstMock` and `mockSessionEnvironment` throw `claude-mock was not found at <path>. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.` |
| A scripted envelope is malformed by mistake | `expectEnvelope` throws `The scripted envelope is not a valid worker result:`, then one line per problem, naming the field |
| An expectation was never used | `assertFullyConsumed` throws, as above |
| A `fakeAgentPort` is asked for a role it has no reply for | the call rejects with `fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler` |
| `slots` is not a whole number of 1 or more | `runSupervisorAgainstMock` throws `slots must be a whole number of 1 or more, but was 0.` before anything runs |
| Two tasks share a `surfaceId` | `runSupervisorAgainstMock` throws `Each scripted task needs its own surfaceId, but "hello" is used more than once: a task's branch and working copy are named after it.` before anything runs |

## Watch it run

Each of these runs with no network and no API key, and prints what it does:

```bash
npm run demo:mock-slice-1   # a stand-in built with fakeAgentPort, and the compile error for a wrong reply
npm run demo:mock-slice-3   # a whole pipeline against the scripted agent, then a typo in the script
npm run demo:mock-slice-4   # each way the agent can misbehave, and what the surface does
```
