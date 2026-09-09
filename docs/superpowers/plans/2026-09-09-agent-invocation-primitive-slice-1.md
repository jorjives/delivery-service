# Agent Invocation Primitive — Slice 1: Wire a Worker to a Real Invocation and Get Back a Typed Result

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 1 of `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`

**Goal:** Build `invoke(roleCfg, ctx)` — the real, SDK-backed agent invocation primitive — so a
harness extender can hand it a worker `RoleConfig` and a run context and get back exactly one
typed `Terminus` (`completed` / `escalate` / `incomplete`), with a deterministic prompt.

**Architecture:** Three new modules in the existing flat `src/*.ts` layout.
`src/role-config.ts` declares the full `RoleConfig` shape, the worker's zod envelope schema, the
reference worker config, and a pre-flight config validator. `src/prompt-assembly.ts` is a pure
five-slot prompt builder over the serialised case file plus a small async ref-resolver that feeds
it gate evidence. `src/agent-invoke.ts` calls `query()` from `@anthropic-ai/claude-agent-sdk`
exactly once, validates whatever came back against the role's envelope schema, and maps the
session end onto one `Terminus`. There is one implementation, not two: tests point the SDK's
`pathToClaudeCodeExecutable` at `claude-mock` so the real code path runs offline.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node ≥22, vitest, zod v4 (already a
dependency), `@anthropic-ai/claude-agent-sdk` (new runtime dependency), `claude-mock` (sibling
project on `PATH`, not vendored here).

## Global Constraints

- **Node ≥22**, TypeScript strict, ESM with `.js` import specifiers on relative imports — as the
  rest of `src/` already does.
