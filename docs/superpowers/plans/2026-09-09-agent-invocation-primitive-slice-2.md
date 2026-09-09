# Agent Invocation Primitive — Slice 2: A Role Cannot Act Outside What It Was Given Permission to Touch

> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`

**Goal:** Make a role's `allowedTools` an enforced boundary at the SDK seam: an out-of-role tool call is refused before it runs, and the harness reports that refusal as an `incomplete` terminus whose message names the role, the tool, and that the refusal was deliberate.

**Architecture:** Enforcement lives in one new pure module, `src/tool-authority.ts`, which produces the SDK's `canUseTool` callback for a `RoleConfig`, records every out-of-role attempt, and owns the single English sentence used for both the model-facing deny message and the harness-facing terminus. `src/agent-invoke.ts` installs that callback, builds its SDK `Options` field-by-field from a narrowed caller parameter (no spread, no caller-supplied permission fields), and lets an authority refusal take precedence over every other terminus mapping. `result.permission_denials` is folded in as a second source and classified by tool name before it is believed.

**Tech Stack:** TypeScript (ESM, Node ≥22), `@anthropic-ai/claude-agent-sdk`, zod v4, vitest, `claude-mock` (sibling project, resolved from `PATH`).

## Global Constraints

- Node ≥22, TypeScript, existing `eslint`/`typescript-eslint` config, `vitest`. No new dependency of any kind for this slice.
- **Buy-vs-build (inherited from the spec):** the SDK is the enforcement mechanism — no hand-rolled permission layer, no second schema language, no path guard. zod stays the only schema library.
- **Build note (inherited, binding):** the enforcement point is `canUseTool`, and only `canUseTool`.
  - `tools` is **not** narrowed to the role's list (narrowing it silences the guard — the model never issues the call).
  - `allowedTools` is **not** set to the role's list (a bare `allowedTools` entry auto-approves before `canUseTool` is consulted, making the guard dead code; the SDK warns about this at runtime). `canUseTool` is itself the programmatic prompt surface, so an unattended run still never stalls.
  - The guard is the only decision point, closed by construction: pin `settingSources: []`, pin `permissionMode`, accept no hooks and no plugins, and narrow the caller's session-options parameter to an **allowlist** of the executable path and its environment. A spread of caller options with permission fields written back over it is a deny-list and is forbidden.
  - `result.permission_denials` is read as a second source but **classified, never trusted wholesale**: only a denial whose `tool_name` is outside `role_cfg.allowedTools` is a role-authority refusal. An in-role denial is an ordinary "did not complete" and carries no claim about authority.
- **Operability / DX (inherited, binding):** `claude-mock` does not model tool permissions, so no automated test can drive a real out-of-role call through it. Only a smoke-level check is possible without the real runtime. The demo and the docs must say this plainly — it is a known, documented gap, not a silent hole.
- Messages a project owner reads never carry a stack trace, an exception message, or an SDK identifier — state, cause class, plain English (Item 3's DX precedent, already honoured by `DID_NOT_COMPLETE`).

## Scaffolding Impact

- `docs/agent-interface.md` — its "Tool authority" section says `allowedTools` is "passed to the session", and its `INCOMPLETE_TERMINUS` table has no refusal row. Both describe behaviour this slice changes → updated in Task 2.
- `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` — its Architecture "Tool authority enforcement" paragraph and its buy-vs-build row still describe the superseded `tools` + `allowedTools` mechanism. A one-line supersession pointer to the slice scope's Build note → added in Task 2.
- `package.json` — new `demo:agent-slice-2` script for the new demo → added in Task 3.
- `eslint.config.js` — `demos/*.ts` is already in `allowDefaultProject`; the file-count ceiling (40) has headroom for one more demo, so no change is needed. Confirmed, not assumed.
- No new env var, dependency, or build step. `npm test` and `npm run lint` are unchanged.

**Known risk, flagged not designed around:** `canUseTool` makes the SDK register a permission surface over the control protocol with the spawned CLI. `claude-mock` implements the control protocol but has never been driven with `canUseTool` set. Task 2's smoke test is what proves the wiring survives it. If the mock cannot negotiate it, that is a finding to report — the fix belongs in `claude-mock`'s own repo (Item 7's territory), not here, and the smoke test degrades to a documented skip.

---

## Task 1: Tool authority — the guard, its sentence, and the classification of denials

**Files:**
- Create: `src/tool-authority.ts`
- Create: `src/tool-authority.test.ts`
- Modify: `src/index.ts` (add exports alongside the existing ones)

**Interfaces:**
- Consumes: `RoleConfig` from `./role-config.js` (fields used: `role`, `allowedTools`); `Terminus` from `./ports.js`; `CanUseTool`, `PermissionResult`, `SDKPermissionDenial` types from `@anthropic-ai/claude-agent-sdk`.
- Produces, all from `src/tool-authority.ts`:
  - `refusalSentence(roleCfg: RoleConfig, tool: string): string`
  - `createToolAuthority(roleCfg: RoleConfig): ToolAuthority` where `interface ToolAuthority { canUseTool: CanUseTool; attempted: readonly string[] }`
  - `authorityRefusal(roleCfg: RoleConfig, attempted: readonly string[], denials: readonly { tool_name: string }[]): Terminus | undefined`

- [ ] **Step 1: Write the failing tests**

Create `src/tool-authority.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createToolAuthority, refusalSentence, authorityRefusal } from "./tool-authority.js";
import type { RoleConfig } from "./role-config.js";
import { WorkerEnvelope } from "./role-config.js";

const readOnlyWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: "You are a read-only worker.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob"],
};

/** The options bag the SDK passes as `canUseTool`'s third argument. */
const sdkCallOptions = { signal: new AbortController().signal };

