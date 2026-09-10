# Agent Invocation Primitive — Slice 3: Configure a Second Role Using the Same Seam, Nothing Rebuilt

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 3 of `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`

**Goal:** Ship a reference gate-maintenance `RoleConfig` that runs through the unchanged `invoke()` seam, make the "checks live outside the worktree" boundary something the harness actually enforces rather than assumes, and publish one guide that gets an extender to a first successful invocation of either role without reading source.

**Architecture:** `gateMaintenanceRoleConfig` is pure data in `src/role-config.ts`, beside `workerRoleConfig`; `invoke()` does not change shape. The Slice 2 guard (`createToolAuthority`) learns the run's worktree and refuses, for every role, any tool call whose target path resolves outside it: the SDK already routes out-of-working-directory calls to `canUseTool` (that is what `blockedPath` / `decisionReason: "workingDir"` exist for), and until now the guard answered "allow" for any in-role tool, so the design's "a file that is not present cannot be edited" was false against the real runtime. The guard now records complete refusal sentences, so a path refusal and a tool refusal surface through the same `authorityRefusal` terminus.

**Tech Stack:** TypeScript (ESM, Node ≥22), `@anthropic-ai/claude-agent-sdk` 0.3.x, zod v4, vitest, `claude-mock` (sibling project, resolved from `PATH`).

## Global Constraints

- Node ≥22, TypeScript, existing `eslint`/`typescript-eslint` config, `vitest`. No new dependency of any kind.
- **Buy-vs-build (inherited from the spec):** the SDK is the enforcement mechanism: `canUseTool` stays the single decision point (Slice 2 Build note). No second schema language, zod only. No new permission layer, hook, or SDK `sandbox` setting: the path rule is one more condition inside the existing guard.
- **Operability/DX (inherited from Slices 1–2 Operational notes):** every demo and the guide state plainly that `claude-mock` is a sibling project installed with `npm link`, and that the mock models no tool permissions, so the refusal path is demonstrated by driving the harness's own decision functions, with the end-to-end guarantee resting on the real runtime.
- **One primitive, roles are configs:** `invoke()` must not branch on `role`, and must not gain a parameter for this slice. Any role-specific behaviour is data in a `RoleConfig`.
- Refusal sentences are plain English, never an exception message or stack trace, and always say the refusal was the boundary working as intended (Slice 2 precedent).
- `refusalSentence(roleCfg, tool)` output must not change: the Slice 2 UAT test asserts on it.

## Scaffolding Impact

- `docs/configuring-a-role.md` (new) — the extender guide for worker and gate-maintenance → Task 3.
- `README.md` — "Documentation" list gains a link to the guide → Task 3.
- `docs/agent-interface.md` — its "Tool authority" bullet says gate-maintenance's boundary is enforced "by physical location" alone with no path guard; this slice adds the worktree rule to the guard. Bullet rewritten and a "call outside the worktree" row added to the terminus table → Task 1.
- `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` — "Tool authority enforcement" paragraph ("A file that is not present under the agent's working directory cannot be edited by it") gets a one-line supersession pointer, matching how Slice 2 annotated the same section → Task 1.
- `package.json` — new `demo:agent-slice-3` script → Task 4.
- `eslint.config.js` — `allowDefaultProject` currently matches 39 files against a ceiling of 40. The new demo makes 40 and the UAT phase's recorded test would make 41 and fail lint. Raise `maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING` to 50 → Task 4.
- `demos/agent-invocation-slice-2-tool-authority.ts` — reads `authority.attempted`, which Task 1 replaces → updated in Task 1 (printed output unchanged).
- No new env var, dependency, or build step. `npm test` and `npm run lint` commands unchanged.

**Out of scope, noted not built:** no `AgentPort` adapter (`createClaudeAgentPort`) exists yet; `surface.ts` still passes `{ role }` to an injected port. Mapping a role name to its reference config is the adapter's job and is not in this slice's acceptance criteria.

**Known residual, documented not closed:** a role granted `Bash` can write anywhere its shell can; the SDK reports a `blockedPath` for some such commands (the guard refuses those), but not all. The reference gate-maintenance config therefore does not grant `Bash`, and the guide says why.

---

## Task 1: The guard refuses any call that reaches outside the worktree

**Files:**
- Modify: `src/tool-authority.ts`
- Modify: `src/tool-authority.test.ts`
- Modify: `src/agent-invoke.ts:111-121`
- Modify: `src/agent-invoke.test.ts:147-196` (the "session options" block builds `createToolAuthority(workerRoleConfig)`)
- Modify: `src/index.ts:74` (add `outsideWorktreeSentence` export)
- Modify: `demos/agent-invocation-slice-2-tool-authority.ts`
- Modify: `docs/agent-interface.md` ("Tool authority" section, terminus table)
- Modify: `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` ("Tool authority enforcement" section)

**Interfaces:**
- Consumes: `RoleConfig` (`role`, `allowedTools`), `Terminus`, SDK `CanUseTool` / `PermissionResult` / `SDKPermissionDenial` types.
- Produces (all `src/tool-authority.ts`):
  - `refusalSentence(roleCfg: RoleConfig, tool: string): string` — unchanged.
  - `outsideWorktreeSentence(roleCfg: RoleConfig, tool: string, target: string): string` — new.
  - `createToolAuthority(roleCfg: RoleConfig, worktreePath: string): ToolAuthority` — gains `worktreePath`.
  - `interface ToolAuthority { canUseTool: CanUseTool; refusals: readonly string[] }` — `attempted` (tool names) replaced by `refusals` (complete refusal sentences, in order).
  - `authorityRefusal(roleCfg: RoleConfig, refusals: readonly string[], denials: readonly Pick<SDKPermissionDenial, "tool_name">[]): Terminus | undefined` — first guard refusal wins; otherwise the first out-of-role SDK denial, phrased with `refusalSentence`.

