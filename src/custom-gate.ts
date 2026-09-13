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

/**
 * A `Gate` that loads its module lazily and reports load failures as ERROR
 * reports rather than exceptions — the shape gate resolution needs, where
 * "failed to load" and "failed to run" must look the same to the caller.
 */
export function createCustomGate(
  repoPath: string,
  modulePath: string,
  exportName?: string,
): Gate {
  let gate: Promise<Gate> | undefined;
  const run =
    (method: "baseline" | "check") =>
    async (ctx: GateContext): Promise<GateReport> => {
      gate ??= loadCustomGate(repoPath, modulePath, exportName);
      try {
        return await (await gate)[method](ctx);
      } catch (err) {
        return errorReport(messageOf(err));
      }
    };

  return { baseline: run("baseline"), check: run("check") };
}
