# Agent Mock — Slice 4: Prove the Pipeline Copes When the Agent Misbehaves

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 4 of `docs/superpowers/specs/2026-09-13-agent-mock-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-13-agent-mock-design.md`

**Goal:** Prove, through `runSurfaceAgainstMock` and the real `invoke()`, that an unmatched prompt, a reply with no envelope, a wrong-shaped envelope and a scripted failure each end the worker's session as incomplete; that an authority escalation escalates the surface at once; and that a change the real gate rejects is routed back for another attempt. Add `expectEnvelope`, which rejects a malformed scripted envelope where the script is written, and a misbehaving-agent demo.

**Architecture:** No production behaviour changes. The existing terminus mapping (`DID_NOT_COMPLETE` in `src/agent-invoke.ts`), the driver's terminus-budget retry (`incompleteTerminus` in `src/surface.ts`), its authority edge (`deriveStateFromEntry` in `src/case-file.ts`) and the deterministic router's `gate_fail` reroute (`src/router.ts`) already give every outcome this slice asks for; this was confirmed by running each scenario through `runSurfaceAgainstMock` before planning. The slice adds one small authoring helper (`expectEnvelope`, in `src/mock-script.ts`, published through `src/testing.ts`), surface-grain tests in `src/scripted-surface-run.test.ts` whose ability to fail is shown by named mutation checks, and a demo.

**Tech Stack:** Node ≥ 22, TypeScript 6 (strict, Node16 ESM, `noUncheckedIndexedAccess`), zod 4, vitest, ESLint flat config (`typescript-eslint` strict), `tsx` for demos, git, the vendored `@jorj/claude-mock`.

## Global Constraints

- **Buy-vs-build (Build note):** no new failure mapping is added. `src/agent-invoke.ts`, `src/surface.ts`, `src/case-file.ts`, `src/router.ts` and the vendored `claude-mock` are not modified (mutation checks edit them temporarily and revert; nothing of that is committed). The bad replies are exercised through the real invocation path, `runSurfaceAgainstMock` → `createAgentPort` → `invoke()`, never through `fakeAgentPort`.
- **Tool-authority refusal is not modelled in the scripted agent.** "Escalates for authority" in this slice means the worker's own scripted envelope `{ status: "escalate", category: "authority", ... }`, not a refused tool call.
- **The existing plain-English reasons are the contract, verbatim.** A worker's incomplete terminus rationale is `worker session did not complete: <reason>`, where `<reason>` is one of `DID_NOT_COMPLETE` (`src/agent-invoke.ts`). Observed mapping, confirmed empirically:
  - prompt matches no expectation → `DID_NOT_COMPLETE.errored` ("the session ended in an error before it reported a result"); the journal has an `unmatched` event for each such prompt
  - `reply` with no `json` → `DID_NOT_COMPLETE.noEnvelope` ("the session ended without reporting a result")
  - `json` failing the role's `envelopeSchema` → `DID_NOT_COMPLETE.wrongShape` ("the session replied with something that is not a valid result for this role"); this is the "replied in the wrong shape" sentence the AC names, and its wording does not change
  - `fail.message` → `DID_NOT_COMPLETE.errored`; the scripted message never reaches the rationale
- **An unmatched prompt and a scripted failure share a reason.** Tests and the demo tell them apart by the journal's `unmatched` events, never by inventing a new reason.
- **`expectEnvelope` signature:** `expectEnvelope<E>(roleCfg: RoleConfig<E>, envelope: NoInfer<E>): E`. `E` is inferred from the role config only, so the envelope literal is type-checked against that role's reply (a worker given a triage verdict does not compile), and the role's own `envelopeSchema` checks it at runtime (catching what the compiler cannot, such as an empty `rationale`). It returns the envelope object it was given, unchanged (not zod's parsed copy, which would strip unknown keys), so a script built with it is byte-identical to one written by hand. It throws a plain `Error` (the testing API's precedent: `fakeAgentPort`, `assertFullyConsumed`). `writeMockScript` does **not** call it: a deliberately malformed envelope is written straight into `json`.
- **`expectEnvelope` failure message**, exactly:
  ```
  The scripted envelope is not a valid <role> result:
    <field path joined with ".", or "(root)">: <zod issue message>     (one line per issue)
  Fix the envelope. To script a malformed reply on purpose, write it into the expectation's json directly, without expectEnvelope.
  ```
  Tests assert the first and last lines exactly and the issue line by field prefix only, so a zod wording change does not break them.