describe("the guard the SDK consults before each tool call", () => {
  it("allows a tool the role's config names", async () => {
    const authority = createToolAuthority(readOnlyWorker);
    const decision = await authority.canUseTool("Read", { file_path: "/x" }, sdkCallOptions);
    expect(decision).toEqual({ behavior: "allow", updatedInput: { file_path: "/x" } });
    expect(authority.attempted).toEqual([]);
  });

  it("denies a tool outside the role's config and says why in plain English", async () => {
    const authority = createToolAuthority(readOnlyWorker);
    const decision = await authority.canUseTool("Bash", { command: "rm -rf /" }, sdkCallOptions);
    expect(decision.behavior).toBe("deny");
    if (decision.behavior !== "deny") return;
    expect(decision.message).toBe(refusalSentence(readOnlyWorker, "Bash"));
  });

  it("records each out-of-role attempt so the harness can report it afterwards", async () => {
    const authority = createToolAuthority(readOnlyWorker);
    await authority.canUseTool("Bash", {}, sdkCallOptions);
    await authority.canUseTool("Read", {}, sdkCallOptions);
    await authority.canUseTool("WebFetch", {}, sdkCallOptions);
    expect(authority.attempted).toEqual(["Bash", "WebFetch"]);
  });
});

describe("the sentence a refusal is reported with", () => {
  it("names the role, the tool, the permitted tools, and that this was deliberate", () => {
    const sentence = refusalSentence(readOnlyWorker, "Bash");
    expect(sentence).toContain("worker");
    expect(sentence).toContain("Bash");
    expect(sentence).toContain("Read, Glob");
    expect(sentence).toContain("working as intended");
  });

  it("never reads as an unexplained failure", () => {
    const sentence = refusalSentence(readOnlyWorker, "Bash");
    expect(sentence).toContain("refused");
    expect(sentence).toContain("not a fault in the run");
    expect(sentence).not.toMatch(/error|Error|exception|denied by the SDK/);
  });
});