- [ ] **Step 1: Rewrite the guard tests for the new shape and add the worktree rule's tests**

Replace the body of `src/tool-authority.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import {
  createToolAuthority,
  refusalSentence,
  outsideWorktreeSentence,
  authorityRefusal,
} from "./tool-authority.js";
import type { RoleConfig } from "./role-config.js";
import { WorkerEnvelope } from "./role-config.js";

const readOnlyWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: "You are a read-only worker.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob"],
};

const editor: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: "You repair the environment.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Edit", "Write"],
};

const worktree = "/runs/s-1/tree";

/** The options bag the SDK passes as `canUseTool`'s third argument. */
const sdkCallOptions = {
  signal: new AbortController().signal,
  toolUseID: "test-tool-use-id",
  requestId: "test-request-id",
};

describe("the guard the SDK consults before each tool call", () => {
  it("allows a tool the role's config names", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    const decision = await authority.canUseTool("Read", { file_path: `${worktree}/x` }, sdkCallOptions);
    expect(decision).toEqual({ behavior: "allow", updatedInput: { file_path: `${worktree}/x` } });
    expect(authority.refusals).toEqual([]);
  });

  it("denies a tool outside the role's config and says why in plain English", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    const decision = await authority.canUseTool("Bash", { command: "rm -rf /" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toBe(refusalSentence(readOnlyWorker, "Bash"));
  });

  it("records each refusal, in order, so the harness can report it afterwards", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    await authority.canUseTool("Bash", {}, sdkCallOptions);
    await authority.canUseTool("Read", {}, sdkCallOptions);
    await authority.canUseTool("WebFetch", {}, sdkCallOptions);
    expect(authority.refusals).toEqual([
      refusalSentence(readOnlyWorker, "Bash"),
      refusalSentence(readOnlyWorker, "WebFetch"),
    ]);
  });
});

describe("the worktree boundary, for tools the role IS permitted", () => {
  it("allows an edit to a file inside the worktree, relative or absolute", async () => {
    const authority = createToolAuthority(editor, worktree);
    for (const file_path of [".env", `${worktree}/config/app.env`]) {
      const decision = await authority.canUseTool("Edit", { file_path }, sdkCallOptions);
      expect(decision?.behavior).toBe("allow");
    }
    expect(authority.refusals).toEqual([]);
  });

  it("refuses an edit to a file outside the worktree, even though Edit is permitted", async () => {
    const authority = createToolAuthority(editor, worktree);
    const target = "/runs/s-1/checks/greeting.check.sh";
    const decision = await authority.canUseTool("Edit", { file_path: target }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toBe(outsideWorktreeSentence(editor, "Edit", target));
    expect(authority.refusals).toEqual([outsideWorktreeSentence(editor, "Edit", target)]);
  });

  it("is not fooled by a relative path that climbs out", async () => {
    const authority = createToolAuthority(editor, worktree);
    const decision = await authority.canUseTool("Write", { file_path: "../checks/x.sh" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("is not fooled by a sibling directory that shares the worktree's prefix", async () => {
    const authority = createToolAuthority(editor, worktree);
    const decision = await authority.canUseTool("Edit", { file_path: `${worktree}-evil/x` }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("refuses a notebook edit outside the worktree", async () => {
    const authority = createToolAuthority({ ...editor, allowedTools: ["NotebookEdit"] }, worktree);
    const decision = await authority.canUseTool("NotebookEdit", { notebook_path: "/elsewhere/n.ipynb" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("refuses whatever path the runtime itself flags as outside the allowed directories", async () => {
    const authority = createToolAuthority({ ...editor, allowedTools: ["Bash"] }, worktree);
    const decision = await authority.canUseTool(
      "Bash",
      { command: "sed -i s/a/b/ /runs/s-1/checks/x.sh" },
      { ...sdkCallOptions, blockedPath: "/runs/s-1/checks/x.sh" },
    );
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toContain("/runs/s-1/checks/x.sh");
  });

  it("checks the tool list first, so an out-of-role call is reported as that", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    await authority.canUseTool("Write", { file_path: "/elsewhere/x" }, sdkCallOptions);
    expect(authority.refusals).toEqual([refusalSentence(readOnlyWorker, "Write")]);
  });
});

describe("the sentences a refusal is reported with", () => {
  it("names the role, the tool, the permitted tools, and that this was deliberate", () => {
    const sentence = refusalSentence(readOnlyWorker, "Bash");
    expect(sentence).toContain("worker");
    expect(sentence).toContain("Bash");
    expect(sentence).toContain("Read, Glob");
    expect(sentence).toContain("working as intended");
  });

  it("names the role, the tool, the path, the worktree rule, and that this was deliberate", () => {
    const sentence = outsideWorktreeSentence(editor, "Edit", "/runs/s-1/checks/x.sh");
    expect(sentence).toContain("gate-maintenance");
    expect(sentence).toContain("Edit");
    expect(sentence).toContain("/runs/s-1/checks/x.sh");
    expect(sentence).toContain("outside the worktree");
    expect(sentence).toContain("working as intended");
  });

  it("never reads as an unexplained failure", () => {
    for (const sentence of [
      refusalSentence(readOnlyWorker, "Bash"),
      outsideWorktreeSentence(editor, "Edit", "/x"),
    ]) {
      expect(sentence).toContain("refused");
      expect(sentence).toContain("not a fault in the run");
      expect(sentence).not.toMatch(/error|Error|exception|denied by the SDK/);
    }
  });
});

describe("classifying what a finished session refused", () => {
  it("reports nothing when nothing was refused", () => {
    expect(authorityRefusal(readOnlyWorker, [], [])).toBeUndefined();
  });

  it("turns the first recorded refusal into one incomplete terminus", () => {
    const first = outsideWorktreeSentence(editor, "Edit", "/x");
    const terminus = authorityRefusal(editor, [first, refusalSentence(editor, "Bash")], []);
    expect(terminus).toEqual({
      status: "incomplete",
      rationale: `gate-maintenance session did not complete: ${first}`,
    });
  });

  it("reads the SDK's own denial record as a second source", () => {
    const terminus = authorityRefusal(readOnlyWorker, [], [{ tool_name: "Write" }]);
    expect(terminus?.rationale).toBe(
      `worker session did not complete: ${refusalSentence(readOnlyWorker, "Write")}`,
    );
  });

  it("makes no authority claim about a denial of a tool the role was permitted", () => {
    expect(authorityRefusal(readOnlyWorker, [], [{ tool_name: "Read" }])).toBeUndefined();
  });

  it("prefers the guard's own record over the SDK's", () => {
    const own = refusalSentence(readOnlyWorker, "Bash");
    const terminus = authorityRefusal(readOnlyWorker, [own], [{ tool_name: "Write" }]);
    expect(terminus?.rationale).toBe(`worker session did not complete: ${own}`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tool-authority.test.ts`