- **Public surface:** after this slice `src/testing.ts` exports exactly these values: `assertFullyConsumed`, `expectEnvelope`, `fakeAgentPort`, `mockSessionEnvironment`, `promptsSent`, `readJournal`, `runSurfaceAgainstMock`, `writeMockScript`; types unchanged from Slice 3. `src/index.ts` does not change.
- **Proving existing behaviour honestly:** Task 2's tests pass the moment they are written, because the behaviour already exists (that is the slice). Each such test is instead shown able to fail by a named, temporary mutation of the production line it depends on, run and reverted before commit.
- **No network, no API key:** every run reaches the agent only through `runSurfaceAgainstMock` (which uses `mockSessionEnvironment`), in scratch repositories with no remote.
- **Messages name the fix, not the mechanism** (house rule, `docs/configuring-a-role.md`). No em-dashes in outward-facing copy: error messages, demo output, `CONTRIBUTING.md`.
- **Imports:** tests and demos take the testing API from the public entry point (`./testing.js`, `../src/testing.js`).
- **Every tracked `.ts` file outside `vendor/` is inside `tsconfig.json`'s `include`** (`tests/typecheck-coverage.test.ts`); the new demo goes under `demos/`.
- **Commands:** run everything from the worktree root. Never `cd` into another checkout. Run only each task's own targeted tests; the full suite runs once in the final review. If `node_modules` is missing, run `npm ci --no-audit --no-fund` first.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Scaffolding Impact

