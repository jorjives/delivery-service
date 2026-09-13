# Close Interface — Slice 4: An Extender Writes Their Own Closer From the Guide

> **Status:** ✅ Complete — 2026-09-13 — `334ba55`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 4 of `docs/superpowers/specs/2026-09-11-close-interface-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-11-close-interface-design.md`

**Goal:** Let a project reference its own closer module by path (`{ type: "custom", modulePath, exportName? }`), load and guard it with the same mechanism custom gates use so any failure becomes an `ERROR` report, and ship a "writing a closer" guide whose worked example is the merge-back closer.

**Architecture:** First a tidy-first extraction: `custom-gate.ts`'s dynamic import, export/method validation and per-call guard move into `src/plugin-loader.ts` (`loadPlugin`, `guardMethod`), with the existing `custom-gate.test.ts` run unmodified as the regression proof. `CloseReport` becomes a zod schema so the closer guard can validate a custom closer's return value. `src/custom-closer.ts` (`loadCustomCloser`, `createCustomCloser`) mirrors `custom-gate.ts` on top of `plugin-loader.ts`. `CloserRef` gains a `custom` arm, and `resolveCloser(ref, repoPath)` takes a required `repoPath`, exactly as `resolveGate` does, so a relative `modulePath` always resolves against the repo root and never the worktree. A demo and `docs/writing-a-closer.md` complete the extender story.

**Tech Stack:** TypeScript (ESM, `node:` builtins only), zod 4, vitest, system `git` (`src/git-exec.ts` in src; `execFile` argv arrays in the guide's example).

## Global Constraints

- **Buy-vs-build (slice Build note, spec "Custom-plugin loading"):** custom-closer loading and guarding **reuses** the custom gate's mechanism, extracted **once** into `src/plugin-loader.ts` and used by both `custom-gate.ts` and `custom-closer.ts`. No second copy of the import/validate/guard code. `src/custom-gate.test.ts` must be **byte-for-byte unchanged** by this slice and pass after the extraction.
- **Error types stay distinct per plugin kind:** gates keep `GateModuleLoadFailure` / `InvalidGateExport`; closers get `CloserModuleLoadFailure` / `InvalidCloserExport`.
- **Resolution is total:** `resolveCloser` never throws; an unparseable ref, an unloadable module, a missing `close`, a throw, a rejection or a schema-invalid return all become `{ status: "ERROR", detail }` naming the cause.
- **`repoPath` is required** on `resolveCloser`, `loadCustomCloser` and `createCustomCloser`, mirroring `resolveGate`: a relative `modulePath` resolves against the repo root, never the worktree or `process.cwd()`.
- **Custom closers run in-process with the harness's authority**, the same trust model as custom gates; no new boundary.
- **No new npm dependency.** zod for schemas, `node:` builtins only.
- **Operability / DX (slice Operational note):** the guide ships as `docs/writing-a-closer.md` beside `docs/configuring-a-role.md` and `docs/writing-a-gate.md`, and must be followable without reading `src/surface.ts` or `src/provision.ts`. The demo needs only system `git`: no network, no API key, nothing to skip.
- **Spawned git in any example or test must strip inherited `GIT_*` env** (`cleanGitEnv()` in src; an inline filter in the guide's example), because this repo's `pre-push` hook runs the test suite with `GIT_DIR` set.
- **Lint:** `typescript-eslint` strict: no non-null assertions (`!`); use guards or `??`.
- **Copy:** British English, no em-dashes in the guide or demo output.

## Scaffolding Impact

- **Inherited (Operational note):** the "writing a closer" guide `docs/writing-a-closer.md` → created in Task 5, with a test that runs its worked example.
- **Reactive:** `README.md` docs list (links the role and gate guides) → gains a "Writing a closer" link in Task 5.
- **Reactive:** `resolveCloser`'s signature changes (required `repoPath`). Call sites in `demos/close-interface-slice-1-merge-back.ts`, `demos/close-interface-slice-2-branch-and-teardown.ts`, `demos/close-interface-slice-3-close-failure.ts` and `src/resolve-closer.test.ts` → updated in Task 3. No doc describes `resolveCloser`'s signature today (checked: `docs/*.md`, `README.md`).
- **Reactive:** `src/index.ts` public exports → gain `createCustomCloser`, `loadCustomCloser`, `CloserModuleLoadFailure`, `InvalidCloserExport` in Task 2.
- **Proactive:** `package.json` script `demo:close-slice-4` → added in Task 4 with its demo.
- `docs/single-surface-control-flow.md` §Close interface already describes closers as pluggable implementations keyed on `outcome`; unchanged. `docs/configuring-a-role.md`'s `retry_close` row ("the built-in closers ignore it") stays true. No env var, CI or build step changes: `tests/typecheck-coverage.test.ts` already requires every tracked `.ts` (new demo and tests included) to be in `tsconfig.json`, whose `include` covers `src`, `demos` and `tests`.

---

### Task 1: Extract the custom gate's loader and guard into a shared plugin loader

A behaviour-preserving refactor (tidy first). There is no red step: the existing `src/custom-gate.test.ts`, left unmodified, is the proof the gate behaves exactly as before.

**Files:**
- Create: `src/plugin-loader.ts`
- Modify: `src/custom-gate.ts` (whole file; the `guard` function and the body of `loadCustomGate`)
- Test (unchanged, regression proof): `src/custom-gate.test.ts`, `src/resolve-gate.test.ts`

**Interfaces:**
- Consumes: `messageOf(err: unknown): string` from `src/gate-support.ts`.
- Produces (used by Task 2):
  ```typescript
  export interface PluginErrors {
    loadFailure: new (modulePath: string, detail: string) => Error;
    invalidExport: new (modulePath: string, exportName: string, detail: string) => Error;
  }
  export function loadPlugin<T extends object>(
    repoPath: string, modulePath: string, exportName: string,
    methods: readonly (keyof T & string)[], errors: PluginErrors,
  ): Promise<T>;
  export interface PluginCallSite { plugin: string; reportName: string; method: string; modulePath: string }
  export function guardMethod<A extends unknown[], R>(
    call: (...args: A) => Promise<R>, schema: ZodType<R>,
    fail: (detail: string) => R, where: PluginCallSite,
  ): (...args: A) => Promise<R>;
  ```

- [ ] **Step 1: Confirm the regression proof is green before touching anything**

Run: `npx vitest run src/custom-gate.test.ts src/resolve-gate.test.ts`
Expected: PASS (all tests).

- [ ] **Step 2: Create `src/plugin-loader.ts`**

```typescript
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ZodType } from "zod";
import { messageOf } from "./gate-support.js";

/** The typed errors a plugin kind throws, so gates and closers keep their own. */
export interface PluginErrors {
  loadFailure: new (modulePath: string, detail: string) => Error;
  invalidExport: new (modulePath: string, exportName: string, detail: string) => Error;
}

/**
 * Load a user-supplied plugin module (a custom gate or closer). A relative
 * `modulePath` is resolved against `repoPath`, the repository root: never the
 * worktree under judgement and never the process's working directory.
 * Absolute paths pass through unchanged. Throws `errors.loadFailure` if the
 * module cannot be imported and `errors.invalidExport` if the selected export
 * is not an object carrying every named method, both before any method is
 * called.
 */
export async function loadPlugin<T extends object>(
  repoPath: string,
  modulePath: string,
  exportName: string,
  methods: readonly (keyof T & string)[],
  errors: PluginErrors,
): Promise<T> {
  const absolutePath = resolve(repoPath, modulePath);

  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  } catch (err) {
    throw new errors.loadFailure(modulePath, messageOf(err));
  }

  const exported = loaded[exportName];
  if (typeof exported !== "object" || exported === null) {
    throw new errors.invalidExport(
      modulePath,
      exportName,
      exported === undefined ? "export not found" : "export is not an object",
    );
  }

  const candidate = exported as Record<string, unknown>;
  for (const method of methods) {
    if (typeof candidate[method] !== "function") {
      throw new errors.invalidExport(modulePath, exportName, `missing "${method}" method`);
    }
  }

  return exported as T;
}

/** Where a guarded call lives, for the error sentence a person reads. */
export interface PluginCallSite {
  plugin: string; // "Custom gate" | "Custom closer"
  reportName: string; // "GateReport" | "CloseReport"
  method: string;
  modulePath: string;
}

/**
 * Safety net: a plugin is third-party code. Whatever it throws, sync or async,
 * becomes `fail(detail)`, never an exception reaching the harness; and whatever
 * it returns must satisfy `schema` before the harness is allowed to believe it.
 */
export function guardMethod<A extends unknown[], R>(
  call: (...args: A) => Promise<R>,
  schema: ZodType<R>,
  fail: (detail: string) => R,
  where: PluginCallSite,
): (...args: A) => Promise<R> {
  return async (...args) => {
    let returned: unknown;
    try {
      returned = await call(...args);
    } catch (err) {
      return fail(`${where.plugin} "${where.modulePath}" threw during ${where.method}: ${messageOf(err)}`);
    }

    const parsed = schema.safeParse(returned);
    if (!parsed.success) {
      return fail(
        `${where.plugin} "${where.modulePath}" did not return a valid ${where.reportName} from ${where.method}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  };
}
```

- [ ] **Step 3: Rewrite `src/custom-gate.ts` onto the shared loader**

Replace the file's imports, `guard` and `loadCustomGate` with the following; `createCustomGate` stays exactly as it is.

```typescript
import type { Gate, GateContext } from "./command-gate.js";
import { GateReport } from "./schema.js";
import { GateModuleLoadFailure, InvalidGateExport } from "./errors.js";
import { errorReport, messageOf, duplicateIdReport } from "./gate-support.js";
import { guardMethod, loadPlugin } from "./plugin-loader.js";