- **One schema language: zod.** Spec Build note: the agent's expected-reply shape is defined with
  zod (already the codebase's exclusive schema library, as `GateRef` in `src/schema.ts` shows) and
  converted to the SDK's JSON Schema via `z.toJSONSchema()`. No second schema library, no
  hand-rolled validator. **Verified:** `z.toJSONSchema()` on a `z.discriminatedUnion` emits a
  `oneOf` of object schemas under `$schema: draft/2020-12`.
- **One new dependency only:** `@anthropic-ai/claude-agent-sdk` (pin `^0.3.266`; verified present
  on the registry). No new devDependency.
- **No hidden retries:** `invoke()` calls the SDK exactly once and returns exactly one `Terminus`.
  All retry logic stays in `src/surface.ts`, untouched by this slice.
- **Determinism:** the assembled prompt is a pure function of the serialised case file and the
  pinned role config. No clock, no randomness, no `sessionKey` in prompt content.
- **Plain-English failure text:** an `incomplete` rationale never carries a raw exception message
  or stack trace. Follows `src/budgets.ts`'s `budgetExhausted` precedent — one fixed sentence per
  cause class, authored in one place.
- **Operational note (spec + slice):** `claude-mock` is a **sibling project, not vendored in this
  repo**, installed via `npm link` and resolved on `PATH`. Mock-backed tests must skip cleanly
  when it is absent; the demo must say so plainly rather than crash. This slice's tests do **not**
  prove tool-authority enforcement — the mock models no tool permissions. That guarantee rests on
  the real SDK and is Slice 2's.
- **Out of scope for this slice** (spec's own boundaries): triage's role config and the
  `Terminus` widening it needs (Item 5); budget knob *values* (`budgets?` is a reserved field
  only); the "writing a `role_cfg`" guide and gate-maintenance's config (Slice 3); wiring the
  primitive into `SurfacePorts.agent` (Slice 3, where a second role makes a role→config registry
  worth having).

## Scaffolding Impact

- `package.json` — new runtime dependency `@anthropic-ai/claude-agent-sdk` → **Task 1**
- `package.json` — new `demo:agent-slice-1` script (matches the existing `demo:*` convention) → **Task 6**
- `docs/agent-interface.md` — its two `[claude-mock](../../tools/claude-mock)` links do not
  resolve inside this repo; the mock is a sibling project on `PATH`. This slice is the first code
  that actually depends on the mock resolving, so the stale link is corrected here → **Task 4**
- `docs/agent-interface.md` — "Open items" resolved by this slice's code (`ctx` shape, worker
  completion payload, schema definition mechanism) are recorded as decided, with the budget-knob
  item left open → **Task 4**
- `CONTRIBUTING.md` — `npm test` now has a tier of tests that skip when `claude-mock` is not on
  `PATH`; a developer must be told why they see skips → **Task 4**

---

## Task 1: Add the SDK dependency and free the `RoleConfig` name

**Why this is first:** `src/ports.ts` already exports `RoleConfig` as the driver's one-field role
*handle* (`{ role }`, all `src/surface.ts` ever constructs). This slice introduces the real,
five-field role configuration under that same name. Two different types called `RoleConfig` in one
codebase is a drift hazard, so the handle is renamed before the real config arrives. This is a
tidy-first rename with no behaviour change, committed separately.

**Files:**
- Modify: `package.json` (dependencies), `package-lock.json`
- Modify: `src/ports.ts` (rename `RoleConfig` → `RoleHandle`)
- Modify: `src/index.ts:14` (export list)

**Interfaces:**
- Consumes: nothing.
- Produces: `RoleHandle { role: AgentRole }` exported from `src/ports.ts`;
  `AgentPort.invoke(roleCfg: RoleHandle, ctx: AgentContext): Promise<Terminus>`. The name
  `RoleConfig` is now free for Task 2.

- [ ] **Step 1: Install the dependency**

```bash
npm install @anthropic-ai/claude-agent-sdk@^0.3.266 --no-audit --no-fund
```

This also creates `node_modules/` in this worktree (it starts empty) so the rest of the plan can
run tests.

- [ ] **Step 2: Rename the role handle in `src/ports.ts`**

Replace the existing declaration:

```ts
/** Per-role pinned configuration. Item 4 owns what else lives in here. */
export interface RoleConfig {
  role: AgentRole;
}
```

with:

```ts
/**
 * The driver's handle for "which role is being dispatched". The full pinned
 * configuration for a role — prompt fragment, envelope schema, tool authority —
 * lives in `role-config.ts`; the driver never assembles one, it names a role and
 * the agent port resolves it.
 */
export interface RoleHandle {
  role: AgentRole;
}
```

Then update the `AgentPort` declaration in the same file:

```ts
export interface AgentPort {
  invoke(roleCfg: RoleHandle, ctx: AgentContext): Promise<Terminus>;
}
```

- [ ] **Step 3: Update the export list in `src/index.ts`**

In the `export type { ... } from "./ports.js";` block, change the line `RoleConfig,` to
`RoleHandle,`.

- [ ] **Step 4: Verify nothing else referenced the old name**

Run: `npx tsc --noEmit`
Expected: no errors. (`src/surface.ts` passes an object literal `{ role }` and is unaffected —
this is the whole point of the rename being safe.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/ports.ts src/index.ts
git commit -m "Rename AgentPort's RoleConfig to RoleHandle and add the agent SDK

The driver only ever names a role; the real per-role configuration this item
introduces needs the RoleConfig name for its five-field shape. Renaming the
one-field handle first keeps one name per concept."
```

---

## Task 2: The worker's role configuration and envelope schema

**Files:**
- Create: `src/role-config.ts`
- Test: `src/role-config.test.ts`
- Modify: `src/errors.ts` (add `InvalidRoleConfig`)
- Modify: `src/index.ts` (exports)

**Interfaces:**
- Consumes: `AgentRole`, `Terminus`, `RoleHandle` from `src/ports.js` (Task 1).
- Produces:
  - `type Envelope = Exclude<Terminus, { status: "incomplete" }>` — the valid-reply shape, i.e.
    `{status:"completed", rationale}` or `{status:"escalate", category, rationale}`.
  - `const WorkerEnvelope: z.ZodType<Envelope>` — the worker's zod discriminated union.
  - `interface RoleConfig extends RoleHandle { systemPromptFragment: string; envelopeSchema:
    z.ZodType<Envelope>; allowedTools: string[]; budgets?: Record<string, unknown> }`.
  - `const workerRoleConfig: RoleConfig` — the reference worker configuration.
  - `function validateRoleConfig(cfg: RoleConfig): void` — throws `InvalidRoleConfig`.
  - `class InvalidRoleConfig extends Error` with `field` and `code: "INVALID_ROLE_CONFIG"`.

**Note on `Envelope`:** a valid worker/gate-maintenance envelope is structurally identical to a
non-`incomplete` `Terminus`, so mapping a parsed envelope to a terminus is the identity function.
Derive the type rather than re-declaring it — that is what keeps the two from drifting.

- [ ] **Step 1: Write the failing tests**

Create `src/role-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { WorkerEnvelope, workerRoleConfig, validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import { InvalidRoleConfig } from "./errors.js";

describe("WorkerEnvelope", () => {
  it("accepts a clean completion", () => {
    const parsed = WorkerEnvelope.parse({ status: "completed", rationale: "added the feature" });
    expect(parsed).toEqual({ status: "completed", rationale: "added the feature" });
  });

  it("accepts an escalation carrying its category", () => {
    const parsed = WorkerEnvelope.parse({
      status: "escalate",
      category: "authority",
      rationale: "the change needs a credential I was not given",
    });
    expect(parsed).toEqual({
      status: "escalate",
      category: "authority",
      rationale: "the change needs a credential I was not given",
    });
  });

  it("rejects a triage-only status, so a worker cannot route itself", () => {
    expect(WorkerEnvelope.safeParse({ status: "reroute", rationale: "try again" }).success)
      .toBe(false);
  });

  it("rejects an escalation with no category", () => {
    expect(WorkerEnvelope.safeParse({ status: "escalate", rationale: "stuck" }).success)
      .toBe(false);
  });

  it("rejects an envelope with no rationale", () => {
    expect(WorkerEnvelope.safeParse({ status: "completed" }).success).toBe(false);
  });

  it("converts to a JSON Schema the SDK can constrain output with", () => {
    const schema = z.toJSONSchema(WorkerEnvelope) as { oneOf: unknown[] };
    expect(schema.oneOf).toHaveLength(2);
  });
});

describe("workerRoleConfig", () => {
  it("is a worker config with a prompt fragment and a non-empty tool list", () => {
    expect(workerRoleConfig.role).toBe("worker");
    expect(workerRoleConfig.systemPromptFragment.length).toBeGreaterThan(0);
    expect(workerRoleConfig.allowedTools.length).toBeGreaterThan(0);
  });

  it("passes its own validation", () => {
    expect(() => validateRoleConfig(workerRoleConfig)).not.toThrow();
  });
});

describe("validateRoleConfig", () => {
  it("names the offending field when the tool list is empty", () => {
    const cfg = { ...workerRoleConfig, allowedTools: [] };
    expect(() => validateRoleConfig(cfg)).toThrow(InvalidRoleConfig);
    try {
      validateRoleConfig(cfg);
    } catch (err) {
      expect((err as InvalidRoleConfig).field).toBe("allowedTools");
      expect((err as InvalidRoleConfig).message).toContain("allowedTools");
    }
  });

  it("names the offending field when the prompt fragment is blank", () => {
    try {
      validateRoleConfig({ ...workerRoleConfig, systemPromptFragment: "" });
      expect.unreachable("blank fragment should not validate");
    } catch (err) {
      expect((err as InvalidRoleConfig).field).toBe("systemPromptFragment");
    }
  });

  it("names the offending field when the envelope schema is not a zod schema", () => {
    const cfg = { ...workerRoleConfig, envelopeSchema: {} } as unknown as RoleConfig;
    try {
      validateRoleConfig(cfg);
      expect.unreachable("a non-schema should not validate");
    } catch (err) {
      expect((err as InvalidRoleConfig).field).toBe("envelopeSchema");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/role-config.test.ts`
Expected: FAIL — `Failed to resolve import "./role-config.js"`.

- [ ] **Step 3: Add the error class**

Append to `src/errors.ts`:

```ts
export class InvalidRoleConfig extends Error {
  readonly code = "INVALID_ROLE_CONFIG" as const;
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(`Invalid role config: ${field} ${detail}`);
    this.name = "InvalidRoleConfig";
  }
}
```

- [ ] **Step 4: Write `src/role-config.ts`**

```ts
import { z } from "zod";
import { InvalidRoleConfig } from "./errors.js";
import type { AgentRole, RoleHandle, Terminus } from "./ports.js";

/**
 * A valid reply from a worker or gate-maintenance session. Structurally it is
 * exactly a `Terminus` minus `incomplete` — `incomplete` is the harness's own
 * verdict on a session that produced nothing usable, never something an agent
 * may claim for itself — so mapping a parsed envelope to a terminus is the
 * identity. Deriving the type is what stops the two drifting apart.
 */
export type Envelope = Exclude<Terminus, { status: "incomplete" }>;

/**
 * The worker's legal statuses. A discriminated union, matching `GateRef` in
 * `schema.ts` — this codebase's one way of saying "one of these shapes".
 *
 * Strictness here is a security boundary, not tidiness: a worker that emits a
 * triage status (`reroute`, `fix_the_gate`, ...) fails this parse and becomes
 * INCOMPLETE_TERMINUS, so a confused or adversarial worker cannot route itself.
 */
export const WorkerEnvelope = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    rationale: z.string().min(1),
  }),
  z.object({
    status: z.literal("escalate"),
    category: z.enum(["exhaustion", "authority"]),
    rationale: z.string().min(1),
  }),
]) satisfies z.ZodType<Envelope>;

/**
 * Everything pinned about one role for the length of a run: out of every
 * agent's reach, and the only thing that varies between roles. The invocation
 * primitive itself never branches on `role`.
 */
export interface RoleConfig extends RoleHandle {
  /** Role identity and domain context. Becomes the session's system prompt. */
  systemPromptFragment: string;
  /** The reply shape this role may emit. Also constrains the SDK's output. */
  envelopeSchema: z.ZodType<Envelope>;
  /** The authored, positive tool list. This role's entire blast radius. */
  allowedTools: string[];
  /**
   * Reserved for per-invocation SDK-level resource caps. Deliberately untyped
   * and unused: the budget design owns the field names, and guessing at them
   * here would bake in a contract nothing has verified.
   */
  budgets?: Record<string, unknown>;
}

/**
 * The reference worker configuration. An extender copies this, changes the
 * domain sentences in the fragment, and has a working role.
 */
export const workerRoleConfig: RoleConfig = {
  role: "worker",
  systemPromptFragment: [
    "You are the worker on a gated delivery harness.",
    "You make the smallest change to the working tree that satisfies the task below.",
    "You do not run, edit, or reason about the project's gate: a separate, pinned gate",
    "judges your work, and you cannot see or influence it.",
    "If you cannot proceed and no further attempt would help, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};

const RoleConfigShape = z.object({
  role: z.enum(["worker", "triage", "gate-maintenance"] as const satisfies readonly AgentRole[]),
  systemPromptFragment: z.string().min(1),
  envelopeSchema: z.custom<z.ZodType<Envelope>>((value) => value instanceof z.ZodType, {
    message: "must be a zod schema",
  }),
  allowedTools: z.array(z.string().min(1)).min(1),
  budgets: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Check a role config before any session is spawned, and name the field that is
 * wrong. An extender's first mistake is a typo in a config, and finding it
 * costs nothing here versus a confusing session failure later.
 */
export function validateRoleConfig(cfg: RoleConfig): void {
  const result = RoleConfigShape.safeParse(cfg);
  if (result.success) return;
  const issue = result.error.issues[0];
  throw new InvalidRoleConfig(issue.path.join(".") || "(root)", issue.message);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/role-config.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Export from the package index**

In `src/index.ts`, add:

```ts
export { WorkerEnvelope, workerRoleConfig, validateRoleConfig } from "./role-config.js";
export type { Envelope, RoleConfig } from "./role-config.js";
```

and add `InvalidRoleConfig,` to the existing `export { ... } from "./errors.js";` block.

- [ ] **Step 7: Verify types and lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/role-config.ts src/role-config.test.ts src/errors.ts src/index.ts
git commit -m "Add the worker role config and its envelope schema

A role is configuration, not code: this is the first one. The envelope is a zod
discriminated union so a worker emitting a triage status fails validation rather
than silently routing itself."
```

---

## Task 3: Deterministic five-slot prompt assembly

**Files:**
- Create: `src/prompt-assembly.ts`
- Test: `src/prompt-assembly.test.ts`
- Modify: `src/index.ts` (exports)

**Interfaces:**
- Consumes: `RoleConfig` from `src/role-config.js` (Task 2); `load`, `readRef` from
  `src/case-file.js`; `CaseFile`, `NewFailure` from `src/schema.js`.
- Produces:
  - `interface PromptEvidence { brief: unknown; newFailures: NewFailure[] }`
  - `interface AssembledPrompt { systemPrompt: string; prompt: string }`
  - `function resolveEvidence(dir: string, caseFile: CaseFile): Promise<PromptEvidence>` — the
    only I/O; reads the refs the log points at.
  - `function assemblePrompt(caseFile: CaseFile, roleCfg: RoleConfig, evidence: PromptEvidence):
    AssembledPrompt` — pure.

**Design notes for the implementer:**
- The five slots of `docs/agent-interface.md` split across two SDK fields: slot 1 (role fragment +
  the case file's immutable `header.domainPrompt`) becomes `systemPrompt`; slots 2–5 (task
  definition, distilled brief, verbatim gate evidence, envelope instruction) become `prompt`.
  Both are pure functions of pinned config and serialised state, so determinism holds for the
  whole request, not just the user turn.
- Evidence lives behind refs (`GateEntry.newFailures[].detailRef`, `DispatchEntry.briefRef`), so
  resolving it is I/O. It is split into `resolveEvidence` precisely so `assemblePrompt` stays
  pure and directly testable: same inputs, byte-identical output, no disk, no clock.
- The envelope instruction is generated from `z.toJSONSchema(roleCfg.envelopeSchema)`, not
  authored per role. One source of truth for the reply shape, and a role added later gets its
  instruction for free.
- `ctx.sessionKey` never appears in either string — a terminus retry with a new session key must
  produce a byte-identical request.

- [ ] **Step 1: Write the failing tests**

Create `src/prompt-assembly.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, appendEntry, writeRef } from "./case-file.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { workerRoleConfig } from "./role-config.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prompt-assembly-"));
  await create(
    dir,
    {
      surfaceId: "s-1",
      taskDef: { intent: "add a greeting endpoint" },
      gateRef,
      domainPrompt: "This is a Python service.",
    },
    budgets,
  );
});

describe("assemblePrompt", () => {
  it("puts the role fragment and the domain prompt in the system prompt", async () => {
    const caseFile = await load(dir);
    const { systemPrompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(systemPrompt).toContain("You are the worker on a gated delivery harness.");
    expect(systemPrompt).toContain("This is a Python service.");
  });

  it("carries the task definition, the brief slot and the envelope instruction, in that order", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("add a greeting endpoint");
    const order = ["## Task", "## Brief", "## Gate evidence", "## Reply format"];
    const positions = order.map((heading) => prompt.indexOf(heading));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("names the role's legal statuses in the envelope instruction", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("completed");
    expect(prompt).toContain("escalate");
  });

  it("says plainly when there is no brief and no gate evidence yet", async () => {
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("No distilled brief");
    expect(prompt).toContain("No failing assertions");
  });

  it("reproduces the gate's newly-failing assertions verbatim", async () => {
    const detailRef = await writeRef(dir, "gate-1-0-0", {
      id: "test_greeting",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "AssertionError: expected 'hi' to equal 'hello'",
    });
    await appendEntry(dir, {
      t: "gate",
      attempt: 1,
      status: "FAIL",
      newFailures: [{ id: "test_greeting", detailRef }],
      class: "fail",
    });
    const caseFile = await load(dir);
    const { prompt } = assemblePrompt(caseFile, workerRoleConfig, await resolveEvidence(dir, caseFile));
    expect(prompt).toContain("test_greeting");
    expect(prompt).toContain("AssertionError: expected 'hi' to equal 'hello'");
  });

  it("produces a byte-identical request for the same case file", async () => {
    const first = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    const second = assemblePrompt(await load(dir), workerRoleConfig, await resolveEvidence(dir, await load(dir)));
    expect(second.prompt).toBe(first.prompt);
    expect(second.systemPrompt).toBe(first.systemPrompt);
  });

  it("ignores the session key, so a retry re-sends the same request", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    const before = await load(dir);
    const first = assemblePrompt(before, workerRoleConfig, await resolveEvidence(dir, before));
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-1" });
    const after = await load(dir);
    const second = assemblePrompt(after, workerRoleConfig, await resolveEvidence(dir, after));
    expect(second.prompt).toBe(first.prompt);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/prompt-assembly.test.ts`
Expected: FAIL — `Failed to resolve import "./prompt-assembly.js"`.

- [ ] **Step 3: Write `src/prompt-assembly.ts`**

```ts
import { z } from "zod";
import { readRef } from "./case-file.js";
import { NewFailure } from "./schema.js";
import type { CaseFile } from "./schema.js";
import type { RoleConfig } from "./role-config.js";

/** The parts of the prompt that live behind refs rather than in the log itself. */
export interface PromptEvidence {
  /** The distilled brief a triage reroute left behind, or null on a first attempt. */
  brief: unknown;
  /** The gate's newly-failing assertions, resolved from their detail refs. */
  newFailures: NewFailure[];
}

/** One assembled request: the session's system prompt and its single user turn. */
export interface AssembledPrompt {
  systemPrompt: string;
  prompt: string;
}

/**
 * Read what the log points at. The only I/O in this module, split out so that
 * `assemblePrompt` stays a pure function of its arguments and determinism is
 * something you can assert rather than hope for.
 */
export async function resolveEvidence(dir: string, caseFile: CaseFile): Promise<PromptEvidence> {
  const history = [...caseFile.history].reverse();

  const gate = history.find((entry) => entry.t === "gate");
  const newFailures: NewFailure[] = [];
  for (const failure of gate?.newFailures ?? []) {
    const parsed = NewFailure.safeParse(await readRef(dir, failure.detailRef));
    if (parsed.success) newFailures.push(parsed.data);
  }

  const dispatch = history.find((entry) => entry.t === "dispatch");
  const brief = dispatch?.briefRef ? await readRef(dir, dispatch.briefRef) : null;

  return { brief, newFailures };
}

/**
 * The five slots of `docs/agent-interface.md`, in fixed order, split across the
 * two fields the SDK takes. The project supplies content — the task, the domain
 * fragment — never the structure: if a project could reorder or drop a slot it
 * could tell a worker not to emit an envelope, and INCOMPLETE_TERMINUS would
 * stop meaning "the session produced nothing usable".
 *
 * Pure: no clock, no randomness, no I/O, and no `sessionKey`. The same case file
 * yields a byte-identical request, so a reconstructed session after a crash is
 * the same session.
 */
export function assemblePrompt(
  caseFile: CaseFile,
  roleCfg: RoleConfig,
  evidence: PromptEvidence,
): AssembledPrompt {
  const domain = caseFile.header.domainPrompt;

  const systemPrompt = domain
    ? `${roleCfg.systemPromptFragment}\n\n${domain}`
    : roleCfg.systemPromptFragment;

  const brief =
    evidence.brief === null
      ? "No distilled brief — work from the task and the gate evidence below."
      : JSON.stringify(evidence.brief, null, 2);

  const gateEvidence =
    evidence.newFailures.length === 0
      ? "No failing assertions recorded yet."
      : evidence.newFailures
          .map((f) => `- ${f.id} (${f.baselineOutcome} -> ${f.checkOutcome})\n  ${f.detail}`)
          .join("\n");

  const envelopeInstruction = [
    "End your turn by emitting a JSON object matching this schema exactly:",
    "",
    JSON.stringify(z.toJSONSchema(roleCfg.envelopeSchema), null, 2),
    "",
    "Emit no other status. A reply that does not match this schema is treated as",
    "no reply at all, and the attempt is recorded as incomplete.",
  ].join("\n");

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
    "## Reply format",
    envelopeInstruction,
    "",
  ].join("\n");

  return { systemPrompt, prompt };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/prompt-assembly.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Export from the package index**

In `src/index.ts`, add:

```ts
export { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
export type { AssembledPrompt, PromptEvidence } from "./prompt-assembly.js";
```

- [ ] **Step 6: Verify types and lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/prompt-assembly.ts src/prompt-assembly.test.ts src/index.ts
git commit -m "Assemble a role's prompt deterministically from the case file

The harness owns the template end to end and the project supplies only values,
which is what keeps the envelope instruction unconditional. Ref reads are split
out so the assembly itself is pure and its determinism is assertable."
```

---

## Task 4: `invoke()` — a real session in, a typed terminus out

**Files:**
- Create: `src/agent-invoke.ts`
- Test: `src/agent-invoke.test.ts`
- Modify: `src/index.ts` (exports), `docs/agent-interface.md`, `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `RoleConfig`, `validateRoleConfig`, `workerRoleConfig` from `src/role-config.js`;
  `assemblePrompt`, `resolveEvidence` from `src/prompt-assembly.js`; `load` from
  `src/case-file.js`; `AgentContext`, `Terminus` from `src/ports.js`.
- Produces:
  - `function invoke(roleCfg: RoleConfig, ctx: AgentContext, sdkOverrides?: Partial<Options>):
    Promise<Terminus>`
  - `const DID_NOT_COMPLETE: { errored, noEnvelope, wrongShape, notRun }` — the four fixed
    plain-English reasons (exported so tests assert the exact text rather than a fragment).

**Facts verified against `claude-mock` and the real SDK — write the code to these, do not re-derive:**
- A `json` expectation lands on the result message as `structured_output`.
- A `fail.message` expectation yields `subtype: "success"` with `is_error: true` and the text in
  `result`. **So `is_error` must be checked, not just `subtype`.**
- A `reply`-only expectation yields a success result with `structured_output` undefined.
- An unmatched prompt yields `is_error: true` — same class as a crash, which is exactly right.
- The SDK's `env` option **replaces** the subprocess environment; spread `process.env` or the
  mock loses `PATH`.

**Authority fields go last in the options object**, after `...sdkOverrides` — a caller supplying
overrides for the executable path and env can never widen the session's tool authority.

- [ ] **Step 1: Write the failing tests**

Create `src/agent-invoke.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { create } from "./case-file.js";
import { invoke, DID_NOT_COMPLETE } from "./agent-invoke.js";
import { workerRoleConfig } from "./role-config.js";
import type { AgentContext } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

/**
 * claude-mock is a sibling project installed with `npm link`, not vendored
 * here, so this tier skips rather than fails when it is absent.
 */
const hasMock = (process.env.PATH ?? "")
  .split(delimiter)
  .some((d) => d !== "" && existsSync(join(d, "claude-mock")));

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

let dir: string;
let worktreePath: string;
let scriptPath: string;
let ctx: AgentContext;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "invoke-case-"));
  worktreePath = await mkdtemp(join(tmpdir(), "invoke-tree-"));
  scriptPath = join(dir, "mock.json");
  ctx = { worktreePath, dir, sessionKey: "worker-1-0" };
  await create(dir, { surfaceId: "s-1", taskDef: { intent: "add a greeting" }, gateRef }, budgets);
});

/** Write the mock's expectation queue for this test. */
async function script(expectations: unknown[]): Promise<void> {
  await writeFile(scriptPath, JSON.stringify(expectations), "utf-8");
}

/** Point the SDK at the mock instead of the real CLI. */
function useMock(): { pathToClaudeCodeExecutable: string; env: Record<string, string | undefined> } {
  return {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  };
}

describe.skipIf(!hasMock)("invoke against a scripted agent session", () => {
  it("returns one completed terminus carrying the agent's explanation", async () => {
    await script([{ json: { status: "completed", rationale: "added the greeting endpoint" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({ status: "completed", rationale: "added the greeting endpoint" });
  });

  it("returns one escalate terminus naming the category", async () => {
    await script([
      { json: { status: "escalate", category: "authority", rationale: "needs a credential I was not given" } },
    ]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({
      status: "escalate",
      category: "authority",
      rationale: "needs a credential I was not given",
    });
  });

  it("treats a session that ended in an error as did-not-complete", async () => {
    await script([{ fail: { message: "the session blew up: TypeError at line 42" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.errored);
  });

  it("treats a session that emitted no envelope as did-not-complete", async () => {
    await script([{ reply: "I had a look around but never reported back." }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.noEnvelope);
  });

  it("treats a reply that does not match the expected shape as did-not-complete", async () => {
    await script([{ json: { status: "finished", note: "all good" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.wrongShape);
  });

  it("treats a worker emitting a triage-only status as did-not-complete, not a route", async () => {
    await script([{ json: { status: "reroute", rationale: "someone else should do this" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.wrongShape);
  });

  it("never leaks the underlying error text into the rationale", async () => {
    await script([{ fail: { message: "TypeError: Cannot read properties of undefined\n    at foo (/x/y.js:42:9)" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus.rationale).not.toContain("TypeError");
    expect(terminus.rationale).not.toContain("at foo");
    expect(terminus.rationale).toContain("worker");
  });
});

describe("invoke without a runnable session", () => {
  it("returns did-not-complete rather than throwing when the agent cannot be run", async () => {
    await script([{ reply: "unreachable" }]);
    const terminus = await invoke(workerRoleConfig, ctx, {
      pathToClaudeCodeExecutable: join(dir, "no-such-binary"),
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
    });
    expect(terminus.status).toBe("incomplete");
    expect(terminus.rationale).toContain(DID_NOT_COMPLETE.notRun);
    expect(terminus.rationale).not.toContain("ENOENT");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent-invoke.test.ts`
Expected: FAIL — `Failed to resolve import "./agent-invoke.js"`.

- [ ] **Step 3: Write `src/agent-invoke.ts`**

```ts
import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { load } from "./case-file.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import type { AgentContext, Terminus } from "./ports.js";

/**
 * The four ways a session fails to produce a usable answer, and the one
 * sentence each is reported with.
 *
 * They collapse to a single terminus on purpose — the control flow treats "the
 * agent never cleanly signalled" as one edge with one budget, whatever the
 * cause — but the reason distinguishes them, because a project owner reading
 * the case file has to be able to tell a crash from a bad reply without an
 * engineer. Fixed strings, never an exception message: a stack trace in the log
 * tells that reader nothing and leaks harness internals.
 */
export const DID_NOT_COMPLETE = {
  errored: "the session ended in an error before it reported a result",
  noEnvelope: "the session ended without reporting a result",
  wrongShape: "the session replied with something that is not a valid result for this role",
  notRun: "the session could not be started or run to completion",
} as const;

function incomplete(roleCfg: RoleConfig, reason: string): Terminus {
  return { status: "incomplete", rationale: `${roleCfg.role} session did not complete: ${reason}` };
}

/**
 * One agent session in, exactly one terminus out.
 *
 * The primitive never retries and never branches on role: it assembles the
 * prompt, spawns one fresh session (no resume, no session id — sessions are
 * reconstructed from the case file, never continued), and validates whatever
 * came back. `sdkOverrides` exists so a test or demo can point the SDK at
 * `claude-mock` instead of the real CLI; the tool-authority fields are applied
 * after it, so an override can never widen what the role may do.
 */
export async function invoke(
  roleCfg: RoleConfig,
  ctx: AgentContext,
  sdkOverrides: Partial<Options> = {},
): Promise<Terminus> {
  validateRoleConfig(roleCfg);

  const caseFile = await load(ctx.dir);
  const { systemPrompt, prompt } = assemblePrompt(
    caseFile,
    roleCfg,
    await resolveEvidence(ctx.dir, caseFile),
  );

  let result: SDKResultMessage | undefined;
  try {
    result = await lastResult(prompt, systemPrompt, roleCfg, ctx, sdkOverrides);
  } catch {
    return incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  }

  if (!result) return incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  if (result.subtype !== "success" || result.is_error) {
    return incomplete(roleCfg, DID_NOT_COMPLETE.errored);
  }
  if (result.structured_output === undefined) {
    return incomplete(roleCfg, DID_NOT_COMPLETE.noEnvelope);
  }

  const envelope = roleCfg.envelopeSchema.safeParse(result.structured_output);
  if (!envelope.success) return incomplete(roleCfg, DID_NOT_COMPLETE.wrongShape);

  // A valid envelope IS the terminus — see `Envelope` in role-config.ts.
  return envelope.data;
}

/**
 * Drive the session to its end and keep the result message. The stream is
 * drained rather than broken out of, so the child process is never left behind.
 */
async function lastResult(
  prompt: string,
  systemPrompt: string,
  roleCfg: RoleConfig,
  ctx: AgentContext,
  sdkOverrides: Partial<Options>,
): Promise<SDKResultMessage | undefined> {
  let result: SDKResultMessage | undefined;
  for await (const message of query({
    prompt,
    options: {
      ...sdkOverrides,
      cwd: ctx.worktreePath,
      systemPrompt,
      // One authored list, two SDK options: `tools` is the real restriction on
      // the session's base tool set, `allowedTools` auto-approves what the role
      // is already entitled to so an unattended run never stalls on a prompt.
      tools: roleCfg.allowedTools,
      allowedTools: roleCfg.allowedTools,
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(roleCfg.envelopeSchema) },
    },
  })) {
    if (message.type === "result") result = message;
  }
  return result;
}
```

**Implementation note:** `structured_output` exists only on the success variant of
`SDKResultMessage`, so the `subtype !== "success"` check in `invoke` must come before it is read —
that narrowing is what makes the access type-safe, not a cast.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agent-invoke.test.ts`
Expected: PASS (8 tests; the mock-backed ones skip if `claude-mock` is not on `PATH` — confirm
with `which claude-mock` that they ran).

- [ ] **Step 5: Export from the package index**

In `src/index.ts`, add:

```ts
export { invoke, DID_NOT_COMPLETE } from "./agent-invoke.js";
```

- [ ] **Step 6: Correct the stale mock links and record the resolved open items**

In `docs/agent-interface.md`, replace both occurrences of
`[claude-mock](../../tools/claude-mock)` with `claude-mock` and add, at the end of the
"Relationship to the mock" section:

```markdown
`claude-mock` is a **sibling project, not vendored into this repo**. Install it with
`npm link` from its own checkout so that `claude-mock` resolves on `PATH`; the mock-backed
tests and the invocation demos skip or refuse to run without it. Vendoring it is Item 7's.
```

Then, in the "Open items" section, replace the first three bullets with:

```markdown
- **`ctx` shape** — resolved. `AgentContext.dir` is the case-file reference: the primitive
  calls `load(ctx.dir)` itself, `ctx.worktreePath` becomes the session's `cwd`, and
  `ctx.sessionKey` is a journal key only, deliberately kept out of prompt content so a retry
  re-sends a byte-identical request.
- **Worker completion payload** — resolved. `completed` carries `rationale` and nothing else;
  the gate stays the sole judge of the work.
- **Schema definition mechanism** — resolved. Each role's envelope is a zod discriminated union
  in its `role_cfg`, validated harness-side and handed to the SDK's `outputFormat` via
  `z.toJSONSchema()`. One schema language, two enforcement points.
```

Leave the budget-knobs bullet open, and append to it:
`Reserved as \`role_cfg.budgets?\`, unused until the budget design names the fields.`

- [ ] **Step 7: Tell developers why they may see skipped tests**

In `CONTRIBUTING.md`, under "Development", after the command block, add:

```markdown
Some tests drive the real Claude Agent SDK against `claude-mock`, a scripted fake `claude`
binary from a sibling project. It is not vendored here: install it with `npm link` from its
own checkout so `claude-mock` resolves on `PATH`. Without it those tests skip — they never
fail — and `npm test` still passes.
```

- [ ] **Step 8: Verify types and lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/agent-invoke.ts src/agent-invoke.test.ts src/index.ts docs/agent-interface.md CONTRIBUTING.md
git commit -m "Invoke a real agent session and map it to one typed terminus

Replaces the stubbed seam with the real SDK call. Every way a session can fail
to produce a usable answer collapses to one incomplete terminus, with a fixed
plain-English reason that distinguishes the causes without leaking a stack
trace at a project owner."
```

---

## Task 5: Prove the request is byte-identical across runs

**Files:**
- Modify: `src/agent-invoke.test.ts`

**Interfaces:**
- Consumes: `invoke` from `src/agent-invoke.js` (Task 4).
- Produces: nothing new — this closes the determinism acceptance criterion end to end, through
  the real SDK call path rather than at the pure-function level Task 3 covered.

**Why separate from Task 3:** Task 3 proves `assemblePrompt` is deterministic. This proves what
the harness *actually sent* is identical, read back from `claude-mock`'s journal — the spec's
own wording ("proven by an automated test against `claude-mock`'s journal, not a manual check").

- [ ] **Step 1: Write the failing test**

Append to the `describe.skipIf(!hasMock)` block in `src/agent-invoke.test.ts`:

```ts
  it("sends the identical request twice from the same starting case file", async () => {
    const journalPath = join(dir, "journal.jsonl");
    await script([
      { json: { status: "completed", rationale: "first run" } },
      { json: { status: "completed", rationale: "second run" } },
    ]);
    const sdk = {
      pathToClaudeCodeExecutable: "claude-mock",
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: journalPath },
    };

    await invoke(workerRoleConfig, { ...ctx, sessionKey: "worker-1-0" }, sdk);
    await invoke(workerRoleConfig, { ...ctx, sessionKey: "worker-1-1" }, sdk);

    const prompts = (await readFile(journalPath, "utf-8"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { event: string; prompt?: string })
      .filter((entry) => entry.event === "matched")
      .map((entry) => entry.prompt);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toBe(prompts[0]);
  });
```

Add `readFile` to the existing `node:fs/promises` import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Temporarily change `expect(prompts[1]).toBe(prompts[0]);` to
`expect(prompts[1]).not.toBe(prompts[0]);` and run:

Run: `npx vitest run src/agent-invoke.test.ts -t "identical request"`
Expected: FAIL — proving the assertion is actually reached and the journal is being read (a
green test on an unwritten journal would be a fiction). Restore the assertion afterwards.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/agent-invoke.test.ts -t "identical request"`
Expected: PASS. Two different session keys, one identical prompt.

- [ ] **Step 4: Commit**

```bash
git add src/agent-invoke.test.ts
git commit -m "Prove the request sent to the agent is identical across runs

Determinism is asserted from the mock's journal — what the harness actually
sent — rather than from the pure assembly function alone, so a session key or
an option leaking into the prompt would be caught."
```

---

## Task 6: A demo an extender can read the three outcomes from

**Files:**
- Create: `demos/agent-invocation-slice-1-worker-invocation.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `invoke` from `../src/agent-invoke.js`, `workerRoleConfig` from
  `../src/role-config.js`, `create` from `../src/case-file.js`.
- Produces: `npm run demo:agent-slice-1`.

Follow the shape of `demos/single-surface-slice-2-happy-path.ts`: a doc comment naming the slice
and the usage line, top-level constants, an `async function main()`, and
`main().catch((err) => { console.error(err); process.exit(1); })` at the foot (copy the exact
foot from that file).

- [ ] **Step 1: Write the demo**

```ts
/**
 * UAT demo for Agent Invocation Primitive Slice 1: Wire a Worker to a Real
 * Invocation and Get Back a Typed Result.
 *
 * Provisions a fresh case file, supplies the reference worker configuration,
 * and runs the real invocation primitive three times against a scripted agent
 * session: one clean completion, one escalation, one reply that does not match
 * the shape the worker must emit.
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed.
 *
 * This demo does NOT prove tool authority is enforced — the mock models no tool
 * permissions. That guarantee rests on the real SDK and is Slice 2's demo.
 *
 * Usage: npx tsx demos/agent-invocation-slice-1-worker-invocation.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create } from "../src/case-file.js";
import { invoke } from "../src/agent-invoke.js";
import { workerRoleConfig } from "../src/role-config.js";
import type { AgentContext, Terminus } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

const scenarios: { name: string; reply: unknown }[] = [
  {
    name: "the agent finishes cleanly",
    reply: { status: "completed", rationale: "added the greeting endpoint and its handler" },
  },
  {
    name: "the agent escalates",
    reply: {
      status: "escalate",
      category: "authority",
      rationale: "the change needs a deploy credential this role was not given",
    },
  },
  {
    name: "the agent replies with the wrong shape",
    reply: { status: "finished", note: "all done!" },
  },
];

function requireMock(): void {
  const onPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .some((d) => d !== "" && fs.existsSync(path.join(d, "claude-mock")));
  if (onPath) return;
  console.error(
    "claude-mock is not on PATH.\n\n" +
      "It is a scripted fake `claude` binary from a sibling project, deliberately not\n" +
      "vendored into this repo. Install it with `npm link` from its own checkout, then\n" +
      "run this demo again. Nothing here calls a live API.",
  );
  process.exit(1);
}

function describe(terminus: Terminus): string {
  switch (terminus.status) {
    case "completed":
      return `completed — ${terminus.rationale}`;
    case "escalate":
      return `escalate (${terminus.category}) — ${terminus.rationale}`;
    case "incomplete":
      return `did not complete — ${terminus.rationale}`;
  }
}

async function main(): Promise<void> {
  requireMock();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-demo-case-"));
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "agent-demo-tree-"));
  const scriptPath = path.join(dir, "mock.json");

  await create(
    dir,
    {
      surfaceId: "agent-demo",
      taskDef: { intent: "add a greeting endpoint" },
      gateRef,
      domainPrompt: "This is a small HTTP service.",
    },
    budgets,
  );

  const ctx: AgentContext = { worktreePath, dir, sessionKey: "worker-1-0" };

  console.log(`Case file: ${dir}`);
  console.log(`Role:      ${workerRoleConfig.role}`);
  console.log(`Tools:     ${workerRoleConfig.allowedTools.join(", ")}\n`);

  for (const scenario of scenarios) {
    fs.writeFileSync(scriptPath, JSON.stringify([{ json: scenario.reply }]), "utf-8");
    const terminus = await invoke(workerRoleConfig, ctx, {
      pathToClaudeCodeExecutable: "claude-mock",
      env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
    });
    console.log(`Scenario: ${scenario.name}`);
    console.log(`  Result: ${describe(terminus)}\n`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

Before committing, open `demos/single-surface-slice-2-happy-path.ts` and copy its exact
`main().catch(...)` foot so the demos stay consistent.

- [ ] **Step 2: Add the npm script**

In `package.json`, after `"demo:surface-slice-5"`, add:

```json
    "demo:agent-slice-1": "npx tsx demos/agent-invocation-slice-1-worker-invocation.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:agent-slice-1`
Expected: three scenarios printed — a `completed` result with the agent's note, an `escalate`
result naming `authority`, and a `did not complete` result whose reason is plain English with no
stack trace or raw error text.

- [ ] **Step 4: Verify types and lint**

Run: `npm run lint`
Expected: no errors (demos are covered by the eslint config's default include).

- [ ] **Step 5: Commit**

```bash
git add demos/agent-invocation-slice-1-worker-invocation.ts package.json
git commit -m "Add the worker-invocation demo for slice 1

The extender-facing proof for this slice: three scripted sessions, three typed
results, no live API call. It states the claude-mock dependency and the
tool-authority gap up front rather than assuming either away."
```

---

## Self-Review

**1. Slice coverage**

| Acceptance criterion | Task |
|---|---|
| Worker `role_cfg` + run context + clean reply → one `completed` result with the agent's explanation | Task 2 (config + schema), Task 3 (prompt), Task 4 (first test) |
| A session that reports a genuine limit → one `escalate` result naming the category | Task 2 (`category` in the schema), Task 4 (second test) |
| Crash / cut off / wrong shape → the same single "did not complete" result, plus a plain-English reason distinguishing which | Task 4 (`DID_NOT_COMPLETE` and its four tests, including the triage-status exploit case) |
| The "did not complete" result never exposes a raw system error or stack trace | Task 4 (fixed reason strings; the "never leaks" test and the unrunnable-binary test) |
| Same scenario twice from the same case file → the exact same request both times | Task 3 (pure-function determinism), Task 5 (journal proof through the real call path) |
| UAT demo: fresh case file, reference config, three runs, readable results | Task 6 |

No gaps.

**2. Placeholder scan**

Every step carries runnable content: real test bodies, real implementations, real commands with
their expected outcomes. No "TBD", no "add appropriate error handling", no "similar to Task N",
no code step without a code block.

**3. Type consistency**

`RoleHandle` (Task 1) → extended by `RoleConfig` (Task 2) → consumed by `assemblePrompt`
(Task 3) and `invoke` (Task 4). `Envelope = Exclude<Terminus, {status:"incomplete"}>` is declared
once in Task 2 and relied on in Task 4's `return envelope.data;`. `PromptEvidence` /
`AssembledPrompt` names match between Task 3's interface block and its usage in Task 4.
`DID_NOT_COMPLETE`'s four keys are identical in Task 4's implementation and its tests.
`workerRoleConfig`, `validateRoleConfig`, `WorkerEnvelope`, `resolveEvidence`, `assemblePrompt`,
`invoke` are spelled the same everywhere they appear.

**4. Right choice re-audit**

| Decision | Pre-planning choice | What the plan actually does | Easy or Right? |
|---|---|---|---|
| Schema language | Reuse zod + `z.toJSONSchema()` (spec Build note) | Task 2 defines the envelope as a zod discriminated union mirroring `GateRef`; Task 3 generates the envelope instruction and Task 4 the SDK `outputFormat` from the same schema | Right |
| Two `RoleConfig` types | Let them coexist (easy) | Task 1 renames the driver's handle to `RoleHandle` first, as a separate tidy-first commit | Right |
| Envelope→Terminus mapping | Write a mapping function | Derived `Envelope` type makes it the identity; no mapper to drift | Right |
| Prompt evidence | Render only the assertion ids already in the log (easy — no I/O) | `resolveEvidence` reads the detail refs so the gate evidence slot is actually verbatim, split from the pure assembler so determinism stays assertable | Right |
| Prompt split | Put all five slots in the user turn (easy, one string) | Slot 1 becomes the SDK `systemPrompt`, slots 2–5 the user turn — real role pinning for a real model, both halves deterministic | Right |
| Envelope instruction | Author a sentence per role (easy) | Generated from the role's own JSON Schema — role-generic, one source of truth | Right |
| SDK overrides | Spread last (easy) | Spread **first**, with `tools`/`allowedTools`/`cwd`/`outputFormat` applied after, so no caller can widen a role's authority | Right |
| Failure text | Interpolate the SDK error (easy, informative to an engineer) | Four fixed sentences in one exported constant, `budgetExhausted` precedent; two tests assert nothing leaks | Right |
| Test double | A hand-written `AgentPort` fake (easy, no external dependency) | One implementation only; the real SDK path runs against `claude-mock`, skipping cleanly when absent | Right |
| `createClaudeAgentPort` / driver wiring | Build the role→config registry now | Deferred to Slice 3, where a second role justifies it; no AC in this slice needs it | Right (YAGNI) |
| Budget knobs | Guess SDK cap field names | `budgets?: Record<string, unknown>`, reserved and unused, as the spec requires | Right |
| `permissionMode` | Set `bypassPermissions` to stop an unattended stall (easy) | Not set; `tools` restricts and `allowedTools` auto-approves, which is the spec's mechanism. A security-relevant widening is not something this slice takes on speculatively | Right |

No drift found; no easy choices left standing.

**5. Scaffolding drift check**

- `package.json` dependency → Task 1 Step 1. ✅
- `package.json` demo script → Task 6 Step 2. ✅
- `docs/agent-interface.md` stale `../../tools/claude-mock` links, and its three "Open items"
  this slice's code decides (`ctx` shape, worker completion payload, schema mechanism) → Task 4
  Step 6, folded into the task whose deliverable resolved them. ✅
- `CONTRIBUTING.md` — a new class of conditionally-skipped tests → Task 4 Step 7. ✅
- Read the other way: behaviours this slice changes are the `RoleConfig` type name (`src/ports.ts`
  and `src/index.ts` only — no doc describes it), the four `Terminus` failure sentences (new, no
  prior description), and the prompt template (described only in `docs/agent-interface.md`, which
  Task 4 updates). `README.md` names no demos, no commands beyond `npm install` / `npm test`, and
  no seam behaviour, so it needs no change. The `Makefile`'s `verify` target (`npm ci`, lint,
  test) is unchanged — the new tests run under the existing `npm test`. No `CLAUDE.md` /
  `AGENTS.md` exists in this repo.
- The "writing a `role_cfg`" guide is deliberately **not** here: the slice scope places the guide
  and its cold-start walkthrough in Slice 3, where it must cover both roles.
