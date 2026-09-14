# Agent Mock — Slice 5: Test Your Own Pipeline by Following One Guide

> **Status:** ✅ Complete — 2026-09-14 — `24d4aae`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 5 of `docs/superpowers/specs/2026-09-13-agent-mock-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-13-agent-mock-design.md`

**Goal:** Publish `docs/testing-your-pipeline.md`, one guide that takes an extender from nothing to passing scripted tests of their own gate, closer and role configurations, kept honest by a test that runs and type-checks the guide's own worked tests.

**Architecture:** Documentation only; no production code changes. The guide teaches the testing API that Slices 1 to 4 shipped (`fakeAgentPort`, `runSurfaceAgainstMock`, `promptsSent`, `assertFullyConsumed`, `expectEnvelope`). Its two worked tests are self-contained `node:test` files a reader saves at the repository root and runs with `npx tsx --test <file>`, matching the existing guides' "run the snippets with `npx tsx`" convention. `tests/testing-your-pipeline-guide.test.ts` follows the `tests/writing-a-closer-guide.test.ts` precedent: it extracts each snippet from the guide verbatim, stages it outside the checkout with its `./src/` imports pointed back at the checkout, runs it exactly as the guide says (with credentials stripped from the child), type-checks it with the repository's own `tsconfig.json`, and checks the guide's quoted messages against the code that produces them.

**Tech Stack:** Node ≥ 22 (`node:test`, `node:assert/strict`), TypeScript 6 strict (Node16 ESM, `noUncheckedIndexedAccess`), `tsx`, vitest (the guide test), git, the vendored `@jorj/claude-mock`.

## Global Constraints