// A custom gate's report must also be duplicate-free, which is gate-specific,
// so it is checked after the shared guard has validated the shape.
function guard(
  call: (ctx: GateContext) => Promise<GateReport>,
  method: string,
  modulePath: string,
): (ctx: GateContext) => Promise<GateReport> {
  const guarded = guardMethod(call, GateReport, errorReport, {
    plugin: "Custom gate",
    reportName: "GateReport",
    method,
    modulePath,
  });
  return async (ctx) => {
    const report = await guarded(ctx);
    return duplicateIdReport(report.assertions) ?? report;
  };
}

/**
 * Load a user-supplied gate module. A relative `modulePath` is resolved
 * against `repoPath`, the repository root — never the worktree under judgement
 * and never the process's working directory, so the caller must say which root
 * it means; absolute paths pass through unchanged. Throws
 * `GateModuleLoadFailure` if the module cannot be imported and
 * `InvalidGateExport` if the selected export is not a gate — both before any
 * gate method is called.
 */
export async function loadCustomGate(
  repoPath: string,
  modulePath: string,
  exportName = "default",
): Promise<Gate> {
  const gate = await loadPlugin<Gate>(repoPath, modulePath, exportName, ["baseline", "check"], {
    loadFailure: GateModuleLoadFailure,
    invalidExport: InvalidGateExport,
  });
  return {
    baseline: guard((ctx) => gate.baseline(ctx), "baseline", modulePath),
    check: guard((ctx) => gate.check(ctx), "check", modulePath),
  };
}
```

`messageOf` is still used by `createCustomGate`; keep the import. The method order `["baseline", "check"]` must stay as written: the existing tests expect a module missing both to be reported against `baseline` first.

- [ ] **Step 4: Run the unchanged regression proof and typecheck**

Run: `npx vitest run src/custom-gate.test.ts src/resolve-gate.test.ts tests/gate-interface/3-gate-a-project-with-a-custom-hand-written-gate.test.ts && npm run typecheck && git diff --exit-code -- src/custom-gate.test.ts`
Expected: all PASS, typecheck clean, and `git diff` prints nothing (the gate tests were not touched).

- [ ] **Step 5: Commit**

```bash
git add src/plugin-loader.ts src/custom-gate.ts
git commit -m "Extract the custom gate's loader and guard into plugin-loader

A custom closer needs the same dynamic import, export check and per-call
guard. Sharing one routine keeps a second copy out of the codebase; the
custom gate tests, run unchanged, prove the gate behaves as before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Load and guard a custom closer

**Files:**
- Modify: `src/schema.ts` (add `CloseReport` zod schema after `CloserRef`)
- Modify: `src/schema.test.ts` (add `CloseReport` describe)
- Modify: `src/ports.ts:109-112` (replace the `CloseReport` interface with a re-export of the schema type)
- Modify: `src/errors.ts` (add `CloserModuleLoadFailure`, `InvalidCloserExport` after `InvalidGateExport`)
- Modify: `src/closer-support.ts` (add `closeError`; `failedCloser` uses it)
- Create: `src/custom-closer.ts`
- Create: `src/custom-closer.test.ts`
- Modify: `src/index.ts` (exports)

**Interfaces:**
- Consumes: `loadPlugin`, `guardMethod` from `src/plugin-loader.ts` (Task 1); `messageOf` from `src/gate-support.ts`.
- Produces (used by Task 3):
  ```typescript
  // src/schema.ts
  export const CloseReport: z.ZodObject<{ status: z.ZodEnum<...>; detail: z.ZodString }>;
  export type CloseReport = { status: "DONE" | "FAIL" | "ERROR"; detail: string };
  // src/closer-support.ts
  export function closeError(detail: string): CloseReport;
  // src/custom-closer.ts
  export function loadCustomCloser(repoPath: string, modulePath: string, exportName?: string): Promise<CloserPort>;
  export function createCustomCloser(repoPath: string, modulePath: string, exportName?: string): CloserPort;
  // src/errors.ts
  export class CloserModuleLoadFailure extends Error { code: "CLOSER_MODULE_LOAD_FAILURE"; modulePath; detail }
  export class InvalidCloserExport extends Error { code: "INVALID_CLOSER_EXPORT"; modulePath; exportName; detail }
  ```

- [ ] **Step 1: Write the failing schema test**

Append to `src/schema.test.ts` (add `CloseReport` to the existing import from `./schema.js`):

```typescript
describe("CloseReport", () => {
  it("accepts each of the three statuses with a detail", () => {
    for (const status of ["DONE", "FAIL", "ERROR"]) {
      expect(CloseReport.safeParse({ status, detail: "what happened" }).success).toBe(true);
    }
  });

  it("rejects an unknown status, a missing detail, and a non-object", () => {
    expect(CloseReport.safeParse({ status: "OK", detail: "x" }).success).toBe(false);
    expect(CloseReport.safeParse({ status: "DONE" }).success).toBe(false);
    expect(CloseReport.safeParse(undefined).success).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing custom-closer tests**

Create `src/custom-closer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCustomCloser, loadCustomCloser } from "./custom-closer.js";
import { CloserModuleLoadFailure, InvalidCloserExport } from "./errors.js";
import type { CloseContext } from "./ports.js";

// Each test writes a real .mjs module to a fresh temp dir and loads it by
// path, exactly how a project's closer module reaches the harness.
function writeCloserModule(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-closer-test-"));
  const file = path.join(dir, "closer.mjs");
  fs.writeFileSync(file, source);
  return file;
}

// Absolute module paths ignore the repo root, so these tests pass one that is
// deliberately not the directory the closer module lives in.
const REPO_ROOT = "/tmp/not-the-closer-directory";

const ctx: CloseContext = {
  worktreePath: "/tmp/custom-closer-tree",
  dir: "/tmp/custom-closer-case",
  repoPath: REPO_ROOT,
  branch: "surface/surface-9",
  baseBranch: "main",
};
const accepted = { kind: "accepted" } as const;

const WORKING_CLOSER = `
export default {
  async close(ctx, outcome) {
    return { status: "DONE", detail: "closed " + ctx.branch + " onto " + ctx.baseBranch + " as " + outcome.kind };
  },
};
`;

describe("custom closer loading", () => {
  it("requires a repo root: omitting it must not type-check", () => {
    // @ts-expect-error both take a required repoPath, so a relative modulePath
    // can never silently resolve against process.cwd().
    const loadWithoutRepoRoot: (modulePath: string) => unknown = loadCustomCloser;
    // @ts-expect-error see above.
    const createWithoutRepoRoot: (modulePath: string) => unknown = createCustomCloser;

    expect(loadWithoutRepoRoot).toBe(loadCustomCloser);
    expect(createWithoutRepoRoot).toBe(createCustomCloser);
  });
});

