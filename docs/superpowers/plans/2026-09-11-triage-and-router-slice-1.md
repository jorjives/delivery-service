# Triage and Deterministic Router — Slice 1: A Stuck Worker's Retry Is Informed by Triage, Not Re-dispatched Blind

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-10-triage-and-router-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-10-triage-and-router-design.md`

**Goal:** An exhaustion-class worker escalate with correction budget left is judged by a read-only triage agent through the existing invocation seam; a `reroute` verdict's `SharpenedBrief` reaches the next worker's prompt as a labelled `## Brief` beside the verbatim `## Gate evidence`, while plain gate failures keep routing with zero agent calls.

**Architecture:** A new `src/triage-role-config.ts` holds the zod payload schemas, `TriageEnvelope` and `triageRoleConfig`; a new `src/triage.ts` holds `createAgentTriage(agent): TriagePort` (authority pass-through, the fast-path rule, the legal-verdict check and the envelope-to-verdict mapping). `AgentPort.invoke` becomes role-keyed (`RoleTerminusMap`), `invoke()` and `RoleConfig` become generic over their envelope, and a small `createAgentPort(configs, session)` adapter lets a surface drive real (or `claude-mock`) sessions for every role. `surface.ts`'s `triage()` hands the port a `ctx` whose session key is the round's ref key, writes the verdict's artefact into that ref, and every worker dispatch derives its `briefRef` from the log (the latest `reroute` whose ref carries an artefact), so live runs, retries and resumed runs thread the same brief. `assemblePrompt` renders the brief as labelled fields and gains a triage-only `## Setback` slot; worker and gate-maintenance prompts stay byte-identical.

**Tech Stack:** TypeScript (ESM, Node ≥22), `@anthropic-ai/claude-agent-sdk` 0.3.x, zod v4, vitest, `claude-mock` (sibling project, resolved from `PATH`).

## Global Constraints

- Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint` config, `vitest`. **No new dependency of any kind.**
- **Buy-vs-build (Build note):** triage reuses the single invocation seam (`invoke()` in `src/agent-invoke.ts`, reached through `AgentPort.invoke()`), the `RoleConfig` shape, the one prompt assembler (`assemblePrompt`) and the tool-authority guard (`src/tool-authority.ts`, whose logic is not edited). Reply shapes are zod schemas. No second invocation path, no second assembler, no second schema library.
- **Operability/DX (Operational note):** the demo and the mock-gated tests depend on `claude-mock` on `PATH` (a sibling project installed with `npm link`), and the demo says so plainly and exits non-zero when it is absent. Triage mock scripts need no file-editing effects. `claude-mock` does not enforce `allowedTools`: no test, demo line or doc in this slice may claim the mock proves triage cannot write. Triage's read-only authority is proven by unit tests on the config, the validator and the guard; the live guarantee rests on the real SDK.
- **One primitive, roles are configs:** `invoke()` must not branch on `role`.
- **`status` at the SDK boundary, `verdict` in the case file:** `toTriageVerdict` in `src/triage.ts` is the only translation point. `TriageEntry` and `TriageEnvelope` keep their field names.
- **Worker and gate-maintenance prompts are unchanged** byte-for-byte for any case file whose dispatches carry no `briefRef`.
- **Determinism:** triage prompts and session keys are pure functions of the case file. The triage session key is `triage-${priorTriages}`, the same string as the round's ref key.
- **No side effect before the single `TriageEntry` append** except the ref write, which a re-run overwrites at the same key.
- Rationale and prompt text is plain English, never a stack trace or exception message.
- `refusalSentence` and `outsideWorktreeSentence` output must not change; existing UAT tests assert on them.
- Run commands from the worktree root. Targeted tests only: `npx vitest run <file> -t "<name>"`. Typecheck: `npx tsc --noEmit`.

## Scaffolding Impact

- `src/index.ts` public exports: new schemas, config, adapter, triage port and types → Tasks 2, 3, 5.
- `docs/agent-interface.md` "prompt template" block lists five slots; this slice adds a triage-only `## Setback` slot and renders the brief as labelled fields. The block gains one line and a sentence → Task 4.
- `package.json`: new `demo:triage-slice-1` script → Task 7.
- `eslint.config.js`: `allowDefaultProject` currently matches 47 files (2 root, 18 demos, 27 under `tests/`) against a ceiling of 50. The new demo makes 48; the UAT phase will add `tests/triage-and-router/*.ts`, which no glob matches today and which would fail lint. Add that glob and raise the ceiling to 60 → Task 7.
- Stale code comments describing "Item 5" as future work: `src/ports.ts` (`TriagePort` section header, `AgentPort` header) and `src/surface.ts` `triage()` ref comment → Tasks 3 and 6.
- `docs/configuring-a-role.md`: no change. It describes worker and gate-maintenance only, both of which still compile unchanged (`RoleConfig` defaults its type parameter). The Triage chapter is Slice 3's.
- `README.md`, `CONTRIBUTING.md`: none; no new command beyond the demo script, no new env var, no build step.

**Decision recorded (spec deviation, empirically verified):** the spec says existing `AgentPort` call sites need no edit. Call sites are indeed unchanged, but a scratch `tsc --strict` check confirmed that every non-generic fake (`invoke: () => Promise<Terminus>`) stops satisfying the generic `invoke<R>` signature. `src/surface.test.ts` has 12 such fakes; Task 3 routes them all through one local `sessionAgent` helper with a single cast. Demos are not type-checked (`tsconfig.json` includes only `src`), so they stay as they are.

**Also pulled forward from Slice 2, deliberately:** the legal-verdict-per-trigger check. Opening the agent path without it would let a triage agent answer `retry_close` to a worker escalate and send ungated work to `CLOSING`. The check and its escalate rationale are built here (Task 5); Slice 2 adds escalation packets and their tests on top.

**Not in this slice:** `EscalationPacket` synthesis (`buildEscalationPacket`, `withPacket`), last-slot agent engagement for `gate_fail`/`close_failure`, `gate_error` judgement and `recheck_gate`, threading a `GateRepairBrief` to gate maintenance, and the Triage guide chapter.

---

## Task 1: Move setback classification into the log-derivation module

Tidy first. `resolveEvidence` (Task 4) must read the setback from the log tail, and it must not import `surface.ts` to do so. The classification is a pure function of one history entry, exactly like `deriveStateFromEntry`, so it belongs in `case-file.ts`.

**Files:**
- Modify: `src/case-file.ts` (add `setbackOf` beside `deriveStateFromEntry`)
- Modify: `src/case-file.test.ts`
- Modify: `src/surface.ts:508-526` (`triageTrigger` delegates to `setbackOf`)

**Interfaces:**
- Consumes: `HistoryEntry` (`schema.ts`), `TriageInput` type (`ports.ts`).
- Produces: `setbackOf(tail: HistoryEntry | undefined): Setback | undefined` and `type Setback = Pick<TriageInput, "trigger" | "category">`, both exported from `src/case-file.ts`. `triageTrigger(dir, tail)` in `surface.ts` keeps its signature and its throw.

- [ ] **Step 0: Install dependencies (worktree has no `node_modules`)**

Run: `npm ci`
Expected: completes; `node_modules/` is git-ignored, so `git status` stays clean.

- [ ] **Step 1: Write the failing test**

Append to `src/case-file.test.ts` (add `setbackOf` to its existing `./case-file.js` import):

```ts
describe("setbackOf", () => {
  it("classifies a failed gate as gate_fail and an errored gate as gate_error", () => {
    expect(setbackOf({ t: "gate", attempt: 1, status: "FAIL", newFailures: [] })).toEqual({ trigger: "gate_fail" });
    expect(setbackOf({ t: "gate", attempt: 1, status: "ERROR", newFailures: [] })).toEqual({ trigger: "gate_error" });
  });

  it("classifies a close entry as close_failure", () => {
    expect(setbackOf({ t: "close", status: "FAIL", detailRef: "close-0" })).toEqual({ trigger: "close_failure" });
  });

  it("classifies a worker escalate with its category", () => {
    expect(
      setbackOf({ t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate", category: "exhaustion", rationale: "stuck" }),
    ).toEqual({ trigger: "worker_escalate", category: "exhaustion" });
  });

  it("returns undefined for a tail that is not a setback", () => {
    expect(setbackOf(undefined)).toBeUndefined();
    expect(setbackOf({ t: "dispatch", attempt: 1, sessionKey: "worker-1-0" })).toBeUndefined();
    expect(setbackOf({ t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "ok" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/case-file.test.ts -t "setbackOf"`
Expected: FAIL, `setbackOf` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/case-file.ts`, add `import type { TriageInput } from "./ports.js";` and, directly after `deriveStateFromEntry`:

```ts
/** What kind of setback a history entry records, as `TriagePort` names it. */
export type Setback = Pick<TriageInput, "trigger" | "category">;

/**
 * The setback a log tail records, or undefined when the tail is not one.
 * Pure over one entry, like `deriveStateFromEntry`, so the surface routing into
 * TRIAGE and the prompt shown to triage classify the same tail identically.
 */