- **Buy-vs-build:** reuse the testing API and the closer-guide test pattern; add nothing to `src/`. `src/testing.ts` and `src/index.ts` do not change. The guide's worked tests use Node's built-in test runner and `node:assert`, not a new dependency and not Vitest (a reader's project may use any runner; the guide says the same calls work inside Vitest or Jest). The guide creates its scratch git repository with plain `git`, because `initTempRepo` is not public API and the spec fixes the testing barrel's exports.
- **Operability / DX (Operational note):** the guide's snippets run the same way as the existing gate and closer guides (imports from `./src/index.js` and `./src/testing.js` at the repository root, run with `npx tsx`), and the guide is kept honest by `tests/testing-your-pipeline-guide.test.ts`, which runs under the normal `npm test` with no new step. The role-configuration guide's "Trying it offline" section stays the single-role quick start and gains a pointer to the new guide.
- **Snippet identity:** every snippet the test extracts is a fenced ```` ```ts ```` block whose first line is `// <file name>`: `// fake-agent.ts`, `// happy-path.test.ts`, `// misbehaviour.test.ts`. The guide's run commands are exactly `npx tsx --test happy-path.test.ts` and `npx tsx --test misbehaviour.test.ts`.
- **Verified before planning:** both worked tests, as written in this plan, were run with `npx tsx --test` (pass 1 / pass 2, fail 0), type-checked against the repository's `tsconfig.json`, and the complete guide test below was run green against the complete guide, then shown to fail when the happy path's expected state and a scripted envelope were mutated. The dry run was reverted; nothing of it is committed.
- **The guide's quoted strings are the contract, verbatim:** the incomplete rationales are `worker session did not complete: ` + `DID_NOT_COMPLETE.errored` / `.noEnvelope` / `.wrongShape` (`src/agent-invoke.ts`); the exhausted-budget reason starts `terminus budget exhausted (<used>/<max>): `; the consumption failure is exactly what `assertFullyConsumed` throws; `MockNotInstalled`'s message is `claude-mock was not found at <path>. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.`; `fakeAgentPort`'s is `fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler`.
- **Tool authority:** the guide states the scripted agent cannot prove tool-permission refusals, and points to `src/tool-authority.test.ts`, `src/agent-invoke.test.ts` ("the session options the primitive builds") and `npm run demo:agent-slice-2`. The test checks those files exist.
- **No network, no API key, no global setup:** the guide says so in "What you need"; the guide test runs each worked test with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` removed from the child's environment and every `GIT_*` variable removed (`cleanGitEnv`).
- **Copy rules:** plain British English; no em-dashes anywhere in `docs/testing-your-pipeline.md` (the test asserts it) or in the pointer sentences added to other docs; messages name the fix, not the mechanism.
- **Every tracked `.ts` file outside `vendor/` is inside `tsconfig.json`'s `include`** (`tests/typecheck-coverage.test.ts`): the new test lives under `tests/`. The guide's snippets are not tracked `.ts` files.
- **Commands:** run everything from the worktree root; never `cd` into another checkout. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first. Run only each task's own targeted tests; the full suite runs once in the final review.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Scaffolding Impact

- **Inherited (Operational note), guide kept honest by a test:** `tests/testing-your-pipeline-guide.test.ts` → Task 1 (happy path, decision table, journal assertions, pointers), extended in Task 2 (misbehaviour, incomplete cases, limits).
- **Inherited (Operational note), role guide points to the new guide:** `docs/configuring-a-role.md` "Trying it offline" → Task 1.
- **Proactive, test helper:** `tests/helpers.ts` `runTsx` gains an optional `env` so the guide test can run a snippet without credentials; existing callers unchanged → Task 1.
- **Proactive, discovery:** `README.md` lists the adopter guides → link added in Task 1.
- **Proactive, contributor docs:** `CONTRIBUTING.md`'s testing-API paragraphs → one sentence naming the adopter guide and its test, so a testing-API change updates both → Task 1.
- **Reactive, mechanism spec:** `docs/agent-interface.md` §Relationship to the mock describes the mock for harness readers; it gains one sentence pointing adopters to the guide → Task 1.
- **Proactive, reachability guard:** `tests/scripted-agent-reachability.test.ts` scans `docs/configuring-a-role.md` for naming `claude-mock` as the executable or skipping when it is absent; the new guide teaches the same seam, so it joins that scope → Task 1.
- **Unchanged, checked:** `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push` (the new test runs under `npm test`; no new step); `package.json` (no new script or dependency: the worked tests run with `npx tsx --test`, and the existing `demo:mock-slice-*` scripts are what "Watch it run" names); `src/testing.ts`, `src/index.ts`, `eslint.config.js`, `vendor/README.md` (no API, cast or vendored-format change); `docs/writing-a-gate.md`, `docs/writing-a-closer.md` (describe no testing behaviour); `tests/agent-mock/2-*.test.ts` (recorded UAT test with its own frozen scope list; not edited).

---

### Task 1: The guide's happy path, stand-in choice and journal assertions, kept honest by a test ✅ DONE (deliver-slice)

**Files:**
- Create: `docs/testing-your-pipeline.md`
- Create: `tests/testing-your-pipeline-guide.test.ts`
- Modify: `tests/helpers.ts` (`runTsx` optional `env`)
- Modify: `docs/configuring-a-role.md` (end of "Trying it offline")
- Modify: `README.md`, `CONTRIBUTING.md`, `docs/agent-interface.md`
- Modify: `tests/scripted-agent-reachability.test.ts` (`SCOPE`)

**Interfaces:**
- Consumes: `REPO_ROOT`, `sectionOf(stdout, from, to?)`, `runTsx(args)` (`tests/helpers.ts`); `cleanGitEnv()` (`src/git-env.ts`); `assertFullyConsumed(journal: JournalEvent[], script: MockScript): void`, `expectEnvelope`, `fakeAgentPort`, `JournalEvent`, `MockScript` (`src/testing.ts`); `workerRoleConfig` (`src/index.ts`); `MockNotInstalled` (`src/errors.ts`, not public: the test checks the guide quotes its message).
- Produces:
  - `runTsx(args: string[], env?: NodeJS.ProcessEnv): { stdout: string; status: number }`: `env` omitted means inherit, as before.
  - `docs/testing-your-pipeline.md` with these `##` headings in this order: `What you need`, `Choosing a stand-in`, `Worked example: the happy path`, `Asserting what the harness sent, and that the script was used`, `When the test itself is wrong`, `Watch it run`. Task 2 inserts three sections immediately before `## When the test itself is wrong`.
  - In `tests/testing-your-pipeline-guide.test.ts`: helpers `snippet(name)`, `stage(name)`, `runWorkedTest(name)`, the module-level `scratch` directory and `env`, used by Task 2.

- [ ] **Step 1: Let `runTsx` take an environment**

In `tests/helpers.ts`, replace:

```ts
export function runTsx(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    });
```

with:

```ts
export function runTsx(args: string[], env?: NodeJS.ProcessEnv): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env,
    });
```

- [ ] **Step 2: Write the failing guide test**

Create `tests/testing-your-pipeline-guide.test.ts`:

```ts
// Agent Mock design, capability 8: the testing API ships with a "testing your
// delivery pipeline" guide, followable without reading harness source. This runs
// the guide's own worked tests the way the guide tells a reader to, so they
// cannot drift from the API they teach.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, runTsx, sectionOf } from "./helpers.js";
import { cleanGitEnv } from "../src/git-env.js";
import { MockNotInstalled } from "../src/errors.js";
import { workerRoleConfig } from "../src/index.js";
import { assertFullyConsumed, expectEnvelope, fakeAgentPort, type JournalEvent, type MockScript } from "../src/testing.js";

const guide = readFileSync(join(REPO_ROOT, "docs/testing-your-pipeline.md"), "utf-8");

/** Credentials the guide promises its examples never need: stripped from the child, not trusted to be absent. */
const CREDENTIALS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];
const env = Object.fromEntries(Object.entries(cleanGitEnv()).filter(([name]) => !CREDENTIALS.includes(name)));

/** The guide's ```ts block that starts with `// <name>`, exactly as a reader would copy it. */
function snippet(name: string): string {
  const start = guide.indexOf("```ts\n// " + name + "\n");
  if (start === -1) throw new Error(`the guide has no \`\`\`ts block starting with // ${name}`);
  const body = start + "```ts\n".length;
  return guide.slice(body, guide.indexOf("```", body));
}

// A reader saves each snippet at the repository root, so it imports "./src/...".
// Staged outside the checkout instead, those imports point back at it. The package.json
// makes the scratch files ES modules, as the repository's own package.json does for a
// reader's; the tsconfig type-checks them with the repository's own compiler options.
const scratch = mkdtempSync(join(tmpdir(), "pipeline-guide-"));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(scratch, "tsconfig.json"),
  JSON.stringify({
    extends: join(REPO_ROOT, "tsconfig.json"),
    include: ["*.ts"],
    compilerOptions: { typeRoots: [join(REPO_ROOT, "node_modules", "@types")] },
  }),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function stage(name: string): string {
  const source = snippet(name);
  if (!source.includes('from "./src/')) throw new Error(`${name} does not import the harness from "./src/"`);
  const path = join(scratch, name);
  writeFileSync(path, source.replaceAll('from "./src/', `from "${REPO_ROOT}/src/`));
  return path;
}

/** Run a staged worked test as the guide says to, with no credentials in reach. */
function runWorkedTest(name: string): string {
  expect(guide).toContain(`npx tsx --test ${name}`);
  const { stdout, status } = runTsx(["--test", stage(name)], env);
  expect(stdout).toContain("ℹ fail 0");
  expect(status).toBe(0);
  return stdout;
}

describe("the 'testing your delivery pipeline' guide", () => {
  it("says when to use each stand-in, and how to assert what was sent and that the script was used", () => {
    const choosing = sectionOf(guide, "## Choosing a stand-in", "## Worked example: the happy path");
    for (const row of ["| What it runs |", "| Cost |", "| Proves your role configuration |", "| Right for |"]) {
      expect(choosing).toContain(row);
    }
    expect(choosing).toContain("`fakeAgentPort`");
    expect(choosing).toContain("`runSurfaceAgainstMock`");
    expect(guide).toContain("promptsSent(journal)");
    expect(guide).toContain("assertFullyConsumed(journal, script)");
    for (const event of ["matched", "unmatched", "effect_failed", "finished"]) expect(guide).toContain(`"${event}"`);
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });

  it("says its examples need no network, no API key and no global setup", () => {
    const needs = sectionOf(guide, "## What you need", "## Choosing a stand-in");
    expect(needs).toContain("npm install");
    expect(needs).toMatch(/no global setup/);
    expect(needs).toMatch(/no\s+network/);
    expect(needs).toMatch(/no API key/);
  });

  it("runs its worked happy-path test as written, and it passes", () => {
    const stdout = runWorkedTest("happy-path.test.ts");
    expect(stdout).toContain("✔ a scripted worker's change is judged by the real gate and landed by the real closer");
    expect(stdout).toContain("ℹ pass 1");
    expect(guide).toContain("ℹ pass 1");
  }, 60_000);

  it("quotes the consumption check's failure exactly as assertFullyConsumed words it", () => {
    const script: MockScript = { expectations: [{ when: { promptContains: "add a greting file" } }] };
    const journal: JournalEvent[] = [{ session_id: "s1", event: "unmatched", prompt: "## Task" }];
    let message = "";
    try {
      assertFullyConsumed(journal, script);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    for (const line of message.split("\n")) expect(guide).toContain(line);
  });

  it("quotes each authoring mistake's message exactly as the testing API words it", async () => {
    const wrong = sectionOf(guide, "## When the test itself is wrong", "## Watch it run");
    expect(wrong).toContain(new MockNotInstalled("<path>").message);

    const missingRole = await fakeAgentPort({})
      .invoke({ role: "triage" }, { worktreePath: "/w", dir: "/d", sessionKey: "k" })
      .then(() => "", (err: unknown) => (err as Error).message);
    expect(missingRole).toMatch(/triage/);
    expect(wrong).toContain(missingRole);

    let malformed = "";
    try {
      expectEnvelope(workerRoleConfig, { status: "completed", rationale: "" });
    } catch (err) {
      malformed = (err as Error).message;
    }
    const [heading = ""] = malformed.split("\n");
    expect(heading).toMatch(/worker/);
    expect(wrong).toContain(heading);
  });

  it("type-checks every snippet it tells a reader to save", () => {
    for (const name of ["fake-agent.ts", "happy-path.test.ts"]) stage(name);
    let errors = "";
    try {
      execFileSync("npx", ["tsc", "-p", join(scratch, "tsconfig.json")], { cwd: REPO_ROOT, encoding: "utf-8", stdio: "pipe" });
    } catch (err) {
      errors = (err as { stdout?: string }).stdout || String(err);
    }
    expect(errors).toBe("");
  }, 60_000);

  it("is where the role guide's offline quick start points", () => {
    const roleGuide = readFileSync(join(REPO_ROOT, "docs/configuring-a-role.md"), "utf-8");
    expect(sectionOf(roleGuide, "## Trying it offline", "## Triage")).toContain(
      "[Testing your delivery pipeline](testing-your-pipeline.md)",
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: FAIL: the file cannot load, `ENOENT: no such file or directory, open '.../docs/testing-your-pipeline.md'`.

- [ ] **Step 4: Write the guide**

Create `docs/testing-your-pipeline.md` with exactly this content:

````markdown
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
````

- [ ] **Step 5: Point the role guide's offline section at it**

In `docs/configuring-a-role.md`, replace:

```markdown
The mock does not model tool permissions, so it cannot show a refusal happening
inside a live session. The demos show the refusal by driving the harness's own
decision directly; the live guarantee comes from the real `claude` runtime.
```

with:

```markdown
The mock does not model tool permissions, so it cannot show a refusal happening
inside a live session. The demos show the refusal by driving the harness's own
decision directly; the live guarantee comes from the real `claude` runtime.

This section is the single-role quick start. To test your gate, closer and role
configurations together through a whole surface against the scripted agent, follow
[Testing your delivery pipeline](testing-your-pipeline.md).
```

(This paragraph closes "Trying it offline", directly before `## Triage`. The different paragraph at the very end of the file, "The mock does not enforce `allowedTools`...", is not touched.)

- [ ] **Step 6: Run the guide test to verify it passes**

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts`
Expected: PASS, 7 tests in the guide test (the second file still passes: it reads `docs/configuring-a-role.md`, which only gained a paragraph).

Then run: `npx eslint tests/testing-your-pipeline-guide.test.ts tests/helpers.ts`
Expected: no output.

If the happy-path run fails, read the `stdout` in the assertion diff: it holds the worked test's own `node:test` failure, usually `assertFullyConsumed`'s message naming the prompt sent.

- [ ] **Step 7: Commit the guide**

```bash
git add docs/testing-your-pipeline.md tests/testing-your-pipeline-guide.test.ts tests/helpers.ts docs/configuring-a-role.md
git commit -m "Add the testing-your-pipeline guide with a worked happy-path test

An extender with a gate, a closer and role configurations had no documented
way to test them together without reading src/. The guide explains which
stand-in to use, walks a whole-surface happy path against the scripted
agent, and shows how to assert what was sent and that the script was used.
A test runs and type-checks the guide's own snippets, as the closer guide's
test does, so the guide cannot drift from the API. The role guide's offline
section stays the single-role quick start and now points here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Update the scaffolding that should name the guide**

In `README.md`, replace:

```markdown
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
```

with:

```markdown
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
- [Testing your delivery pipeline](docs/testing-your-pipeline.md): test your gate, closer and role configurations together against a scripted agent
```

In `CONTRIBUTING.md`, replace:

```markdown
malformed reply on purpose, put it in the expectation's `json` directly.
```

with:

```markdown
malformed reply on purpose, put it in the expectation's `json` directly.
`docs/testing-your-pipeline.md` teaches the same API to adopters, and
`tests/testing-your-pipeline-guide.test.ts` runs its worked tests: change the guide with the
testing API.
```

In `docs/agent-interface.md`, replace:

```markdown
copy by absolute path and hands it the script and journal locations, so nothing depends on
`PATH` and no mock-backed suite skips.
```

with:

```markdown
copy by absolute path and hands it the script and journal locations, so nothing depends on
`PATH` and no mock-backed suite skips. [Testing your delivery pipeline](testing-your-pipeline.md)
is the adopter's guide to testing a pipeline with it.
```

In `tests/scripted-agent-reachability.test.ts`, replace:

```ts
  "docs/configuring-a-role.md",
  ":(exclude)tests/scripted-agent-reachability.test.ts",
```

with:

```ts
  "docs/configuring-a-role.md",
  "docs/testing-your-pipeline.md",
  ":(exclude)tests/scripted-agent-reachability.test.ts",
```

and change the comment above `SCOPE` from `// Tests, demos and the role guide reach claude-mock only through mockSessionEnvironment,` to `// Tests, demos and the agent guides reach claude-mock only through mockSessionEnvironment,`.

- [ ] **Step 9: Run the reachability guard**

Run: `npx vitest run tests/scripted-agent-reachability.test.ts`
Expected: PASS, 2 tests. (`gitGrepFiles` searches tracked files; the guide was committed in Step 7.)

- [ ] **Step 10: Commit the scaffolding**

```bash
git add README.md CONTRIBUTING.md docs/agent-interface.md tests/scripted-agent-reachability.test.ts
git commit -m "Point the README, contributor guide and mock spec at the pipeline guide

A guide nobody can find does not stop extenders reverse-engineering the
testing story from source. Contributors are told the guide's worked tests
run in CI, so a testing-API change updates the guide too, and the guide
joins the scan that keeps docs from naming claude-mock as a bare command.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The misbehaviour example, the incomplete cases and what the scripted agent cannot prove ✅ DONE (deliver-slice)

**Files:**
- Modify: `docs/testing-your-pipeline.md` (three sections inserted before `## When the test itself is wrong`)
- Modify: `tests/testing-your-pipeline-guide.test.ts`

**Interfaces:**
- Consumes (Task 1, in `tests/testing-your-pipeline-guide.test.ts`): `snippet(name: string): string`, `stage(name: string): string`, `runWorkedTest(name: string): string`, `guide`, `scratch`; `sectionOf` (`tests/helpers.ts`); `DID_NOT_COMPLETE` (`src/index.ts`: `{ errored, noEnvelope, wrongShape, notRun }`).
- Produces: the guide's `##` headings, in order: `What you need`, `Choosing a stand-in`, `Worked example: the happy path`, `Asserting what the harness sent, and that the script was used`, `Worked example: when the agent misbehaves`, `When a reply ends as incomplete`, `What the scripted agent cannot prove`, `When the test itself is wrong`, `Watch it run`.

- [ ] **Step 1: Write the failing tests**

In `tests/testing-your-pipeline-guide.test.ts`:

Replace the first import line:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

with:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
```

Replace:

```ts
import { workerRoleConfig } from "../src/index.js";
```

with:

```ts
import { DID_NOT_COMPLETE, workerRoleConfig } from "../src/index.js";
```

Replace:

```ts
    for (const name of ["fake-agent.ts", "happy-path.test.ts"]) stage(name);
```

with:

```ts
    for (const name of ["fake-agent.ts", "happy-path.test.ts", "misbehaviour.test.ts"]) stage(name);
```

Insert these tests immediately before `  it("is where the role guide's offline quick start points", () => {`:

```ts
  it("runs its worked misbehaviour test as written, and both cases pass", () => {
    const stdout = runWorkedTest("misbehaviour.test.ts");
    expect(stdout).toContain("✔ a worker that escalates for authority stops the surface at once");
    expect(stdout).toContain("✔ a change the gate rejects goes back to the worker, and only the passing attempt lands");
    expect(stdout).toContain("ℹ pass 2");
    expect(guide).toContain("ℹ pass 2");
  }, 60_000);

  it("lists each way a reply ends as incomplete, with the rationale the harness records", () => {
    const incomplete = sectionOf(guide, "## When a reply ends as incomplete", "## What the scripted agent cannot prove");
    for (const reason of [DID_NOT_COMPLETE.errored, DID_NOT_COMPLETE.noEnvelope, DID_NOT_COMPLETE.wrongShape]) {
      expect(incomplete).toContain(`worker session did not complete: ${reason}`);
    }
    for (const scripted of ["`promptContains`", "`reply`", "`json`", "`fail: { message }`"]) expect(incomplete).toContain(scripted);
    expect(incomplete).toContain('"unmatched"');
    expect(incomplete).toContain("terminus budget exhausted (<used>/<max>): ");
  });

  it("says plainly that the scripted agent cannot prove tool-permission refusals, and where they are tested", () => {
    const limits = sectionOf(guide, "## What the scripted agent cannot prove", "## When the test itself is wrong");
    expect(limits).toMatch(/The scripted agent cannot prove that a role is refused a tool it was not\s+given\./);
    expect(limits).toContain("`allowedTools`");
    for (const file of ["src/tool-authority.test.ts", "src/agent-invoke.test.ts"]) {
      expect(limits).toContain(`\`${file}\``);
      expect(existsSync(join(REPO_ROOT, file))).toBe(true);
    }
    expect(limits).toContain("npm run demo:agent-slice-2");
  });

```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: FAIL, 4 tests: "type-checks every snippet" and "runs its worked misbehaviour test" with `the guide has no ```ts block starting with // misbehaviour.test.ts`; "lists each way a reply ends as incomplete" and "says plainly that the scripted agent cannot prove" on missing text. The other 6 pass.

- [ ] **Step 3: Add the three sections to the guide**

In `docs/testing-your-pipeline.md`, insert the following immediately before the line `## When the test itself is wrong` (so it follows the "Asserting what the harness sent" section, separated by one blank line on each side):

````markdown
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
} from "./src/index.js";
import { assertFullyConsumed, expectEnvelope, promptsSent, runSurfaceAgainstMock, type MockScript } from "./src/testing.js";

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

What the surface does next: each incomplete attempt uses one slot of the
`terminus` budget and the attempt is run again. When the budget is used up the
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

````

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/testing-your-pipeline-guide.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Lint the test file**

Run: `npx eslint tests/testing-your-pipeline-guide.test.ts tests/helpers.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add docs/testing-your-pipeline.md tests/testing-your-pipeline-guide.test.ts
git commit -m "Teach misbehaviour tests, incomplete replies and the mock's limits

Trust in a pipeline comes from seeing it refuse bad work, so the guide now
walks a worker escalating for authority and a change the gate rejects being
retried, lists each scripted reply that ends as incomplete with the exact
rationale the harness records, and says plainly that the scripted agent
cannot prove tool-permission refusals, naming where that guarantee is
tested. The guide test runs the new example and checks the quoted
rationales against DID_NOT_COMPLETE.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
