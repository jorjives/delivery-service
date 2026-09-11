# Triage and Deterministic Router — Slice 3: Triage Judges the Last Attempt and Rechecks Broken Gates for Free

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-10-triage-and-router-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-10-triage-and-router-design.md`

**Goal:** The triage agent is consulted only where its judgement changes the outcome: on the last correction slot after a gate failure, on the last close slot, and on a gate error once its free rechecks are spent. A gate that errors is first re-run for free against the same baseline. A repair session receives triage's brief. An extender can configure triage from a new Triage chapter of `docs/configuring-a-role.md`.

**Architecture:** `needsJudgement` (`src/triage.ts`) gains the last-slot `gate_fail` row and the `gate_error` row. A new router-only verdict `recheck_gate` routes `TRIAGE → GATING`, which re-runs the existing `runCheck` against the pinned baseline. The deterministic router's `gate_error` handling becomes two-step: recheck while `gateError` has a slot, then fall through to the existing `{gateMaintenance, fix_the_gate}` table row. The `recheck_gate` triage entry is the `gateError` burn, like `reroute` for `correction` and `retry_close` for `close`. `surface.ts`'s `currentBriefRef` generalises from "the latest `reroute`" to "the latest verdict that starts this role's session", so a `fix_the_gate` brief reaches the repair dispatch through the same `briefRef` → `## Brief` path the worker already uses.

**Tech Stack:** TypeScript (ESM, Node ≥22), zod v4, vitest, `@anthropic-ai/claude-agent-sdk` 0.3.x, `claude-mock` (sibling project, resolved from `PATH`).

## Global Constraints

- Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint` strict config, `vitest`. **No new dependency of any kind.**
- **Buy-vs-build (Build note):** the gate recheck reuses the existing gate check (`runCheck` via the `GATING` edge) against the same immutable baseline. No new gate mechanism, no flaky-assertion quarantine, no second prompt assembler, no second invocation path.
- **Operability/DX (Operational note):** a Triage chapter in `docs/configuring-a-role.md`, shaped like the Worker and Gate-maintenance material, stating that triage's tool list is read-only by design. A demo in the existing naming convention: `demos/triage-slice-3-last-attempt.ts`, `npm run demo:triage-slice-3`.
- **Slice 1 Operational note still binds:** the demo depends on `claude-mock` on `PATH`, says so plainly, and exits non-zero when it is absent. `claude-mock` does not enforce `allowedTools`; no demo line or doc may claim otherwise.
- **`recheck_gate` is the router's alone.** It is not in `TriageEnvelope` and not in `legalVerdicts`: re-running a gate needs no judgement.
- **No agent call where no decision exists.** Once a population is spent, the lookup table decides and nothing invokes the agent.
- **Every escalation stores a packet** (Slice 2): the at-cap paths escalate through the router's `cause`, which the surface turns into a packet. Nothing in this slice may bypass that.
- **Determinism:** the brief a session receives, the budgets and the next state are all derived from the log, so a live run and a resumed one agree.
- **`outcome.reason` strings do not change** for any path that existed before this slice.
- Worker and gate-maintenance prompt *structure* is unchanged; a repair session's `## Brief` slot simply stops being empty when triage wrote a brief.
- Run commands from the worktree root. Targeted tests only: `npx vitest run <file> -t "<name>"`. Typecheck: `npx tsc --noEmit`. Lint a single file: `npx eslint <file>`.

## Scaffolding Impact

- `docs/single-surface-control-flow.md`: the state machine gains `TRIAGE → GATING (recheck_gate)`; the `triage` entry's verdict list gains `recheck_gate`; the gate-error budget note says what burns it → Task 2.
- `demos/single-surface-slice-4-budgets.ts`: its printed note "gateError is counted but gated by nothing in this item" becomes false → Task 2.
- `demos/single-surface-slice-3-setbacks.ts`: the gate-error scenario's comment and `Setback:` line describe a straight-to-repair route → Task 2.
- `tests/single-surface-state-machine/3-…test.ts` and `5-…test.ts` pin the old gate-error route and the old `gateError` count in demo output. Those are intended behaviour changes, so the assertions are updated in the task that changes them → Task 2.
- `src/router.ts` module comment ("`gateError` is deliberately absent … reserved for a future … re-check") → Task 2.
- `src/case-file.ts` `deriveBudgetsFromLog` comment on what burns `gateError` → Task 2.
- `docs/configuring-a-role.md`: the Triage chapter, plus the intro and the four-field table, which currently say there are two roles and `WorkerEnvelope` for both → Task 4.
- `package.json`: new `demo:triage-slice-3` script → Task 5.
- `eslint.config.js`: no change. `demos/*.ts` is already matched; Task 5 lints the demo to prove it.
- `docs/agent-interface.md`: none. Its triage row lists the agent's vocabulary, and `recheck_gate` is deliberately not in it.
- `src/index.ts`: none. Every symbol the guide and demo use is already exported (`invoke`, `createAgentPort`, `createAgentTriage`, `triageRoleConfig`, `TriageEnvelope`, `run`, `noopCloser`, `SETBACK_LABELS`).
- `README.md`, `CONTRIBUTING.md`: none. No new command beyond the demo script, no env var, no build step.

**Decisions recorded (unattended run):**

1. **`gateError` is burnt by the `recheck_gate` triage entry, not by every `ERROR` gate entry.** This departs from the spec's sentence "`gateError` already counts `gate` entries with status `ERROR`". Counting every errored gate entry would make the population exceed its cap: an always-broken gate records five `ERROR` entries against `max: 3` (three rechecks, then one after each of two repairs). The packet would then tell Marcus "gate recheck 5/3 used". Burning at the verdict matches the rule every other triage-funded population already follows ("the triage entry IS the burn"), keeps `used ≤ max`, and makes the `gate recheck` label literally true: `max: 3` means three free rechecks. `case-file.test.ts`'s rebuild test, which pins the old count, is updated to the intended one.
2. **The pre-task baseline error is not rechecked.** It never reaches triage (`preGating` dispatches a repair directly), and the spec scopes `recheck_gate` to triage's `gate_error` rule. Unchanged.
3. **The repair brief is found by `currentBriefRef(dir, history, role)`**, which takes the latest `fix_the_gate` entry for gate-maintenance and the latest `reroute` entry for the worker. The latest such entry is always the one that started the current session. Pre-task repairs have no triage entry, so they get no brief. A later deterministic `fix_the_gate` has no artefact, so its repair gets no brief rather than a stale earlier one.
4. **Triage's prompt says what a gate error is.** The `## Setback` slot currently says "the newly-failing assertions are listed under Gate evidence above", which is false for a gate that could not run. This slice is the first to ask the agent about `gate_error`, so `resolveSetback` now gives the gate-error sentence already used by escalation packets (`GATE_ERROR_EVIDENCE`, exported from `escalation-packet.ts`).
5. **`triageRoleConfig`'s system prompt gains one sentence** telling triage what a `fix_the_gate` brief is for, now that the agent can answer it.

6. **"A close failure with exactly one close slot left engages the triage agent" is already delivered.** Slice 2 pulled it forward (its decision 6), and `src/triage.test.ts`'s `describe("a failed close", …)` pins it: `"engages the agent only on its last close slot"` and `"asks the agent on the last slot, and escalates its 'retry the worker' answer"`. No task re-implements it; Task 1's `"a spent population"` block adds the at-cap close case.

**Not in this slice:** Dana's plain-language summary (COULD), rechecking a pre-task baseline error, and any threading of `CloseRepairBrief` (the closer is not an agent; that is Item 6).

---

## Task 1: The last correction slot after a gate failure engages the triage agent

**Files:**
- Modify: `src/triage.ts` (`needsJudgement` and its doc comment)
- Modify: `src/triage.test.ts` (two new `describe` blocks appended at the end of the file)
- Modify: `src/surface.test.ts` (one new test in `describe("triage by agent", …)`)

**Interfaces:**
- Consumes: `needsJudgement(input: TriageInput): boolean`, `createAgentTriage(agent: AgentPort): TriagePort` (`triage.ts`); `deterministicRouter` (`router.ts`).
- Produces: no signature change. `needsJudgement` returns `true` for `gate_fail` exactly when `remainingBudgets.correction.max - used === 1`.

- [ ] **Step 0: Install dependencies if the worktree has no `node_modules`**

Run: `test -d node_modules || npm ci`
Expected: completes; `git status` stays clean.

- [ ] **Step 1: Write the failing unit tests**

Append to the **end** of `src/triage.test.ts`. It must come after the module-level `packet` const, because `it.each` tables are evaluated when the `describe` runs:

```ts
describe("the last correction slot after a gate failure", () => {
  const gateFail = (correctionUsed: number) =>
    input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(correctionUsed) });

  it("engages the agent only on the last correction slot", () => {
    expect(needsJudgement(gateFail(2))).toBe(true);
    expect(needsJudgement(gateFail(1))).toBe(false);
    expect(needsJudgement(gateFail(3))).toBe(false);
  });

  it.each([
    { status: "reroute", rationale: "one more try is worth it", payload: brief },
    { status: "escalate", rationale: "a last retry would repeat attempt 2", payload: packet },
  ] as TriageTerminus[])("asks the agent on the last slot and acts on its $status answer", async (reply) => {
    const agent = triageAgent(reply);
    const verdict = await createAgentTriage(agent).triage(gateFail(2));
    expect(agent.calls).toEqual([ctx]);
    expect(verdict).toEqual({ verdict: reply.status, rationale: reply.rationale, artifact: reply.payload });
  });
});

describe("a spent population", () => {
  it.each([
    ["a gate failure", input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(3) }), "correction"],
    ["a stuck worker", input({ remainingBudgets: budgets(3) }), "correction"],
    ["a close failure", input({ trigger: "close_failure", category: undefined, remainingBudgets: budgets(0, 3) }), "close"],
  ] as const)("escalates %s with no agent call, naming the spent budget as the cause", async (_name, spent, population) => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(spent);
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.cause).toMatchObject({ kind: "budget", population });
  });
});
```

- [ ] **Step 2: Run the unit tests to verify the first block fails**

Run: `npx vitest run src/triage.test.ts -t "last correction slot"`
Expected: FAIL. `needsJudgement(gateFail(2))` is `false`, so `createAgentTriage` hands the round to the lookup table: it returns `reroute` with no artefact, and `agent.calls` is `[]`.

Run: `npx vitest run src/triage.test.ts -t "a spent population"`
Expected: PASS already. This pins the at-cap acceptance criterion; it is not red because the router already guards it.

- [ ] **Step 3: Write the failing surface test**

In `src/surface.test.ts`, inside `describe("triage by agent", …)`, after the test `"routes a plain gate failure with slots to spare with no agent call, and its retry carries no brief"`, add:

```ts
  it("asks the triage agent about a failing gate only on the last correction slot", async () => {
    const lastSlotPacket = {
      decision: "Three attempts have regressed the same assertion. Decide whether to amend the task or take it on yourself.",
      evidence: "2: not ok 2 - beta",
      dead_ends: "Attempts 1 to 3 each rewrote report.tap and broke beta.",
      why_now: "One correction slot is left, and another attempt would repeat the same change.",
      references: ["worker-1-0", "worker-2-0", "worker-3-0"],
    };
    const triageKeys: string[] = [];
    const agent = sessionAgent(
      (_role, ctx) => {
        writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
        return Promise.resolve({ status: "completed", rationale: "changed it" });
      },
      (ctx) => {
        triageKeys.push(ctx.sessionKey);
        return Promise.resolve({ status: "escalate", rationale: "a last retry would repeat attempt 3", payload: lastSlotPacket });
      },
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);

    // correction max is 3: rounds 0 and 1 leave more than one slot, so the lookup
    // table reroutes; round 2 has exactly one slot left, so the agent decides.
    expect(triageKeys).toEqual(["triage-2"]);
    expect(result.state).toBe("ESCALATED");
    expect(result.outcome).toMatchObject({ source: "triage", reason: "a last retry would repeat attempt 3" });
    expect(await readRef(dir, result.outcome?.packetRef ?? "")).toEqual(lastSlotPacket);
  });
```

- [ ] **Step 4: Run the surface test to verify it fails**

Run: `npx vitest run src/surface.test.ts -t "only on the last correction slot"`
Expected: FAIL. `triageKeys` is `[]` and the outcome reason is `correction budget exhausted (3/3): …`.

- [ ] **Step 5: Write the minimal implementation**

In `src/triage.ts`, replace `needsJudgement` and its doc comment with:

```ts
/**
 * Whether a real decision exists that an agent could change. A stuck worker
 * with a correction slot left is one: triage may judge a retry worthwhile and
 * say what to try. The last slot of a population is another: with one slot
 * left, a clean escalation may beat a long-shot retry. Once a population is
 * spent, no judgement changes the outcome, so no agent is asked a question
 * whose only answer is escalate.
 */
export function needsJudgement({ trigger, category, remainingBudgets: b }: TriageInput): boolean {
  const left = (x: Budget) => x.max - x.used;
  switch (trigger) {
    case "worker_escalate":
      return category !== "authority" && left(b.correction) > 0;
    case "gate_fail":
      return left(b.correction) === 1;
    case "close_failure":
      return left(b.close) === 1;
    case "gate_error":
      return false;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/triage.test.ts`
Expected: PASS, including the existing `"does not engage the agent for a plain gate failure with more than one slot left"`.

Run: `npx vitest run src/surface.test.ts -t "triage by agent"`
Expected: PASS, including the existing `"routes a plain gate failure with slots to spare …"`, which has only one gate failure.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/triage.ts src/triage.test.ts src/surface.test.ts
git commit -m "Ask the triage agent about a failing gate on the last correction slot

With one correction slot left, a clean escalation can beat a long-shot
reroute, which is a judgement the lookup table cannot make. Every earlier
gate failure still reroutes with no agent call, and a spent population
still escalates without asking anyone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: A gate that errors is rechecked for free before anything else is spent