export function setbackOf(tail: HistoryEntry | undefined): Setback | undefined {
  if (tail?.t === "gate") return { trigger: tail.status === "ERROR" ? "gate_error" : "gate_fail" };
  if (tail?.t === "close") return { trigger: "close_failure" };
  if (tail?.t === "terminus" && tail.status === "escalate") {
    return { trigger: "worker_escalate", category: tail.category };
  }
  return undefined;
}
```

Note: `category` may be `undefined` on an escalate terminus written by an old case file; `toEqual` treats an `undefined` property as absent, matching today's `triageTrigger`.

In `src/surface.ts`, import `setbackOf` from `./case-file.js` and replace the body of `triageTrigger`:

```ts
export function triageTrigger(
  dir: string,
  tail: HistoryEntry | undefined,
): Pick<TriageInput, "trigger" | "category"> {
  const setback = setbackOf(tail);
  if (!setback) throw new IllegalStateTransition(dir, "TRIAGE", "triage");
  return setback;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/case-file.test.ts -t "setbackOf"` then `npx vitest run src/surface.test.ts -t "TRIAGE"`
Expected: PASS for both (the second proves `triageTrigger` behaviour is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/case-file.ts src/case-file.test.ts src/surface.ts
git commit -m "Move setback classification into the log-derivation module

The triage prompt needs to read the setback from the log tail, and the
prompt assembler must not import the surface driver to do it. The
classification is a pure function of one entry, like deriveStateFromEntry,
so it now lives beside it; triageTrigger keeps its throw and delegates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Triage reply shapes, the read-only triage role, and an envelope-generic seam

**Files:**
- Create: `src/triage-role-config.ts`
- Create: `src/triage-role-config.test.ts`
- Modify: `src/role-config.ts` (generic `RoleConfig<E>`, read-only rule in `validateRoleConfig`)
- Modify: `src/role-config.test.ts`
- Modify: `src/agent-invoke.ts` (`invoke<E>`, `incomplete` returns `Incomplete`)
- Modify: `src/tool-authority.ts` (parameter types only: `RoleConfig<unknown>`; `authorityRefusal` returns `Incomplete | undefined`)
- Modify: `src/prompt-assembly.ts` (parameter type only: `RoleConfig<unknown>`)
- Modify: `src/ports.ts` (add `Incomplete` only; the rest of the port widening is Task 3)
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `Terminus` (`ports.ts`), `createToolAuthority` (`tool-authority.ts`).
- Produces:
  - `src/ports.ts`: `export type Incomplete = Extract<Terminus, { status: "incomplete" }>;`
  - `src/role-config.ts`: `interface RoleConfig<E = Envelope> extends RoleHandle { systemPromptFragment: string; envelopeSchema: z.ZodType<E>; allowedTools: string[]; budgets?: Record<string, unknown> }`; `validateRoleConfig(cfg: RoleConfig<unknown>): void`, now also throwing `InvalidRoleConfig("allowedTools", …)` for a `triage` config granting anything outside `READ_ONLY_TOOLS`; `export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"] as const`.
  - `src/triage-role-config.ts`: zod schemas and same-named types `SharpenedBrief`, `GateRepairBrief`, `CloseRepairBrief`, `EscalationPacket`, `TriageEnvelope`; `triageRoleConfig: RoleConfig<TriageEnvelope>`.
  - `src/agent-invoke.ts`: `invoke<E>(roleCfg: RoleConfig<E>, ctx: AgentContext, session?: SessionEnvironment): Promise<E | Incomplete>`.
  - `src/tool-authority.ts`: `authorityRefusal(...): Incomplete | undefined`; other signatures take `RoleConfig<unknown>`.

- [ ] **Step 1: Write the failing tests**

Create `src/triage-role-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SharpenedBrief, EscalationPacket, TriageEnvelope, triageRoleConfig } from "./triage-role-config.js";
import { validateRoleConfig } from "./role-config.js";
import { createToolAuthority } from "./tool-authority.js";

const brief = {
  problem: "the greeting endpoint returns 'hi', and the test expects 'hello'",
  dead_ends: "attempt 1 edited the template, but the string comes from the i18n table",
  scope: "touch src/i18n/en.json only",
  references: ["worker-1-0"],
  diagnosis: "the i18n key was renamed and the fallback is used",
};

const packet = {
  decision: "Decide whether to rename the key or amend the task.",
  evidence: "not ok 2 - beta",
  dead_ends: "attempt 1 edited the template",
  why_now: "worker_escalate (exhaustion), correction 1/3",
  references: ["worker-1-0"],
};

describe("triage reply shapes", () => {
  it("round-trips a sharpened brief", () => {
    expect(SharpenedBrief.parse(brief)).toEqual(brief);
  });

  it("rejects a brief with an empty dead_ends, so a retry can never receive an empty brief", () => {
    expect(SharpenedBrief.safeParse({ ...brief, dead_ends: "" }).success).toBe(false);
  });

  it("has no evidence field on the brief: the gate evidence slot carries it verbatim", () => {
    expect(Object.keys(SharpenedBrief.shape)).not.toContain("evidence");
  });

  it("round-trips an escalation packet", () => {
    expect(EscalationPacket.parse(packet)).toEqual(packet);
  });

  it("accepts each triage status with its own payload", () => {
    for (const reply of [
      { status: "reroute", rationale: "one more try", payload: brief },
      { status: "escalate", rationale: "no fix", payload: packet },
      { status: "fix_the_gate", rationale: "env", payload: brief },
      { status: "retry_close", rationale: "flaky", payload: brief },
      { status: "abort", rationale: "infra", payload: { reason: "disk full" } },
    ]) {
      expect(TriageEnvelope.safeParse(reply).success).toBe(true);
    }
  });

  it("rejects a worker status and a reroute without a brief", () => {
    expect(TriageEnvelope.safeParse({ status: "completed", rationale: "done" }).success).toBe(false);
    expect(TriageEnvelope.safeParse({ status: "reroute", rationale: "again" }).success).toBe(false);
  });

  it("converts to a JSON Schema the SDK can constrain output with", () => {
    expect(() => z.toJSONSchema(TriageEnvelope)).not.toThrow();
  });
});

describe("triageRoleConfig", () => {
  it("is a triage config that passes validation", () => {
    expect(triageRoleConfig.role).toBe("triage");
    expect(() => validateRoleConfig(triageRoleConfig)).not.toThrow();
  });

  it("is given read-only tools and nothing else", () => {
    expect(triageRoleConfig.allowedTools).toEqual(["Read", "Glob", "Grep"]);
  });

  it("is refused every editing or shell tool by the guard, even inside the worktree", async () => {
    const authority = createToolAuthority(triageRoleConfig, "/runs/s-1/tree");
    const options = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    for (const tool of ["Edit", "Write", "Bash", "NotebookEdit"]) {
      const decision = await authority.canUseTool(tool, { file_path: "/runs/s-1/tree/a.txt" }, options);
      expect(decision?.behavior).toBe("deny");
    }
  });

  it("tells the session it is a read-only classifier and that its diagnosis is a hypothesis", () => {
    expect(triageRoleConfig.systemPromptFragment).toContain("read-only");
    expect(triageRoleConfig.systemPromptFragment).toContain("hypothesis");
  });
});
```

Append to `src/role-config.test.ts` (add `READ_ONLY_TOOLS` to its `./role-config.js` import and import `TriageEnvelope` from `./triage-role-config.js`):

```ts
describe("a triage config cannot be configured into editing the worktree", () => {
  it("names allowedTools and the read-only rule when a triage config grants Edit", () => {
    expect(() =>
      validateRoleConfig({
        role: "triage",
        systemPromptFragment: "You classify setbacks.",
        envelopeSchema: TriageEnvelope,
        allowedTools: ["Read", "Edit"],
      }),
    ).toThrow(/allowedTools.*read-only/);
  });

  it("accepts any subset of the read-only tools", () => {
    expect(READ_ONLY_TOOLS).toEqual(["Read", "Glob", "Grep"]);
    expect(() =>
      validateRoleConfig({
        role: "triage",
        systemPromptFragment: "You classify setbacks.",
        envelopeSchema: TriageEnvelope,
        allowedTools: ["Read"],
      }),
    ).not.toThrow();
  });
});
```

(`InvalidRoleConfig`'s message is `Invalid role config: <field> <detail>`, so the regex matches `allowedTools triage is read-only …`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/triage-role-config.test.ts src/role-config.test.ts -t "triage"`
Expected: FAIL, `./triage-role-config.js` does not exist.

- [ ] **Step 3: Write the implementation**

`src/ports.ts`, directly after `Terminus`:

```ts
/** The harness's own verdict on a session that produced nothing usable, for any role. */
export type Incomplete = Extract<Terminus, { status: "incomplete" }>;
```

`src/role-config.ts`:

```ts
export interface RoleConfig<E = Envelope> extends RoleHandle {
  systemPromptFragment: string;
  /** The reply shape this role may emit. Also constrains the SDK's output. */
  envelopeSchema: z.ZodType<E>;
  allowedTools: string[];
  budgets?: Record<string, unknown>;
}

/**
 * The only tools a triage session may be granted. Triage is read-only until its
 * single case-file append; that is what makes a crash mid-triage safe to replay,
 * so the tool list is a property of the role, not a knob to widen.
 */
export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"] as const;
```

Keep the existing doc comments on each field. Change `RoleConfigShape`'s `envelopeSchema` to `z.custom<z.ZodType<unknown>>(...)` and append a refinement:

```ts
const RoleConfigShape = z
  .object({ /* existing fields, envelopeSchema as z.custom<z.ZodType<unknown>> */ })
  .superRefine((cfg, ctx) => {
    if (cfg.role !== "triage") return;
    const writable = cfg.allowedTools.find((tool) => !(READ_ONLY_TOOLS as readonly string[]).includes(tool));
    if (writable === undefined) return;
    ctx.addIssue({
      code: "custom",
      path: ["allowedTools"],
      message: `triage is read-only by design and may use only ${READ_ONLY_TOOLS.join(", ")}, not ${writable}`,
    });
  });

export function validateRoleConfig(cfg: RoleConfig<unknown>): void { /* body unchanged */ }
```

Create `src/triage-role-config.ts`:

```ts
import { z } from "zod";
import { READ_ONLY_TOOLS, type RoleConfig } from "./role-config.js";

/**
 * What a retried session is told: what is failing, what earlier attempts tried
 * and why each missed, what to touch, where to look, and triage's diagnosis.
 * There is deliberately no `evidence` field: the prompt's `## Gate evidence`
 * slot renders the newly-failing assertions verbatim on every dispatch, so the
 * synthesis always arrives beside the ground truth and never replaces it.
 */
export const SharpenedBrief = z.object({
  problem: z.string().min(1),
  dead_ends: z.string().min(1),
  scope: z.string().min(1),
  references: z.array(z.string()),
  diagnosis: z.string().min(1),
});
export type SharpenedBrief = z.infer<typeof SharpenedBrief>;

/** Same job as the brief; the next session is gate maintenance. */
export const GateRepairBrief = SharpenedBrief;
export type GateRepairBrief = SharpenedBrief;

/** Same job as the brief; persisted for the closer. */
export const CloseRepairBrief = SharpenedBrief;
export type CloseRepairBrief = SharpenedBrief;

/** What a human reads at ESCALATED. Carries evidence: a human has no gate-evidence slot. */
export const EscalationPacket = z.object({
  decision: z.string().min(1),
  evidence: z.string().min(1),
  dead_ends: z.string().min(1),
  why_now: z.string().min(1),
  references: z.array(z.string()),
});
export type EscalationPacket = z.infer<typeof EscalationPacket>;

/**
 * A valid reply from a triage session. Uses the universal envelope field
 * `status`; the case file's `TriageEntry` calls it `verdict`, and
 * `toTriageVerdict` in `triage.ts` is the only place that translates.
 */
export const TriageEnvelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reroute"), rationale: z.string().min(1), payload: SharpenedBrief }),
  z.object({ status: z.literal("escalate"), rationale: z.string().min(1), payload: EscalationPacket }),
  z.object({ status: z.literal("fix_the_gate"), rationale: z.string().min(1), payload: GateRepairBrief }),
  z.object({ status: z.literal("retry_close"), rationale: z.string().min(1), payload: CloseRepairBrief }),
  z.object({ status: z.literal("abort"), rationale: z.string().min(1), payload: z.object({ reason: z.string().min(1) }) }),
]);
export type TriageEnvelope = z.infer<typeof TriageEnvelope>;