Expected: FAIL — `outsideWorktreeSentence` is not exported, and `authority.refusals` is undefined.

- [ ] **Step 3: Implement the worktree rule in the guard**

In `src/tool-authority.ts`, add `import * as path from "node:path";` at the top, keep `refusalSentence` exactly as it is, and replace everything from the `ToolAuthority` interface to the end of the file with:

```ts
/**
 * The sentence for an in-role tool aimed outside the run's worktree.
 *
 * The worktree is the only place any role may act. Everything the harness pins
 * out of an agent's reach — the gate's checks, the case file — lives outside
 * it, so this is the rule that stops a gate-maintenance session "repairing" a
 * check into passing, however broad its tool list.
 */
export function outsideWorktreeSentence(roleCfg: RoleConfig, tool: string, target: string): string {
  return (
    `the ${roleCfg.role} role used ${tool} on ${target}, which is outside the worktree, ` +
    `so the harness refused the call before it ran. Every role may act only inside its worktree; ` +
    `the project's checks are kept outside it on purpose. ` +
    `That refusal is the harness's permission boundary working as intended, not a fault in the run.`
  );
}

/** The live guard for one session, plus what it refused. */
export interface ToolAuthority {
  /** Handed to the SDK. Consulted before each tool execution. */
  canUseTool: CanUseTool;
  /** The refusal sentence for each call this session was refused, in order. */
  refusals: readonly string[];
}

/** Input fields the SDK's file tools name their target with. */
const PATH_FIELDS = ["file_path", "notebook_path"] as const;

/**
 * Every path this call would touch: whatever the runtime itself flagged as
 * outside the allowed directories, plus the file tools' own target fields.
 */
function targetsOf(input: Record<string, unknown>, blockedPath: string | undefined): string[] {
  const named = PATH_FIELDS.map((field) => input[field]).filter(
    (value): value is string => typeof value === "string",
  );
  return blockedPath === undefined ? named : [blockedPath, ...named];
}

function isInside(worktreePath: string, target: string): boolean {
  // ponytail: lexical resolve, not realpath. A symlink inside the worktree
  // pointing out of it is not caught; resolve through realpath (on the nearest
  // existing ancestor, since Write targets may not exist yet) if that ever matters.
  const root = path.resolve(worktreePath);
  const full = path.resolve(root, target);
  return full === root || full.startsWith(root + path.sep);
}

/**
 * Build the session's single authority decision point. Two rules, checked in
 * this order, for every role alike:
 *
 * 1. The tool must be in `roleCfg.allowedTools`.
 * 2. Every path the call would touch must be inside `worktreePath`.
 *
 * `tools` is left at the SDK's base set on purpose, so the model can still
 * *issue* an out-of-role call and this callback can refuse it observably. The
 * runtime already routes a call aimed outside its working directory to this
 * callback rather than running it; rule 2 is the harness answering "no".
 */
export function createToolAuthority(roleCfg: RoleConfig, worktreePath: string): ToolAuthority {
  const refusals: string[] = [];
  const deny = (message: string): Promise<PermissionResult> => {
    refusals.push(message);
    return Promise.resolve({ behavior: "deny", message });
  };
  const canUseTool: CanUseTool = (toolName, input, { blockedPath }) => {
    if (!roleCfg.allowedTools.includes(toolName)) {
      return deny(refusalSentence(roleCfg, toolName));
    }
    const outside = targetsOf(input, blockedPath).find((target) => !isInside(worktreePath, target));
    if (outside !== undefined) {
      return deny(outsideWorktreeSentence(roleCfg, toolName, outside));
    }
    return Promise.resolve({ behavior: "allow", updatedInput: input });
  };
  return { canUseTool, refusals };
}