**Files:**
- Modify: `src/schema.ts` (`TriageEntry.verdict` enum)
- Modify: `src/ports.ts` (`TriageVerdict.verdict` union and its doc)
- Modify: `src/case-file.ts` (`triageState`; `deriveBudgetsFromLog`'s `gateError` burn and comment)
- Modify: `src/router.ts` (`gate_error` two-step and module comment)
- Modify: `src/surface.ts` (`triage()` doc comment only)
- Modify: `src/router.test.ts`, `src/case-file.test.ts`, `src/triage.test.ts`, `src/surface.test.ts`
- Modify: `demos/single-surface-slice-3-setbacks.ts`, `demos/single-surface-slice-4-budgets.ts` (printed text and comments only)
- Modify: `tests/single-surface-state-machine/3-route-a-setback-back-into-the-loop-instead-of-giving-up.test.ts`, `tests/single-surface-state-machine/5-resume-a-surface-after-a-crash-to-the-same-outcome.test.ts`
- Modify: `docs/single-surface-control-flow.md`

**Interfaces:**
- Consumes: `deterministicRouter` (`router.ts`), `deriveStateFromEntry`, `deriveBudgetsFromLog` (`case-file.ts`), `gating()` (private, `surface.ts`, unchanged).
- Produces:
  - `TriageVerdict["verdict"]`: `"reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort" | "recheck_gate"`.
  - `TriageEntry.verdict` accepts `"recheck_gate"`; `deriveStateFromEntry` maps it to `"GATING"`.
  - `deriveBudgetsFromLog`: `gateError.used` = the number of `triage` entries with `verdict: "recheck_gate"`. An `ERROR` gate entry burns nothing by itself.
  - `deterministicRouter` on `gate_error`: `recheck_gate` while `gateError.used < max`; else `fix_the_gate` while `gateMaintenance.used < max`; else `escalate` with `cause: { kind: "budget", population: "gateMaintenance", … }`.

- [ ] **Step 1: Write the failing router tests**

In `src/router.test.ts`, replace the test `"routes a gate error to a gate repair while repair budget remains"` with:

```ts
  it("rechecks a gate error, free, while the recheck budget remains", async () => {
    expect(await deterministicRouter.triage(input("gate_error"))).toEqual({
      verdict: "recheck_gate",
      rationale: "gate_error: recheck_gate (gateError 0/3)",
    });
  });

  it("routes a gate error to a gate repair once rechecks are spent and repair budget remains", async () => {
    expect(await deterministicRouter.triage(input("gate_error", atCap("gateError")))).toMatchObject({
      verdict: "fix_the_gate",
    });
  });

  it("escalates a gate error only when rechecks and repairs are both spent, naming the repair budget", async () => {
    const bothSpent = { ...atCap("gateError"), gateMaintenance: { used: 2, max: 2 } };
    const verdict = await deterministicRouter.triage(input("gate_error", bothSpent));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.cause).toMatchObject({ kind: "budget", population: "gateMaintenance", budget: { used: 2, max: 2 } });
  });
```

In both `it.each` tables that list `["gate_error", "gateMaintenance"]` (the "escalates %s once its %s budget is at cap" table and the "names the spent %s population" table), delete that row. The new test above covers `gate_error`'s at-cap escalation, and `atCap("gateMaintenance")` alone now rechecks instead.

- [ ] **Step 2: Write the failing budget and state tests**

In `src/case-file.test.ts`, in the rebuild test that appends a `gate` entry with `status: "ERROR"`, replace

```ts
    expect(rebuilt.cursor.budgets.gateError.used).toBe(1);
```

with

```ts
    // An errored gate costs nothing by itself: the recheck triage verdict is the burn.
    expect(rebuilt.cursor.budgets.gateError.used).toBe(0);
```

Then, in the `describe` block that holds the `deriveBudgetsFromLog` tests (search for `describe("deriveBudgetsFromLog"`; if there is none, add these at the end of the file in a new `describe("gate rechecks", …)`), add the following. Add `deriveBudgetsFromLog`, `deriveStateFromEntry` and the `HistoryEntry` type to the imports if they are not already imported:

```ts
  it("burns gateError on a recheck_gate triage verdict, never on the ERROR gate entry itself", () => {
    const maxima = {
      correction: { used: 0, max: 3 },
      gateError: { used: 0, max: 3 },
      gateMaintenance: { used: 0, max: 2 },
      terminus: { used: 0, max: 5 },
      close: { used: 0, max: 3 },
    };
    const history: HistoryEntry[] = [
      { t: "gate", attempt: 1, status: "ERROR", newFailures: [], class: "error" },
      { t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "recheck_gate", rationale: "r", artifactRef: "triage-0" },
      { t: "gate", attempt: 1, status: "ERROR", newFailures: [], class: "error" },
    ];
    expect(deriveBudgetsFromLog(history, maxima).gateError).toEqual({ used: 1, max: 3 });
  });

  it("routes a recheck_gate verdict back to GATING", () => {
    expect(
      deriveStateFromEntry({ t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "recheck_gate", rationale: "r", artifactRef: "triage-0" }),
    ).toBe("GATING");
  });
```

- [ ] **Step 3: Write the failing triage-port test**

Append to the end of `src/triage.test.ts`:

```ts
describe("a gate error while rechecks remain", () => {
  it("is rechecked with no agent call", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(input({ trigger: "gate_error", category: undefined }));
    expect(verdict.verdict).toBe("recheck_gate");
    expect(verdict.artifact).toBeUndefined();
  });
});
```

- [ ] **Step 4: Write and update the failing surface tests**

In `src/surface.test.ts`, directly after the `FAILING_TAP` const, add:

```ts
/** Errors on the first check after the worker drops a `.flaky` marker, then reads report.tap as usual. */
const FLAKY_GATE = "if [ -f .flaky ]; then rm .flaky; else cat report.tap; fi";
```

In `describe("TRIAGE", …)`, add this new test before `"repairs an errored gate and re-checks the same attempt against the same baseline"`:

```ts
  it("rechecks a gate that errored once, for free, and closes with no agent call and no repair", async () => {
    const flakyDir = await mkdtemp(join(tmpdir(), "surface-case-"));
    const flakyGate: GateRef = { type: "command", command: FLAKY_GATE, parseMode: "tap" };
    await create(flakyDir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef: flakyGate }, budgets);
    const agent = sessionAgent((role, ctx) => {
      if (role !== "worker") return Promise.reject(new Error("no repair session was expected"));
      writeFileSync(join(ctx.worktreePath, ".flaky"), "");
      return Promise.resolve({ status: "completed", rationale: "clean change" });
    }); // no triage function: any triage agent call rejects and fails the test
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(flakyDir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(flakyDir, location, ports);

    expect(result.state).toBe("CLOSED");
    const { history } = await load(flakyDir);
    expect(history.filter((e) => e.t === "triage")).toMatchObject([{ trigger: "gate_error", verdict: "recheck_gate" }]);
    // The same attempt, judged twice against the one baseline pinned before the worker ran.
    expect(history.filter((e) => e.t === "gate")).toMatchObject([
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "PASS" },
    ]);
    expect(history.filter((e) => e.t === "baseline")).toHaveLength(1);
    expect(history.filter((e) => e.t === "dispatch")).toEqual([
      expect.objectContaining({ role: "worker", attempt: 1 }),
    ]);
    expect(deriveBudgetsFromLog(history, budgets).gateError.used).toBe(1);
  });
```

Replace the test `"repairs an errored gate and re-checks the same attempt against the same baseline"` with this one. The body is the same down to `const { header, history } = await load(dir);` and the two baseline expectations; only the name, the comment and the last three expectations change:

```ts
  it("rechecks a gate that keeps erroring until rechecks are spent, then repairs it and re-checks the same attempt", async () => {
    const worker = (ctx: { worktreePath: string }): Promise<Terminus> => {
      // The worker's change removes the file the gate reads: the gate can no
      // longer run at all, which is an ERROR, not a regression.
      rmSync(join(ctx.worktreePath, "report.tap"));
      return Promise.resolve({ status: "completed", rationale: "worked, broke the gate" });
    };
    const repair = (ctx: { worktreePath: string }): Promise<Terminus> => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
      return Promise.resolve({ status: "completed", rationale: "restored report.tap" });
    };
    const agent: SurfacePorts["agent"] = sessionAgent((role, ctx) =>
      role === "gate-maintenance" ? repair(ctx) : worker(ctx),
    );
    // The deterministic router alone: no triage agent is wired in.
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    // Capture the baseline the moment it is pinned, before any worker runs.
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    const pinned = (await load(dir)).header.baseline;
    expect(pinned).not.toBeNull();

    const result = await run(dir, location, ports);
    expect(result.state).toBe("CLOSED");

    const { header, history } = await load(dir);

    // The baseline is the one captured pre-task — never recaptured.
    expect(history.filter((e) => e.t === "baseline")).toHaveLength(1);
    expect(header.baseline).toEqual(pinned);

    // Three free rechecks (gateError max 3), then a repair, as before this item.
    expect(history.filter((e) => e.t === "triage")).toMatchObject([
      { trigger: "gate_error", verdict: "recheck_gate" },
      { trigger: "gate_error", verdict: "recheck_gate" },
      { trigger: "gate_error", verdict: "recheck_gate" },
      { trigger: "gate_error", verdict: "fix_the_gate" },
    ]);
    // Every check, rechecks and the post-repair re-check alike, judged the SAME attempt.
    expect(history.filter((e) => e.t === "gate")).toMatchObject([
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "ERROR" },
      { attempt: 1, status: "PASS" },
    ]);
    expect(history.filter((e) => e.t === "dispatch")).toMatchObject([
      { role: "worker", attempt: 1 },
      { role: "gate-maintenance", attempt: 1 },
    ]);
  });
```

In the test `"dispatches the repair on resume when the fix_the_gate verdict was the last thing recorded"`, replace these four lines:

```ts
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // AGENT_ACTIVE -> GATING
    await advance(dir, location, ports); // GATING -> TRIAGE
    const routed = await advance(dir, location, ports); // TRIAGE -> GATE_MAINTENANCE
```

with:

```ts
    // baseline, worker, first gate; then three recheck rounds (TRIAGE -> GATING -> TRIAGE)
    for (let i = 0; i < 3 + 3 * 2; i++) await advance(dir, location, ports);
    const routed = await advance(dir, location, ports); // TRIAGE -> GATE_MAINTENANCE
```

In `describe("budget caps", …)`, in `"spends exactly the gate-maintenance cap when the gate never runs again"`, add after `expect(spent.gateMaintenance.used).toBe(budgets.gateMaintenance.max);`:

```ts
    // Rechecks came first and are spent too, at exactly their cap: an escalation
    // needs both the free recheck and the paid repair to be exhausted.
    expect(spent.gateError.used).toBe(budgets.gateError.max);
```

In `describe("resume parity: …")`, in the case `"a worker that breaks the gate, repaired to the gate-maintenance cap"`, change `stopAfter: 4,` to:

```ts
      // Provision, baseline, worker, errored gate, first recheck verdict: stops
      // with a recheck_gate recorded and the recheck it pays for not yet run.
      stopAfter: 5,
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run src/router.test.ts src/case-file.test.ts src/triage.test.ts src/surface.test.ts`
Expected: FAIL. The router still returns `fix_the_gate` for a fresh gate error, `recheck_gate` is not a valid `TriageEntry` verdict, `gateError` still counts the `ERROR` gate entry, and the flaky-gate test dispatches a repair session. `npx tsc --noEmit` also reports `"recheck_gate"` as not assignable.

- [ ] **Step 6: Add the verdict to the types and the state map**

In `src/schema.ts`, change the `TriageEntry` verdict line to:

```ts
  verdict: z.enum(["reroute", "escalate", "fix_the_gate", "retry_close", "abort", "recheck_gate"]),
```

In `src/ports.ts`, change `TriageVerdict.verdict` to the following and add the doc line above it:

```ts
  /**
   * `recheck_gate` is the lookup table's alone: re-running a gate needs no
   * judgement, so it is never in `TriageEnvelope` and no agent can answer it.
   */
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort" | "recheck_gate";
```

In `src/case-file.ts`, change `triageState` to:

```ts
const triageState: Record<string, SurfaceState> = {
  reroute: "AGENT_ACTIVE", escalate: "ESCALATED", fix_the_gate: "GATE_MAINTENANCE",
  retry_close: "CLOSING", abort: "ABORTED",
  // Re-run the same check against the same pinned baseline: GATING, not PRE_GATING.
  recheck_gate: "GATING",
};
```

In `deriveBudgetsFromLog`, delete the `case "gate":` branch (with its `ERROR` increment) and replace the `case "triage":` branch with:

```ts
      case "triage":
        // The triage entry IS the burn for the verdict it records — not the
        // dispatch, close or recheck that follows it, which a crash could land
        // before. An errored gate entry costs nothing by itself: counting it
        // would let an always-broken gate run the population past its cap.
        if (entry.verdict === "reroute") used.correction++;
        else if (entry.verdict === "retry_close") used.close++;
        else if (entry.verdict === "recheck_gate") used.gateError++;
        break;
```

- [ ] **Step 7: Make the router's `gate_error` rule two-step**

In `src/router.ts`, replace the module-level comment above `const rules` with:

```ts
/**
 * The whole deterministic rule, one row per trigger: the budget that gates the
 * helpful verdict, and the verdict itself. At cap, every trigger escalates.
 *
 * `gate_error`'s row is its second step. A gate that could not run is not the
 * worker's fault and re-running it costs nothing but time, so it is first
 * rechecked, on the `gateError` budget and with no agent, before this row
 * sends it to `GATE_MAINTENANCE` on the `gateMaintenance` budget.
 */
```

In `deterministicRouter.triage`, directly after the authority `if` block and before `const { budget, helpful } = rules[input.trigger];`, add:

```ts
    if (input.trigger === "gate_error") {
      const { used, max } = input.remainingBudgets.gateError;
      if (used < max) {
        return Promise.resolve({
          verdict: "recheck_gate",
          rationale: `gate_error: recheck_gate (gateError ${used}/${max})`,
        });
      }
    }
```

- [ ] **Step 8: Update the `triage()` comment in `src/surface.ts`**

In the doc comment above `async function triage(`, replace the first paragraph's burn sentence:

```ts
 * The `triage` entry appended here IS the `correction`/`close` burn for a
 * `reroute`/`retry_close` verdict — there is no separate increment, and the
```

with:

```ts
 * The `triage` entry appended here IS the `correction`/`close`/`gateError` burn
 * for a `reroute`/`retry_close`/`recheck_gate` verdict — there is no separate
 * increment, and the
```

- [ ] **Step 9: Run the unit tests to verify they pass**

Run: `npx vitest run src/router.test.ts src/case-file.test.ts src/triage.test.ts src/surface.test.ts src/escalation-packet.test.ts src/prompt-assembly.test.ts`
Expected: PASS. The last two files derive budgets from the log, so they are run to prove the `gateError` counting change leaves their packets and setback slots correct.

Run: `npx tsc --noEmit`
Expected: no errors. `legalVerdicts` in `triage.ts` is typed over `TriageVerdict["verdict"]` and needs no change; `recheck_gate` is correctly absent from every legal set.

- [ ] **Step 10: Bring the earlier demos and their UAT assertions in line with the new route**

In `demos/single-surface-slice-3-setbacks.ts`, replace the scenario-2 comment and `Setback` string:

```ts
  // 2. The worker's change stops the gate running at all. The gate is rechecked,
  //    free, until its recheck budget is spent; then a repair restores it, and
  //    the SAME attempt is re-checked against the SAME baseline.
  await runScenario(
    "Gate error, repaired then re-checked",
    "the worker's change removes the file the gate reads, so the gate cannot run, even on recheck",
```

In `demos/single-surface-slice-4-budgets.ts`, replace the two `console.log` calls that print the `Note:` lines with:

```ts
  console.log("Note: gateError pays for free gate rechecks. A gate that still cannot run after them");
  console.log("      is routed to gate maintenance and paid for there.");
```

Run: `npx tsx demos/single-surface-slice-3-setbacks.ts`
Expected: the `Gate error, repaired then re-checked` section prints exactly:

```
States:   PROVISIONING -> PRE_GATING -> AGENT_ACTIVE -> GATING -> TRIAGE -> GATING -> TRIAGE -> GATING -> TRIAGE -> GATING -> TRIAGE -> GATE_MAINTENANCE -> GATE_MAINTENANCE -> CLOSING -> CLOSED
Router:   gate_error -> recheck_gate, gate_error -> recheck_gate, gate_error -> recheck_gate, gate_error -> fix_the_gate
Attempts: 2 dispatched
```

In `tests/single-surface-state-machine/3-route-a-setback-back-into-the-loop-instead-of-giving-up.test.ts`, in the test `"AC: a gate that errors post-worker routes to a repair, …"`, replace the `States:` and `Router:` expectations and the comment beneath them with:

```ts
    expect(s).toContain("States:   PROVISIONING -> PRE_GATING -> AGENT_ACTIVE -> GATING -> TRIAGE -> GATING -> TRIAGE -> GATING -> TRIAGE -> GATING -> TRIAGE -> GATE_MAINTENANCE -> GATE_MAINTENANCE -> CLOSING -> CLOSED");
    // Triage and Router slice 3: a gate error is first rechecked, free, until its
    // recheck budget is spent; only then is it routed to a repair.
    expect(s).toContain("Router:   gate_error -> recheck_gate, gate_error -> recheck_gate, gate_error -> recheck_gate, gate_error -> fix_the_gate");
    // Only one worker attempt was dispatched: the repair goes through GATE_MAINTENANCE
    // twice (dispatch, then a re-check), never re-running or re-baselining the worker's attempt.
```

Run: `npx tsx demos/single-surface-slice-5-crash-recovery.ts`
Expected: the `Stopped mid repair attempt` section prints `correction 0/3, gateError 3/3, gateMaintenance 2/2, terminus 0/5, close 0/3` twice, and `Identical:     yes`.

In `tests/single-surface-state-machine/5-resume-a-surface-after-a-crash-to-the-same-outcome.test.ts`, replace

```ts
    // The repair retry burns the gate-maintenance budget, never the worker's terminus budget.
    expect(s).toContain(
      "correction 0/3, gateError 1/3, gateMaintenance 2/2, terminus 0/5, close 0/3",
    );
```

with

```ts
    // The repair retry burns the gate-maintenance budget, never the worker's terminus
    // budget. The free rechecks before the first repair spent gateError at its cap.
    expect(s).toContain(
      "correction 0/3, gateError 3/3, gateMaintenance 2/2, terminus 0/5, close 0/3",
    );
```

Run: `npx vitest run tests/single-surface-state-machine/3-route-a-setback-back-into-the-loop-instead-of-giving-up.test.ts tests/single-surface-state-machine/4-stop-cleanly-when-a-retry-budget-runs-out.test.ts tests/single-surface-state-machine/5-resume-a-surface-after-a-crash-to-the-same-outcome.test.ts`
Expected: PASS. Test 4 needs no edit: its gate-repair outcome is still `gateMaintenance budget exhausted (2/2): no retry remains for a gate_error setback`.

- [ ] **Step 11: Update the control-flow doc**

In `docs/single-surface-control-flow.md`, in the state-machine block, replace the `TRIAGE` block's first two edges with:

```
TRIAGE                     (router + classifier; typed verdict; never overturns a PASS)
  → AGENT_ACTIVE           (reroute; burns a correction slot; emits a sharpened brief)
  → GATING                 (recheck_gate — gate error, re-run free against the same baseline; burns a gate-error slot; router only, no agent)
  → GATE_MAINTENANCE       (fix_the_gate — environment only; once gate-error rechecks are spent)
```

In the `Budgets are independent deterministic counters` list, replace the `gate-error retries` bullet with:

```
  - **gate-error retries** (infra) — the gate flaked; cheap, stateless, re-run it.
    Each `recheck_gate` triage verdict is one burn; the errored gate entry itself
    costs nothing. Only once these are spent does a gate error reach gate-maintenance.
```

In the `Entry =` sketch, change the `triage` entry's verdict line to:

```
        verdict: reroute|escalate|fix_the_gate|retry_close|abort|recheck_gate,
```

- [ ] **Step 12: Commit**

```bash
git add src/schema.ts src/ports.ts src/case-file.ts src/router.ts src/surface.ts \
  src/router.test.ts src/case-file.test.ts src/triage.test.ts src/surface.test.ts \
  demos/single-surface-slice-3-setbacks.ts demos/single-surface-slice-4-budgets.ts \
  tests/single-surface-state-machine/3-route-a-setback-back-into-the-loop-instead-of-giving-up.test.ts \
  tests/single-surface-state-machine/5-resume-a-surface-after-a-crash-to-the-same-outcome.test.ts \
  docs/single-surface-control-flow.md
git commit -m "Recheck an errored gate for free before routing it to a repair

A gate that could not run is usually a flake, and re-running it costs no
agent and no repair session. The router now rechecks it against the same
pinned baseline while the gate-error budget lasts, and only then falls
through to gate maintenance as before. The recheck verdict is the burn,
like every other triage-funded population, so the count never passes its
cap and 'gate recheck 3/3' means three rechecks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Triage decides whether to repair a broken gate, and the repair session gets its brief

**Files:**
- Modify: `src/triage.ts` (`needsJudgement`'s `gate_error` row)
- Modify: `src/surface.ts` (`currentBriefRef` takes a role; `dispatchSession` passes it)
- Modify: `src/escalation-packet.ts` (export `GATE_ERROR_EVIDENCE`)
- Modify: `src/prompt-assembly.ts` (`resolveSetback` gives a gate error's detail; `PromptSetback.detail` doc)
- Modify: `src/triage-role-config.ts` (one sentence in `systemPromptFragment`)
- Modify: `src/triage.test.ts`, `src/surface.test.ts`, `src/prompt-assembly.test.ts`, `src/triage-role-config.test.ts`

**Interfaces:**
- Consumes: `recheck_gate` and the two-step router (Task 2); `BriefRef` (`prompt-assembly.ts`); `resolveEvidence`, which already renders the latest dispatch's `briefRef` into `## Brief` for any role.
- Produces:
  - `needsJudgement` on `gate_error`: `left(gateError) <= 0 && left(gateMaintenance) > 0`.
  - `currentBriefRef(dir: string, history: HistoryEntry[], role: "worker" | "gate-maintenance"): Promise<string | undefined>` (private to `surface.ts`).
  - `export const GATE_ERROR_EVIDENCE` from `escalation-packet.ts`.

- [ ] **Step 1: Write the failing triage-port tests**

Append to the end of `src/triage.test.ts`:

```ts
describe("a gate error once rechecks are spent", () => {
  const gateError = (repairUsed: number) =>
    input({
      trigger: "gate_error",
      category: undefined,
      remainingBudgets: { ...budgets(0), gateError: { used: 3, max: 3 }, gateMaintenance: { used: repairUsed, max: 2 } },
    });

  it("engages the agent while a repair slot is left, and never before rechecks are spent", () => {
    expect(needsJudgement(gateError(0))).toBe(true);
    expect(needsJudgement(gateError(1))).toBe(true);
    expect(needsJudgement(input({ trigger: "gate_error", category: undefined }))).toBe(false);
  });

  it("carries the agent's repair brief through with its fix_the_gate verdict", async () => {
    const agent = triageAgent({ status: "fix_the_gate", rationale: "the runner is missing", payload: brief });
    const verdict = await createAgentTriage(agent).triage(gateError(0));
    expect(agent.calls).toEqual([ctx]);
    expect(verdict).toEqual({ verdict: "fix_the_gate", rationale: "the runner is missing", artifact: brief });
  });

  it("escalates with no agent call once repairs are spent too", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(gateError(2));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.cause).toMatchObject({ kind: "budget", population: "gateMaintenance" });
  });
});
```

- [ ] **Step 2: Write the failing surface test**

In `src/surface.test.ts`, add `gateMaintenanceRoleConfig` to the existing `./role-config.js` import if it is not already there (it is imported today alongside `workerRoleConfig`). Inside `describe("triage by agent", …)`, at the end, add:

```ts
  it("asks triage whether to repair a gate that keeps erroring, and hands the repair session its brief", async () => {
    const repairBrief = {
      problem: "The gate cannot run: report.tap is gone.",
      dead_ends: "Three free rechecks all found the report missing.",
      scope: "Restore report.tap; never edit the checks.",
      references: ["worker-1-0"],
      diagnosis: "The worker's change deleted the generated report.",
    };
    const repairPrompts: string[] = [];
    const triageKeys: string[] = [];
    const agent = sessionAgent(
      async (role, ctx) => {
        if (role === "worker") {
          rmSync(join(ctx.worktreePath, "report.tap"));
          return { status: "completed", rationale: "worked, broke the gate" };
        }
        const caseFile = await load(ctx.dir);
        repairPrompts.push(assemblePrompt(caseFile, gateMaintenanceRoleConfig, await resolveEvidence(ctx.dir, caseFile)).prompt);
        writeFileSync(join(ctx.worktreePath, "report.tap"), PASSING_TAP);
        return { status: "completed", rationale: "restored report.tap" };
      },
      (ctx) => {
        triageKeys.push(ctx.sessionKey);
        return Promise.resolve({ status: "fix_the_gate", rationale: "the environment lost the report", payload: repairBrief });
      },
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    // Rounds 0-2 are free rechecks with no agent; round 3 is the first with a decision.
    expect(triageKeys).toEqual(["triage-3"]);
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "dispatch" && e.role === "gate-maintenance")).toEqual([
      expect.objectContaining({ attempt: 1, briefRef: "triage-3" }),
    ]);
    expect(repairPrompts).toHaveLength(1);
    expect(repairPrompts[0]).toContain(`Dead ends: ${repairBrief.dead_ends}`);
    expect(repairPrompts[0]).toContain("Diagnosis (a hypothesis to test, not an established fact)");
  });

  it("gives a deterministic repair no brief, even after an earlier round wrote one", async () => {
    // A repair started by the lookup table must not inherit a brief written for an earlier repair.
    const history: HistoryEntry[] = [
      { t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "fix_the_gate", rationale: "agent", artifactRef: "triage-3" },
      { t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "fix_the_gate", rationale: "table", artifactRef: "triage-4" },
    ];
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await writeRef(dir, "triage-3", { trigger: "gate_error", rationale: "agent", artifact: brief });
    await writeRef(dir, "triage-4", { trigger: "gate_error", rationale: "table" });
    for (const entry of history) await appendEntry(dir, entry);
    const agent = scriptedAgent([{ status: "completed", rationale: "repaired" }]);

    await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, portsWith(agent));

    const repair = (await load(dir)).history.find((e) => e.t === "dispatch");
    expect(repair).toMatchObject({ role: "gate-maintenance" });
    expect(repair).not.toHaveProperty("briefRef");
  });
```

The second test drives one `GATE_MAINTENANCE` advance from a hand-built log. The tail is a `fix_the_gate` triage entry, so `gateMaintenance()` dispatches a repair. `scriptedAgent` returns `completed`; the edge then only records the terminus and does not run the gate, so `/unused` paths are safe. If `HistoryEntry` is not yet imported as a type in `surface.test.ts`, it already is (`import type { …, HistoryEntry, … } from "./schema.js"`).

- [ ] **Step 3: Write the failing prompt tests**

In `src/prompt-assembly.test.ts`, add `GATE_ERROR_EVIDENCE` to the imports:

```ts
import { GATE_ERROR_EVIDENCE } from "./escalation-packet.js";
```

Inside `describe("the triage prompt's setback slot", …)`, add:

```ts
  it("says a gate error left nothing to read, rather than pointing at gate evidence that is not there", async () => {
    await appendEntry(dir, { t: "gate", attempt: 1, status: "ERROR", newFailures: [], class: "error" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));
    const setback = prompt.slice(prompt.indexOf("## Setback"), prompt.indexOf("## Reply format"));
    expect(setback).toContain("Trigger: gate_error");
    expect(setback).toContain(GATE_ERROR_EVIDENCE);
    expect(setback).not.toContain("listed under Gate evidence above");
  });
```

In `src/triage-role-config.test.ts`, next to the existing `toContain("hypothesis")` assertion, add:

```ts
    expect(triageRoleConfig.systemPromptFragment).toContain("fix_the_gate");
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/triage.test.ts -t "once rechecks are spent"`
Expected: FAIL. `needsJudgement` returns `false` for `gate_error`, so the router answers and `agent.calls` is `[]`.

Run: `npx vitest run src/surface.test.ts -t "repair session its brief"`
Expected: FAIL. `triageKeys` is `[]`, and the repair dispatch has no `briefRef`.

Run: `npx vitest run src/prompt-assembly.test.ts -t "gate error left nothing"`
Expected: FAIL. `GATE_ERROR_EVIDENCE` is not exported.

Run: `npx vitest run src/triage-role-config.test.ts`
Expected: FAIL on the new `fix_the_gate` assertion.

(`"gives a deterministic repair no brief …"` passes already; it guards the Step 6 change against a stale-brief regression.)

- [ ] **Step 5: Engage the agent for a gate error once rechecks are spent**

In `src/triage.ts`, in `needsJudgement`, replace

```ts
    case "gate_error":
      return false;
```

with

```ts
    case "gate_error":
      // Rechecks are free and need no judgement; once they are spent, whether
      // a repair is worth dispatching is a decision, while one can be paid for.
      return left(b.gateError) <= 0 && left(b.gateMaintenance) > 0;
```

- [ ] **Step 6: Thread the repair brief to the repair dispatch**

In `src/surface.ts`, replace `currentBriefRef` and its doc comment with:

```ts
/** The triage verdict that starts a session of each role, and so may carry its brief. */
const BRIEFING_VERDICT = { worker: "reroute", "gate-maintenance": "fix_the_gate" } as const;

/**
 * The ref holding the brief for the session about to be dispatched, or undefined.
 *
 * Every worker attempt after the first was started by a `reroute`, and every
 * post-task repair by a `fix_the_gate`; the latest such entry is the one that
 * started the current session. Its ref carries an artefact only when an agent
 * wrote a brief, so a deterministic verdict's session dispatches with none,
 * never with an earlier round's. A pre-task repair has no triage entry at all.
 * Derived from the log, so a first dispatch, a retry and a resumed run agree.
 */
async function currentBriefRef(
  dir: string,
  history: HistoryEntry[],
  role: "worker" | "gate-maintenance",
): Promise<string | undefined> {
  const start = history.findLast((e) => e.t === "triage" && e.verdict === BRIEFING_VERDICT[role]);
  if (start?.t !== "triage") return undefined;
  const ref = await readRef(dir, start.artifactRef);
  return BriefRef.safeParse(ref).success ? start.artifactRef : undefined;
}
```

In `dispatchSession`, replace

```ts
  const briefRef = role === "worker" ? await currentBriefRef(dir, caseFile.history) : undefined;
```

with

```ts
  const briefRef = await currentBriefRef(dir, caseFile.history, role);
```

`GateRepairBrief` is `SharpenedBrief`, so `BriefRef` validates it, and `resolveEvidence` already renders it into the repair prompt's `## Brief` slot.

- [ ] **Step 7: Tell triage what a gate error is**

In `src/escalation-packet.ts`, change

```ts
const GATE_ERROR_EVIDENCE = "The gate could not run to completion; its error output is not kept in the case file.";
```

to

```ts
export const GATE_ERROR_EVIDENCE = "The gate could not run to completion; its error output is not kept in the case file.";
```

In `src/prompt-assembly.ts`, add the import:

```ts
import { GATE_ERROR_EVIDENCE } from "./escalation-packet.js";
```

change the `PromptSetback.detail` doc line to:

```ts
  /** The worker's escalate rationale, the close report's detail, or the gate-error sentence; null for a gate failure. */
```

and in `resolveSetback`, after the `if (tail?.t === "terminus") detail = tail.rationale;` line, add:

```ts
  if (tail?.t === "gate" && tail.status === "ERROR") detail = GATE_ERROR_EVIDENCE;
```

(`escalation-packet.ts` imports `case-file.ts`, `schema.ts`, `ports.ts` types and `triage-role-config.ts` types, and none of them imports `prompt-assembly.ts`, so this adds no cycle.)

In `src/triage-role-config.ts`, in `systemPromptFragment`, insert after the line `"attempts tried and why each missed, what to touch and what to leave.",`:

```ts
    "On fix_the_gate, write the brief for the repair session: what the gate could not do and",
    "what in the environment to repair. The repair session never edits the checks themselves.",
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/triage.test.ts src/prompt-assembly.test.ts src/triage-role-config.test.ts src/escalation-packet.test.ts`
Expected: PASS. The gate-maintenance "renders … exactly as before" prompt test in `prompt-assembly.test.ts` still passes: it has no `fix_the_gate` entry, so the brief slot keeps its no-brief sentence.

Run: `npx vitest run src/surface.test.ts -t "triage by agent"`
Expected: PASS.

Run: `npx vitest run src/surface.test.ts -t "TRIAGE"`
Expected: PASS. Those tests use the deterministic router, whose `fix_the_gate` refs carry no artefact, so their repair dispatches still carry no `briefRef`.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/triage.ts src/surface.ts src/escalation-packet.ts src/prompt-assembly.ts src/triage-role-config.ts \
  src/triage.test.ts src/surface.test.ts src/prompt-assembly.test.ts src/triage-role-config.test.ts
git commit -m "Let triage decide on a gate repair and brief the repair session

Once the free rechecks are spent, whether a repair session is worth its
cost is a real decision, so the triage agent is asked while a repair can
still be paid for. The brief it writes now reaches the repair session
through the same brief slot a retried worker already reads, and triage's
own prompt states that the gate could not run instead of pointing at
evidence that does not exist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: A Triage chapter an extender can follow without reading the source

**Files:**
- Modify: `docs/configuring-a-role.md`

**Interfaces:**
- Consumes (all from `./src/index.js`): `create`, `invoke`, `triageRoleConfig`, `TriageEnvelope`, `createAgentPort`, `createAgentTriage`, `run`, `noopCloser`, `workerRoleConfig`, `gateMaintenanceRoleConfig`. `invoke(roleCfg: RoleConfig<E>, ctx, session?)` returns `Promise<E | Incomplete>`, so with `triageRoleConfig` the result is typed `TriageEnvelope | Incomplete`.
- Produces: documentation only.

The existing UAT `tests/agent-invocation-primitive/3-…test.ts` asserts that the guide contains `role: "worker"`, `role: "gate-maintenance"`, `workerRoleConfig`, `gateMaintenanceRoleConfig`, `import { WorkerEnvelope, type RoleConfig } from "./src/index.js"`, `await invoke(`, `npm run demo:agent-slice-1` and `npm run demo:agent-slice-3`. Keep every one of those strings.

- [ ] **Step 1: Update the intro and the four-field table**

Replace the first paragraph:

```markdown
This guide gets you from nothing to a first successful agent invocation for any
of the three roles the harness ships: the **worker**, **gate-maintenance** and
**triage**. You do not need to read any source to follow it.
```

In the four-field table, replace the `role` and `envelopeSchema` rows with:

```markdown
| `role` | `"worker"`, `"gate-maintenance"` or `"triage"` | Rejected before any session starts |
| `envelopeSchema` | The reply shape the agent must end with. Use `WorkerEnvelope` for the worker and gate-maintenance, and `TriageEnvelope` for triage. | Rejected before any session starts |
```

- [ ] **Step 2: Append the Triage chapter**

Append to the end of `docs/configuring-a-role.md`:

````markdown
## Triage

Triage decides what happens after a setback: the gate failed, the gate could not
run, the worker gave up, or the close failed. It reads; it never edits. It is the
same kind of role as the other two: one configuration, the same `invoke`.

### The reference configuration

```ts
import { TriageEnvelope, READ_ONLY_TOOLS, type RoleConfig } from "./src/index.js";

export const myTriage: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: [
    "You are triage on a gated delivery harness: a read-only classifier.",
    "Read the setback, the remaining budgets and what earlier rounds decided, then choose what happens next.",
    "Your diagnosis is a hypothesis for the next session to test, not an established fact.",
  ].join("\n"),
  envelopeSchema: TriageEnvelope,
  allowedTools: [...READ_ONLY_TOOLS], // Read, Glob, Grep
};
```

It is also exported ready-made as `triageRoleConfig`.

**Triage's tool list is read-only by design. It is not a setting to widen.**
Triage must never change the thing it is judging: the gate is the only proof
that work is good, and a triage session that could edit the worktree could make
a failure disappear rather than explain it. Change the sentences if you like;
keep the tools to `Read`, `Glob` and `Grep`.

### When triage is asked

The harness only calls the triage agent when its answer can change what
happens. Every other setback is settled by a fixed rule, at no cost:

| Setback | The agent is asked when | Otherwise |
|---|---|---|
| The worker lacked authority | never | escalate to a person |
| The worker is stuck | a correction slot is left | escalate once none is left |
| The gate failed | exactly one correction slot is left | retry the worker while more are left; escalate at none |
| The close failed | exactly one close slot is left | retry the close while more are left; escalate at none |
| The gate could not run | gate rechecks are used up and a gate repair slot is left | re-run the gate free while rechecks are left; escalate when both are used up |

### What comes back

`invoke(triageRoleConfig, …)` returns a typed verdict. Which verdicts are
allowed depends on the setback. An answer that is not allowed is escalated
rather than acted on.

| `status` | Allowed after | `payload` |
|---|---|---|
| `reroute` | the gate failed, the worker is stuck | a brief for the next worker: `problem`, `dead_ends`, `scope`, `references`, `diagnosis` |
| `fix_the_gate` | the gate could not run | the same brief shape, for the repair session |
| `retry_close` | the close failed | the same brief shape, kept in the case file |
| `escalate` | any setback | a packet for a person: `decision`, `evidence`, `dead_ends`, `why_now`, `references` |
| `abort` | any setback | `{ reason }` |
| `incomplete` | (the harness's own verdict) | none: the session produced nothing usable, and the harness escalates rather than guessing |

### Your first triage invocation

Offline, with `claude-mock` (see "Trying it offline" above). Write the reply the
mock should give to `/tmp/my-triage/mock.json`:

```json
[
  {
    "json": {
      "status": "reroute",
      "rationale": "Worth one more attempt with a sharper brief.",
      "payload": {
        "problem": "The greeting still says hi.",
        "dead_ends": "Attempt 1 edited the template; the text comes from translations.json.",
        "scope": "Touch translations.json only.",
        "references": ["worker-1-0"],
        "diagnosis": "The template reads its greeting from translations.json."
      }
    }
  }
]
```

Then, from the repository root, save the following as `first-triage.ts` and run
it with `npx tsx first-triage.ts`:

```ts
import { mkdirSync } from "node:fs";
import { create, invoke, triageRoleConfig } from "./src/index.js";

const dir = "/tmp/my-triage/case";
const worktreePath = "/tmp/my-triage/tree";
mkdirSync(dir, { recursive: true });
mkdirSync(worktreePath, { recursive: true });

await create(
  dir,
  {
    surfaceId: "my-first-triage",
    taskDef: { intent: "make the greeting say hello" },
    gateRef: { type: "command", command: "npm test", parseMode: "tap" },
  },
  {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  },
);

const verdict = await invoke(
  triageRoleConfig,
  { worktreePath, dir, sessionKey: "triage-0" },
  {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: "/tmp/my-triage/mock.json" },
  },
);

if (verdict.status === "reroute") {
  console.log("Retry, and tell the next worker:", verdict.payload.dead_ends);
} else {
  console.log(verdict.status, verdict.rationale);
}
```

`verdict` is typed: inside the `reroute` branch your editor knows `payload` is a
brief. The script prints
`Retry, and tell the next worker: Attempt 1 edited the template; the text comes from translations.json.`
Without the third argument, `invoke` uses the real `claude` command.

### Wiring triage into a run

A run takes one agent port for every role, and a triage port built from it:

```ts
import {
  createAgentPort, createAgentTriage, noopCloser, run,
  workerRoleConfig, gateMaintenanceRoleConfig, triageRoleConfig,
} from "./src/index.js";

const agent = createAgentPort({
  worker: workerRoleConfig,
  "gate-maintenance": gateMaintenanceRoleConfig,
  triage: triageRoleConfig,
});
const ports = { agent, triage: createAgentTriage(agent), closer: noopCloser };

const { state, outcome } = await run(dir, { repoPath: "/path/to/your/repo", worktreePath: "/tmp/my-triage/run-tree" }, ports);
```

Pass `deterministicRouter` as `triage` instead to run with the fixed rules alone
and never call the agent. Every run then retries and escalates exactly as the
"Otherwise" column above says.

To watch triage being asked only on the last slot, and a flaky gate recovering
on a free recheck, run:

```bash
npm run demo:triage-slice-3
```

The mock does not enforce `allowedTools`, so it cannot show triage being refused
a write. That guarantee comes from the real `claude` runtime.
````

- [ ] **Step 3: Check that the guide's example runs as written**

If `claude-mock` is not on `PATH` (`command -v claude-mock`), skip this step and say so in the task report.

Otherwise, create the mock script from the guide's JSON, save the guide's TypeScript block verbatim as `first-triage.ts` at the repository root, run it, then delete the file:

```bash
mkdir -p /tmp/my-triage
# write /tmp/my-triage/mock.json with the guide's JSON block
# write ./first-triage.ts with the guide's TypeScript block, unchanged
npx tsx first-triage.ts
rm first-triage.ts
```

Expected: `Retry, and tell the next worker: Attempt 1 edited the template; the text comes from translations.json.`

Also check the typed claim: `npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 first-triage.ts` before deleting it. Expected: no diagnostics in `first-triage.ts`; inside the `reroute` branch, `verdict.payload.dead_ends` type-checks. This compiles without the project tsconfig, so any diagnostics reported in files under `src/` come from the missing project options: ignore those and judge `first-triage.ts` alone.

Run: `npx vitest run tests/agent-invocation-primitive/3-configure-a-second-role-using-the-same-seam-nothing-rebuilt.test.ts`
Expected: PASS; the strings the earlier guide test asserts are all still present.

Run: `git status --short`
Expected: only `docs/configuring-a-role.md` modified; `first-triage.ts` is gone.

- [ ] **Step 4: Commit**

```bash
git add docs/configuring-a-role.md
git commit -m "Add a Triage chapter to the configuring-a-role guide

An extender wiring triage should get from nothing to a typed verdict
without reading the harness source, and should know that triage's tools
are read-only by design rather than a knob to widen. The chapter gives
the reference configuration, when triage is asked, what it may answer,
an offline first invocation, and how to wire it into a run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: A demo of triage on the last slot and the free gate recheck

**Files:**
- Create: `demos/triage-slice-3-last-attempt.ts`
- Modify: `package.json` (one script)

**Interfaces:**
- Consumes: `run` (`surface.ts`), `create`, `load`, `readRef` (`case-file.ts`), `createAgentPort` (`agent-invoke.ts`), `createAgentTriage` (`triage.ts`), `triageRoleConfig`, `EscalationPacket` (`triage-role-config.ts`), `workerRoleConfig`, `gateMaintenanceRoleConfig` (`role-config.ts`), `SETBACK_LABELS` (`escalation-packet.ts`), `initTempRepo` (`temp-repo.ts`), `isOnPath` (`on-path.ts`), `noopCloser` (`ports.ts`).
- Produces: `npm run demo:triage-slice-3`.

- [ ] **Step 1: Write the demo**

Create `demos/triage-slice-3-last-attempt.ts`:

```ts
/**
 * UAT demo for Triage and Deterministic Router Slice 3: Triage Judges the Last
 * Attempt and Rechecks Broken Gates for Free.
 *
 * Four surfaces:
 *   1. A worker whose change keeps failing the gate, down to its last
 *      correction slot, where the triage agent chooses one more retry.
 *   2. The same, where the triage agent chooses to escalate instead.
 *   3. A gate that errors once and passes on its free recheck.
 *   4. A gate that keeps erroring: rechecked, then triage sends a repair
 *      session that receives its brief.
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed. `claude-mock` does not enforce a role's tool
 * list, so this demo shows nothing about triage's read-only authority.
 *
 * Usage: npm run demo:triage-slice-3
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../src/surface.js";
import { create, load, readRef } from "../src/case-file.js";
import { createAgentPort } from "../src/agent-invoke.js";
import { createAgentTriage } from "../src/triage.js";
import { triageRoleConfig, EscalationPacket } from "../src/triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { SETBACK_LABELS } from "../src/escalation-packet.js";
import { initTempRepo } from "../src/temp-repo.js";
import { isOnPath } from "../src/on-path.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, TriageInput } from "../src/ports.js";
import type { BudgetSet, GateRef, HistoryEntry } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
/** Errors on the first check after the worker drops a `.flaky` marker, then reads report.tap as usual. */
const flakyGate: GateRef = { type: "command", command: "if [ -f .flaky ]; then rm .flaky; else cat report.tap; fi", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

const brief = {
  problem: "Beta still fails: the greeting says hi.",
  dead_ends: "Attempts 1 and 2 both edited the template; the greeting comes from translations.json.",
  scope: "Change translations.json only.",
  references: ["worker-1-0", "worker-2-0"],
  diagnosis: "The template reads its greeting from translations.json.",
};

const packet = {
  decision: "Two attempts have regressed the same assertion in the same way. Decide whether to amend the task or take it on yourself.",
  evidence: "2: not ok 2 - beta",
  dead_ends: "Attempts 1 and 2 both edited the template and broke beta.",
  why_now: "One correction slot is left, and nothing suggests a third attempt would try anything new.",
  references: ["worker-1-0", "worker-2-0"],
};

const repairBrief = {
  problem: "The gate cannot run: report.tap is empty, so there is no test output to read.",
  dead_ends: "A free recheck found the report still empty; nothing has been repaired yet.",
  scope: "Regenerate report.tap. Never edit the checks themselves.",
  references: ["worker-1-0"],
  diagnosis: "The worker's change truncated the generated report.",
};

function requireMock(): void {
  if (isOnPath("claude-mock")) return;
  console.error(
    "claude-mock is not on PATH.\n\n" +
      "It is a scripted fake `claude` binary from a sibling project, deliberately not\n" +
      "vendored into this repo. Install it with `npm link` from its own checkout, then\n" +
      "run this demo again. Nothing here calls a live API.",
  );
  process.exit(1);
}

interface Scenario {
  script: unknown[];
  budgets?: Partial<BudgetSet>;
  gateRef?: GateRef;
}

interface Ran {
  state: string;
  history: HistoryEntry[];
  /** The session keys of the triage rounds the agent was actually asked about. */
  agentRounds: Set<string>;
  /** Every prompt the mock matched, in order. */
  prompts: string[];
  packet?: EscalationPacket;
}

function sentPrompts(journal: string): string[] {
  if (!fs.existsSync(journal)) return [];
  return fs.readFileSync(journal, "utf-8").split("\n").filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { event: string; prompt?: string })
    .filter((e) => e.event === "matched").map((e) => e.prompt ?? "");
}

/** Run one surface to its end with the agent-backed triage port, and record who decided each round. */
async function runSurface(name: string, scenario: Scenario): Promise<Ran> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `triage-demo-${name}-`));
  const dir = path.join(scratch, "case");
  fs.mkdirSync(dir);
  await create(
    dir,
    { surfaceId: name, taskDef: { intent: "make the greeting say hello" }, gateRef: scenario.gateRef ?? gateRef },
    { ...budgets, ...scenario.budgets },
  );
  const repoPath = initTempRepo(`triage-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const location = { repoPath, worktreePath: path.join(scratch, "wt") };

  const scriptPath = path.join(scratch, "mock.json");
  const journal = path.join(scratch, "journal.jsonl");
  fs.writeFileSync(scriptPath, JSON.stringify(scenario.script), "utf-8");
  const inner = createAgentPort(configs, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journal },
  });
  const agentRounds = new Set<string>();
  const agent: AgentPort = {
    invoke: ((roleCfg, ctx) => {
      if (roleCfg.role === "triage") agentRounds.add(ctx.sessionKey);
      return inner.invoke(roleCfg, ctx);
    }) as AgentPort["invoke"],
  };

  const result = await run(dir, location, { agent, triage: createAgentTriage(agent), closer: noopCloser });
  const { history } = await load(dir);
  const packetRef = result.outcome?.packetRef;
  const parsed = packetRef ? EscalationPacket.safeParse(await readRef(dir, packetRef)) : undefined;
  return {
    state: result.state,
    history,
    agentRounds,
    prompts: sentPrompts(journal),
    ...(parsed?.success ? { packet: parsed.data } : {}),
  };
}

const indent = (text: string, by: number) => text.split("\n").map((l) => `${" ".repeat(by)}${l}`).join("\n");

function printRounds(r: Ran): void {
  const rounds = r.history.flatMap((e) => (e.t === "triage" ? [e] : []));
  if (rounds.length === 0) console.log("   No triage round was needed.");
  rounds.forEach((e, i) => {
    const by = r.agentRounds.has(`triage-${i}`) ? "the triage agent decided" : "the lookup table decided, no agent call";
    const setback = SETBACK_LABELS[e.trigger as TriageInput["trigger"]];
    console.log(`   Round ${i + 1}: after ${setback} -> ${e.verdict} (${by})`);
  });
}

function printCounts(r: Ran): void {
  const sessions = (role: "worker" | "gate-maintenance") =>
    r.history.filter((e) => e.t === "dispatch" && (e.role ?? "worker") === role).length;
  const gates = r.history.flatMap((e) => (e.t === "gate" ? [e.status] : []));
  console.log(`   Gate runs: ${gates.join(", ")}`);
  console.log(`   Worker sessions: ${sessions("worker")}; repair sessions: ${sessions("gate-maintenance")}; triage agent calls: ${r.agentRounds.size}`);
  console.log(`   Surface finished: ${r.state}\n`);
}

async function main(): Promise<void> {
  requireMock();

  // Each session re-reads the whole script, so expectations are routed by prompt
  // content. Only triage's prompt has a Setback slot, so it is matched first;
  // only a briefed session's prompt contains that brief's dead ends.
  const lastSlot = (triageReply: unknown): Scenario => ({
    budgets: { correction: { used: 0, max: 2 } },
    script: [
      { when: { promptContains: "## Setback" }, json: triageReply },
      { when: { promptContains: brief.dead_ends }, effects: [{ write: { path: "report.tap", content: PASSING_TAP } }], json: { status: "completed", rationale: "Changed the greeting in translations.json." } },
      { effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "Changed the greeting template." } },
    ],
  });

  console.log("1. The last correction slot: the triage agent chooses one more retry");
  console.log("   (correction budget 2: the first failure has two slots left, the second has one)");
  const retried = await runSurface("last-slot-retry", lastSlot({
    status: "reroute", rationale: "One slot left, and the brief names a fix neither attempt tried.", payload: brief,
  }));
  printRounds(retried);
  printCounts(retried);

  console.log("2. The last correction slot: the triage agent chooses to escalate");
  const escalated = await runSurface("last-slot-escalate", lastSlot({
    status: "escalate", rationale: "A third attempt would repeat the first two.", payload: packet,
  }));
  printRounds(escalated);
  console.log(`   Decision put to a person:\n${indent(escalated.packet?.decision ?? "NO ESCALATION PACKET WAS STORED", 6)}`);
  printCounts(escalated);

  console.log("3. A gate that errors once, then passes on its free recheck");
  const flaky = await runSurface("flaky-gate", {
    gateRef: flakyGate,
    script: [
      { effects: [{ write: { path: ".flaky", content: "" } }], json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  });
  printRounds(flaky);
  printCounts(flaky);

  console.log("4. A gate that keeps erroring: rechecked, then repaired with triage's brief");
  console.log("   (gate recheck budget 1: one free recheck, then triage decides on a repair)");
  const broken = await runSurface("broken-gate", {
    budgets: { gateError: { used: 0, max: 1 } },
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "fix_the_gate", rationale: "The report is gone; a repair can regenerate it.", payload: repairBrief } },
      { when: { promptContains: repairBrief.dead_ends }, effects: [{ write: { path: "report.tap", content: PASSING_TAP } }], json: { status: "completed", rationale: "Regenerated report.tap." } },
      { effects: [{ write: { path: "report.tap", content: "" } }], json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  });
  printRounds(broken);
  const repairPrompt = broken.prompts.find((p) => p.includes(repairBrief.dead_ends)) ?? "";
  const briefSlot = repairPrompt.slice(repairPrompt.indexOf("## Brief"), repairPrompt.indexOf("## Gate evidence")).trim();
  console.log(`   The repair session's Brief:\n${indent(briefSlot || "THE REPAIR SESSION RECEIVED NO BRIEF", 6)}`);
  printCounts(broken);

  console.log("5. What this shows");
  console.log(
    "   Triage was asked only where its answer could change the outcome: on the last\n" +
      "   correction slot, where it chose once to retry with a brief and once to escalate,\n" +
      "   and on a gate error once its free recheck was spent. Every earlier round was\n" +
      "   settled by the lookup table with no agent call. The flaky gate recovered on its\n" +
      "   free recheck with no agent and no repair session. The broken gate's repair\n" +
      "   session received triage's brief.\n" +
      "   Note: claude-mock does not enforce a role's tool list; triage's read-only authority\n" +
      "   is proven by unit tests and, live, by the real agent runtime.",
  );
}