/** The reference triage configuration: a read-only classifier. */
export const triageRoleConfig: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: [
    "You are triage on a gated delivery harness: a read-only classifier.",
    "A worker, the gate, or the closer has hit a setback. Read the setback, the remaining",
    "budgets, and what earlier rounds decided, then choose what happens next.",
    "You never edit anything. You never overturn a passing gate or a worker's report that it",
    "lacked authority.",
    "On a reroute, write a brief the next worker cannot derive for itself: what earlier",
    "attempts tried and why each missed, what to touch and what to leave.",
    "Your diagnosis is a hypothesis for the next session to test, not an established fact.",
  ].join("\n"),
  envelopeSchema: TriageEnvelope,
  allowedTools: [...READ_ONLY_TOOLS],
};
```

`src/agent-invoke.ts`:

```ts
import type { AgentContext, Incomplete } from "./ports.js";

function incomplete(roleCfg: RoleConfig<unknown>, reason: string): Incomplete {
  return { status: "incomplete", rationale: `${roleCfg.role} session did not complete: ${reason}` };
}

export function buildSessionOptions(roleCfg: RoleConfig<unknown>, /* rest unchanged */): Options { /* unchanged */ }

export async function invoke<E>(
  roleCfg: RoleConfig<E>,
  ctx: AgentContext,
  session: SessionEnvironment = {},
): Promise<E | Incomplete> {
  /* body unchanged; the final line stays `return envelope.data;`, now typed E */
}
```

Update the doc comment above `invoke` from "returns as a `Terminus`" to "returns as the role's envelope or an incomplete terminus".

`src/tool-authority.ts`: change every `roleCfg: RoleConfig` parameter to `roleCfg: RoleConfig<unknown>`, and `authorityRefusal`'s return type from `Terminus | undefined` to `Incomplete | undefined` (import `Incomplete` instead of `Terminus`). No logic change.

`src/prompt-assembly.ts`: `assemblePrompt(caseFile: CaseFile, roleCfg: RoleConfig<unknown>, evidence: PromptEvidence)`. No logic change in this task.

`src/index.ts`: add

```ts
export { SharpenedBrief, GateRepairBrief, CloseRepairBrief, EscalationPacket, TriageEnvelope, triageRoleConfig } from "./triage-role-config.js";
export { READ_ONLY_TOOLS } from "./role-config.js";
```

and add `Incomplete` to the `./ports.js` type export list.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/triage-role-config.test.ts src/role-config.test.ts src/tool-authority.test.ts src/agent-invoke.test.ts` then `npx tsc --noEmit`
Expected: PASS; typecheck clean (proves worker and gate-maintenance configs compile unchanged with the defaulted parameter).

- [ ] **Step 5: Commit**

```bash
git add src/triage-role-config.ts src/triage-role-config.test.ts src/role-config.ts src/role-config.test.ts src/agent-invoke.ts src/tool-authority.ts src/prompt-assembly.ts src/ports.ts src/index.ts
git commit -m "Add the read-only triage role and its reply shapes

Triage needs its own envelope (reroute, escalate, fix_the_gate,
retry_close, abort, each with a payload) through the same invoke() seam as
every role, so RoleConfig and invoke() become generic over the envelope
with a default that leaves the worker and gate-maintenance configs
untouched. validateRoleConfig refuses a triage config that grants any tool
beyond Read, Glob and Grep: triage's read-only role is what makes a crash
mid-triage safe to replay, so it is not left as a knob.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: A role-keyed agent port, and an adapter that runs real sessions for every role

**Files:**
- Modify: `src/ports.ts` (`TriageTerminus`, `RoleTerminusMap`, generic `AgentPort`, `TriageInput.ctx`, `TriageVerdict.artifact`, `TriageArtifact`; refresh the two "Item N supplies" section comments)
- Modify: `src/agent-invoke.ts` (add `RoleConfigs`, `createAgentPort`)
- Modify: `src/agent-invoke.test.ts`
- Modify: `src/surface.ts` (`triage()` builds `ctx`; nothing else)
- Modify: `src/surface.test.ts` (route the 12 fakes through `sessionAgent`)
- Modify: `src/router.test.ts` (router inputs gain `ctx`)
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `Incomplete` (`ports.ts`), `TriageEnvelope`/`SharpenedBrief`/`EscalationPacket` types (`triage-role-config.ts`), `invoke<E>` (`agent-invoke.ts`).
- Produces (`src/ports.ts`):

```ts
import type { EscalationPacket, SharpenedBrief, TriageEnvelope } from "./triage-role-config.js";

export type TriageTerminus = TriageEnvelope | Incomplete;

export interface RoleTerminusMap {
  worker: Terminus;
  "gate-maintenance": Terminus;
  triage: TriageTerminus;
}

export interface AgentPort {
  invoke<R extends AgentRole>(roleCfg: RoleHandle & { role: R }, ctx: AgentContext): Promise<RoleTerminusMap[R]>;
}

export interface TriageInput {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure";
  category?: "exhaustion" | "authority";
  caseFile: CaseFile;
  remainingBudgets: BudgetSet;
  /** What an agent-backed port needs to invoke triage; the deterministic router ignores it. */
  ctx: AgentContext;
}

export type TriageArtifact = SharpenedBrief | EscalationPacket | { reason: string };

export interface TriageVerdict {
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort";
  rationale: string;
  /** In memory only: what the surface writes into the round's ref. Never set by the deterministic router. */
  artifact?: TriageArtifact;
}
```

- Produces (`src/agent-invoke.ts`):

```ts
export interface RoleConfigs {
  worker: RoleConfig;
  "gate-maintenance": RoleConfig;
  triage: RoleConfig<TriageEnvelope>;
}
export function createAgentPort(configs: RoleConfigs, session?: SessionEnvironment): AgentPort;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/agent-invoke.test.ts` (import `createAgentPort`; import `triageRoleConfig`, `TriageEnvelope` from `./triage-role-config.js`; import `InvalidRoleConfig` from `./errors.js`):

```ts
const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

describe("createAgentPort", () => {
  it("refuses a triage config that grants an editing tool before any session is spawned", async () => {
    const port = createAgentPort({
      ...configs,
      triage: { ...triageRoleConfig, allowedTools: ["Read", "Write"] },
    });
    await expect(port.invoke({ role: "triage" }, { ...ctx, sessionKey: "triage-0" })).rejects.toThrow(InvalidRoleConfig);
  });
});