/**
 * Decide whether this session ended against its authority boundary.
 *
 * Two sources, because neither alone is complete: the guard's own record, and
 * the SDK's `permission_denials` (which catches denials resolved before the
 * callback runs). The guard's record wins, because it carries the exact reason.
 * The SDK's record is classified, never believed wholesale: a denial of a tool
 * the role *was* permitted is an ordinary failed run and says nothing about
 * authority.
 */
export function authorityRefusal(
  roleCfg: RoleConfig,
  refusals: readonly string[],
  denials: readonly Pick<SDKPermissionDenial, "tool_name">[],
): Terminus | undefined {
  const outOfRole = denials
    .map((denial) => denial.tool_name)
    .find((tool) => !roleCfg.allowedTools.includes(tool));
  const sentence = refusals.at(0) ?? (outOfRole === undefined ? undefined : refusalSentence(roleCfg, outOfRole));
  if (sentence === undefined) return undefined;
  return { status: "incomplete", rationale: `${roleCfg.role} session did not complete: ${sentence}` };
}
```

- [ ] **Step 4: Run the guard tests to verify they pass**

Run: `npx vitest run src/tool-authority.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the worktree into `invoke()` and update its callers**

In `src/agent-invoke.ts`, change the two lines that build and read the guard:

```ts
  const authority = createToolAuthority(roleCfg, ctx.worktreePath);
```

```ts
    return authorityRefusal(roleCfg, authority.refusals, []) ?? incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
```

```ts
  const refusal = authorityRefusal(roleCfg, authority.refusals, result?.permission_denials ?? []);
```

In `src/agent-invoke.test.ts`, the two `createToolAuthority(workerRoleConfig).canUseTool` calls (around lines 153 and 187) become `createToolAuthority(workerRoleConfig, worktreePath).canUseTool`. If either sits outside a scope where `worktreePath` is assigned (it is set in `beforeEach`), use the literal `"/tmp/tree"` instead; these tests only inspect the options object.

In `src/index.ts`, line 74 becomes:

```ts
export { createToolAuthority, refusalSentence, outsideWorktreeSentence, authorityRefusal } from "./tool-authority.js";
```

In `demos/agent-invocation-slice-2-tool-authority.ts`, move the `const worktreePath = ...` line so it is declared before the guard is built (it already is: it sits above `create(...)`), then change:

```ts
  const authority = createToolAuthority(readOnlyWorker, worktreePath);
```

```ts
  const terminus = authorityRefusal(readOnlyWorker, authority.refusals, []);
```

The demo's printed output does not change.

- [ ] **Step 6: Run the affected tests**