describe("classifying what a finished session refused", () => {
  it("reports nothing when no out-of-role tool was attempted", () => {
    expect(authorityRefusal(readOnlyWorker, [], [])).toBeUndefined();
  });

  it("turns a recorded out-of-role attempt into one incomplete terminus", () => {
    const terminus = authorityRefusal(readOnlyWorker, ["Bash"], []);
    expect(terminus).toEqual({
      status: "incomplete",
      rationale: `worker session did not complete: ${refusalSentence(readOnlyWorker, "Bash")}`,
    });
  });

  it("reads the SDK's own denial record as a second source", () => {
    const terminus = authorityRefusal(readOnlyWorker, [], [
      { tool_name: "Write", tool_use_id: "t1", tool_input: {} },
    ]);
    expect(terminus?.rationale).toContain("Write");
  });

  it("makes no authority claim about a denial of a tool the role was permitted", () => {
    expect(
      authorityRefusal(readOnlyWorker, [], [{ tool_name: "Read", tool_use_id: "t1", tool_input: {} }]),
    ).toBeUndefined();
  });

  it("reports the first out-of-role tool once, however many sources saw it", () => {
    const terminus = authorityRefusal(readOnlyWorker, ["Bash"], [
      { tool_name: "Bash", tool_use_id: "t1", tool_input: {} },
    ]);
    expect(terminus?.rationale).toBe(
      `worker session did not complete: ${refusalSentence(readOnlyWorker, "Bash")}`,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tool-authority.test.ts`
Expected: FAIL — `Failed to resolve import "./tool-authority.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/tool-authority.ts`:

```ts
import type { CanUseTool, PermissionResult, SDKPermissionDenial } from "@anthropic-ai/claude-agent-sdk";
import type { RoleConfig } from "./role-config.js";
import type { Terminus } from "./ports.js";

/**
 * The one sentence a refusal is ever reported with — to the model in the deny
 * message, and to the project owner in the terminus rationale.
 *
 * It is deliberately not phrased as an error. A reader with no source access
 * has to be able to tell an intentional boundary from a malfunction, so the
 * sentence names the role, the tool it reached for, what it may use instead,
 * and says outright that the refusal was the point.
 */
export function refusalSentence(roleCfg: RoleConfig, tool: string): string {
  return (
    `the ${roleCfg.role} role is not permitted to use ${tool}, so the harness refused the call ` +
    `before it ran. This role may use only: ${roleCfg.allowedTools.join(", ")}. ` +
    `That refusal is the harness's permission boundary working as intended, not a fault in the run.`
  );
}

/** The live guard for one session, plus what it caught. */
export interface ToolAuthority {
  /** Handed to the SDK. Consulted before each tool execution. */
  canUseTool: CanUseTool;
  /** Out-of-role tools this session reached for, in the order it reached for them. */
  attempted: readonly string[];
}

/**
 * Build the session's single authority decision point.
 *
 * This is the whole enforcement mechanism: `tools` is left at the SDK's base
 * set on purpose, so the model can still *issue* an out-of-role call and this
 * callback can refuse it observably. Narrowing `tools` would make the attempt
 * impossible and the refusal unreportable — which is the guarantee this seam
 * exists to demonstrate.
 */
export function createToolAuthority(roleCfg: RoleConfig): ToolAuthority {
  const attempted: string[] = [];
  const canUseTool: CanUseTool = (toolName, input): Promise<PermissionResult> => {
    if (roleCfg.allowedTools.includes(toolName)) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    attempted.push(toolName);
    return Promise.resolve({ behavior: "deny", message: refusalSentence(roleCfg, toolName) });
  };
  return { canUseTool, attempted };
}

/**
 * Decide whether this session ended against its authority boundary.
 *
 * Two sources, because neither alone is complete: the guard's own record, and
 * the SDK's `permission_denials` (which catches denials resolved before the
 * callback runs). The SDK's record is classified, never believed wholesale —
 * a denial of a tool the role *was* permitted is an ordinary failed run and
 * says nothing about authority.
 */
export function authorityRefusal(
  roleCfg: RoleConfig,
  attempted: readonly string[],
  denials: readonly Pick<SDKPermissionDenial, "tool_name">[],
): Terminus | undefined {
  const outOfRole = [...attempted, ...denials.map((denial) => denial.tool_name)].filter(
    (tool) => !roleCfg.allowedTools.includes(tool),
  );
  const first = outOfRole.at(0);
  if (first === undefined) return undefined;
  return {
    status: "incomplete",
    rationale: `${roleCfg.role} session did not complete: ${refusalSentence(roleCfg, first)}`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tool-authority.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Export the module from the package surface**

In `src/index.ts`, immediately after the line `export { invoke, DID_NOT_COMPLETE } from "./agent-invoke.js";`, add:

```ts
export { createToolAuthority, refusalSentence, authorityRefusal } from "./tool-authority.js";
export type { ToolAuthority } from "./tool-authority.js";
```

- [ ] **Step 6: Lint and typecheck the new module**

Run: `npm run lint`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tool-authority.ts src/tool-authority.test.ts src/index.ts
git commit -m "Add the tool-authority guard and its refusal message

A role's allowedTools was authored but never enforced: it was config a
reader had to trust. This is the decision point the SDK consults before
each tool call, and the single sentence a refusal is reported with, kept
in one place so the model and the project owner read the same words.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Install the guard as the session's only decision point

**Files:**
- Modify: `src/agent-invoke.ts` (the `invoke` signature, `lastResult`, and a new exported `buildSessionOptions`)
- Modify: `src/agent-invoke.test.ts` (add the new describe blocks below; existing tests are unchanged)
- Modify: `src/index.ts` (export the narrowed caller type)
- Modify: `docs/agent-interface.md` ("Tool authority" section and the `INCOMPLETE_TERMINUS` table)
- Modify: `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md` (supersession pointer)

**Interfaces:**
- Consumes: `createToolAuthority`, `authorityRefusal` from `./tool-authority.js` (Task 1).
- Produces:
  - `export interface SessionEnvironment { pathToClaudeCodeExecutable?: string; env?: Record<string, string | undefined> }`
  - `export function buildSessionOptions(roleCfg: RoleConfig, ctx: AgentContext, session: SessionEnvironment, canUseTool: CanUseTool): Options`
  - `invoke(roleCfg: RoleConfig, ctx: AgentContext, session?: SessionEnvironment): Promise<Terminus>` — the third parameter narrows from `Partial<Options>` to `SessionEnvironment`. Every existing caller (`src/agent-invoke.test.ts`, `demos/agent-invocation-slice-1-worker-invocation.ts`) already passes exactly `{ pathToClaudeCodeExecutable, env }`, so no call site changes.

- [ ] **Step 1: Write the failing tests**

Append to `src/agent-invoke.test.ts` (and add `buildSessionOptions` to the existing import from `./agent-invoke.js`, plus `import { createToolAuthority } from "./tool-authority.js";`):

```ts
describe("the session options the primitive builds", () => {
  function options() {
    return buildSessionOptions(
      workerRoleConfig,
      ctx,
      { pathToClaudeCodeExecutable: "claude-mock", env: { A: "1" } },
      createToolAuthority(workerRoleConfig).canUseTool,
    );
  }

  it("installs the role's guard as the permission decision point", () => {
    expect(typeof options().canUseTool).toBe("function");
  });

  it("does not narrow the session's base tool set, which would silence the guard", () => {
    expect(options().tools).toBeUndefined();
  });

  it("does not auto-approve the role's tools, which would make the guard dead code", () => {
    expect(options().allowedTools).toBeUndefined();
  });

  it("closes every route round the guard by construction", () => {
    const built = options();
    expect(built.settingSources).toEqual([]);
    expect(built.permissionMode).toBe("default");
    expect(built.permissionPrompts).toBe("host");
    expect(built.hooks).toBeUndefined();
    expect(built.plugins).toBeUndefined();
    expect(built.permissionPromptToolName).toBeUndefined();
    expect(built.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("takes only the executable and its environment from the caller", () => {
    const built = buildSessionOptions(
      workerRoleConfig,
      ctx,
      // A caller reaching for a permission field cannot: the parameter type has no
      // such field, and nothing is spread. Cast to prove the runtime behaviour too.
      { pathToClaudeCodeExecutable: "claude-mock", permissionMode: "bypassPermissions" } as never,
      createToolAuthority(workerRoleConfig).canUseTool,
    );
    expect(built.pathToClaudeCodeExecutable).toBe("claude-mock");
    expect(built.permissionMode).toBe("default");
  });

  it("still points the session at the run's worktree", () => {
    expect(options().cwd).toBe(worktreePath);
  });
});

describe.skipIf(!hasMock)("invoke with the guard installed", () => {
  it("still drives a scripted session to a clean terminus", async () => {
    await script([{ json: { status: "completed", rationale: "guard installed, run unaffected" } }]);
    const terminus = await invoke(workerRoleConfig, ctx, useMock());
    expect(terminus).toEqual({
      status: "completed",
      rationale: "guard installed, run unaffected",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agent-invoke.test.ts`
Expected: FAIL — `buildSessionOptions` is not exported from `./agent-invoke.js`.

- [ ] **Step 3: Rewrite the SDK call path in `src/agent-invoke.ts`**

Replace the import line and everything from `export async function invoke` to the end of the file with:

```ts
import { query, type CanUseTool, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
```

(the `z`, `load`, `assemblePrompt`, `resolveEvidence`, `validateRoleConfig` imports stay as they are), plus:

```ts
import { authorityRefusal, createToolAuthority } from "./tool-authority.js";
```

Then:

```ts
/**
 * The only session settings a caller may supply: where the CLI binary is, and
 * what environment it runs with. Deliberately an allowlist rather than a
 * `Partial<Options>` with the permission fields written back over it — a
 * deny-list silently widens the day the SDK adds an option, and the whole
 * point of this seam is that a role's authority cannot be widened from
 * outside.
 */
export interface SessionEnvironment {
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Assemble the session's options field by field.
 *
 * `tools` is left alone on purpose: narrowing it to the role's list removes
 * out-of-role tools from the session entirely, so the model never issues the
 * call and there is nothing to refuse or report. `allowedTools` is left unset
 * for the mirror-image reason — a bare entry auto-approves before `canUseTool`
 * is consulted. Authority is decided in exactly one place, and the surrounding
 * routes to a decision are pinned shut: no filesystem settings, a fixed
 * permission mode, prompts answered by this process, no hooks, no plugins.
 */
export function buildSessionOptions(
  roleCfg: RoleConfig,
  ctx: AgentContext,
  session: SessionEnvironment,
  canUseTool: CanUseTool,
): Options {
  return {
    cwd: ctx.worktreePath,
    systemPrompt: "",
    outputFormat: { type: "json_schema", schema: z.toJSONSchema(roleCfg.envelopeSchema) },
    canUseTool,
    settingSources: [],
    permissionMode: "default",
    permissionPrompts: "host",
    pathToClaudeCodeExecutable: session.pathToClaudeCodeExecutable,
    env: session.env,
  };
}

/**
 * One agent session in, exactly one terminus out.
 *
 * The primitive never retries and never branches on role: it assembles the
 * prompt, spawns one fresh session (no resume, no session id — sessions are
 * reconstructed from the case file, never continued), and validates whatever
 * came back. `session` exists so a test or demo can point the SDK at
 * `claude-mock` instead of the real CLI; it can name the binary and its
 * environment and nothing else, so a caller can never widen what the role may do.
 *
 * An out-of-role tool call outranks every other outcome. A session that reached
 * outside its authority is reported as that refusal even if it went on to emit a
 * clean envelope: the boundary event is the thing a reader must not miss, and a
 * "completed" that quietly swallowed a refusal would be the harness hiding its
 * own security boundary from the person relying on it.
 *
 * Throws `InvalidRoleConfig` — and only that — for a malformed config, before any
 * session is spawned. An extender's typo is a programming error, not a run
 * outcome: reporting it as `incomplete` would hide it behind a retry budget.
 * Every *agent* outcome, success or failure, returns as a `Terminus`.
 */
export async function invoke(
  roleCfg: RoleConfig,
  ctx: AgentContext,
  session: SessionEnvironment = {},
): Promise<Terminus> {
  validateRoleConfig(roleCfg);

  const caseFile = await load(ctx.dir);
  const { systemPrompt, prompt } = assemblePrompt(
    caseFile,
    roleCfg,
    await resolveEvidence(ctx.dir, caseFile),
  );

  const authority = createToolAuthority(roleCfg);
  const options = { ...buildSessionOptions(roleCfg, ctx, session, authority.canUseTool), systemPrompt };

  let result: SDKResultMessage | undefined;
  try {
    result = await lastResult(prompt, options);
  } catch {
    return authorityRefusal(roleCfg, authority.attempted, []) ?? incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  }

  const refusal = authorityRefusal(roleCfg, authority.attempted, result?.permission_denials ?? []);
  if (refusal) return refusal;

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
async function lastResult(prompt: string, options: Options): Promise<SDKResultMessage | undefined> {
  let result: SDKResultMessage | undefined;
  for await (const message of query({ prompt, options })) {
    if (message.type === "result") result = message;
  }
  return result;
}
```

Note on the `systemPrompt` spread: `buildSessionOptions` is the place a reviewer checks for closure, so it takes only what authority depends on and sets `systemPrompt: ""`; `invoke` supplies the assembled prompt over it. If `result.permission_denials` is absent on some result shapes, `?? []` already covers it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agent-invoke.test.ts src/tool-authority.test.ts`
Expected: PASS — the existing Slice 1 tests plus the seven new ones. If the mock-backed smoke test fails at the control-protocol handshake, stop and report it: that is the `claude-mock` risk named at the top of this plan, and its fix lives in the mock's own repo.

- [ ] **Step 5: Export the narrowed caller type**

In `src/index.ts`, change the `agent-invoke` export line to add the type:

```ts
export { invoke, DID_NOT_COMPLETE, buildSessionOptions } from "./agent-invoke.js";
export type { SessionEnvironment } from "./agent-invoke.js";
```

- [ ] **Step 6: Update the mechanism doc**

In `docs/agent-interface.md`, replace the first bullet of the "Tool authority" section (the one beginning `- **`allowedTools` is pinned in `role_cfg`**`) with:

```markdown
- **`allowedTools` is pinned in `role_cfg`** and enforced at the session's
  `canUseTool` callback — the one decision point, consulted before each tool
  execution. Triage gets a read-only set; the worker gets edit + shell;
  gate-maintenance gets edit scoped to the environment. The session's base tool
  set is deliberately *not* narrowed to that list: a role must be able to issue
  an out-of-role call so the seam can refuse it observably and name it in the
  log. The refusal is reported as `INCOMPLETE_TERMINUS` with a sentence naming
  the role, the tool, and that the boundary worked as intended.

- **The runtime is the enforcer, and the mock is not.** `claude-mock` models no
  tool permissions, so no offline test can drive a real out-of-role call
  through it. The harness's own decision path is unit-tested directly; the
  end-to-end guarantee rests on the real agent runtime. Known gap, stated
  rather than papered over.
```

In the same file's `INCOMPLETE_TERMINUS` table, add a row after `session crashed / cap / idle`:

```
out-of-role tool attempted     → INCOMPLETE_TERMINUS (authority refusal)
```

- [ ] **Step 7: Record the supersession in the design spec**

In `docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md`, at the start of the `### Tool authority enforcement` subsection, insert:

```markdown
> **Superseded during delivery.** The mechanism below (`tools` + `allowedTools`)
> was settled against itself in the slice scope's Slice 2 Build note: narrowing
> `tools` makes the refusal unobservable, and a matching `allowedTools` makes the
> guard dead code. Enforcement is at `canUseTool`, and only there. See
> `2026-09-09-agent-invocation-primitive-slices.md`, Slice 2.
```

- [ ] **Step 8: Lint and typecheck**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/agent-invoke.ts src/agent-invoke.test.ts src/index.ts docs/agent-interface.md docs/superpowers/specs/2026-09-09-agent-invocation-primitive-design.md
git commit -m "Enforce a role's tool authority at the session's canUseTool seam

The primitive previously passed allowedTools as the SDK's tools option, which
removed out-of-role tools from the session entirely: the model never issued the
call, so nothing was ever refused and no refusal could be reported. This makes
canUseTool the single decision point, leaves the base tool set alone so the
attempt can happen and be refused observably, and closes the routes round the
guard by construction rather than by spreading caller options and hoping.

An out-of-role attempt now outranks every other terminus mapping: a run that
touched its boundary reports that, never a completed that swallowed it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The tool-authority demo an extender reads

**Files:**
- Create: `demos/agent-invocation-slice-2-tool-authority.ts`
- Modify: `package.json` (add `demo:agent-slice-2`)

**Interfaces:**
- Consumes: `createToolAuthority`, `refusalSentence`, `authorityRefusal` (Task 1); `invoke`, `SessionEnvironment` (Task 2); `create` from `src/case-file.js`; `isOnPath` from `src/on-path.js`; `WorkerEnvelope`, `RoleConfig` from `src/role-config.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the demo**

Create `demos/agent-invocation-slice-2-tool-authority.ts`:

```ts
/**
 * UAT demo for Agent Invocation Primitive Slice 2: A Role Cannot Act Outside
 * What It Was Given Permission to Touch.
 *
 * Configures a role with a deliberately narrow permitted-tools list, has it
 * reach for a tool outside that list, and prints both halves of the refusal:
 * what the session is told, and what the harness reports back.
 *
 * READ THIS BEFORE TRUSTING THE OUTPUT: `claude-mock` models no tool
 * permissions, so it cannot be scripted to issue an out-of-role call. Sections
 * 2 and 3 therefore drive the harness's own decision path — the exact functions
 * the SDK calls and the exact terminus `invoke` returns — rather than routing
 * through the mock. Section 4 runs one real `invoke()` through the mock to show
 * the guard is genuinely installed on the live call path. Full end-to-end
 * enforcement rests on the real agent runtime. This is a known, documented gap.
 *
 * Requires `claude-mock` on PATH for section 4. It is a sibling project, not
 * vendored in this repo: install it with `npm link` from its own checkout. No
 * live API call is made, and no API key is needed.
 *
 * Usage: npx tsx demos/agent-invocation-slice-2-tool-authority.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create } from "../src/case-file.js";
import { invoke } from "../src/agent-invoke.js";
import { WorkerEnvelope } from "../src/role-config.js";
import { authorityRefusal, createToolAuthority } from "../src/tool-authority.js";
import { isOnPath } from "../src/on-path.js";
import type { RoleConfig } from "../src/role-config.js";
import type { AgentContext } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

/** A worker allowed to look, never to touch. The narrow list is the whole point. */
const readOnlyWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: "You are a read-only worker: report what you find, change nothing.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep"],
};

const OUT_OF_ROLE_TOOL = "Bash";

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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-authority-case-"));
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), "agent-authority-tree-"));
  const scriptPath = path.join(dir, "mock.json");

  await create(
    dir,
    {
      surfaceId: "authority-demo",
      taskDef: { intent: "report on the greeting endpoint" },
      gateRef,
      domainPrompt: "This is a small HTTP service.",
    },
    budgets,
  );

  console.log("1. The role's configuration");
  console.log(`   Role:            ${readOnlyWorker.role}`);
  console.log(`   Permitted tools: ${readOnlyWorker.allowedTools.join(", ")}`);
  console.log(`   Attempted tool:  ${OUT_OF_ROLE_TOOL} (outside the permitted list)\n`);

  // The guard the SDK consults before every tool call, driven directly.
  const authority = createToolAuthority(readOnlyWorker);
  const decision = await authority.canUseTool(
    OUT_OF_ROLE_TOOL,
    { command: "rm -rf build" },
    { signal: new AbortController().signal },
  );

  console.log("2. What the session is told when it reaches outside that list");
  console.log(`   Decision: ${decision.behavior}`);
  if (decision.behavior === "deny") console.log(`   Message:  ${decision.message}\n`);

  const terminus = authorityRefusal(readOnlyWorker, authority.attempted, []);
  console.log("3. What the harness reports back");
  console.log(`   Result: ${terminus?.status ?? "(no refusal recorded)"}`);
  console.log(`   Reason: ${terminus?.rationale ?? "-"}\n`);

  // One real invocation, to show the guard is installed on the live call path.
  fs.writeFileSync(
    scriptPath,
    JSON.stringify([{ json: { status: "completed", rationale: "read the handler, changed nothing" } }]),
    "utf-8",
  );
  const ctx: AgentContext = { worktreePath, dir, sessionKey: "worker-1-0" };
  const clean = await invoke(readOnlyWorker, ctx, {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath },
  });

  console.log("4. A real invocation with the guard installed (via claude-mock)");
  console.log(`   Result: ${clean.status} — ${clean.rationale}`);
  console.log(
    "   Note:   claude-mock models no tool permissions, so it cannot be scripted to\n" +
      "           attempt an out-of-role call. Sections 2 and 3 drive the harness's own\n" +
      "           decision path directly; the end-to-end guarantee rests on the real\n" +
      "           agent runtime. Known gap, stated rather than papered over.",
  );
}