describe.skipIf(!hasMock)("createAgentPort against a scripted session", () => {
  it("runs each role with its own config through the one invoke seam", async () => {
    await script([
      // claude-mock matches the user turn only; the literal "reroute" appears in the
      // triage envelope schema rendered there, and in no worker prompt.
      { when: { promptContains: "\"reroute\"" }, json: {
        status: "reroute",
        rationale: "one more attempt is worth it",
        payload: { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "h" },
      } },
      { json: { status: "completed", rationale: "done" } },
    ]);
    const port = createAgentPort(configs, useMock());

    const triaged = await port.invoke({ role: "triage" }, { ...ctx, sessionKey: "triage-0" });
    expect(triaged.status).toBe("reroute");
    expect(TriageEnvelope.safeParse(triaged).success).toBe(true);

    const worked = await port.invoke({ role: "worker" }, ctx);
    expect(worked).toEqual({ status: "completed", rationale: "done" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agent-invoke.test.ts -t "createAgentPort"`
Expected: FAIL, `createAgentPort` is not exported.

- [ ] **Step 3: Write the implementation**

Apply the `src/ports.ts` interface block above. Replace the comment `// --- AgentPort (Item 4 supplies the real, SDK-backed implementation) ---` with `// --- AgentPort (createAgentPort in agent-invoke.ts is the SDK-backed implementation) ---` and `// --- TriagePort (this item ships the deterministic router; Item 5 the agent) ---` with `// --- TriagePort (deterministicRouter in router.ts; createAgentTriage in triage.ts) ---`.

`src/agent-invoke.ts`, append:

```ts
/** The pinned configuration for every role a surface dispatches. */
export interface RoleConfigs {
  worker: RoleConfig;
  "gate-maintenance": RoleConfig;
  triage: RoleConfig<TriageEnvelope>;
}

/**
 * The SDK-backed `AgentPort`: a role name in, that role's pinned config through
 * the one `invoke()` seam, its terminus out. `session` is passed through
 * unchanged, so a test or demo can point every role at `claude-mock`.
 */
export function createAgentPort(configs: RoleConfigs, session: SessionEnvironment = {}): AgentPort {
  // One cast: TypeScript cannot correlate `configs[role]`'s envelope type with
  // RoleTerminusMap[R] across a generic key. RoleConfigs pins that mapping.
  const run = (roleCfg: RoleHandle, ctx: AgentContext) =>
    invoke(configs[roleCfg.role] as RoleConfig<unknown>, ctx, session);
  return { invoke: run as AgentPort["invoke"] };
}
```

Add the needed type imports (`AgentPort`, `RoleHandle` from `./ports.js`; `TriageEnvelope` type from `./triage-role-config.js`).

`src/surface.ts`, in `triage()`: move the `priorTriages` line above the port call and pass `ctx`:

```ts
const priorTriages = caseFile.history.filter((e) => e.t === "triage").length;
const verdict = await ports.triage.triage({
  trigger,
  ...(category ? { category } : {}),
  caseFile,
  remainingBudgets,
  // The session key is the round's ref key: one string per round, derived from
  // the log, so a resumed triage mints the same session it would have run.
  ctx: { worktreePath: worktreeOf(caseFile, location), dir, sessionKey: `triage-${priorTriages}` },
});
```

and delete the now-duplicate `priorTriages` line lower down.

`src/router.test.ts`: every `TriageInput` literal gains `ctx: { worktreePath: "/w", dir: "/d", sessionKey: "triage-0" }` (put it on the file's shared input builder if it has one; otherwise add to each literal).

`src/surface.test.ts`: add near the other fakes, importing `AgentContext`, `AgentPort`, `TriageTerminus` types from `./ports.js`:

```ts
/**
 * Build an agent port from per-role functions. `AgentPort.invoke` is generic
 * over the role, which a plain function cannot satisfy, so the single cast
 * lives here rather than in every fake. A role with no function rejects.
 */
function sessionAgent(
  worker: (role: "worker" | "gate-maintenance", ctx: AgentContext) => Promise<Terminus>,
  triage?: (ctx: AgentContext) => Promise<TriageTerminus>,
): AgentPort {
  const run = (roleCfg: { role: string }, ctx: AgentContext) => {
    if (roleCfg.role === "triage") {
      return triage ? triage(ctx) : Promise.reject(new Error("the triage agent was not expected here"));
    }
    return worker(roleCfg.role as "worker" | "gate-maintenance", ctx);
  };
  return { invoke: run as AgentPort["invoke"] };
}
```

Then convert each of the 12 fakes (lines 31, 47, 246, 566, 675, 732, 786, 855, 890, 926, 1066, 1242 at the time of writing) from `{ invoke: (roleCfg, ctx) => … }` to `sessionAgent((role, ctx) => …)`, replacing `roleCfg.role` with `role` in the bodies. `scriptedAgent` keeps its `calls` array: return `Object.assign(sessionAgent((role, ctx) => { … }), { calls })`. Behaviour of every fake is unchanged.

`src/index.ts`: add `createAgentPort` to the `./agent-invoke.js` export, `RoleConfigs` to its type export, and `Incomplete` (if not already), `TriageTerminus`, `RoleTerminusMap`, `TriageArtifact` to the `./ports.js` type export.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/agent-invoke.test.ts src/router.test.ts src/surface.test.ts` then `npx tsc --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ports.ts src/agent-invoke.ts src/agent-invoke.test.ts src/surface.ts src/surface.test.ts src/router.test.ts src/index.ts
git commit -m "Key AgentPort results by role and add an SDK-backed adapter

Triage returns a different terminus from the worker, so AgentPort.invoke
is now typed per role; worker and gate-maintenance call sites still infer
Terminus. createAgentPort maps each role to its pinned config through the
one invoke() seam, which is what lets a surface drive real or claude-mock
sessions for every role. TRIAGE now hands the port a context whose session
key is the round's ref key, so a resumed round mints the same session.
The generic signature cannot be met by a plain function, so the surface
tests build their fakes through one helper holding the single cast.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The brief is rendered as labelled fields, and triage sees its setback

**Files:**
- Modify: `src/prompt-assembly.ts`
- Modify: `src/prompt-assembly.test.ts`
- Modify: `docs/agent-interface.md` (prompt template block)
- Modify: `src/index.ts` (export `PromptSetback` type)

**Interfaces:**
- Consumes: `setbackOf`, `Setback`, `readRef`, `deriveBudgetsFromLog`, `logTail` (`case-file.ts`); `SharpenedBrief` (`triage-role-config.ts`); `CloseReport` shape (`{ status, detail }`).
- Produces (`src/prompt-assembly.ts`):

```ts
export interface PromptSetback extends Setback {
  /** Log-derived used/max per population at the moment of the setback. */
  budgets: BudgetSet;
  /** The worker's escalate rationale or the close report's detail; null for gate triggers. */
  detail: string | null;
  /** Rationales of every earlier triage round, oldest first. */
  priorRationales: string[];
}

export interface PromptEvidence {
  /** The sharpened brief behind the latest dispatch's briefRef, or null. */
  brief: SharpenedBrief | null;
  newFailures: NewFailure[];
  /** The setback on the log tail, or null when the tail is not one. Rendered for triage only. */
  setback: PromptSetback | null;
}

export const NO_PRIOR_TRIAGE = "No prior triage rounds on this surface.";
```

- [ ] **Step 1: Pin today's worker and gate-maintenance prompts before touching anything**

Append to `src/prompt-assembly.test.ts` (import `gateMaintenanceRoleConfig`):

```ts
describe("worker and gate-maintenance prompts are unchanged by triage", () => {
  it("renders the worker prompt exactly as before", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "exhaustion", rationale: "I am stuck",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toMatchInlineSnapshot();
  });

  it("renders the gate-maintenance prompt exactly as before", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, gateMaintenanceRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toMatchInlineSnapshot();
  });
});
```

Run: `npx vitest run src/prompt-assembly.test.ts -t "unchanged by triage" -u`
Expected: PASS, and vitest writes both inline snapshots from the **current, unmodified** code. Review the written snapshots: they must contain `## Task`, `## Brief` with "No distilled brief", `## Gate evidence`, `## Reply format`, and no `## Setback`. These snapshots are the "unchanged from before this item" requirement; never re-run `-u` on them after Step 3.

- [ ] **Step 2: Write the failing tests for the new behaviour**

Append to `src/prompt-assembly.test.ts` (import `triageRoleConfig` from `./triage-role-config.js`, `NO_PRIOR_TRIAGE` from `./prompt-assembly.js`):

```ts
const sharpened = {
  problem: "the greeting is 'hi', the test wants 'hello'",
  dead_ends: "attempt 1 edited the template, but the string comes from the i18n table",
  scope: "touch src/i18n/en.json only",
  references: ["worker-1-0"],
  diagnosis: "the i18n key was renamed",
};

/** A stuck worker's escalate on attempt 1: the tail triage reads. */
async function stuckWorker(): Promise<void> {
  await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
  await appendEntry(dir, {
    t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
    status: "escalate", category: "exhaustion", rationale: "I cannot find where the greeting comes from",
  });
}

describe("the brief a triage reroute left behind", () => {
  it("renders each field under its own label, with the diagnosis marked as a hypothesis", async () => {
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "retry", artifact: sharpened });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));

    const brief = prompt.slice(prompt.indexOf("## Brief"), prompt.indexOf("## Gate evidence"));
    expect(brief).toContain(`Problem: ${sharpened.problem}`);
    expect(brief).toContain(`Dead ends: ${sharpened.dead_ends}`);
    expect(brief).toContain(`Scope: ${sharpened.scope}`);
    expect(brief).toContain("References: worker-1-0");
    expect(brief).toContain(`Diagnosis (a hypothesis to test, not an established fact): ${sharpened.diagnosis}`);
    expect(prompt.indexOf("## Gate evidence")).toBeGreaterThan(prompt.indexOf("## Brief"));
  });

  it("falls back to the no-brief sentence when the ref carries no artefact (a deterministic reroute)", async () => {
    await writeRef(dir, "triage-0", { trigger: "gate_fail", rationale: "gate_fail: reroute (correction 0/3)" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("No distilled brief");
  });
});

describe("the triage prompt's setback slot", () => {
  it("shows the setback, the remaining budgets and the fixed no-prior-rounds sentence", async () => {
    await stuckWorker();
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));

    const setback = prompt.slice(prompt.indexOf("## Setback"), prompt.indexOf("## Reply format"));
    expect(prompt.indexOf("## Setback")).toBeGreaterThan(prompt.indexOf("## Gate evidence"));
    expect(setback).toContain("Trigger: worker_escalate (exhaustion)");
    expect(setback).toContain("- correction: 0/3");
    expect(setback).toContain("- gateMaintenance: 0/2");
    expect(setback).toContain("I cannot find where the greeting comes from");
    expect(setback).toContain(NO_PRIOR_TRIAGE);
  });

  it("lists earlier triage rationales oldest first", async () => {
    await stuckWorker();
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "first round" });
    await appendEntry(dir, { t: "triage", afterAttempt: 1, trigger: "worker_escalate", verdict: "reroute", rationale: "first round: retry", artifactRef: "triage-0" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" });
    await appendEntry(dir, { t: "gate", attempt: 2, status: "FAIL", newFailures: [] });
    await appendEntry(dir, { t: "triage", afterAttempt: 2, trigger: "gate_fail", verdict: "reroute", rationale: "second round: retry", artifactRef: "triage-1" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 3, sessionKey: "worker-3-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 3, sessionKey: "worker-3-0",
      status: "escalate", category: "exhaustion", rationale: "still stuck",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));

    expect(prompt).not.toContain(NO_PRIOR_TRIAGE);
    expect(prompt.indexOf("- first round: retry")).toBeGreaterThan(-1);
    expect(prompt.indexOf("- second round: retry")).toBeGreaterThan(prompt.indexOf("- first round: retry"));
    expect(prompt).toContain("- correction: 2/3");
  });

  it("shows a close failure's report detail as the setback evidence", async () => {
    await writeRef(dir, "close-0", { status: "FAIL", detail: "merge conflict in src/app.ts" });
    await appendEntry(dir, { t: "close", status: "FAIL", detailRef: "close-0" });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("Trigger: close_failure");
    expect(prompt).toContain("merge conflict in src/app.ts");
  });

  it("assembles the identical triage request twice from the same case file", async () => {
    await stuckWorker();
    const first = assemblePrompt(await load(dir), triageRoleConfig, await resolveEvidence(dir, await load(dir)));
    const second = assemblePrompt(await load(dir), triageRoleConfig, await resolveEvidence(dir, await load(dir)));
    expect(second).toEqual(first);
  });

  it("is never rendered for a worker, even when the tail is a setback", async () => {
    await stuckWorker();
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).not.toContain("## Setback");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/prompt-assembly.test.ts`
Expected: the two snapshot tests PASS; the brief and setback tests FAIL (no labels, no `## Setback`).

- [ ] **Step 4: Write the implementation**

In `src/prompt-assembly.ts` (imports: `deriveBudgetsFromLog`, `logTail`, `readRef`, `setbackOf`, `type Setback` from `./case-file.js`; `SharpenedBrief` from `./triage-role-config.js`; `BudgetSet` type from `./schema.js`), replace the `PromptEvidence` interface with the Produces block above and replace `resolveEvidence`:

```ts
/** The ref shape `surface.ts` writes for an agent-path triage round. */
const BriefRef = z.object({ artifact: SharpenedBrief });
const CloseDetail = z.object({ detail: z.string() });

export async function resolveEvidence(dir: string, caseFile: CaseFile): Promise<PromptEvidence> {
  const history = [...caseFile.history].reverse();

  const gate = history.find((entry) => entry.t === "gate");
  const parsedFailures = await Promise.all(
    (gate?.newFailures ?? []).map((failure) =>
      readRef(dir, failure.detailRef).then((raw) => NewFailure.safeParse(raw)),
    ),
  );
  const newFailures = parsedFailures.flatMap((p) => (p.success ? [p.data] : []));

  // A deterministic reroute's ref has no artefact; that dispatch has no brief.
  const dispatch = history.find((entry) => entry.t === "dispatch");
  const briefRef = dispatch?.briefRef ? BriefRef.safeParse(await readRef(dir, dispatch.briefRef)) : undefined;
  const brief = briefRef?.success ? briefRef.data.artifact : null;

  return { brief, newFailures, setback: await resolveSetback(dir, caseFile) };
}

/** The setback on the log tail, with the evidence and history triage reads. */
async function resolveSetback(dir: string, caseFile: CaseFile): Promise<PromptSetback | null> {
  const tail = logTail(caseFile);
  const setback: Setback | undefined = setbackOf(tail);
  if (!setback) return null;

  let detail: string | null = null;
  if (tail?.t === "terminus") detail = tail.rationale;
  if (tail?.t === "close") {
    const report = CloseDetail.safeParse(await readRef(dir, tail.detailRef));
    detail = report.success ? report.data.detail : null;
  }

  return {
    ...setback,
    budgets: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
    detail,
    priorRationales: caseFile.history.flatMap((e) => (e.t === "triage" ? [e.rationale] : [])),
  };
}
```

In `assemblePrompt`, replace the `brief` constant and the `prompt` array:

```ts
const brief =
  evidence.brief === null
    ? "No distilled brief — work from the task and the gate evidence below."
    : [
        `Problem: ${evidence.brief.problem}`,
        `Dead ends: ${evidence.brief.dead_ends}`,
        `Scope: ${evidence.brief.scope}`,
        `References: ${evidence.brief.references.length === 0 ? "none" : evidence.brief.references.join(", ")}`,
        `Diagnosis (a hypothesis to test, not an established fact): ${evidence.brief.diagnosis}`,
      ].join("\n");

// Triage alone reads the setback; every other role's prompt stays exactly as it was.
const setbackSlot = roleCfg.role === "triage" ? ["## Setback", renderSetback(evidence.setback), ""] : [];

const prompt = [
  "## Task",
  JSON.stringify(caseFile.header.taskDef, null, 2),
  "",
  "## Brief",
  brief,
  "",
  "## Gate evidence",
  gateEvidence,
  "",
  ...setbackSlot,
  "## Reply format",
  envelopeInstruction,
  "",
].join("\n");
```

and add below `assemblePrompt`:

```ts
export const NO_PRIOR_TRIAGE = "No prior triage rounds on this surface.";

/** Fixed population order, so the rendering never depends on object key order. */
const POPULATIONS = ["correction", "gateError", "gateMaintenance", "terminus", "close"] as const;

function renderSetback(setback: PromptSetback | null): string {
  if (setback === null) return "No setback is recorded on the log tail.";
  return [
    `Trigger: ${setback.trigger}${setback.category ? ` (${setback.category})` : ""}`,
    "",
    "Remaining budgets (used/max):",
    ...POPULATIONS.map((p) => `- ${p}: ${setback.budgets[p].used}/${setback.budgets[p].max}`),
    "",
    "Setback evidence:",
    setback.detail ?? "The newly-failing assertions are listed under Gate evidence above.",
    "",
    "Earlier triage rounds (oldest first):",
    setback.priorRationales.length === 0
      ? NO_PRIOR_TRIAGE
      : setback.priorRationales.map((r) => `- ${r}`).join("\n"),
  ].join("\n");
}
```

Update `assemblePrompt`'s doc comment: "The five slots of `docs/agent-interface.md` … plus, for triage only, a `## Setback` slot between the gate evidence and the reply format."

`docs/agent-interface.md`, prompt template block: after the `[ verbatim gate evidence ]` line add
`[ setback ]                    # triage only: trigger, used/max budgets, setback evidence, prior triage rationales`
and after the block's first bullet add: "The brief is rendered as labelled fields (problem, dead ends, scope, references, diagnosis), with the diagnosis labelled as a hypothesis. Worker and gate-maintenance prompts carry no setback slot."

`src/index.ts`: add `NO_PRIOR_TRIAGE` to the `./prompt-assembly.js` export and `PromptSetback` to its type export; add `setbackOf` to the `./case-file.js` export and `Setback` as a type export from `./case-file.js`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/prompt-assembly.test.ts src/agent-invoke.test.ts` then `npx tsc --noEmit`
Expected: PASS, including both inline snapshots unchanged; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/prompt-assembly.ts src/prompt-assembly.test.ts docs/agent-interface.md src/index.ts
git commit -m "Render the sharpened brief by field and give triage a setback slot

A retried worker must see what earlier attempts tried and why they
missed, with triage's diagnosis flagged as a hypothesis, beside the
verbatim gate evidence rather than in place of it. Triage in turn needs
the setback, the remaining budgets and earlier rounds' rationales. The
setback slot renders for triage only, and inline snapshots taken before
the change pin the worker and gate-maintenance prompts byte for byte.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `createAgentTriage`: the agent judges only where a decision exists

**Files:**
- Create: `src/triage.ts`
- Create: `src/triage.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `deterministicRouter` (`router.ts`); `AgentPort`, `TriageInput`, `TriagePort`, `TriageVerdict`, `TriageTerminus` (`ports.ts`); `Budget` (`schema.ts`).
- Produces (`src/triage.ts`):
  - `createAgentTriage(agent: AgentPort): TriagePort`
  - `needsJudgement(input: TriageInput): boolean`
  - `toTriageVerdict(terminus: TriageTerminus, input: TriageInput): TriageVerdict`
  - `legalVerdicts: Record<TriageInput["trigger"], ReadonlySet<TriageVerdict["verdict"]>>`

- [ ] **Step 1: Write the failing tests**

Create `src/triage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createAgentTriage, needsJudgement, toTriageVerdict } from "./triage.js";
import type { AgentContext, AgentPort, TriageInput, TriageTerminus } from "./ports.js";
import type { BudgetSet, CaseFile } from "./schema.js";

const ctx: AgentContext = { worktreePath: "/w", dir: "/d", sessionKey: "triage-0" };

function budgets(correctionUsed: number, closeUsed = 0): BudgetSet {
  return {
    correction: { used: correctionUsed, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: closeUsed, max: 3 },
  };
}

function input(overrides: Partial<TriageInput>): TriageInput {
  return {
    trigger: "worker_escalate",
    category: "exhaustion",
    caseFile: {} as CaseFile, // never read by createAgentTriage
    remainingBudgets: budgets(0),
    ctx,
    ...overrides,
  };
}

const brief = { problem: "p", dead_ends: "attempt 1 edited the wrong file", scope: "s", references: ["worker-1-0"], diagnosis: "h" };

/** An agent port that answers triage with `reply` and records every call. */
function triageAgent(reply: TriageTerminus): AgentPort & { calls: AgentContext[] } {
  const calls: AgentContext[] = [];
  const run = (roleCfg: { role: string }, c: AgentContext) => {
    if (roleCfg.role !== "triage") return Promise.reject(new Error(`unexpected ${roleCfg.role} session`));
    calls.push(c);
    return Promise.resolve(reply);
  };
  return { calls, invoke: run as AgentPort["invoke"] };
}

/** An agent port that fails the test if it is called at all. */
const forbiddenAgent: AgentPort = {
  invoke: (() => Promise.reject(new Error("no agent call was expected"))) as AgentPort["invoke"],
};

describe("needsJudgement", () => {
  it("engages the agent for a stuck worker while a correction slot is left", () => {
    expect(needsJudgement(input({ remainingBudgets: budgets(2) }))).toBe(true);
  });

  it("does not engage the agent for a stuck worker once corrections are spent", () => {
    expect(needsJudgement(input({ remainingBudgets: budgets(3) }))).toBe(false);
  });

  it("never engages the agent for an authority limit", () => {
    expect(needsJudgement(input({ category: "authority" }))).toBe(false);
  });

  it("does not engage the agent for a plain gate failure with more than one slot left", () => {
    expect(needsJudgement(input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(0) }))).toBe(false);
  });
});

describe("createAgentTriage", () => {
  it("asks the triage agent about a stuck worker with budget left, with the round's context", async () => {
    const agent = triageAgent({ status: "reroute", rationale: "worth one more try", payload: brief });
    const verdict = await createAgentTriage(agent).triage(input({}));
    expect(agent.calls).toEqual([ctx]);
    expect(verdict).toEqual({ verdict: "reroute", rationale: "worth one more try", artifact: brief });
  });

  it("routes a plain gate failure with more than one slot left with no agent call and no artefact", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(
      input({ trigger: "gate_fail", category: undefined, remainingBudgets: budgets(1) }),
    );
    expect(verdict.verdict).toBe("reroute");
    expect(verdict.artifact).toBeUndefined();
  });

  it("passes an authority limit straight to escalation without asking the agent", async () => {
    const verdict = await createAgentTriage(forbiddenAgent).triage(input({ category: "authority" }));
    expect(verdict.verdict).toBe("escalate");
  });
});

describe("toTriageVerdict", () => {
  it("escalates, never reroutes, when triage produced nothing usable", () => {
    const verdict = toTriageVerdict({ status: "incomplete", rationale: "triage session did not complete: x" }, input({}));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.rationale).toBe(
      "triage did not produce a usable verdict: triage session did not complete: x. Escalating rather than guessing.",
    );
    expect(verdict.artifact).toBeUndefined();
  });

  it("escalates a verdict that is not legal for the trigger, naming the verdict, trigger and legal set", () => {
    const verdict = toTriageVerdict({ status: "retry_close", rationale: "close it", payload: brief }, input({}));
    expect(verdict.verdict).toBe("escalate");
    expect(verdict.rationale).toContain("retry_close");
    expect(verdict.rationale).toContain("worker_escalate");
    expect(verdict.rationale).toContain("reroute, escalate, abort");
  });

  it("carries a legal verdict's rationale and payload through unchanged", () => {
    expect(toTriageVerdict({ status: "abort", rationale: "infra", payload: { reason: "disk full" } }, input({}))).toEqual({
      verdict: "abort",
      rationale: "infra",
      artifact: { reason: "disk full" },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/triage.test.ts`
Expected: FAIL, `./triage.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/triage.ts`:

```ts
import { deterministicRouter } from "./router.js";
import type { AgentPort, TriageInput, TriagePort, TriageTerminus, TriageVerdict } from "./ports.js";
import type { Budget } from "./schema.js";

type Verdict = TriageVerdict["verdict"];

/**
 * The verdicts each setback may legally end in. Structural, not a prompt
 * instruction: an agent answering `retry_close` to a stuck worker would
 * otherwise send ungated work to CLOSING. `abort` is legal everywhere.
 */
export const legalVerdicts: Record<TriageInput["trigger"], ReadonlySet<Verdict>> = {
  gate_fail: new Set(["reroute", "escalate", "abort"]),
  gate_error: new Set(["fix_the_gate", "escalate", "abort"]),
  worker_escalate: new Set(["reroute", "escalate", "abort"]),
  close_failure: new Set(["retry_close", "escalate", "abort"]),
};

/**
 * Whether a real decision exists that an agent could change. A stuck worker
 * with a correction slot left is one: triage may judge a retry worthwhile and
 * say what to try. Once a population is spent, no judgement changes the
 * outcome, so no agent is asked a question whose only answer is escalate.
 */
export function needsJudgement({ trigger, category, remainingBudgets: b }: TriageInput): boolean {
  const left = (x: Budget) => x.max - x.used;
  switch (trigger) {
    case "worker_escalate":
      return category !== "authority" && left(b.correction) > 0;
    case "gate_fail":
    case "close_failure":
    case "gate_error":
      return false;
  }
}

/**
 * The single translation from the agent's `status` to the case file's
 * `verdict`. Anything unusable or illegal escalates: a default reroute would
 * burn correction slots on a triage fault and disguise it as a retry loop.
 */
export function toTriageVerdict(terminus: TriageTerminus, input: TriageInput): TriageVerdict {
  if (terminus.status === "incomplete") {
    return {
      verdict: "escalate",
      rationale: `triage did not produce a usable verdict: ${terminus.rationale}. Escalating rather than guessing.`,
    };
  }
  const legal = legalVerdicts[input.trigger];
  if (!legal.has(terminus.status)) {
    return {
      verdict: "escalate",
      rationale:
        `triage answered ${terminus.status}, which is not allowed for a ${input.trigger} setback ` +
        `(allowed: ${[...legal].join(", ")}). Escalating rather than acting on it.`,
    };
  }
  return { verdict: terminus.status, rationale: terminus.rationale, artifact: terminus.payload };
}

/**
 * The agent-backed `TriagePort`. The deterministic router stays the first
 * check: an authority limit passes straight to escalation before anything else
 * is consulted, and every setback with no real decision is routed by the table
 * with no agent call and no cost.
 */
export function createAgentTriage(agent: AgentPort): TriagePort {
  return {
    async triage(input) {
      if (input.trigger === "worker_escalate" && input.category === "authority") {
        return deterministicRouter.triage(input);
      }
      if (!needsJudgement(input)) return deterministicRouter.triage(input);
      return toTriageVerdict(await agent.invoke({ role: "triage" }, input.ctx), input);
    },
  };
}
```

`src/index.ts`: `export { createAgentTriage, needsJudgement, toTriageVerdict, legalVerdicts } from "./triage.js";`

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/triage.test.ts` then `npx tsc --noEmit`
Expected: PASS; typecheck clean (the exhaustive `switch` compiles with no default).

- [ ] **Step 5: Commit**

```bash
git add src/triage.ts src/triage.test.ts src/index.ts
git commit -m "Add the agent-backed triage port behind the deterministic router

A stuck worker with a correction slot left is a real decision, so it is
put to the triage agent; an authority limit still escalates before
anything is consulted, and a plain gate failure keeps the zero-cost
lookup. Unusable or illegal triage output escalates rather than
defaulting to a retry, which would burn budget on a triage fault and hide
it as a retry loop.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The surface threads triage's brief to the next worker, and replays a crashed round

**Files:**
- Modify: `src/surface.ts` (`triage()` ref payload; `dispatchSession` derives `briefRef` for worker dispatches)
- Modify: `src/surface.test.ts` (new `describe` inside the file, after "TRIAGE")

**Interfaces:**
- Consumes: `createAgentTriage` (`triage.ts`), `createAgentPort` (`agent-invoke.ts`), `triageRoleConfig`, `workerRoleConfig`, `gateMaintenanceRoleConfig`, `assemblePrompt`, `resolveEvidence`, `isOnPath`, the `sessionAgent` helper from Task 3.
- Produces: in `src/surface.ts`, a private `currentBriefRef(dir: string, history: HistoryEntry[]): Promise<string | undefined>`. No exported signature changes.

- [ ] **Step 1: Write the failing tests**

In `src/surface.test.ts` add imports: `createAgentTriage` from `./triage.js`; `createAgentPort` from `./agent-invoke.js`; `triageRoleConfig` from `./triage-role-config.js`; `workerRoleConfig`, `gateMaintenanceRoleConfig` from `./role-config.js`; `assemblePrompt`, `resolveEvidence` from `./prompt-assembly.js`; `isOnPath` from `./on-path.js`. Then add after the `TRIAGE` describe:

```ts
describe("triage by agent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  const brief = {
    problem: "the second assertion fails",
    dead_ends: "attempt 1 gave up looking in the wrong module",
    scope: "touch report.tap only",
    references: ["worker-1-0"],
    diagnosis: "the report is generated, not hand-written",
  };

  /** Worker 1 is stuck; later workers complete. Records each worker's assembled prompt. */
  function stuckThenCleanWorker(prompts: string[]) {
    let calls = 0;
    return async (role: "worker" | "gate-maintenance", ctx: { dir: string }): Promise<Terminus> => {
      const caseFile = await load(ctx.dir);
      prompts.push(assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(ctx.dir, caseFile)).prompt);
      calls += 1;
      return calls === 1
        ? { status: "escalate", category: "exhaustion", rationale: "I am stuck" }
        : { status: "completed", rationale: "fixed it" };
    };
  }

  it("puts a stuck worker to the triage agent and hands the retried worker its brief", async () => {
    const workerPrompts: string[] = [];
    const triageKeys: string[] = [];
    const agent = sessionAgent(stuckThenCleanWorker(workerPrompts), (ctx) => {
      triageKeys.push(ctx.sessionKey);
      return Promise.resolve({ status: "reroute", rationale: "one more try with a sharper brief", payload: brief });
    });
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    expect(triageKeys).toEqual(["triage-0"]);
    const { history } = await load(dir);
    expect(history.find((e) => e.t === "triage")).toMatchObject({ verdict: "reroute", artifactRef: "triage-0" });
    expect(await readRef(dir, "triage-0")).toEqual({
      trigger: "worker_escalate",
      rationale: "one more try with a sharper brief",
      artifact: brief,
    });
    expect(history.filter((e) => e.t === "dispatch").at(-1)).toMatchObject({ attempt: 2, briefRef: "triage-0" });

    const retried = workerPrompts.at(-1) ?? "";
    expect(retried).toContain(`Dead ends: ${brief.dead_ends}`);
    expect(retried).toContain("Diagnosis (a hypothesis to test, not an established fact)");
    expect(retried.indexOf("## Gate evidence")).toBeGreaterThan(retried.indexOf("## Brief"));
  });

  it("keeps the brief when the retried worker's session ends without a result and is retried", async () => {
    let calls = 0;
    const agent = sessionAgent(
      () => {
        calls += 1;
        if (calls === 1) return Promise.resolve({ status: "escalate", category: "exhaustion", rationale: "stuck" });
        if (calls === 2) return Promise.resolve({ status: "incomplete", rationale: "hit the turn cap" });
        return Promise.resolve({ status: "completed", rationale: "fixed it" });
      },
      () => Promise.resolve({ status: "reroute", rationale: "retry", payload: brief }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await run(dir, location, ports);

    const dispatches = (await load(dir)).history.filter((e) => e.t === "dispatch");
    expect(dispatches.slice(1)).toEqual([
      expect.objectContaining({ attempt: 2, sessionKey: "worker-2-0", briefRef: "triage-0" }),
      expect.objectContaining({ attempt: 2, sessionKey: "worker-2-1", briefRef: "triage-0" }),
    ]);
  });

  it("routes a plain gate failure with slots to spare with no agent call, and its retry carries no brief", async () => {
    let workerCalls = 0;
    const agent = sessionAgent((_role, ctx) => {
      workerCalls += 1;
      if (workerCalls === 1) writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
      return Promise.resolve({ status: "completed", rationale: "changed it" });
    }); // no triage function: any triage call rejects and fails the test
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    for (let i = 0; i < 5; i++) await advance(dir, location, ports); // baseline, worker, gate, triage, worker 2

    const { history } = await load(dir);
    expect(history.find((e) => e.t === "triage")).toMatchObject({ trigger: "gate_fail", verdict: "reroute" });
    expect(await readRef(dir, "triage-0")).not.toHaveProperty("artifact");
    const retry = history.filter((e) => e.t === "dispatch").at(-1);
    expect(retry).toMatchObject({ attempt: 2 });
    expect(retry).not.toHaveProperty("briefRef");
  });

  it("never asks the triage agent about an authority limit", async () => {
    const agent = sessionAgent(() =>
      Promise.resolve({ status: "escalate", category: "authority", rationale: "I may not touch billing" }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    const result = await run(dir, location, ports);
    expect(result.state).toBe("ESCALATED");
  });

  it("resumes a triage round that crashed mid-session to the same round and the same request", async () => {
    const seen: { sessionKey: string; prompt: string }[] = [];
    let triageCalls = 0;
    const agent = sessionAgent(
      () => Promise.resolve({ status: "escalate", category: "exhaustion", rationale: "stuck" }),
      async (ctx) => {
        const caseFile = await load(ctx.dir);
        seen.push({
          sessionKey: ctx.sessionKey,
          prompt: assemblePrompt(caseFile, triageRoleConfig, await resolveEvidence(ctx.dir, caseFile)).prompt,
        });
        triageCalls += 1;
        if (triageCalls === 1) throw new Error("process killed mid-triage");
        return { status: "reroute", rationale: "retry", payload: brief };
      },
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);
    await advance(dir, location, ports); // PRE_GATING -> AGENT_ACTIVE
    await advance(dir, location, ports); // worker escalates -> TRIAGE
    const before = await load(dir);

    await expect(advance(dir, location, ports)).rejects.toThrow("process killed mid-triage");
    expect((await load(dir)).history).toEqual(before.history); // nothing appended

    const resumed = await advance(dir, location, ports);
    expect(resumed.state).toBe("AGENT_ACTIVE");
    expect(seen.map((s) => s.sessionKey)).toEqual(["triage-0", "triage-0"]);
    expect(seen[1]?.prompt).toBe(seen[0]?.prompt);
  });
});

describe.skipIf(!isOnPath("claude-mock"))("triage by agent through the real invocation seam", () => {
  it("delivers the triage brief's dead ends into the retried worker's actual request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
    const scriptPath = join(dir, "mock.json");
    const journalPath = join(dir, "journal.jsonl");
    // Each session re-reads the queue, so expectations are routed by prompt content:
    // triage first (only its prompt has a Setback slot), then the briefed retry, then attempt 1.
    await writeFile(scriptPath, JSON.stringify([
      { when: { promptContains: "## Setback" }, json: { status: "reroute", rationale: "one more try", payload: brief } },
      { when: { promptContains: brief.dead_ends }, json: { status: "completed", rationale: "fixed it" } },
      { when: { promptContains: "No distilled brief" }, json: { status: "escalate", category: "exhaustion", rationale: "I am stuck" } },
    ]), "utf-8");
    const agent = createAgentPort(
      { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
      { pathToClaudeCodeExecutable: "claude-mock", env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath } },
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("CLOSED");

    const prompts = (await readFile(journalPath, "utf-8"))
      .split("\n").filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { event: string; prompt?: string })
      .filter((e) => e.event === "matched").map((e) => e.prompt ?? "");
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain("## Setback");
    expect(prompts[2]).toContain(`Dead ends: ${brief.dead_ends}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "triage by agent"`
Expected: FAIL: the ref has no `artifact`, and the attempt-2 dispatch has no `briefRef`. The authority, plain-gate-failure and crash tests may already pass (they are guards against regressions from Step 3).

- [ ] **Step 3: Write the implementation**

In `src/surface.ts` `triage()`, replace the ref write and its comment:

```ts
  // Keyed by prior triage count so repeated rounds never overwrite each other's
  // artefacts, and written before the entry: a crash between the two leaves an
  // orphan ref that the re-run overwrites at the same key. The artefact (a
  // brief or packet) is present only when the verdict carried one.
  const artifactRef = await writeRef(dir, `triage-${priorTriages}`, {
    trigger,
    rationale: verdict.rationale,
    ...(verdict.artifact ? { artifact: verdict.artifact } : {}),
  });
```

Add, above `dispatchSession` (import `readRef` from `./case-file.js`):

```ts
/**
 * The ref holding the brief for the worker attempt in flight, or undefined.
 *
 * Every worker attempt after the first was started by a `reroute` triage entry,
 * and the latest such entry is the one that started the current attempt. Its
 * ref carries an artefact only when an agent wrote a brief; a deterministic
 * reroute's ref does not, so that retry dispatches with no brief. Derived from
 * the log, so a first dispatch, a terminus-retry and a resumed run all agree.
 */
async function currentBriefRef(dir: string, history: HistoryEntry[]): Promise<string | undefined> {
  const reroute = history.findLast((e) => e.t === "triage" && e.verdict === "reroute");
  if (reroute?.t !== "triage") return undefined;
  const ref = await readRef(dir, reroute.artifactRef);
  return typeof ref === "object" && ref !== null && "artifact" in ref ? reroute.artifactRef : undefined;
}
```

In `dispatchSession`, replace the dispatch append:

```ts
  const briefRef = role === "worker" ? await currentBriefRef(dir, caseFile.history) : undefined;
  await appendEntry(dir, { t: "dispatch", role, attempt, sessionKey, ...(briefRef ? { briefRef } : {}) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/surface.test.ts` then `npx tsc --noEmit`
Expected: PASS (all surface tests, including the existing TRIAGE, budget-cap and resume-parity suites unchanged); typecheck clean. The mock-gated test runs when `claude-mock` is on `PATH`.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Thread triage's brief from the round's ref into the next worker

A retry is only informed if the brief actually reaches the retried
worker's request. TRIAGE now stores the verdict's artefact in the round's
ref, and each worker dispatch derives its briefRef from the latest
reroute whose ref carries one, so a first dispatch, a retry after an
incomplete session and a resumed run all pick up the same brief, while a
deterministic reroute still dispatches with none.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Runnable demo against `claude-mock`

**Files:**
- Create: `demos/triage-slice-1-informed-retry.ts`
- Modify: `package.json` (`demo:triage-slice-1`)
- Modify: `eslint.config.js` (glob and ceiling)

**Interfaces:**
- Consumes: `create`, `load`, `readRef`, `advance`, `run` (via `../src/…`), `createAgentPort`, `createAgentTriage`, the three reference role configs, `initTempRepo` (`src/temp-repo.ts`), `isOnPath`.
- Produces: printed sections headed `1. The stuck worker's setback`, `2. What triage was asked`, `3. Triage's verdict`, `4. The second worker's request`, `5. A plain gate failure`, `6. What this shows`. The UAT phase asserts on these headings, so keep them exact.

- [ ] **Step 1: Write the demo**

Create `demos/triage-slice-1-informed-retry.ts`:

```ts
/**
 * UAT demo for Triage and Deterministic Router Slice 1: A Stuck Worker's Retry
 * Is Informed by Triage, Not Re-dispatched Blind.
 *
 * Runs a surface in which a scripted worker gives up as "stuck", a scripted
 * triage agent decides to retry with a sharpened brief, and a second worker is
 * dispatched; prints the triage request, the verdict and the second worker's
 * request. Then runs a plain gate failure and shows no triage agent was called.
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed. `claude-mock` does not enforce a role's tool
 * list, so this demo shows nothing about triage's read-only authority; that is
 * proven by unit tests and, live, by the real agent runtime.
 *
 * Usage: npm run demo:triage-slice-1
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { advance, run } from "../src/surface.js";
import { create, load, readRef } from "../src/case-file.js";
import { createAgentPort } from "../src/agent-invoke.js";
import { createAgentTriage } from "../src/triage.js";
import { triageRoleConfig } from "../src/triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { initTempRepo } from "../src/temp-repo.js";
import { isOnPath } from "../src/on-path.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

const brief = {
  problem: "The greeting endpoint returns 'hi'; the task asks for 'hello'.",
  dead_ends: "Attempt 1 searched the route handlers for the string and gave up: the text is not in any handler.",
  scope: "Change the greeting text only; leave routing and tests alone.",
  references: ["worker-1-0"],
  diagnosis: "The greeting is probably read from a translations file rather than written in code.",
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

/** A fresh case file and repo; the surface is provisioned by the first advance. */
async function surface(name: string): Promise<{ dir: string; location: SurfaceLocation; scratch: string }> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `triage-demo-${name}-`));
  const dir = path.join(scratch, "case");
  await create(dir, { surfaceId: name, taskDef: { intent: "make the greeting say hello" }, gateRef }, budgets);
  const repoPath = initTempRepo(`triage-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  return { dir, location: { repoPath, worktreePath: path.join(scratch, "tree") }, scratch };
}

function mockSession(scratch: string, script: unknown[]) {
  const scriptPath = path.join(scratch, "mock.json");
  const journalPath = path.join(scratch, "journal.jsonl");
  fs.writeFileSync(scriptPath, JSON.stringify(script), "utf-8");
  return {
    journalPath,
    session: { pathToClaudeCodeExecutable: "claude-mock", env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath } },
  };
}

function sentPrompts(journalPath: string): string[] {
  return fs.readFileSync(journalPath, "utf-8").split("\n").filter((l) => l !== "")
    .map((l) => JSON.parse(l) as { event: string; prompt?: string })
    .filter((e) => e.event === "matched").map((e) => e.prompt ?? "");
}

const indent = (text: string) => text.split("\n").map((l) => `   ${l}`).join("\n");

async function informedRetry(): Promise<void> {
  const { dir, location, scratch } = await surface("stuck-worker");
  // Each session re-reads the whole queue, so each expectation is routed by
  // what its prompt contains: only triage's prompt has a Setback slot, and only
  // the retried worker's prompt contains the brief's dead ends.
  const { session, journalPath } = mockSession(scratch, [
    { when: { promptContains: "## Setback" }, json: { status: "reroute", rationale: "A second attempt is worth it with a sharper brief.", payload: brief } },
    { when: { promptContains: brief.dead_ends }, json: { status: "completed", rationale: "Changed the greeting in the translations file." } },
    { when: { promptContains: "No distilled brief" }, json: { status: "escalate", category: "exhaustion", rationale: "I cannot find where the greeting text comes from." } },
  ]);
  const agent = createAgentPort(configs, session);
  const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };

  const result = await run(dir, location, ports);
  const [, triagePrompt = "", secondWorker = ""] = sentPrompts(journalPath);
  const { history } = await load(dir);
  const triaged = history.find((e) => e.t === "triage");

  console.log("1. The stuck worker's setback");
  const stuck = history.find((e) => e.t === "terminus");
  console.log(`   Worker attempt 1 ended: ${stuck?.t === "terminus" ? `${stuck.status} (${stuck.category ?? "-"}): ${stuck.rationale}` : "-"}\n`);

  console.log("2. What triage was asked");
  console.log(indent(triagePrompt.slice(triagePrompt.indexOf("## Setback"), triagePrompt.indexOf("## Reply format")).trimEnd()));
  console.log("");

  console.log("3. Triage's verdict");
  console.log(`   Verdict:   ${triaged?.t === "triage" ? triaged.verdict : "-"}`);
  console.log(`   Rationale: ${triaged?.t === "triage" ? triaged.rationale : "-"}`);
  console.log(`   Stored at: ${triaged?.t === "triage" ? triaged.artifactRef : "-"}\n`);

  console.log("4. The second worker's request");
  console.log(indent(secondWorker.slice(secondWorker.indexOf("## Brief"), secondWorker.indexOf("## Reply format")).trimEnd()));
  console.log(`   Surface finished: ${result.state}\n`);
}

async function plainGateFailure(): Promise<void> {
  const { dir, location, scratch } = await surface("plain-gate-failure");
  const { session } = mockSession(scratch, [
    { when: { promptContains: "No distilled brief" }, effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "Changed the greeting." } },
    { json: { status: "completed", rationale: "Tried again." } },
  ]);
  const inner = createAgentPort(configs, session);
  let triageAgentCalls = 0;
  const counting: AgentPort = {
    invoke: ((roleCfg, ctx) => {
      if (roleCfg.role === "triage") triageAgentCalls += 1;
      return inner.invoke(roleCfg, ctx);
    }) as AgentPort["invoke"],
  };
  const ports: SurfacePorts = { agent: counting, triage: createAgentTriage(counting), closer: noopCloser };

  // Provision, baseline, worker, gate, triage, second worker.
  for (let i = 0; i < 6; i++) await advance(dir, location, ports);

  const { history } = await load(dir);
  const triaged = history.find((e) => e.t === "triage");
  const retry = history.filter((e) => e.t === "dispatch").at(-1);
  const ref = triaged?.t === "triage" ? await readRef(dir, triaged.artifactRef) : undefined;

  console.log("5. A plain gate failure");
  console.log("   Worker attempt 1 broke one assertion; 3 correction slots remained.");
  console.log(`   Verdict:              ${triaged?.t === "triage" ? `${triaged.verdict}: ${triaged.rationale}` : "-"}`);
  console.log(`   Triage agent calls:   ${triageAgentCalls}`);
  console.log(triageAgentCalls === 0 ? "   No triage agent was called: the deterministic router routed it." : "   A TRIAGE AGENT WAS CALLED");
  console.log(`   Brief stored:         ${ref && typeof ref === "object" && "artifact" in ref ? "yes" : "no"}`);
  console.log(`   Retry dispatch brief: ${retry?.t === "dispatch" && retry.briefRef ? retry.briefRef : "none"}\n`);
}

async function main(): Promise<void> {
  requireMock();
  await informedRetry();
  await plainGateFailure();
  console.log("6. What this shows");
  console.log(
    "   A worker that gave up was judged by a read-only triage agent, whose brief reached\n" +
      "   the second worker as a Brief section, with the diagnosis labelled a hypothesis,\n" +
      "   separate from the verbatim Gate evidence. A plain gate failure with budget to spare\n" +
      "   was routed by the lookup table with no agent call and no brief.\n" +
      "   Note: claude-mock does not enforce a role's tool list; triage's read-only authority\n" +
      "   is proven by unit tests and, live, by the real agent runtime.",
  );
}

await main();
```

- [ ] **Step 2: Wire the script and lint scope**

`package.json` scripts, after `demo:agent-slice-3`:

```json
"demo:triage-slice-1": "npx tsx demos/triage-slice-1-informed-retry.ts",
```

`eslint.config.js`: add `"tests/triage-and-router/*.ts",` after `"tests/single-surface-state-machine/*.ts",` and change the ceiling to `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 60,`.

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:triage-slice-1`
Expected (with `claude-mock` on `PATH`): exit 0; section 2 shows `Trigger: worker_escalate (exhaustion)`, `- correction: 0/3` and `No prior triage rounds on this surface.`; section 3 shows `Verdict:   reroute` and `Stored at: triage-0`; section 4 shows `## Brief` containing `Dead ends: Attempt 1 searched…` and `Diagnosis (a hypothesis to test, not an established fact): …`, then a separate `## Gate evidence`, and `Surface finished: CLOSED`; section 5 shows `Triage agent calls:   0`, `No triage agent was called`, `Brief stored:         no`, `Retry dispatch brief: none`.
Without `claude-mock`: exit 1 and the "claude-mock is not on PATH" message.

If the step count in `plainGateFailure` does not land on the second worker's dispatch (for example, provisioning takes a different number of advances), adjust the loop to advance until `history` contains a second worker `dispatch`, rather than changing the printed text.

Run: `npx eslint demos/triage-slice-1-informed-retry.ts eslint.config.js`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add demos/triage-slice-1-informed-retry.ts package.json eslint.config.js
git commit -m "Add a runnable demo of a triage-informed retry

A reviewer needs to see, without reading code, that a stuck worker's
retry now carries what the first attempt tried and why it missed, and
that a plain gate failure still costs no agent call. The demo runs both
against claude-mock and says plainly that the mock is required and does
not enforce tool authority. The lint scope gains the glob and headroom
the slice's recorded UAT test will need.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