await main();
```

- [ ] **Step 2: Add the npm script**

In `package.json`, after the `"demo:triage-slice-2"` line, add:

```json
    "demo:triage-slice-3": "npx tsx demos/triage-slice-3-last-attempt.ts",
```

- [ ] **Step 3: Run the demo and check what it prints**

Run: `npm run demo:triage-slice-3`
Expected, when `claude-mock` is on `PATH`, exit status 0 and:
- Section 1: `Round 1: after a gate failure -> reroute (the lookup table decided, no agent call)`, `Round 2: after a gate failure -> reroute (the triage agent decided)`, `Gate runs: FAIL, FAIL, PASS`, `triage agent calls: 1`, `Surface finished: CLOSED`.
- Section 2: round 2 `-> escalate (the triage agent decided)`, the packet's decision printed, `Surface finished: ESCALATED`.
- Section 3: `Round 1: after a gate error -> recheck_gate (the lookup table decided, no agent call)`, `Gate runs: ERROR, PASS`, `repair sessions: 0; triage agent calls: 0`, `Surface finished: CLOSED`.
- Section 4: round 1 `-> recheck_gate (the lookup table decided, …)`, round 2 `-> fix_the_gate (the triage agent decided)`, a Brief block containing `Dead ends: A free recheck found the report still empty`, `repair sessions: 1; triage agent calls: 1`, `Surface finished: CLOSED`.

When `claude-mock` is absent, expected: the `claude-mock is not on PATH` message and exit status 1. Record which case ran in the task report.

If section 3 shows `Gate runs: ERROR, ERROR, …` or section 4's worker gate does not error, the empty-file effect is not producing a TAP parse error. Check `claude-mock`'s `write` effect with empty content before changing any harness code.

Run: `npx eslint demos/triage-slice-3-last-attempt.ts && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add demos/triage-slice-3-last-attempt.ts package.json
git commit -m "Add a demo of triage on the last slot and the free gate recheck

A reviewer should be able to see, from printed output alone, that the
triage agent is asked only where its answer changes the outcome, that a
flaky gate recovers on its free recheck with no agent involved, and that
a broken gate's repair session carries triage's brief.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