await main();
```

- [ ] **Step 2: Run the demo and read its output**

Run: `npx tsx demos/agent-invocation-slice-2-tool-authority.ts`
Expected: four numbered sections. Section 2 prints `Decision: deny` and a message naming `worker`, `Bash`, the permitted tools, and "working as intended". Section 3 prints `Result: incomplete` with the same sentence. Section 4 prints `Result: completed — read the handler, changed nothing` followed by the gap note.

- [ ] **Step 3: Register the demo script**

In `package.json`, after the `"demo:agent-slice-1"` line, add:

```json
    "demo:agent-slice-2": "npx tsx demos/agent-invocation-slice-2-tool-authority.ts",
```

- [ ] **Step 4: Verify the script entry runs**

Run: `npm run demo:agent-slice-2`
Expected: the same four sections, exit status 0.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add demos/agent-invocation-slice-2-tool-authority.ts package.json
git commit -m "Add the tool-authority demo for slice 2

An extender has to see the boundary refuse something before trusting the
harness with a real change. The demo prints both halves of a refusal — what
the session is told and what the harness reports — and states plainly which
part claude-mock cannot exercise, so the gap is documented rather than
implied by an absence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**1. Slice coverage**

| Acceptance criterion | Task |
|---|---|
| `role_cfg` names the permitted tool set | Already shipped by Slice 1 (`RoleConfig.allowedTools`); exercised by Tasks 1 and 3 |
| An out-of-role attempt is refused before it takes effect | Task 1 (`createToolAuthority` denies), Task 2 (installed as the session's only decision point, `tools`/`allowedTools` left unset so the guard is live) |
| Refused as the same "did not complete" shape, naming role, tool, and that it is a working boundary | Task 1 (`authorityRefusal`, `refusalSentence`), Task 2 (refusal outranks other mappings) |
| The message never reads as an unexplained failure | Task 1 (test asserting the sentence carries "refused", "not a fault in the run", and no error vocabulary) |

**2. Placeholder scan:** no TBDs, no "handle edge cases", every code step carries the code.

**3. Type consistency:** `createToolAuthority` → `ToolAuthority { canUseTool, attempted }` is used with those exact names in Tasks 2 and 3. `authorityRefusal(roleCfg, attempted, denials)` keeps the same argument order everywhere. `SessionEnvironment` is the name in the signature, the export, and both call sites. `refusalSentence(roleCfg, tool)` — same arity in the module, the tests, and the demo.

**4. Right-choice re-audit**

| Decision | Pre-planning choice | What the plan does | Easy or Right |
|---|---|---|---|
| Enforcement point | `canUseTool` only, per the Build note | `canUseTool` only; `tools` and `allowedTools` both left unset, with tests that fail if either is ever set | Right |
| Caller's session parameter | Allowlist, not a spread | `SessionEnvironment` with two fields, built field-by-field, plus a test that a caller-supplied `permissionMode` cannot land | Right |
| Where the refusal sentence lives | One formatter, two consumers | `refusalSentence` used for the deny message and the terminus | Right |
| `permission_denials` | Classified, not trusted | Filtered against `allowedTools`; an in-role denial yields no authority claim, with a test for it | Right |
| Refusal vs. a clean envelope | Refusal wins | Checked before the envelope path, with the reason in the doc comment | Right (a swallowed refusal would hide the boundary from the person relying on it) |
| Read-only tools the runtime auto-approves without prompting | Cannot be closed at `canUseTool` without a deny-list, which the Build note forbids | Not code — stated as the runtime-dependent residual in the demo and in `docs/agent-interface.md` | Right (the alternative is a `disallowedTools` complement the spec rejected for having nothing to enumerate against) |
| A second reference `role_cfg` for a narrow role | Not now | The demo defines its narrow role inline; the gate-maintenance reference config is Slice 3's | Right (YAGNI) |
| Module boundary | New `src/tool-authority.ts` | The security boundary is the file a reviewer opens; keeping it inside `agent-invoke.ts` would bury it in the SDK call path | Right |

**5. Scaffolding drift:** `docs/agent-interface.md` (behaviour it describes changes → Task 2, folded into the task that changed it), the design spec's superseded paragraph (Task 2), `package.json` demo script (Task 3), `eslint.config.js` (checked — `demos/*.ts` already allowlisted, count ceiling has headroom, no change). No new env var or dependency. `npm test` and `npm run lint` are unchanged commands. No guide exists yet to update: the "writing a `role_cfg`" guide is Slice 3's deliverable, and Slice 3's own acceptance criteria cover its content.
