import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Gate, GateContext } from "../command-gate.js";
import { errorReport } from "../gate-support.js";
import { resolveGate } from "../resolve-gate.js";
import type { GateRef, GateReport } from "../schema.js";
import { checkFinding } from "./finding-check.js";
import { FixTask } from "./fix-task.js";

/** This module's own path: loaded from the installed package, outside every working copy, so a fix's agent can neither read nor change it. */
export const FINDING_GATE_MODULE = fileURLToPath(import.meta.url);

/** How a fix's run pins this check: a new failure counts, which is what makes "the problem is gone" a requirement. */
export const FINDING_GATE_REF: GateRef = { type: "custom", modulePath: FINDING_GATE_MODULE, failOnNewAssertions: true };

export const findingAssertion = (id: string): string => `finding:${id}:resolved`;

/** The fix this run is for and the project's own check it wraps, or why it cannot be judged. */
function regressionCheck(ctx: GateContext): { task: FixTask; gate: Gate; ctx: GateContext } | GateReport {
  const parsed = FixTask.safeParse(ctx.taskDef);
  if (!parsed.success) return errorReport("this check judges only the fix of a problem a review found, and this task is not one");
  const { verify } = parsed.data.authorisation;
  if (verify.type === "custom" && !isAbsolute(verify.modulePath)) return errorReport(`the project's own check ${verify.modulePath} was not pinned by its full path`);
  return { task: parsed.data, gate: resolveGate(verify, ctx.worktreePath), ctx: { ...ctx, gateRef: verify } };
}

/**
 * A fix's check: the project's own (its tests), and, unless the problem is
 * tests only, one more result saying whether the problem is gone. That result
 * is absent at baseline, so the delta rule's new-assertion option makes a FAIL
 * count and a PASS harmless. A check of the problem that cannot run is an error,
 * never a pass.
 */
const findingGate: Gate = {
  async baseline(ctx) {
    const resolved = regressionCheck(ctx);
    return "gate" in resolved ? resolved.gate.baseline(resolved.ctx) : resolved;
  },
  async check(ctx) {
    const resolved = regressionCheck(ctx);
    if (!("gate" in resolved)) return resolved;
    const { task, gate } = resolved;
    const report = await gate.check(resolved.ctx);
    if (task.finding.check.kind === "none" || report.status === "ERROR") return report;
    const result = await checkFinding(task.finding, { worktreePath: ctx.worktreePath });
    if (typeof result !== "string") return errorReport(`the check of this problem could not run: ${result.error}`);
    const gone = result === "resolved";
    return {
      ...report,
      status: gone ? report.status : "FAIL",
      assertions: [...report.assertions, { id: findingAssertion(task.finding.id), outcome: gone ? "PASS" : "FAIL", detail: gone ? "the problem is gone" : "the problem is still there" }],
    };
  },
};

export default findingGate;