describe("loadCustomCloser", () => {
  it("loads a default export and hands it the context and outcome", async () => {
    const closer = await loadCustomCloser(REPO_ROOT, writeCloserModule(WORKING_CLOSER));

    expect(await closer.close(ctx, { kind: "escalated" })).toEqual({
      status: "DONE",
      detail: "closed surface/surface-9 onto main as escalated",
    });
  });

  it("loads a named export other than the default", async () => {
    const modulePath = writeCloserModule(`
      export const notify = { close: async () => ({ status: "DONE", detail: "from notify" }) };
      export default { close: async () => ({ status: "DONE", detail: "from default" }) };
    `);

    const closer = await loadCustomCloser(REPO_ROOT, modulePath, "notify");

    expect((await closer.close(ctx, accepted)).detail).toBe("from notify");
  });

  it("resolves a relative module path against the supplied repo root", async () => {
    const modulePath = writeCloserModule(WORKING_CLOSER);

    const closer = await loadCustomCloser(path.dirname(modulePath), "./closer.mjs");

    expect((await closer.close(ctx, accepted)).status).toBe("DONE");
  });

  it("throws CloserModuleLoadFailure naming the module when it cannot be imported", async () => {
    const missing = path.join(os.tmpdir(), "no-such-closer-module-xyz.mjs");

    await expect(loadCustomCloser(REPO_ROOT, missing)).rejects.toThrow(CloserModuleLoadFailure);
    await expect(loadCustomCloser(REPO_ROOT, missing)).rejects.toThrow(missing);
  });

  it("throws InvalidCloserExport naming the module and the missing close method", async () => {
    const modulePath = writeCloserModule(`export default { shut: async () => ({ status: "DONE", detail: "" }) };`);

    await expect(loadCustomCloser(REPO_ROOT, modulePath)).rejects.toThrow(InvalidCloserExport);
    await expect(loadCustomCloser(REPO_ROOT, modulePath)).rejects.toThrow(/missing "close" method/);
    await expect(loadCustomCloser(REPO_ROOT, modulePath)).rejects.toThrow(modulePath);
  });

  it("throws InvalidCloserExport when the named export is absent", async () => {
    const modulePath = writeCloserModule(WORKING_CLOSER);

    await expect(loadCustomCloser(REPO_ROOT, modulePath, "notThere")).rejects.toThrow(InvalidCloserExport);
    await expect(loadCustomCloser(REPO_ROOT, modulePath, "notThere")).rejects.toThrow(/notThere/);
  });

  it("turns a synchronous throw into an ERROR report naming the module and the message", async () => {
    const modulePath = writeCloserModule(`export default { close() { throw new Error("mail server down"); } };`);

    const report = await (await loadCustomCloser(REPO_ROOT, modulePath)).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain(modulePath);
    expect(report.detail).toContain("mail server down");
  });

  it("turns a rejected promise into an ERROR report", async () => {
    const modulePath = writeCloserModule(`export default { close: async () => { throw new Error("timed out"); } };`);

    const report = await (await loadCustomCloser(REPO_ROOT, modulePath)).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("timed out");
  });

  it("turns a malformed report into an ERROR report", async () => {
    for (const returned of [`{ status: "OK", detail: "x" }`, `{ status: "DONE" }`, `undefined`]) {
      const modulePath = writeCloserModule(`export default { close: async () => (${returned}) };`);

      const report = await (await loadCustomCloser(REPO_ROOT, modulePath)).close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toContain("did not return a valid CloseReport");
      expect(report.detail).toContain(modulePath);
    }
  });
});