Run: `npx vitest run src/tool-authority.test.ts src/agent-invoke.test.ts tests/agent-invocation-primitive/2-a-role-cannot-act-outside-what-it-was-given-permission-to-touch.test.ts && npm run typecheck`
Expected: PASS, and `tsc` reports no errors (the demo is typechecked by lint's project service; `npm run typecheck` covers `src`).

- [ ] **Step 7: Bring the two descriptions of this boundary up to date**

In `docs/agent-interface.md`, replace the whole "Gate-maintenance's "environment, not assertions" boundary..." bullet with:

```markdown
- **No role may act outside its worktree.** Gate-maintenance's "environment, not
  assertions" boundary is finer than a tool list: it needs edit tools but must not
  touch assertion definitions. Those definitions live outside every agent-reachable
  worktree (invariant 5), and the same `canUseTool` guard enforces that location: a
  call whose target path (`file_path`, `notebook_path`, or the path the runtime
  itself flags as outside its working directory) resolves outside the run's
  worktree is refused, for every role, with a sentence naming the role, the tool,
  the path, and that the boundary worked as intended. The runtime already routes
  such calls to the guard instead of running them; before this rule the guard
  answered "allow" for any permitted tool, so "not present, so not editable" held
  only by luck. Residual: a role granted `Bash` can write wherever its shell can,
  and the runtime does not flag every such command, which is why the reference
  gate-maintenance config does not grant `Bash`.
```

In the same file's terminus table, after the `out-of-role tool attempted` row, add:

```
call aimed outside the worktree → INCOMPLETE_TERMINUS (authority refusal)
```

In `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`, directly above the paragraph beginning "Gate-maintenance's finer "environment, not assertions" boundary", add:

```markdown
> **Refined during delivery.** Physical location alone did not hold against the
> real runtime: an in-role edit tool can name an absolute path outside `cwd`, and
> the guard allowed it. The `canUseTool` guard now also refuses any call aimed
> outside the worktree. See `docs/agent-interface.md`, "Tool authority", and
> `2026-09-09-agent-invocation-primitive-slices.md`, Slice 3.
```

- [ ] **Step 8: Commit**

```bash
git add src/tool-authority.ts src/tool-authority.test.ts src/agent-invoke.ts src/agent-invoke.test.ts src/index.ts demos/agent-invocation-slice-2-tool-authority.ts docs/agent-interface.md docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md
git commit -m "Refuse any agent tool call aimed outside the run's worktree

The design kept gate checks out of an agent's reach by keeping them outside
the worktree, but the real runtime lets an in-role Edit name any absolute
path and routes it to canUseTool, which allowed it. The guard now refuses
such calls for every role, and records full refusal sentences so a path
refusal reports through the same authority terminus as a tool refusal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The reference gate-maintenance configuration, through the unchanged seam

**Files:**
- Modify: `src/role-config.ts` (add `gateMaintenanceRoleConfig` after `workerRoleConfig`)
- Modify: `src/role-config.test.ts`
- Modify: `src/agent-invoke.test.ts` (one new mock-backed `describe`)
- Modify: `src/index.ts:67`

**Interfaces:**
- Consumes: `RoleConfig`, `WorkerEnvelope`, `validateRoleConfig` (`src/role-config.ts`); `invoke(roleCfg, ctx, session)` (`src/agent-invoke.ts`), unchanged; the test file's existing `script()`, `useMock()`, `hasMock`, `dir`, `worktreePath`, `scriptPath` helpers.
- Produces: `export const gateMaintenanceRoleConfig: RoleConfig` from `src/role-config.ts` and `src/index.ts`, with `role: "gate-maintenance"`, `envelopeSchema: WorkerEnvelope`, `allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"]`.

- [ ] **Step 1: Write the failing config tests**

Append to `src/role-config.test.ts` (and add `gateMaintenanceRoleConfig` to its import from `./role-config.js`):

```ts
describe("gateMaintenanceRoleConfig", () => {
  it("is a gate-maintenance config that passes the same validation as the worker's", () => {
    expect(gateMaintenanceRoleConfig.role).toBe("gate-maintenance");
    expect(() => validateRoleConfig(gateMaintenanceRoleConfig)).not.toThrow();
  });

  it("may edit files, which is how it repairs the environment", () => {
    expect(gateMaintenanceRoleConfig.allowedTools).toEqual(
      expect.arrayContaining(["Edit", "Write"]),
    );
  });

  it("is not granted a shell, which could write past the worktree boundary", () => {
    expect(gateMaintenanceRoleConfig.allowedTools).not.toContain("Bash");
  });

  it("tells the session it repairs the environment and never the checks", () => {
    expect(gateMaintenanceRoleConfig.systemPromptFragment).toMatch(/environment/);
    expect(gateMaintenanceRoleConfig.systemPromptFragment).toMatch(/never .*checks/i);
  });

  it("replies with the same completed/escalate shape as the worker", () => {
    expect(
      gateMaintenanceRoleConfig.envelopeSchema.safeParse({ status: "completed", rationale: "fixed .env" }).success,
    ).toBe(true);
    expect(
      gateMaintenanceRoleConfig.envelopeSchema.safeParse({ status: "fix_the_gate", rationale: "x" }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing invocation test**

Append to `src/agent-invoke.test.ts` (add `gateMaintenanceRoleConfig` to its `./role-config.js` import, and `readFile` is already imported from `node:fs/promises`):

```ts
describe.skipIf(!hasMock)("invoking gate-maintenance through the same seam as the worker", () => {
  it("repairs an environment file and returns a completed terminus, as the worker's clean case does", async () => {
    await writeFile(join(worktreePath, ".env"), "PORT=\n", "utf-8");
    await script([
      {
        effects: [{ edit: { path: ".env", old: "PORT=", new: "PORT=8080" } }],
        json: { status: "completed", rationale: "set the missing PORT in .env so the service can start" },
      },
    ]);

    const terminus = await invoke(
      gateMaintenanceRoleConfig,
      { worktreePath, dir, sessionKey: "gate-maintenance-1-0" },
      useMock(),
    );

    expect(terminus).toEqual({
      status: "completed",
      rationale: "set the missing PORT in .env so the service can start",
    });
    expect(await readFile(join(worktreePath, ".env"), "utf-8")).toBe("PORT=8080\n");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/role-config.test.ts src/agent-invoke.test.ts`
Expected: FAIL — `gateMaintenanceRoleConfig` is not exported. (If `claude-mock` is not on `PATH`, the invocation test is skipped: install it with `npm link` from its own checkout before continuing, so Step 5 genuinely exercises it.)

- [ ] **Step 4: Add the reference configuration**

In `src/role-config.ts`, directly after `workerRoleConfig`:

```ts
/**
 * The reference gate-maintenance configuration. Same seam, same reply shape as
 * the worker; only the content differs.
 *
 * It may edit files because repairing the environment means editing files. It
 * cannot edit the checks because they live outside the worktree and the tool
 * guard refuses any call aimed outside it. It is deliberately not given `Bash`:
 * a shell can write past that boundary in ways the runtime does not always flag.
 */
export const gateMaintenanceRoleConfig: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: [
    "You are gate maintenance on a gated delivery harness.",
    "The project's gate could not run. Repair the environment inside the working tree",
    "(configuration, fixtures, dependency manifests) so that the gate can run again.",
    "You never edit, weaken, or work around the checks themselves: they are pinned by",
    "the harness, kept outside your working tree, and any attempt to touch them is refused.",
    "If the only fix is a change to a check, escalate instead.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"],
};
```

In `src/index.ts`, line 67 becomes:

```ts
export { WorkerEnvelope, workerRoleConfig, gateMaintenanceRoleConfig, validateRoleConfig } from "./role-config.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/role-config.test.ts src/agent-invoke.test.ts`
Expected: PASS, with the gate-maintenance invocation test run (not skipped).

- [ ] **Step 6: Commit**

```bash
git add src/role-config.ts src/role-config.test.ts src/agent-invoke.test.ts src/index.ts
git commit -m "Add the reference gate-maintenance role config

Proves the invocation seam generalises: a second, narrower role runs
through the unchanged invoke() with nothing but new configuration, and a
clean environment repair returns the same completed terminus as the worker.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The "configuring a role" guide, for both roles

**Files:**
- Create: `docs/configuring-a-role.md`
- Modify: `README.md` ("Documentation" list)
- Modify: `docs/agent-interface.md` (one pointer line at the end of "Roles as configs")

**Interfaces:**
- Consumes: the public exports `invoke`, `workerRoleConfig`, `gateMaintenanceRoleConfig`, `WorkerEnvelope`, `validateRoleConfig`, `InvalidRoleConfig`, `create`, and types `RoleConfig`, `AgentContext`, `Terminus`, `SessionEnvironment` from `src/index.ts`; the demo scripts `demo:agent-slice-1` and `demo:agent-slice-3` (Task 4 adds the latter).
- Produces: a standalone chapter an extender follows without opening `src/`.

No unit test: this is prose, verified by the UAT phase's cold-read. The self-check below is the task's gate.

- [ ] **Step 1: Write the guide**

Create `docs/configuring-a-role.md` with exactly this content:

````markdown
# Configuring a role

This guide gets you from nothing to a first successful agent invocation for either
of the two roles the harness ships: the **worker** and **gate-maintenance**. You do
not need to read any source to follow it.

## What a role is

The harness has one way of running an agent: `invoke(roleCfg, ctx)`. It starts one
fresh agent session, sends it a prompt the harness assembles from the case file,
and hands back exactly one result. A **role** is nothing more than the
configuration you pass as `roleCfg`. You never write invocation code for a new
role; you write a new configuration.

A role configuration has four fields:

| Field | What it is | What happens if it is wrong |
|---|---|---|
| `role` | `"worker"` or `"gate-maintenance"` | Rejected before any session starts |
| `systemPromptFragment` | Who the agent is and what it is for, in plain sentences. Must not be empty. | Rejected before any session starts |
| `envelopeSchema` | The reply shape the agent must end with. Use `WorkerEnvelope` for both roles. | Rejected before any session starts |
| `allowedTools` | The tools the agent may use, e.g. `["Read", "Edit"]`. Must not be empty. This is the role's entire blast radius. | Rejected before any session starts |

A mistake in any field throws `InvalidRoleConfig`, naming the field, before an
agent is started. It is never reported as a failed run.

Everything below is imported from the harness's single entry point,
`./src/index.js` from the repository root (the harness is not published as a
package yet). Run the snippets with `npx tsx`.

## The two reference configurations

Start from one of these. Copy it, change the sentences to suit your project, and
narrow the tools if you want.

**Worker**: makes the change the task asks for, inside the working tree.

```ts
import { WorkerEnvelope, type RoleConfig } from "./src/index.js";

export const myWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: [
    "You are the worker on a gated delivery harness.",
    "You make the smallest change to the working tree that satisfies the task below.",
    "If you cannot proceed and no further attempt would help, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};
```

**Gate-maintenance**: repairs the environment so the project's checks can run,
and never touches the checks themselves.

```ts
import { WorkerEnvelope, type RoleConfig } from "./src/index.js";

export const myGateMaintenance: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: [
    "You are gate maintenance on a gated delivery harness.",
    "Repair the environment inside the working tree so that the gate can run again.",
    "You never edit, weaken, or work around the checks themselves.",
    "If the only fix is a change to a check, escalate instead.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"],
};
```

The two are also exported ready-made as `workerRoleConfig` and
`gateMaintenanceRoleConfig`.

The only differences between them are the sentences and the tool list. The call
you make is identical.

## Making your first invocation

You need two directories: a **case file** directory (the harness's record of the
run) and a **worktree** (the files the agent works on). `invoke` reads the task
from the case file and runs the agent inside the worktree.

```ts
import { create, invoke, gateMaintenanceRoleConfig } from "./src/index.js";

const dir = "/tmp/my-run/case";          // the case file directory
const worktreePath = "/tmp/my-run/tree"; // the agent's working tree

await create(
  dir,
  {
    surfaceId: "my-first-run",
    taskDef: { intent: "the gate cannot start: repair its environment" },
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

const result = await invoke(gateMaintenanceRoleConfig, {
  worktreePath,
  dir,
  sessionKey: "gate-maintenance-1-0", // a label for this attempt's transcript
});

console.log(result);
```

To run the worker instead, pass `workerRoleConfig` (or your own worker config).
Nothing else changes.

`invoke` uses the `claude` command on your machine and needs whatever credentials
that command needs. To try it without a real agent or an API key, see "Trying it
offline" below.

## What comes back

Always exactly one of three results:

| `status` | Meaning | What the harness does next |
|---|---|---|
| `completed` | The agent finished and says why, in `rationale`. | Runs the gate to judge the work. The agent's word is never taken as proof. |
| `escalate` | The agent says it cannot go on, with a `category` of `exhaustion` or `authority`. | Stops retrying that step and escalates. |
| `incomplete` | The session produced nothing usable. `rationale` says which of these it was, in plain English: it crashed, it ended without a reply, it replied in the wrong shape, it could not be started, or it tried something it is not allowed to do. | Retries, within the run's budget. |

You will never get a stack trace or raw error text in `rationale`.

## What a role cannot do

Two rules are enforced by the harness itself, not requested of the agent:

1. **Only the tools in `allowedTools`.** Any other tool call is refused before it runs.
2. **Only inside the worktree.** Any call aimed at a file outside the worktree is
   refused before it runs, even with a tool the role is allowed. This is how
   gate-maintenance can edit files but can never edit the project's checks: keep
   the checks outside the worktree and they are out of every role's reach.

A refusal comes back as `incomplete`, with a sentence naming the role, what it
tried, and that the refusal was the boundary working as intended.

One limit to know about: if you grant `Bash`, the agent's shell can write to
places the harness cannot always see. That is why the gate-maintenance reference
configuration does not grant it. Grant `Bash` only to a role you would trust
with the whole machine the run executes on.

## Trying it offline

`claude-mock` is a scripted stand-in for the `claude` command. It is a separate
project, not included here: install it with `npm link` from its own checkout so
that `claude-mock` works from your shell. Then pass a third argument to `invoke`:

```ts
const ctx = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
const result = await invoke(gateMaintenanceRoleConfig, ctx, {
  pathToClaudeCodeExecutable: "claude-mock",
  env: { ...process.env, CLAUDE_MOCK_SCRIPT: "/tmp/my-run/mock.json" },
});
```

where `/tmp/my-run/mock.json` scripts what the agent does and replies, for example:

```json
[
  {
    "effects": [{ "edit": { "path": ".env", "old": "PORT=", "new": "PORT=8080" } }],
    "json": { "status": "completed", "rationale": "set the missing PORT in .env" }
  }
]
```

The ready-made demos do exactly this, one per role:

```bash
npm run demo:agent-slice-1   # worker
npm run demo:agent-slice-3   # gate-maintenance
```

The mock does not model tool permissions, so it cannot show a refusal happening
inside a live session. The demos show the refusal by driving the harness's own
decision directly; the live guarantee comes from the real `claude` runtime.
````

- [ ] **Step 2: Verify the guide's imports are real public exports**

The guide imports from the entry point `./src/index.js` (the package has no `main`/`exports`, so a bare package name would not resolve). Confirm each named import exists:

Run: `grep -nE "WorkerEnvelope|gateMaintenanceRoleConfig|workerRoleConfig|create,|invoke,|RoleConfig" src/index.ts`
Expected: every name the guide imports (`WorkerEnvelope`, `RoleConfig`, `create`, `invoke`, `gateMaintenanceRoleConfig`, `workerRoleConfig`) appears in an `export` line.

Confirm the guide never sends the reader to source:

Run: `grep -nE "src/|\.d\.ts|agent-interface" docs/configuring-a-role.md | grep -v "src/index.js"`
Expected: no output (the entry-point import is the only permitted mention of `src/`).

- [ ] **Step 3: Link the guide**

In `README.md`, the "Documentation" list becomes:

```markdown
- [Design docs](docs/)
- [Configuring a role](docs/configuring-a-role.md): set up a worker or gate-maintenance agent
- [Contributing](CONTRIBUTING.md)
```

In `docs/agent-interface.md`, at the end of the "Roles as configs" section (after "the primitive does not branch on role."), add:

```markdown
For the extender's how-to, with both reference configurations, see
[Configuring a role](configuring-a-role.md).
```

- [ ] **Step 4: Commit**

```bash
git add docs/configuring-a-role.md README.md docs/agent-interface.md
git commit -m "Add the configuring-a-role guide for worker and gate-maintenance

This item commits that an extender reaches a first successful invocation of
either role it ships without reading source; the guide is that path, with
both reference configs, the call, the results, and the offline story.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The gate-maintenance demo

**Files:**
- Create: `demos/agent-invocation-slice-3-gate-maintenance.ts`
- Modify: `package.json` (scripts)
- Modify: `eslint.config.js:24`

**Interfaces:**
- Consumes: `create` (`src/case-file.ts`), `invoke` (`src/agent-invoke.ts`), `gateMaintenanceRoleConfig` (Task 2), `createToolAuthority(roleCfg, worktreePath)` and `authorityRefusal(roleCfg, refusals, denials)` (Task 1), `isOnPath` (`src/on-path.ts`).
- Produces: `npm run demo:agent-slice-3`, printing four numbered sections whose headings the UAT phase will assert on: `1. The gate-maintenance role's configuration`, `2. Scenario: repair a broken environment file`, `3. Scenario: try to edit one of the project's checks`, `4. What this shows`.

No unit test: the demo composes functions Tasks 1 and 2 test, and the UAT phase records a test against its output. The run in Step 3 is the task's gate.

- [ ] **Step 1: Write the demo**

Create `demos/agent-invocation-slice-3-gate-maintenance.ts`:

```ts
/**
 * UAT demo for Agent Invocation Primitive Slice 3: Configure a Second Role
 * Using the Same Seam, Nothing Rebuilt.
 *
 * Runs the reference gate-maintenance configuration through the same
 * `invoke()` the worker uses, against a scripted session that repairs a broken
 * environment file; then has the role reach for one of the project's checks,
 * kept outside the worktree, and prints the refusal.
 *
 * READ THIS BEFORE TRUSTING THE OUTPUT: `claude-mock` models no tool
 * permissions, so it cannot be scripted to issue a tool call the harness then
 * refuses. Scenario 2 therefore drives the harness's own decision path — the
 * exact guard the SDK consults and the exact terminus `invoke` returns — as the
 * Slice 2 demo does. The live guarantee rests on the real agent runtime.
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed.
 *
 * Usage: npx tsx demos/agent-invocation-slice-3-gate-maintenance.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create } from "../src/case-file.js";
import { invoke } from "../src/agent-invoke.js";
import { gateMaintenanceRoleConfig } from "../src/role-config.js";
import { authorityRefusal, createToolAuthority } from "../src/tool-authority.js";
import { isOnPath } from "../src/on-path.js";
import type { AgentContext } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
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

async function main(): Promise<void> {
  requireMock();

  const run = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-maint-"));
  const dir = path.join(run, "case");
  const worktreePath = path.join(run, "tree");
  const checksDir = path.join(run, "checks");
  for (const d of [dir, worktreePath, checksDir]) fs.mkdirSync(d, { recursive: true });

  // The environment the gate needs, broken: PORT is empty, so the service cannot start.
  const envFile = path.join(worktreePath, ".env");
  fs.writeFileSync(envFile, "PORT=\n", "utf-8");

  // One of the project's actual checks, pinned outside the worktree.
  const checkFile = path.join(checksDir, "greeting.check.sh");
  fs.writeFileSync(checkFile, "curl -sf localhost:$PORT/greeting | grep -q hello\n", "utf-8");

  const gateRef: GateRef = { type: "command", command: `sh ${checkFile}`, parseMode: "tap" };
  await create(
    dir,
    {
      surfaceId: "gate-maintenance-demo",
      taskDef: { intent: "the gate cannot start the service: repair its environment" },
      gateRef,
      domainPrompt: "This is a small HTTP service configured through .env.",
    },
    budgets,
  );

  console.log("1. The gate-maintenance role's configuration");
  console.log(`   Role:            ${gateMaintenanceRoleConfig.role}`);
  console.log(`   Permitted tools: ${gateMaintenanceRoleConfig.allowedTools.join(", ")}`);
  console.log(`   Worktree:        ${worktreePath}`);
  console.log(`   Project checks:  ${checksDir} (outside the worktree)`);
  console.log("   Invocation code: the same invoke() the worker uses; only this config differs\n");

  console.log("2. Scenario: repair a broken environment file");
  console.log(`   Before: .env = ${JSON.stringify(fs.readFileSync(envFile, "utf-8"))}`);
  const scriptPath = path.join(run, "mock.json");
  fs.writeFileSync(
    scriptPath,
    JSON.stringify([
      {
        effects: [{ edit: { path: ".env", old: "PORT=", new: "PORT=8080" } }],
        json: { status: "completed", rationale: "set the missing PORT in .env so the service can start" },
      },
    ]),
    "utf-8",
  );
  const ctx: AgentContext = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
  const repaired = await invoke(gateMaintenanceRoleConfig, ctx, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  });
  console.log(`   After:  .env = ${JSON.stringify(fs.readFileSync(envFile, "utf-8"))}`);
  console.log(`   Result: ${repaired.status} — ${repaired.rationale}\n`);

  console.log("3. Scenario: try to edit one of the project's checks");
  console.log(`   Attempt: Edit ${checkFile}`);
  console.log("            (Edit IS in this role's permitted tools)");
  const authority = createToolAuthority(gateMaintenanceRoleConfig, worktreePath);
  const decision = await authority.canUseTool(
    "Edit",
    { file_path: checkFile, old_string: "grep -q hello", new_string: "true" },
    { signal: new AbortController().signal, toolUseID: "demo-edit", requestId: "demo-request" },
  );
  console.log(`   Decision: ${decision?.behavior ?? "(none)"}`);
  const refused = authorityRefusal(gateMaintenanceRoleConfig, authority.refusals, []);
  console.log(`   Result:   ${refused?.status ?? "(no refusal recorded)"}`);
  console.log(`   Reason:   ${refused?.rationale ?? "-"}`);
  console.log(`   Check file unchanged: ${fs.readFileSync(checkFile, "utf-8").includes("grep -q hello") ? "yes" : "NO"}\n`);

  console.log("4. What this shows");
  console.log(
    "   A second, narrower role ran through the unchanged invocation seam with nothing\n" +
      "   but a new configuration, and got the same kind of result as a worker's clean\n" +
      "   completion. Its edit tools reach the environment but not the checks: a call aimed\n" +
      "   outside the worktree is refused by the same guard that refuses out-of-role tools.\n" +
      "   Note: claude-mock models no tool permissions, so scenario 3 drives the harness's\n" +
      "   own guard directly; the live guarantee rests on the real agent runtime.\n" +
      "   Guide: docs/configuring-a-role.md",
  );
}

await main();
```

`toolUseID` and `requestId` are the SDK's required fields on `canUseTool`'s options (SDK 0.3.266); do not cast.

- [ ] **Step 2: Register the demo and lift the lint ceiling**

In `package.json` scripts, after `"demo:agent-slice-2"`:

```json
    "demo:agent-slice-3": "npx tsx demos/agent-invocation-slice-3-gate-maintenance.ts",
```

In `eslint.config.js`, line 24 becomes:

```js
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 50,
```

(39 files matched before this slice; this demo makes 40 and the UAT phase's recorded test would make 41.)

- [ ] **Step 3: Run the demo and lint it**

Run: `npm run demo:agent-slice-3 && npx eslint demos/agent-invocation-slice-3-gate-maintenance.ts eslint.config.js`
Expected: exit 0; section 2 prints `After:  .env = "PORT=8080\n"` and `Result: completed — set the missing PORT in .env so the service can start`; section 3 prints `Decision: deny`, `Result:   incomplete`, a reason containing `gate-maintenance`, `outside the worktree` and `working as intended`, and `Check file unchanged: yes`. ESLint reports nothing.

- [ ] **Step 4: Commit**

```bash
git add demos/agent-invocation-slice-3-gate-maintenance.ts package.json eslint.config.js
git commit -m "Add the gate-maintenance invocation demo

Gives the slice's UAT a runnable proof: the reference gate-maintenance
config repairs an environment file through the unchanged seam, and its
attempt to edit a check kept outside the worktree is refused by the guard.
Lifts the lint project-service ceiling, which this demo would otherwise sit
at and the recorded UAT test would breach.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