- **Proactive, public testing API contract:** `src/testing.test.ts` pins the barrel's export list → `expectEnvelope` added in Task 1.
- **Proactive, contributor docs:** `CONTRIBUTING.md`'s `runSurfaceAgainstMock` paragraph tells contributors how to script a run but not how to author an envelope safely or script a malformed one → one sentence added in Task 1.
- **Reactive, mock correspondence doc:** `docs/agent-interface.md` §Relationship to the mock says "an unmatched or malformed reply exercises the `INCOMPLETE_TERMINUS` path". It omits the no-envelope and scripted-failure cases, names no proof, and does not say an unmatched prompt reads as an errored session (distinguishable only by the journal), which this slice establishes → bullet rewritten in Task 2.
- **Proactive, run story:** new `npm run demo:mock-slice-4` script in `package.json` → Task 3.
- **Unchanged, checked:** `.github/workflows/ci.yml`, `Makefile`, `.githooks/pre-push` (new tests run under `npm test`; no new step); `README.md` (lists no mock demos); `src/index.ts`; `eslint.config.js` (no new cast); `vendor/README.md` (`expectEnvelope` mirrors no vendored format); `docs/configuring-a-role.md` (its `incomplete` row already says "it crashed, it ended without a reply, it replied in the wrong shape", still true; its offline-section pointer is Slice 5's); `docs/single-surface-control-flow.md` (the INCOMPLETE_TERMINUS edge is unchanged). The adopter guide `docs/testing-your-pipeline.md` is Slice 5's.

---

### Task 1: `expectEnvelope`, authoring-time envelope validation

**Files:**
- Modify: `src/mock-script.ts` (add a type import and `expectEnvelope`)
- Modify: `src/mock-script.test.ts` (imports; new `describe("expectEnvelope")`)
- Modify: `src/testing.ts` (re-export)
- Modify: `src/testing.test.ts` (export list)
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `RoleConfig<E>` (`src/role-config.ts`, `envelopeSchema: z.ZodType<E>`, `role: AgentRole`); `workerRoleConfig` (`src/role-config.ts`); `triageRoleConfig` (`src/triage-role-config.ts`); `writeMockScript`, `MockScript` (Slice 3, `src/mock-script.ts`).
- Produces (exported from `src/mock-script.ts`, re-exported from `src/testing.ts`):
  - `expectEnvelope<E>(roleCfg: RoleConfig<E>, envelope: NoInfer<E>): E`

- [ ] **Step 1: Write the failing tests**

In `src/testing.test.ts`, replace the expected export list with:

```ts
    expect(Object.keys(testing).sort()).toEqual([
      "assertFullyConsumed",
      "expectEnvelope",
      "fakeAgentPort",
      "mockSessionEnvironment",
      "promptsSent",
      "readJournal",
      "runSurfaceAgainstMock",
      "writeMockScript",
    ]);
```

In `src/mock-script.test.ts`, change the import

```ts
import { assertFullyConsumed, promptsSent, readJournal, writeMockScript } from "./testing.js";
```

to

```ts
import { assertFullyConsumed, expectEnvelope, promptsSent, readJournal, writeMockScript } from "./testing.js";
import { workerRoleConfig } from "./role-config.js";
import { triageRoleConfig } from "./triage-role-config.js";
```

and append at the end of the file:

```ts
describe("expectEnvelope", () => {
  const FIX = "Fix the envelope. To script a malformed reply on purpose, write it into the expectation's json directly, without expectEnvelope.";

  function messageOf(write: () => unknown): string {
    try {
      write();
    } catch (err) {
      return (err as Error).message;
    }
    return "(did not throw)";
  }

  it("hands back a valid envelope unchanged, ready to be an expectation's json", () => {
    const envelope = { status: "completed" as const, rationale: "wrote greeting.txt" };

    expect(expectEnvelope(workerRoleConfig, envelope)).toBe(envelope);
  });

  it("checks the envelope against the role it is scripted for, at compile time and when the script is written", () => {
    const verdict = { status: "abort" as const, rationale: "the task is already done upstream", payload: { reason: "nothing left to change" } };

    expect(expectEnvelope(triageRoleConfig, verdict)).toBe(verdict);
    // @ts-expect-error a triage verdict is not a worker result, so the compiler refuses it
    expect(messageOf(() => expectEnvelope(workerRoleConfig, verdict)).split("\n")[0]).toBe("The scripted envelope is not a valid worker result:");
  });

  it("rejects, where the script is written, an envelope the compiler accepts but the role does not, naming each field and the fix", () => {
    const lines = messageOf(() => expectEnvelope(workerRoleConfig, { status: "completed", rationale: "" })).split("\n");

    expect(lines).toEqual([
      "The scripted envelope is not a valid worker result:",
      expect.stringMatching(/^ {2}rationale: \S/),
      FIX,
    ]);
  });

  it("does not stand between a deliberately malformed envelope and a script written directly", async () => {
    const scriptPath = join(await scratch(), "mock.json");
    const malformed: MockScript = { expectations: [{ json: { status: "completed", rationale: "" } }] };

    await writeMockScript(scriptPath, malformed);

    expect(JSON.parse(await readFile(scriptPath, "utf-8"))).toEqual(malformed);
  });
});
```

(The last test passes before the implementation too: it guards the design choice that `writeMockScript` never validates envelopes, so a later change that wires `expectEnvelope` into it fails here.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mock-script.test.ts src/testing.test.ts`
Expected: FAIL. The first three `expectEnvelope` tests fail with `expectEnvelope is not a function`; the export-list test fails on the missing `"expectEnvelope"`. The fourth `expectEnvelope` test and every Slice 3 test PASS.

- [ ] **Step 3: Write the implementation**

In `src/mock-script.ts`, below `import { readFile, writeFile } from "node:fs/promises";` add:

```ts
import type { RoleConfig } from "./role-config.js";
```

Append to `src/mock-script.ts`:

```ts
/**
 * An envelope for a scripted expectation's `json`, checked where the script is
 * written: against the role's reply type by the compiler, and against the
 * role's own `envelopeSchema` at runtime, which also catches what the compiler
 * cannot (an empty rationale, say). Without it, a slip in a scripted envelope
 * surfaces only as an unintended incomplete attempt, far from its cause.
 *
 * Returns the envelope it was given, unchanged, so the script is exactly what
 * the author wrote. To script a malformed reply on purpose, put it in `json`
 * directly: `writeMockScript` never validates envelopes.
 */
export function expectEnvelope<E>(roleCfg: RoleConfig<E>, envelope: NoInfer<E>): E {
  const parsed = roleCfg.envelopeSchema.safeParse(envelope);
  if (parsed.success) return envelope;
  throw new Error(
    [
      `The scripted envelope is not a valid ${roleCfg.role} result:`,
      ...parsed.error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`),
      "Fix the envelope. To script a malformed reply on purpose, write it into the expectation's json directly, without expectEnvelope.",
    ].join("\n"),
  );
}
```

In `src/testing.ts`, change

```ts
export { assertFullyConsumed, promptsSent, readJournal, writeMockScript } from "./mock-script.js";
```

to

```ts
export { assertFullyConsumed, expectEnvelope, promptsSent, readJournal, writeMockScript } from "./mock-script.js";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/mock-script.test.ts src/testing.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit && npx eslint src/mock-script.ts src/mock-script.test.ts src/testing.ts src/testing.test.ts`
Expected: no output. (tsc is what proves the `@ts-expect-error` line: if `expectEnvelope` accepted a triage verdict for a worker, tsc reports an unused `@ts-expect-error` directive.)

Mutation check (do not commit): in `src/mock-script.ts` temporarily change `envelope: NoInfer<E>` to `envelope: unknown` and the return `return envelope;` to `return envelope as E;`, then run `npx tsc --noEmit`. Expected: `Unused '@ts-expect-error' directive` in `src/mock-script.test.ts`. Restore both and rerun: no output.

- [ ] **Step 5: Tell contributors how to author envelopes**

In `CONTRIBUTING.md`, at the end of the paragraph that ends "so give each expectation a `when` clause once a run makes more than one call.", append these sentences to the same paragraph:

```markdown
Build each scripted envelope with `expectEnvelope(roleConfig, envelope)`, so a malformed one
fails where it is written rather than as an unexplained incomplete attempt; to script a
malformed reply on purpose, put it in the expectation's `json` directly.
```

- [ ] **Step 6: Commit**

```bash
git add src/mock-script.ts src/mock-script.test.ts src/testing.ts src/testing.test.ts CONTRIBUTING.md
git commit -m "Add expectEnvelope to check scripted envelopes where they are written

A slip in a scripted envelope used to surface only as an incomplete
attempt deep inside a run, indistinguishable from a deliberate bad reply.
expectEnvelope checks it against the role's reply type at compile time
and the role's own schema at runtime, while a deliberately malformed
envelope can still be written straight into the script.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Prove each misbehaviour through a whole scripted surface

**Files:**
- Modify: `src/scripted-surface-run.test.ts` (imports; two helpers; replace one Slice 3 test; new `describe`)
- Modify: `docs/agent-interface.md` (§Relationship to the mock, "Terminus mapping" bullet)

**Interfaces:**
- Consumes: `runSurfaceAgainstMock`, `ScriptedSurfaceRun`, `assertFullyConsumed`, `promptsSent`, `MockScript`, `MockExpectation` (`src/testing.ts`); `DID_NOT_COMPLETE` (`src/agent-invoke.ts`); `load` (`src/case-file.ts`); `deterministicRouter` (`src/router.ts`); `TriageInput` (`src/ports.ts`). The file's existing `scratchRun(script, triage?)` helper (returns `{ result, journal, dir, repoPath }`), `git`, `budgets` (`correction` max 1, `terminus` max 2), `PASSING_TAP`, `FAILING_TAP`, `INTENT`.
- Produces: nothing new for later tasks; no production code changes.

Note: these tests pass as soon as they are written, because the behaviour exists and the Build note forbids adding any. Step 3's mutation checks are what show each test can fail; do not skip them.

- [ ] **Step 1: Tidy: fold the Slice 3 gate-rejection test into a shared recording triage**

In `src/scripted-surface-run.test.ts`, change the imports

```ts
import { assertFullyConsumed, promptsSent, runSurfaceAgainstMock } from "./testing.js";
import type { MockScript, ScriptedSurfaceRun } from "./testing.js";
```

to

```ts
import { DID_NOT_COMPLETE } from "./agent-invoke.js";
import { assertFullyConsumed, promptsSent, runSurfaceAgainstMock } from "./testing.js";
import type { MockExpectation, MockScript, ScriptedSurfaceRun } from "./testing.js";
```

Add these two helpers directly after the `scratchRun` function:

```ts
/** A triage that records each setback it is handed, then decides as the deterministic router does. */
function recordingRouter(triggers: TriageInput["trigger"][]): ScriptedSurfaceRun["triage"] {
  return () => ({
    triage: (input) => {
      triggers.push(input.trigger);
      return deterministicRouter.triage(input);
    },
  });
}

/** Each agent session's terminus, in order, as the case file recorded it. */
async function terminiOf(dir: string): Promise<string[]> {
  const { history } = await load(dir);
  return history.flatMap((e) => (e.t === "terminus" ? [`${e.status}: ${e.rationale}`] : []));
}
```

Delete the whole Slice 3 test `it("does not land a change the real gate rejects, and hands the setback to the caller's triage", async () => { ... });`. Its claims (the gate's rejection is not landed, and the caller's triage is handed a `gate_fail`) are asserted by the retry test in Step 2, which also proves the retry the slice asks for. `FAILING_TAP` stays: Step 2 uses it.

- [ ] **Step 2: Write the misbehaviour tests**

Append to `src/scripted-surface-run.test.ts`:

```ts
describe("runSurfaceAgainstMock when the agent misbehaves", () => {
  const badReplies: Array<{ name: string; expectation: MockExpectation; reason: string; unmatchedPrompts: number }> = [
    {
      name: "a prompt no expectation matches",
      expectation: { when: { promptContains: "a phrase the harness never sends" }, json: { status: "completed", rationale: "never reached" } },
      reason: DID_NOT_COMPLETE.errored,
      unmatchedPrompts: 2,
    },
    {
      name: "a reply with no envelope",
      expectation: { reply: "I looked around but never reported back." },
      reason: DID_NOT_COMPLETE.noEnvelope,
      unmatchedPrompts: 0,
    },
    {
      name: "an envelope in a triage verdict's shape",
      expectation: { json: { status: "reroute", rationale: "someone else should take this" } },
      reason: DID_NOT_COMPLETE.wrongShape,
      unmatchedPrompts: 0,
    },
    {
      name: "a scripted failure",
      expectation: { fail: { message: "the session crashed part way through" } },
      reason: DID_NOT_COMPLETE.errored,
      unmatchedPrompts: 0,
    },
  ];

  it.each(badReplies)(
    "ends the worker's session as incomplete with the plain-English reason for $name, retries it within the terminus budget, then escalates",
    async ({ expectation, reason, unmatchedPrompts }) => {
      const { result, journal, dir } = await scratchRun({ expectations: [expectation] });

      const rationale = `worker session did not complete: ${reason}`;
      expect(await terminiOf(dir)).toEqual([`incomplete: ${rationale}`, `incomplete: ${rationale}`]);
      const { history } = await load(dir);
      expect(history.some((e) => e.t === "gate")).toBe(false);
      expect(result.state).toBe("ESCALATED");
      expect(result.outcome?.reason).toBe(`terminus budget exhausted (2/2): ${rationale}`);
      // An unmatched prompt and a scripted failure share a reason; only the journal tells them apart.
      expect(journal.filter((e) => e.event === "unmatched")).toHaveLength(unmatchedPrompts);
    },
  );

  it("escalates at once when the worker escalates for authority, with no retry and no triage", async () => {
    const triggers: TriageInput["trigger"][] = [];
    const reason = "deploying needs a production credential this worker was not given";

    const { result, journal, dir } = await scratchRun(
      { expectations: [{ json: { status: "escalate", category: "authority", rationale: reason } }] },
      recordingRouter(triggers),
    );

    expect(result.state).toBe("ESCALATED");
    expect(result.outcome?.source).toBe("worker");
    expect(result.outcome?.reason).toBe(reason);
    expect(await terminiOf(dir)).toEqual([`escalate: ${reason}`]);
    expect(promptsSent(journal)).toHaveLength(1);
    expect(triggers).toEqual([]);
  });

  it("routes a change the real gate rejects back to the worker for another attempt, and lands only the attempt that passes", async () => {
    const triggers: TriageInput["trigger"][] = [];
    const script: MockScript = {
      expectations: [
        // Each session re-reads the script and takes the first expectation that matches,
        // so the retry's expectation, keyed on the failure the gate reported, comes first.
        {
          when: { promptContains: "2 - beta (PASS -> FAIL)" },
          effects: [{ write: { path: "report.tap", content: PASSING_TAP } }, { write: { path: "greeting.txt", content: "hello\n" } }],
          json: { status: "completed", rationale: "restored the beta check and wrote greeting.txt" },
        },
        {
          when: { promptContains: INTENT },
          effects: [{ write: { path: "report.tap", content: FAILING_TAP } }],
          json: { status: "completed", rationale: "wrote the greeting, breaking the beta check" },
        },
      ],
    };

    const { result, journal, dir, repoPath } = await scratchRun(script, recordingRouter(triggers));

    const { history } = await load(dir);
    expect(history.flatMap((e) => (e.t === "gate" ? [`${e.attempt}: ${e.status}`] : []))).toEqual(["1: FAIL", "2: PASS"]);
    expect(history.flatMap((e) => (e.t === "triage" ? [e.verdict] : []))).toEqual(["reroute"]);
    expect(triggers).toEqual(["gate_fail"]);
    expect(result.state).toBe("CLOSED");
    expect(git(repoPath, ["show", "main:report.tap"])).toBe(PASSING_TAP.trim());
    expect(git(repoPath, ["show", "main:greeting.txt"])).toBe("hello");
    expect(() => assertFullyConsumed(journal, script)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests, then show each can fail**

Run: `npx vitest run src/scripted-surface-run.test.ts`
Expected: PASS: 9 tests (the 3 remaining Slice 3 tests, the 4 `it.each` rows, the authority test, the retry test). Each run spawns claude-mock sessions and finishes in well under a second; no timeout change is needed.

Run: `npx tsc --noEmit && npx eslint src/scripted-surface-run.test.ts`
Expected: no output.

Mutation checks (do not commit; run each, confirm the named failure, revert with `git checkout -- <file>`, move on):

1. `src/agent-invoke.ts`: change `if (result.subtype !== "success" || result.is_error) {` to `if (result.subtype !== "success") {`. Run `npx vitest run src/scripted-surface-run.test.ts`. Expected: FAIL on the rows for "a prompt no expectation matches" and "a scripted failure" (their reason becomes `noEnvelope`). Revert.
2. `src/agent-invoke.ts`: in `if (result.structured_output === undefined) {`, change the returned `DID_NOT_COMPLETE.noEnvelope` to `DID_NOT_COMPLETE.errored`. Expected: FAIL on the "a reply with no envelope" row. Revert.
3. `src/agent-invoke.ts`: change `if (!envelope.success) return incomplete(roleCfg, DID_NOT_COMPLETE.wrongShape);` to use `DID_NOT_COMPLETE.noEnvelope`. Expected: FAIL on the "an envelope in a triage verdict's shape" row. Revert.
4. `src/case-file.ts` (`deriveStateFromEntry`): change `return entry.category === "authority" ? "ESCALATED" : "TRIAGE";` to `return "TRIAGE";`. Expected: FAIL on the authority test (`triggers` is `["worker_escalate"]` and the reason is the router's). Revert.
5. `src/router.ts`: change `gate_fail: { budget: "correction", helpful: "reroute" },` to `gate_fail: { budget: "correction", helpful: "abort" },`. Expected: FAIL on the retry test (no second gate entry; state `ABORTED`). Revert.

After the last revert, run `git status --short src/agent-invoke.ts src/case-file.ts src/router.ts` and expect no output, then rerun `npx vitest run src/scripted-surface-run.test.ts`: PASS.

- [ ] **Step 4: Correct the mock correspondence in `docs/agent-interface.md`**

In `docs/agent-interface.md` §Relationship to the mock, replace the bullet

```markdown
- **Terminus mapping** ↔ what the harness does with the mock's reply; an unmatched
  or malformed reply exercises the `INCOMPLETE_TERMINUS` path.
```

with

```markdown
- **Terminus mapping** ↔ what the harness does with the mock's reply. A prompt no
  expectation matches, a `reply` with no `json`, a `json` the role's schema rejects, and a
  scripted `fail` each exercise the `INCOMPLETE_TERMINUS` path
  (`src/scripted-surface-run.test.ts` proves each through a whole surface). An unmatched
  prompt and a scripted `fail` both read as a session that ended in an error; only the
  journal's `unmatched` event tells them apart.
```

- [ ] **Step 5: Commit**

```bash
git add src/scripted-surface-run.test.ts docs/agent-interface.md
git commit -m "Prove a scripted surface copes with each way the agent misbehaves

The terminus mapping and the driver's retry, authority and reroute edges
were only unit-tested piecemeal. These tests run each bad reply, an
authority escalation and a gate rejection through a whole surface and
the real invoke(), so an extender can rely on the incomplete, escalation
and retry paths being taken on cue. No production behaviour changes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The misbehaving-agent demo

**Files:**
- Create: `demos/agent-mock-slice-4-misbehaving-agent.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `expectEnvelope` (Task 1); `runSurfaceAgainstMock`, `promptsSent`, `MockScript` (`src/testing.ts`, Slice 3); `load` (`src/case-file.ts`), `initTempRepo` (`src/temp-repo.ts`), `cleanGitEnv` (`src/git-env.ts`), `deterministicRouter` (`src/router.ts`), `workerRoleConfig`, `gateMaintenanceRoleConfig` (`src/role-config.ts`), `triageRoleConfig` (`src/triage-role-config.ts`), `BudgetSet`, `CloserRef`, `GateRef`, `HistoryEntry` (`src/schema.ts`).
- Produces: `npm run demo:mock-slice-4`, printing six numbered sections whose headings the UAT phase will assert on:
  - `--- 1. No expectation matches the prompt ---`
  - `--- 2. A reply with no envelope ---`
  - `--- 3. An envelope in the wrong shape for the worker ---`
  - `--- 4. A scripted failure ---`
  - `--- 5. The worker escalates for authority ---`
  - `--- 6. The worker's change fails the gate ---`

- [ ] **Step 1: Write the demo**

Create `demos/agent-mock-slice-4-misbehaving-agent.ts`:

```ts
/**
 * UAT demo for Agent Mock Slice 4: Prove the Pipeline Copes When the Agent Misbehaves.
 *
 * Runs one surface per misbehaviour against the scripted agent, each in its own
 * scratch repository with a real command gate and the real merge-back closer:
 *
 * 1-4. The worker replies badly: a prompt no expectation matches, a reply with
 *      no envelope, an envelope in the wrong shape, a scripted failure. Each
 *      attempt ends incomplete with a plain-English reason, is retried within
 *      the terminus budget, and the surface then escalates. Section 3 also
 *      shows expectEnvelope rejecting a malformed envelope as it is written.
 * 5.   The worker escalates for authority: the surface escalates at once.
 * 6.   The worker's first change fails the gate: it is routed back for another
 *      attempt, and only the passing attempt lands.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no other setup. No network, no API key.
 *
 * Usage: npm run demo:mock-slice-4
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { load } from "../src/case-file.js";
import { cleanGitEnv } from "../src/git-env.js";
import { initTempRepo } from "../src/temp-repo.js";
import { deterministicRouter } from "../src/router.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { triageRoleConfig } from "../src/triage-role-config.js";
import { expectEnvelope, promptsSent, runSurfaceAgainstMock } from "../src/testing.js";
import type { MockScript } from "../src/testing.js";
import type { BudgetSet, CloserRef, GateRef, HistoryEntry } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 2 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 2 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const closerRef: CloserRef = { type: "merge-back" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const INTENT = "add a greeting file that says hello";

const indent = (text: string) => text.split("\n").map((l) => `   ${l}`).join("\n");

/** The steps a reader follows: what each session ended with, and what the gate, triage and closer did. */
function describeStep(entry: HistoryEntry): string[] {
  switch (entry.t) {
    case "terminus":
      return [`${entry.role ?? "worker"} attempt ${entry.attempt} (${entry.sessionKey}): ${entry.status}: ${entry.rationale}`];
    case "gate":
      return [`gate on attempt ${entry.attempt}: ${entry.status}`];
    case "triage":
      return [`triage after attempt ${entry.afterAttempt}: ${entry.verdict} (${entry.rationale})`];
    case "close":
      return [`closer: ${entry.status}`];
    default:
      return [];
  }
}

function onMain(repoPath: string, file: string): string {
  try {
    return execFileSync("git", ["show", `main:${file}`], { cwd: repoPath, encoding: "utf-8", env: cleanGitEnv(), stdio: "pipe" }).trim();
  } catch {
    return "(not on main)";
  }
}

/** Print the script, run one surface with it, then print what the surface recorded and how it finished. */
async function show(name: string, script: MockScript) {
  console.log("Script given to the agent:");
  console.log(indent(JSON.stringify(script, null, 2)));

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `mock-misbehaving-demo-${name}-`));
  const dir = path.join(scratch, "case");
  fs.mkdirSync(dir);
  const repoPath = initTempRepo(`mock-misbehaving-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const { result, journal } = await runSurfaceAgainstMock({
    dir,
    location: { repoPath, worktreePath: path.join(scratch, "wt") },
    header: { surfaceId: name, taskDef: { intent: INTENT }, gateRef, closerRef },
    budgets,
    roleConfigs: { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
    triage: () => deterministicRouter,
    script,
  });
  const { history } = await load(dir);

  console.log("What the surface recorded:");
  console.log(indent(history.flatMap(describeStep).join("\n")));
  console.log(`Surface finished: ${result.state}`);
  console.log(`Outcome:          ${result.outcome?.reason ?? "-"}`);
  return { journal, repoPath };
}

async function main(): Promise<void> {
  console.log("=== Agent Mock Slice 4: a pipeline against a misbehaving scripted agent ===\n");

  console.log("--- 1. No expectation matches the prompt ---");
  const noMatch = await show("no-match", {
    expectations: [{ when: { promptContains: "a phrase the harness never sends" }, json: { status: "completed", rationale: "never reached" } }],
  });
  console.log(`Prompts the journal shows matched no expectation: ${noMatch.journal.filter((e) => e.event === "unmatched").length}\n`);

  console.log("--- 2. A reply with no envelope ---");
  await show("no-envelope", { expectations: [{ reply: "I looked around but never reported back." }] });
  console.log("");

  console.log("--- 3. An envelope in the wrong shape for the worker ---");
  console.log("A triage verdict, written straight into json to script a malformed reply on purpose:");
  await show("wrong-shape", { expectations: [{ json: { status: "reroute", rationale: "someone else should take this" } }] });
  console.log("A slip the compiler cannot see, an empty rationale, caught by expectEnvelope as the script is written:");
  try {
    expectEnvelope(workerRoleConfig, { status: "completed", rationale: "" });
    console.log(indent("accepted"));
  } catch (err) {
    console.log(indent((err as Error).message));
  }
  console.log("");

  console.log("--- 4. A scripted failure ---");
  await show("scripted-failure", { expectations: [{ fail: { message: "the session crashed part way through" } }] });
  console.log("");

  console.log("--- 5. The worker escalates for authority ---");
  const authority = await show("authority", {
    expectations: [
      {
        json: expectEnvelope(workerRoleConfig, {
          status: "escalate",
          category: "authority",
          rationale: "deploying needs a production credential this worker was not given",
        }),
      },
    ],
  });
  console.log(`Worker sessions run: ${promptsSent(authority.journal).length}\n`);

  console.log("--- 6. The worker's change fails the gate ---");
  const retried = await show("gate-fail", {
    expectations: [
      // Each session re-reads the script and takes the first expectation that matches,
      // so the retry's expectation, keyed on the failure the gate reported, comes first.
      {
        when: { promptContains: "2 - beta (PASS -> FAIL)" },
        effects: [{ write: { path: "report.tap", content: PASSING_TAP } }, { write: { path: "greeting.txt", content: "hello\n" } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "restored the beta check and wrote greeting.txt" }),
      },
      {
        when: { promptContains: INTENT },
        effects: [{ write: { path: "report.tap", content: FAILING_TAP } }],
        json: expectEnvelope(workerRoleConfig, { status: "completed", rationale: "wrote the greeting, breaking the beta check" }),
      },
    ],
  });
  const landedReport = onMain(retried.repoPath, "report.tap");
  console.log(`report.tap on main:   ${landedReport === PASSING_TAP.trim() ? "passing: the rejected change never landed" : landedReport}`);
  console.log(`greeting.txt on main: ${onMain(retried.repoPath, "greeting.txt")}`);
}

await main();
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"demo:mock-slice-3": "npx tsx demos/agent-mock-slice-3-scripted-pipeline.ts",` add:

```json
    "demo:mock-slice-4": "npx tsx demos/agent-mock-slice-4-misbehaving-agent.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:mock-slice-4`
Expected, exit 0, and:
- Sections 1 to 4 each print the script, then two lines `worker attempt 1 (worker-1-0): incomplete: worker session did not complete: <reason>` and `worker attempt 1 (worker-1-1): incomplete: ...` with the same reason, no `gate on attempt` line, `Surface finished: ESCALATED` and `Outcome:          terminus budget exhausted (2/2): worker session did not complete: <reason>`. The reasons are: section 1 and section 4 `the session ended in an error before it reported a result`; section 2 `the session ended without reporting a result`; section 3 `the session replied with something that is not a valid result for this role`.
- Section 1 ends `Prompts the journal shows matched no expectation: 2`.
- Section 3 then prints `The scripted envelope is not a valid worker result:`, an indented `rationale: ...` line, and `Fix the envelope. To script a malformed reply on purpose, write it into the expectation's json directly, without expectEnvelope.`
- Section 5 prints one line `worker attempt 1 (worker-1-0): escalate: deploying needs a production credential this worker was not given`, `Surface finished: ESCALATED`, `Outcome:          deploying needs a production credential this worker was not given` and `Worker sessions run: 1`.
- Section 6 prints, in order, `worker attempt 1 (worker-1-0): completed: wrote the greeting, breaking the beta check`, `gate on attempt 1: FAIL`, `triage after attempt 1: reroute (gate_fail: reroute (correction 0/2))`, `worker attempt 2 (worker-2-0): completed: restored the beta check and wrote greeting.txt`, `gate on attempt 2: PASS`, `closer: DONE`, then `Surface finished: CLOSED`, `report.tap on main:   passing: the rejected change never landed` and `greeting.txt on main: hello`.

Run: `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN npm run demo:mock-slice-4 | grep -c "^Surface finished:"`
Expected: `6`.

Run: `npx tsc --noEmit && npx eslint demos/agent-mock-slice-4-misbehaving-agent.ts && npx vitest run tests/typecheck-coverage.test.ts`
Expected: no lint output; PASS.

Run: `grep -n "—" demos/agent-mock-slice-4-misbehaving-agent.ts`
Expected: no output (no em-dashes in demo copy).

- [ ] **Step 4: Commit**

```bash
git add demos/agent-mock-slice-4-misbehaving-agent.ts package.json
git commit -m "Add the misbehaving-agent demo

The slice's UAT has a reviewer run one command and read each bad reply
reported as an incomplete attempt with its plain-English reason, an
authority escalation ending escalated at once, and a change the gate
rejected being retried rather than landed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