describe("createCustomCloser", () => {
  it("runs a working closer without the caller loading it first", async () => {
    const closer = createCustomCloser(REPO_ROOT, writeCloserModule(WORKING_CLOSER));

    expect((await closer.close(ctx, accepted)).detail).toBe("closed surface/surface-9 onto main as accepted");
  });

  it("reports a module that cannot be loaded as an ERROR report naming it, not a throw", async () => {
    const missing = path.join(os.tmpdir(), "no-such-closer-module-abc.mjs");

    const report = await createCustomCloser(REPO_ROOT, missing).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain(missing);
  });

  it("reports a module without close as an ERROR report naming the module and what is missing", async () => {
    const modulePath = writeCloserModule(`export default {};`);

    const report = await createCustomCloser(REPO_ROOT, modulePath).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain(modulePath);
    expect(report.detail).toContain('missing "close" method');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/schema.test.ts src/custom-closer.test.ts`
Expected: FAIL: `CloseReport` is not exported from `./schema.js`; `./custom-closer.js` cannot be resolved.

- [ ] **Step 4: Add the `CloseReport` schema**

In `src/schema.ts`, directly after `export type CloserRef = ...`:

```typescript
/**
 * What a closer returns. A schema, as `GateReport` is, so a custom closer's
 * return value is validated at runtime before the harness believes it.
 */
export const CloseReport = z.object({
  status: z.enum(["DONE", "FAIL", "ERROR"]),
  detail: z.string(),
});
export type CloseReport = z.infer<typeof CloseReport>;
```

In `src/ports.ts`, extend the first import line to `import type { Budget, BudgetPopulation, BudgetSet, CaseFile, CloseReport } from "./schema.js";`, delete the `export interface CloseReport { ... }` block, and in its place write:

```typescript
export type { CloseReport };
```

Every existing `import type { CloseReport } from "./ports.js"` keeps working unchanged.

- [ ] **Step 5: Add the closer error types**

In `src/errors.ts`, after `InvalidGateExport`:

```typescript
export class CloserModuleLoadFailure extends Error {
  readonly code = "CLOSER_MODULE_LOAD_FAILURE" as const;
  constructor(
    readonly modulePath: string,
    readonly detail: string,
  ) {
    super(`CloserModuleLoadFailure: cannot load custom closer module "${modulePath}": ${detail}`);
    this.name = "CloserModuleLoadFailure";
  }
}

export class InvalidCloserExport extends Error {
  readonly code = "INVALID_CLOSER_EXPORT" as const;
  constructor(
    readonly modulePath: string,
    readonly exportName: string,
    readonly detail: string,
  ) {
    super(`InvalidCloserExport: export "${exportName}" of "${modulePath}" is not a closer: ${detail}`);
    this.name = "InvalidCloserExport";
  }
}
```

- [ ] **Step 6: Add `closeError` to `src/closer-support.ts`**

Add below the imports, and make `failedCloser` use it:

```typescript
/** An ERROR close report: the one shape every "could not close" reaches the driver in. */
export function closeError(detail: string): CloseReport {
  return { status: "ERROR", detail };
}

export function failedCloser(detail: string): CloserPort {
  return { close: () => Promise.resolve(closeError(detail)) };
}
```

(Keep `failedCloser`'s existing doc comment.)

- [ ] **Step 7: Create `src/custom-closer.ts`**

```typescript
import type { CloseContext, CloseOutcome, CloseReport, CloserPort } from "./ports.js";
import { CloseReport as CloseReportSchema } from "./schema.js";
import { CloserModuleLoadFailure, InvalidCloserExport } from "./errors.js";
import { messageOf } from "./gate-support.js";
import { closeError } from "./closer-support.js";
import { guardMethod, loadPlugin } from "./plugin-loader.js";

/**
 * Load a project's closer module. A relative `modulePath` is resolved against
 * `repoPath`, the repository root, never the worktree the surface ran in, so
 * the agent whose work is being closed cannot edit the closer. Throws
 * `CloserModuleLoadFailure` if the module cannot be imported and
 * `InvalidCloserExport` if the selected export has no `close` method, both
 * before `close` is ever called. The returned closer turns a throw, a
 * rejection or a malformed report into an ERROR report.
 */
export async function loadCustomCloser(
  repoPath: string,
  modulePath: string,
  exportName = "default",
): Promise<CloserPort> {
  const closer = await loadPlugin<CloserPort>(repoPath, modulePath, exportName, ["close"], {
    loadFailure: CloserModuleLoadFailure,
    invalidExport: InvalidCloserExport,
  });
  return {
    close: guardMethod(
      (ctx: CloseContext, outcome: CloseOutcome) => closer.close(ctx, outcome),
      CloseReportSchema,
      closeError,
      { plugin: "Custom closer", reportName: "CloseReport", method: "close", modulePath },
    ),
  };
}

/**
 * A closer that loads its module lazily, on the first `close()`, and reports
 * load failures as ERROR reports rather than exceptions: the shape closer
 * resolution needs, where "failed to load" and "failed to run" must reach
 * close-triage the same way.
 */
export function createCustomCloser(repoPath: string, modulePath: string, exportName?: string): CloserPort {
  let closer: Promise<CloserPort> | undefined;
  return {
    close: async (ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport> => {
      closer ??= loadCustomCloser(repoPath, modulePath, exportName);
      try {
        return await (await closer).close(ctx, outcome);
      } catch (err) {
        return closeError(messageOf(err));
      }
    },
  };
}
```

- [ ] **Step 8: Export from `src/index.ts`**

After the `export { failedCloser, teardownWorktree } from "./closer-support.js";` line add:

```typescript
export { createCustomCloser, loadCustomCloser } from "./custom-closer.js";
```

and add `CloserModuleLoadFailure,` and `InvalidCloserExport,` to the `export { ... } from "./errors.js";` list, directly after `InvalidGateExport,`.

- [ ] **Step 9: Run the tests and typecheck**

Run: `npx vitest run src/schema.test.ts src/custom-closer.test.ts src/closer-support.test.ts src/custom-gate.test.ts && npm run lint`
Expected: PASS; lint and typecheck clean (the `@ts-expect-error` lines are consumed).

- [ ] **Step 10: Commit**

```bash
git add src/schema.ts src/schema.test.ts src/ports.ts src/errors.ts src/closer-support.ts src/custom-closer.ts src/custom-closer.test.ts src/index.ts
git commit -m "Load and guard a project's own closer module

A closer the harness did not write is third-party code: a throw, a
rejection or a malformed report must reach close-triage as an ERROR
report naming the cause, never crash the surface. It reuses the plugin
loader the custom gate already runs on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Reference a custom closer by module path

**Files:**
- Modify: `src/schema.ts:58-66` (`CloserRef` gains a `custom` arm; update its doc comment)
- Modify: `src/schema.test.ts` (`CloserRef` describe)
- Modify: `src/resolve-closer.ts` (whole file)
- Modify: `src/resolve-closer.test.ts` (existing calls take `repo`; new tests)
- Modify: `src/surface-close.test.ts` (new describe)
- Modify: `demos/close-interface-slice-1-merge-back.ts:80,109,113,119`, `demos/close-interface-slice-2-branch-and-teardown.ts:104,135`, `demos/close-interface-slice-3-close-failure.ts:70` (pass `repo`)

**Interfaces:**
- Consumes: `createCustomCloser(repoPath, modulePath, exportName?)` (Task 2).
- Produces (used by Tasks 4 and 5):
  ```typescript
  // CloserRef gains: { type: "custom"; modulePath: string; exportName?: string }
  export function resolveCloser(closerRef: CloserRef, repoPath: string): CloserPort;
  ```

- [ ] **Step 1: Write the failing schema tests**

Inside `describe("CloserRef", ...)` in `src/schema.test.ts` add:

```typescript
  it("accepts a custom closer referenced by module path, with or without an export name", () => {
    expect(CloserRef.parse({ type: "custom", modulePath: "closers/notify.mjs" })).toEqual({
      type: "custom",
      modulePath: "closers/notify.mjs",
    });
    expect(CloserRef.safeParse({ type: "custom", modulePath: "closers/notify.mjs", exportName: "slack" }).success).toBe(true);
  });

  it("rejects a custom closer with no module path", () => {
    expect(CloserRef.safeParse({ type: "custom" }).success).toBe(false);
  });
```

- [ ] **Step 2: Write the failing resolver tests**

In `src/resolve-closer.test.ts`:

1. Add `mkdirSync` to the `node:fs` import.
2. Pass `repo` as the second argument to every existing `resolveCloser(...)` call (five calls: `resolveCloser({ type: "merge-back" }, repo)`, `resolveCloser({ type: "merge-back", deleteBranch: false }, repo)`, `resolveCloser({ type: "teleport" } as unknown as CloserRef, repo)`, `resolveCloser(undefined as unknown as CloserRef, repo)`, `resolveCloser({ type: "commit-to-branch" }, repo)`).
3. Add inside the `describe("resolveCloser", ...)` block:

```typescript
  it("requires a repo root: omitting it must not type-check", () => {
    // @ts-expect-error repoPath is required, so a custom closer's relative
    // modulePath can never resolve against the worktree or process.cwd().
    const withoutRepoRoot: (ref: CloserRef) => unknown = resolveCloser;

    expect(withoutRepoRoot).toBe(resolveCloser);
  });

  it("resolves a custom reference's relative module path against the repo root", async () => {
    mkdirSync(join(repo, "closers"));
    writeFileSync(
      join(repo, "closers", "landing.mjs"),
      `export default { async close(ctx) { return { status: "DONE", detail: "project closer ran for " + ctx.branch }; } };`,
    );

    const report = await resolveCloser({ type: "custom", modulePath: "closers/landing.mjs" }, repo).close(ctx, accepted);

    expect(report).toEqual({ status: "DONE", detail: "project closer ran for surface/surface-42" });
  });

  it("selects a named export of a custom closer module", async () => {
    mkdirSync(join(repo, "closers"));
    writeFileSync(
      join(repo, "closers", "many.mjs"),
      `export const quiet = { close: async () => ({ status: "DONE", detail: "quiet" }) };`,
    );

    const report = await resolveCloser({ type: "custom", modulePath: "closers/many.mjs", exportName: "quiet" }, repo).close(ctx, accepted);

    expect(report.detail).toBe("quiet");
  });

  it("turns a custom reference to a missing module into an error report naming it", async () => {
    const report = await resolveCloser({ type: "custom", modulePath: "closers/absent.mjs" }, repo).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("closers/absent.mjs");
    expect(existsSync(tree)).toBe(true);
  });
```

- [ ] **Step 3: Write the failing surface test**

In `src/surface-close.test.ts`:
1. Change the `node:fs` import to `import { existsSync, mkdirSync, writeFileSync } from "node:fs";`.
2. Add `import { resolveCloser } from "./resolve-closer.js";`.
3. Change the schema type import to `import type { BudgetSet, CloserRef, GateRef, HistoryEntry } from "./schema.js";`.
4. Append at the end of the file:

```typescript
describe("a project's own closer, referenced by module path", () => {
  const MODULE_PATH = "closers/project-closer.mjs";

  /** A surface whose pinned closerRef names a module written into the repo root, not the worktree. */
  async function surfaceWithCustomCloser(source: string): Promise<{ dir: string; location: SurfaceLocation; ports: SurfacePorts }> {
    const dir = await mkdtemp(join(tmpdir(), "surface-custom-close-case-"));
    const repo = initTempRepo("surface-custom-close-repo-", { "report.tap": PASSING_TAP });
    mkdirSync(join(repo, "closers"));
    writeFileSync(join(repo, MODULE_PATH), source);
    const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-custom-close-tree-")), "wt") };
    const closerRef: CloserRef = { type: "custom", modulePath: MODULE_PATH };
    await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef, closerRef }, budgets);
    const pinned = (await load(dir)).header.closerRef;
    if (!pinned) throw new Error("the closer reference was not pinned");
    return { dir, location, ports: { agent: worker, triage: deterministicRouter, closer: resolveCloser(pinned, repo) } };
  }

  it("closes an accepted surface with the project's closer, recording the closer's own report", async () => {
    const { dir, location, ports } = await surfaceWithCustomCloser(
      `export default { async close(ctx, outcome) { return { status: "DONE", detail: "project closer: " + outcome.kind + " " + ctx.branch + " onto " + ctx.baseBranch }; } };`,
    );

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    const caseFile = await load(dir);
    const detail = "project closer: accepted surface/surface-7 onto main";
    expect(caseFile.outcome?.reason).toBe(detail);
    expect(await closeReports(dir, caseFile.history)).toEqual([{ status: "DONE", detail }]);
  });

  it("sends a closer that throws to close-triage with an error naming the module, instead of crashing", async () => {
    const { dir, location, ports } = await surfaceWithCustomCloser(
      `export default { async close() { throw new Error("the notification service is unreachable"); } };`,
    );
    let step: AdvanceResult;
    do {
      step = await advance(dir, location, ports);
    } while (step.state !== "CLOSING" && !step.done);
    expect(step.state).toBe("CLOSING");

    step = await advance(dir, location, ports);

    expect(step).toEqual({ state: "TRIAGE", done: false });
    const caseFile = await load(dir);
    const [report] = (await closeReports(dir, caseFile.history)) as { status: string; detail: string }[];
    expect(report?.status).toBe("ERROR");
    expect(report?.detail).toContain(MODULE_PATH);
    expect(report?.detail).toContain("the notification service is unreachable");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/schema.test.ts src/resolve-closer.test.ts src/surface-close.test.ts && npm run typecheck`
Expected: FAIL: the `custom` `CloserRef` is rejected; custom references resolve to the "Cannot resolve closer reference" ERROR; typecheck reports `Unused '@ts-expect-error' directive` and a type error on `resolveCloser(pinned, repo)`.

- [ ] **Step 5: Add the `custom` arm to `CloserRef`**

In `src/schema.ts`, replace the `CloserRef` doc comment and definition with:

```typescript
/**
 * Which closer this surface uses, as data. A project names a built-in strategy
 * and its parameters, or points at its own closer module; it never implements
 * one inline. No variant takes a base branch: the target is the branch pinned
 * at provisioning, so an owner never restates something the harness already
 * derived. A `custom` `modulePath` that is relative resolves against the
 * repository root, never the worktree, exactly as a custom gate's does.
 */
export const CloserRef = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("merge-back"),
    deleteBranch: z.boolean().optional(),
  }),
  // No parameters: the branch to commit to is the surface's own, and the COULD-tier
  // `push` is deliberately absent until it is built rather than parsed and ignored.
  z.object({ type: z.literal("commit-to-branch") }),
  z.object({
    type: z.literal("custom"),
    modulePath: z.string(),
    exportName: z.string().optional(),
  }),
]);
```

- [ ] **Step 6: Resolve a `custom` reference**

Replace `src/resolve-closer.ts` with:

```typescript
import type { CloserPort } from "./ports.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { createCommitToBranchCloser } from "./commit-to-branch-closer.js";
import { createCustomCloser } from "./custom-closer.js";
import { failedCloser } from "./closer-support.js";
import { CloserRef } from "./schema.js";

/**
 * Turn a pinned closer reference into a runnable closer. Total, like
 * `resolveGate`: an unparseable reference (an unknown type, a missing one), a
 * custom module that cannot be loaded, or one that fails when run all yield an
 * ERROR report from `close()`, so a misconfiguration reaches close-triage as a
 * report rather than as a crash of the surface.
 *
 * `repoPath` is what a custom closer's relative `modulePath` resolves against.
 * It is required for the same reason `resolveGate`'s is: a caller that omitted
 * it would load the closer from wherever the process happens to be running.
 * Pass the surface's `SurfaceLocation.repoPath`.
 */
export function resolveCloser(closerRef: CloserRef, repoPath: string): CloserPort {
  const parsed = CloserRef.safeParse(closerRef);
  if (!parsed.success) {
    return failedCloser(`Cannot resolve closer reference: ${parsed.error.message}`);
  }

  const ref = parsed.data;
  switch (ref.type) {
    case "merge-back":
      return createMergeBackCloser({ deleteBranch: ref.deleteBranch });
    case "commit-to-branch":
      return createCommitToBranchCloser();
    case "custom":
      return createCustomCloser(repoPath, ref.modulePath, ref.exportName);
  }
}
```

- [ ] **Step 7: Update the demo call sites**

Every demo already has `const repo = initTempRepo(...)` in scope at the call site:
- `demos/close-interface-slice-1-merge-back.ts`: `resolveCloser(pinned)` → `resolveCloser(pinned, repo)`; `resolveCloser(keepBranch)` (twice) → `resolveCloser(keepBranch, repo)`; `resolveCloser(closerRef)` → `resolveCloser(closerRef, repo)`.
- `demos/close-interface-slice-2-branch-and-teardown.ts`: `resolveCloser(acceptedPinned)` → `resolveCloser(acceptedPinned, repo)`; `resolveCloser(stuckPinned)` → `resolveCloser(stuckPinned, repo)`.
- `demos/close-interface-slice-3-close-failure.ts`: `resolveCloser(pinned)` → `resolveCloser(pinned, repo)`.

Confirm none are left: `npm run typecheck` fails on any call site still passing one argument, so Step 8's lint run is the check.

- [ ] **Step 8: Run the tests and lint**

Run: `npx vitest run src/schema.test.ts src/resolve-closer.test.ts src/surface-close.test.ts tests/close-interface && npm run lint`
Expected: PASS; lint and typecheck clean (demos compile with the new signature).

- [ ] **Step 9: Commit**

```bash
git add src/schema.ts src/schema.test.ts src/resolve-closer.ts src/resolve-closer.test.ts src/surface-close.test.ts demos/close-interface-slice-1-merge-back.ts demos/close-interface-slice-2-branch-and-teardown.ts demos/close-interface-slice-3-close-failure.ts
git commit -m "Let a project reference its own closer module by path

Projects whose close step the built-ins do not cover (a notification, a
non-GitHub host) name it as data, as they already do a custom gate.
resolveCloser now requires the repo root, so a relative modulePath can
never be loaded from inside the worktree being closed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The custom-closer demo

Demos in this repo are not unit-tested; the UAT phase records one against its output. Verification here is running it and checking the output reads as the slice's UAT describes.

**Files:**
- Create: `demos/close-interface-slice-4-custom-closer.ts`
- Modify: `package.json` (`scripts`: add `"demo:close-slice-4": "npx tsx demos/close-interface-slice-4-custom-closer.ts"` after `demo:close-slice-3`)

**Interfaces:**
- Consumes: `resolveCloser(ref, repoPath)` (Task 3); `create`, `load`, `readRef` from `src/case-file.ts`; `advance`, `run`, `AdvanceResult` from `src/surface.ts`; `deterministicRouter`; `initTempRepo`; `EscalationPacket`.
- Produces: console output with the section headings `--- 1. `, `--- 2. `, `--- 3. `, `--- 4. ` below (the UAT recording slices on them with `sectionOf`).

- [ ] **Step 1: Write the demo**

Create `demos/close-interface-slice-4-custom-closer.ts`:

```typescript
/**
 * UAT demo for Close Interface Slice 4: An Extender Writes Their Own Closer
 * From the Guide.
 *
 * Writes a small example closer into a scratch repository, references it by
 * module path, and runs a surface that closes with it. Then swaps in a
 * deliberately broken closer and shows the failure reaching close-triage as a
 * report, not a crash.
 *
 * Needs only a system `git`: no network, no API key, nothing to skip. Triage
 * is the built-in deterministic router, so no agent is involved.
 *
 * Usage: npm run demo:close-slice-4
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { create, load, readRef } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { advance, run, type AdvanceResult } from "../src/surface.js";
import { resolveCloser } from "../src/resolve-closer.js";
import { deterministicRouter } from "../src/router.js";
import { EscalationPacket } from "../src/triage-role-config.js";
import type { AgentContext, AgentPort, CloseContext, RoleHandle, SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, CloserRef, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 1 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..1\nok 1 - feature\n";

const EXAMPLE_CLOSER = `// closers/announce.mjs: says what it would do, and does nothing.
export default {
  async close(ctx, outcome) {
    switch (outcome.kind) {
      case "accepted":
        return { status: "DONE", detail: "Example closer: would land " + ctx.branch + " on " + ctx.baseBranch + " and notify the team." };
      case "escalated":
        return { status: "DONE", detail: "Example closer: would keep " + ctx.branch + " for whoever takes over, and tidy the worktree." };
      case "aborted":
        return { status: "DONE", detail: "Example closer: would tidy the worktree; nothing is landed." };
    }
  },
};
`;

const BROKEN_CLOSER = `// closers/broken.mjs: fails the way real integrations do.
export default {
  async close() {
    throw new Error("the notification service is unreachable");
  },
};
`;

/** Stands in for a worker that finishes the job. */
const workingAgent: AgentPort = {
  invoke: ((_role: RoleHandle, ctx: AgentContext) => {
    fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
    return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
  }) as AgentPort["invoke"],
};

async function surfaceWith(
  repo: string,
  surfaceId: string,
  closerRef: CloserRef,
): Promise<{ dir: string; location: SurfaceLocation; ports: SurfacePorts }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "close4-demo-case-"));
  const location: SurfaceLocation = {
    repoPath: repo,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "close4-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId, taskDef: { goal: "add the feature" }, gateRef, closerRef }, budgets);
  const pinned = (await load(dir)).header.closerRef;
  if (!pinned) throw new Error("the closer reference was not pinned in the header");
  return { dir, location, ports: { agent: workingAgent, triage: deterministicRouter, closer: resolveCloser(pinned, repo) } };
}

async function main(): Promise<void> {
  console.log("=== Close Interface Slice 4: a project's own closer ===\n");

  const repo = initTempRepo("close4-demo-repo-", { "report.tap": PASSING_TAP });
  fs.mkdirSync(path.join(repo, "closers"));
  fs.writeFileSync(path.join(repo, "closers", "announce.mjs"), EXAMPLE_CLOSER);
  fs.writeFileSync(path.join(repo, "closers", "broken.mjs"), BROKEN_CLOSER);

  // --- 1 ---
  const exampleRef: CloserRef = { type: "custom", modulePath: "closers/announce.mjs" };
  console.log("--- 1. The example closer ---");
  console.log(`The project keeps its closer in its own repository and names it as data: closerRef = ${JSON.stringify(exampleRef)}`);
  console.log("The path is relative to the repository root, never the worktree the agent edits.\n");
  console.log(EXAMPLE_CLOSER);

  // --- 2 ---
  console.log("--- 2. An accepted surface closes using it ---");
  const accepted = await surfaceWith(repo, "surface-71", exampleRef);
  const result = await run(accepted.dir, accepted.location, accepted.ports);
  const acceptedCase = await load(accepted.dir);
  console.log(`The surface ran to: ${result.state}`);
  console.log(`Closing report: ${acceptedCase.outcome?.reason ?? "(none)"}\n`);

  console.log("The same closer, asked about the other two outcomes:");
  const ctx: CloseContext = {
    worktreePath: accepted.location.worktreePath,
    dir: accepted.dir,
    repoPath: repo,
    branch: "surface/surface-71",
    baseBranch: "main",
  };
  for (const kind of ["escalated", "aborted"] as const) {
    const report = await accepted.ports.closer.close(ctx, { kind });
    console.log(`  ${kind}: ${report.status}: ${report.detail}`);
  }
  console.log("");

  // --- 3 ---
  const brokenRef: CloserRef = { type: "custom", modulePath: "closers/broken.mjs" };
  console.log("--- 3. A deliberately broken closer ---");
  console.log(`A second surface names a closer that throws: closerRef = ${JSON.stringify(brokenRef)}\n`);
  const broken = await surfaceWith(repo, "surface-72", brokenRef);
  let step: AdvanceResult;
  do {
    step = await advance(broken.dir, broken.location, broken.ports);
  } while (step.state !== "CLOSING" && !step.done);
  if (step.state !== "CLOSING") throw new Error(`expected the work to be accepted, reached ${step.state}`);
  step = await advance(broken.dir, broken.location, broken.ports);
  const closeEntry = (await load(broken.dir)).history.find((e) => e.t === "close");
  const report = closeEntry?.t === "close" ? ((await readRef(broken.dir, closeEntry.detailRef)) as { detail?: string }) : {};
  console.log(`Close report: ${closeEntry?.t === "close" ? closeEntry.status : "(none)"}: ${report.detail ?? "(no detail)"}`);
  console.log(`The surface moved to: ${step.state} (close-triage), and nothing crashed.\n`);

  // --- 4 ---
  console.log("--- 4. What happens next ---");
  const final = await run(broken.dir, broken.location, broken.ports);
  const brokenCase = await load(broken.dir);
  console.log(`Triage retried the close while the close budget allowed (${budgets.close.max} retry), then the surface ran to: ${final.state}`);
  const packet = EscalationPacket.parse(await readRef(broken.dir, brokenCase.outcome?.packetRef ?? ""));
  console.log(`Decision:\n  ${packet.decision}`);
  console.log(`Evidence:\n  ${packet.evidence}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script**

In `package.json` `scripts`, after `"demo:close-slice-3": ...,` add:

```json
    "demo:close-slice-4": "npx tsx demos/close-interface-slice-4-custom-closer.ts",
```

- [ ] **Step 3: Run the demo and check the output**

Run: `npm run demo:close-slice-4`
Expected, exit 0, and:
- section 2 prints `The surface ran to: CLOSED` and `Closing report: Example closer: would land surface/surface-71 on main and notify the team.`
- section 2 prints an `escalated:` and an `aborted:` line, each `DONE` with its announcement.
- section 3 prints `Close report: ERROR:` with a detail containing `closers/broken.mjs` and `the notification service is unreachable`, then `The surface moved to: TRIAGE`.
- section 4 prints `ESCALATED` and an `Evidence:` block quoting the same error detail.

If section 4 reaches a state other than `ESCALATED` (for example the router aborts), report the actual final state in the demo line rather than asserting one: the printed line already uses `final.state`; only the wording "Triage retried..." must remain true, so check `brokenCase.history` has a `retry_close` triage entry and adjust the sentence if not.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add demos/close-interface-slice-4-custom-closer.ts package.json
git commit -m "Add the custom-closer demo

Shows an extender a closer they wrote closing a real surface, and a
broken one reaching close-triage as an ERROR report rather than a crash,
with no network or API key.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The "writing a closer" guide, its worked example under test

The guide's worked example is the merge-back closer, written as a custom closer module against only the public contract, so an extender can copy it. A test extracts that exact code block from the guide and runs it against real temp repos through `resolveCloser`, so the example cannot drift from the contract (precedent: the gate guide's example test). The built-in `src/merge-back-closer.ts` stays the source of truth for the harness; the guide says so.

**Files:**
- Create: `docs/writing-a-closer.md`
- Create: `tests/writing-a-closer-guide.test.ts`
- Modify: `README.md` (docs list)

**Interfaces:**
- Consumes (via `../src/index.js`): `resolveCloser`, `provisionWorktree`, `branchName`, `type CloseContext` (Task 3; all already exported).
- Produces: `docs/writing-a-closer.md` containing a fenced ` ```js ` block whose first line is `// merge-back-closer.mjs`.

- [ ] **Step 1: Write the failing guide test**

Create `tests/writing-a-closer-guide.test.ts`:

```typescript
// Close interface DX note: the closer ships with a "writing a closer" guide,
// followable without reading the surface driver or provisioning code. This
// runs the guide's own worked example, so it cannot drift from the contract.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";
import { cleanGitEnv } from "../src/git-env.js";
import { initTempRepo } from "../src/temp-repo.js";
import { branchName, provisionWorktree, resolveCloser, type CloseContext, type CloserRef } from "../src/index.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-closer.md"), "utf-8");

function exampleCloser(): string {
  const match = /```js\n(\/\/ merge-back-closer\.mjs\n[\s\S]*?)```/.exec(guide);
  if (!match?.[1]) throw new Error("guide has no ```js block starting with // merge-back-closer.mjs");
  return match[1];
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

describe("the 'writing a closer' guide", () => {
  it("covers the context, the three outcomes, FAIL versus ERROR, replays, secrets and how to reference a closer", () => {
    for (const field of ["worktreePath", "dir", "repoPath", "branch", "baseBranch", "repairBrief"]) {
      expect(guide).toContain(`\`${field}\``);
    }
    for (const kind of ["accepted", "escalated", "aborted"]) expect(guide).toContain(`"${kind}"`);
    for (const status of ["DONE", "FAIL", "ERROR"]) expect(guide).toContain(`"${status}"`);
    expect(guide).toMatch(/already done/i);
    expect(guide).toMatch(/secret/i);
    expect(guide).toContain('type: "custom"');
    expect(guide).toContain('type: "merge-back"');
    expect(guide).toContain("resolveCloser(");
    expect(guide).toContain("npm run demo:close-slice-4");
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });

  describe("its worked merge-back closer, loaded as a custom closer", () => {
    const ref: CloserRef = { type: "custom", modulePath: "closers/merge-back-closer.mjs" };
    let repo: string;
    let ctx: CloseContext;

    beforeEach(async () => {
      repo = initTempRepo("closer-guide-repo-", { "seed.txt": "hello\n" });
      mkdirSync(join(repo, "closers"));
      writeFileSync(join(repo, "closers", "merge-back-closer.mjs"), exampleCloser());
      const dir = mkdtempSync(join(tmpdir(), "closer-guide-case-"));
      const worktreePath = join(mkdtempSync(join(tmpdir(), "closer-guide-tree-")), "wt");
      const { baseBranch } = await provisionWorktree(dir, repo, worktreePath, "surface-1");
      ctx = { worktreePath, dir, repoPath: repo, branch: branchName("surface-1"), baseBranch };
    });

    it("merges accepted work into the base branch, cleans up, and is DONE again on replay", async () => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the work\n");
      const closer = resolveCloser(ref, repo);

      const first = await closer.close(ctx, { kind: "accepted" });

      expect(first.status).toBe("DONE");
      expect(git(repo, ["show", "main:feature.txt"])).toBe("the work");
      expect(existsSync(ctx.worktreePath)).toBe(false);
      expect(git(repo, ["branch", "--list", ctx.branch])).toBe("");

      const replay = await closer.close(ctx, { kind: "accepted" });
      expect(replay.status).toBe("DONE");
      expect(replay.detail).toMatch(/already/i);
    });

    it("refuses with FAIL, changing nothing, when the base branch has moved on", async () => {
      writeFileSync(join(ctx.worktreePath, "feature.txt"), "the work\n");
      writeFileSync(join(repo, "hotfix.txt"), "moved on\n");
      git(repo, ["add", "seed.txt", "hotfix.txt"]);
      git(repo, ["commit", "-m", "main moved on"]);
      const tip = git(repo, ["rev-parse", "main"]);

      const report = await resolveCloser(ref, repo).close(ctx, { kind: "accepted" });

      expect(report.status).toBe("FAIL");
      expect(git(repo, ["rev-parse", "main"])).toBe(tip);
      expect(existsSync(ctx.worktreePath)).toBe(true);
    });

    it("tears down a stopped surface's worktree and keeps its branch", async () => {
      const report = await resolveCloser(ref, repo).close(ctx, { kind: "escalated" });

      expect(report.status).toBe("DONE");
      expect(existsSync(ctx.worktreePath)).toBe(false);
      expect(git(repo, ["branch", "--list", ctx.branch, "--format=%(refname:short)"])).toBe(ctx.branch);
    });
  });
});
```

Note the FAIL test stages only `seed.txt hotfix.txt`, not `-A`, so the untracked `closers/` directory in the repo root is never committed onto `main`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/writing-a-closer-guide.test.ts`
Expected: FAIL with `ENOENT` reading `docs/writing-a-closer.md`.

- [ ] **Step 3: Write the guide**

Create `docs/writing-a-closer.md` with exactly this content:

~~~~markdown
# Writing a closer

This guide gets you from nothing to a working closer for your project: either
one of the **built-in closers**, named as data, or a **custom closer** you write
yourself. You do not need to read any source to follow it.

## What a closer is

When the gate accepts a surface's work, the harness runs the surface's closer
once to do something with it: merge it, leave it on a branch, open a pull
request, tell someone. The harness decides *when* the closer runs and acts on
what it reports; the closer decides *what* closing means.

The same closer is also called when a surface stops without being accepted
(escalated to a person, or aborted), so it can tidy up after itself.

What the harness does with the report:

| Report | On an accepted surface | On a stopped surface |
|---|---|---|
| `"DONE"` | the surface is `CLOSED`, and your `detail` is its closing report | nothing more |
| `"FAIL"` or `"ERROR"` | close-triage retries the close while the close budget lasts, then hands it to a person with your `detail` as the evidence | logged, never retried |

A failed close is never sent back to the worker: the work is already accepted.

Everything below is imported from the harness's single entry point,
`./src/index.js` from the repository root (the harness is not published as a
package yet). Run the snippets with `npx tsx`.

## Choosing a closer

A surface pins its closer in the case file header as a `closerRef`, passed to
`create()` with the rest of the header, exactly as in
[Configuring a role](configuring-a-role.md):

```ts
// Built in: fast-forward the base branch onto the work, then remove the worktree and branch.
{ type: "merge-back" }
{ type: "merge-back", deleteBranch: false } // keep the branch after merging

// Built in: commit the work to the surface's own branch and keep the branch.
{ type: "commit-to-branch" }

// Your own closer module.
{ type: "custom", modulePath: "closers/notify.mjs", exportName: "default" }
```

Whoever runs the surface turns the pinned reference into a closer and passes it
in the surface's ports:

```ts
import { load, resolveCloser } from "./src/index.js";

const { header } = await load(dir);
if (!header.closerRef) throw new Error(`no closer pinned for ${dir}`);
const closer = resolveCloser(header.closerRef, repoPath);
```

`repoPath` is required. A relative `modulePath` is resolved against it, the
repository root, never the worktree the surface ran in, so the agent whose work
is being closed cannot edit the closer. An absolute path works too.

A `closerRef` the harness cannot understand (an unknown `type`, a missing
`modulePath`) is not an exception: it resolves to a closer whose every report is
`"ERROR"`, naming what was wrong.

## The contract

A closer is any object with one method:

```ts
import type { CloseContext, CloseOutcome, CloseReport } from "./src/index.js";

interface Closer {
  close(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport>;
}
```

`close` receives a `CloseContext`:

| Field | What it is | When it is set |
|---|---|---|
| `worktreePath` | The surface's scratch worktree, holding the accepted work. It may already be gone on a replay (see below). | Always |
| `dir` | The surface's case file directory. Most closers ignore it. | Always |
| `repoPath` | The repository checkout the worktree was created from. It is shared with the people using that checkout: act on it, but never switch its checked-out branch. | Always |
| `branch` | The surface's own branch, for example `surface/surface-7`. The worktree has it checked out. | Always |
| `baseBranch` | The local branch the surface was started from, pinned when it was provisioned, for example `main`. The branch to merge into or open a pull request against. | Always; the empty string only if provisioning never completed, which a closer should report as `"ERROR"` |
| `repairBrief` | Guidance written by triage's agent: `{ problem, dead_ends, scope, references, diagnosis }`. You may surface it, in a pull request body or a notification. The built-in closers ignore it. | Only on a close retried by triage's agent; absent on a first close and on a deterministic retry |

an `outcome`, `{ kind: "accepted" | "escalated" | "aborted" }`, and must return a
`CloseReport`:

| Field | What it is |
|---|---|
| `status` | `"DONE"`, `"FAIL"` or `"ERROR"` |
| `detail` | One or two plain sentences a person will read: what happened, or exactly what stopped the close |

## The three outcomes

Every closer switches on `outcome.kind`:

- **`"accepted"`**: the gate accepted the work. Land it, whatever landing means
  for your project.
- **`"escalated"`**: the surface was handed to a person. Nothing is landed. Tidy
  up, and keep whatever that person needs to take over: the built-ins remove
  the worktree and keep the branch.
- **`"aborted"`**: the surface was stopped. Nothing is landed. Tidy up the same
  way.

A report on a stopped surface is only logged, so make teardown something that is
safe to run twice.

## FAIL or ERROR

Both route to close-triage in the same way; the difference tells the person
reading the escalation what kind of problem it is.

- **`"FAIL"`: a decision could resolve it.** The close was refused for a reason
  in the work or the project: the base branch has moved on, a pull request was
  rejected by branch protection.
- **`"ERROR"`: the environment is broken.** Your closer could not do its job at
  all: a command is missing, a credential has expired, the network is down, the
  checkout is on the wrong branch.

Either way, write `detail` as plain prose naming the specific cause and, where
you can, what to do about it: "the gh CLI is not authenticated; run gh auth
login", not a stack trace.

## Replays: detect "already done" yourself

The harness can crash after your closer has done its work but before it records
the report. On restart it calls your closer again, with the same context. There
is no resume token: your closer must work out from the world itself whether the
job is already done, and report `"DONE"` if it is.

So each closer starts with a detect step, and never assumes anything it did last
time is still there:

- a merge closer checks whether the base branch already contains the work;
- a pull request closer checks whether an open pull request already exists for
  the branch;
- a notification closer records what it sent somewhere it can check, or accepts
  that a crash may send the message twice.

In particular, `worktreePath` may already have been removed by the earlier run.
Check that it exists before touching it.

## Never echo secrets in `detail`

`detail` is written to the case file and quoted, word for word, into the
escalation a person reads. Never put a token, a password or a credentialed URL
in it, and never paste a subprocess's raw output or error into it: `git` and
`gh` can print a remote URL with a token embedded. The same applies to the
message of anything your closer throws, because the harness records that too.
Describe the cause in your own words instead.

## Worked example: the merge-back closer

This is the built-in `merge-back` closer's algorithm, written as a custom closer
module that uses nothing but Node.js and `git`. Use it as a starting point: name
`{ type: "merge-back" }` if the built-in already does what you need.

Its order matters, and every step is safe to replay:

1. **Guard.** No `baseBranch` means nothing to merge into: `"ERROR"`.
2. **Detect a finished close.** If `branch` no longer exists, an earlier close
   merged and cleaned up: `"DONE"`, without touching the worktree.
3. **Commit the work**, but only if the worktree still exists.
4. **Detect a finished merge.** If `baseBranch` already contains `branch`, clean
   up and report `"DONE"`. This check comes after the commit: before it, the
   uncommitted work is invisible and the branch looks already merged.
5. **Check the shared checkout** is on `baseBranch`. Switching it is not the
   closer's call: `"ERROR"`.
6. **Fast-forward or refuse.** A fast-forward that git refuses changes nothing:
   `"FAIL"`, naming where the base branch now is.
7. **Clean up**: the worktree first, then the branch.

Stopped surfaces remove the worktree and keep the branch.

```js
// merge-back-closer.mjs
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// Git sets GIT_DIR and friends when it runs hooks. Left in place they would
// point every command below at the wrong repository, whatever cwd says.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

// Arguments as a list, never a shell string: branch names can come from task content.
async function git(cwd, args) {
  const { stdout } = await run("git", args, { cwd, env });
  return stdout.trim();
}

async function succeeds(cwd, args) {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

// Safe to run twice: removing a worktree that is already gone is tolerated.
async function removeWorktree(ctx) {
  await succeeds(ctx.repoPath, ["worktree", "remove", "--force", "--", ctx.worktreePath]);
  await succeeds(ctx.repoPath, ["worktree", "prune"]);
}

async function cleanUp(ctx) {
  await removeWorktree(ctx);
  // Lower-case -d is git's own guard: it refuses to delete unmerged work.
  await succeeds(ctx.repoPath, ["branch", "-d", "--", ctx.branch]);
}

async function land(ctx) {
  if (ctx.baseBranch === "") {
    return { status: "ERROR", detail: "This surface has no pinned base branch, so there is nothing to merge into." };
  }

  if (!(await succeeds(ctx.repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${ctx.branch}`]))) {
    return { status: "DONE", detail: `Already closed: ${ctx.branch} no longer exists, so an earlier close merged it.` };
  }

  if (existsSync(ctx.worktreePath)) {
    await git(ctx.worktreePath, ["add", "-A"]);
    if ((await git(ctx.worktreePath, ["status", "--porcelain"])) !== "") {
      await git(ctx.worktreePath, ["commit", "-m", `Accepted work from ${ctx.branch}`]);
    }
  }

  if (await succeeds(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.branch, ctx.baseBranch])) {
    await cleanUp(ctx);
    return { status: "DONE", detail: `Already merged: ${ctx.baseBranch} has everything from ${ctx.branch}.` };
  }

  const head = await git(ctx.repoPath, ["symbolic-ref", "--short", "HEAD"]);
  if (head !== ctx.baseBranch) {
    return {
      status: "ERROR",
      detail: `The main checkout is on ${head}, not ${ctx.baseBranch}, so nothing was changed. Check out ${ctx.baseBranch} there and close again.`,
    };
  }

  if (!(await succeeds(ctx.repoPath, ["merge", "--ff-only", "--", ctx.branch]))) {
    const tip = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
    return {
      status: "FAIL",
      detail: `${ctx.baseBranch} has moved on to ${tip} and cannot be fast-forwarded onto ${ctx.branch}. Nothing was changed; the work is still on ${ctx.branch}.`,
    };
  }

  const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
  await cleanUp(ctx);
  return { status: "DONE", detail: `Fast-forwarded ${ctx.baseBranch} to ${sha} and removed ${ctx.branch}.` };
}

export default {
  async close(ctx, outcome) {
    try {
      if (outcome.kind === "accepted") return await land(ctx);
      await removeWorktree(ctx);
      return { status: "DONE", detail: `The surface was ${outcome.kind}: removed its worktree and kept ${ctx.branch}.` };
    } catch (err) {
      // Name the cause without echoing git's output, which can contain a credentialed URL.
      return { status: "ERROR", detail: `A git command failed while closing ${ctx.branch} (exit code ${err.code ?? "unknown"}).` };
    }
  },
};
```

Save it in your repository, for example as `closers/merge-back-closer.mjs`, and
reference it:

```ts
{ type: "custom", modulePath: "closers/merge-back-closer.mjs" }
```

`exportName` selects a named export instead of `default`, so one module can hold
several closers.

To try it on a real surface's worktree without running a whole surface:

```ts
import { branchName, provisionWorktree, resolveCloser } from "./src/index.js";

const repoPath = "/home/me/project";
const dir = "/tmp/closer-try/case";
const worktreePath = "/tmp/closer-try/tree";

const { baseBranch } = await provisionWorktree(dir, repoPath, worktreePath, "surface-1");
// ... change something in worktreePath ...
const closer = resolveCloser({ type: "custom", modulePath: "closers/merge-back-closer.mjs" }, repoPath);
const ctx = { worktreePath, dir, repoPath, branch: branchName("surface-1"), baseBranch };
console.log(await closer.close(ctx, { kind: "accepted" }));
```

## When your closer goes wrong

The harness wraps every custom closer, so a mistake in yours is reported, never
crashed on. Each of these becomes an `"ERROR"` report, and on an accepted
surface goes to close-triage like any other failed close:

| Mistake | The `detail` names |
|---|---|
| The module cannot be imported | the module path and the import error |
| The export is missing, or has no `close` method | the module path, the export and `missing "close" method` |
| `close` throws, or its promise rejects | the module path and the error message |
| `close` returns something that is not a `CloseReport` | the module path and what was invalid |

To watch an example closer close a surface, then a broken one reach close-triage:

```bash
npm run demo:close-slice-4
```
~~~~

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/writing-a-closer-guide.test.ts`
Expected: PASS (4 tests). If the extraction regex fails, check the code block starts with exactly `` ```js `` followed by `// merge-back-closer.mjs` on the next line.

- [ ] **Step 5: Link the guide from the README**

In `README.md`, after the line `- [Writing a gate](docs/writing-a-gate.md): configure the command gate or write your own` add:

```markdown
- [Writing a closer](docs/writing-a-closer.md): name a built-in closer or write your own
```

- [ ] **Step 6: Cold-read check against the Operational note**

Run: `grep -nE "surface\.ts|provision\.ts|src/[a-z-]+\.ts" docs/writing-a-closer.md`
Expected: no output. The guide must not send the reader to the driver or provisioning source.

- [ ] **Step 7: Commit**

```bash
git add docs/writing-a-closer.md tests/writing-a-closer-guide.test.ts README.md
git commit -m "Add the writing a closer guide, its merge-back example under test

An extender should be able to write a closer from a contract and a
worked example without reading harness internals. Running the guide's
own example against real repositories keeps it from drifting from the
contract the harness enforces.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
