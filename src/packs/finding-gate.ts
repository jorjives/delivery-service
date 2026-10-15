import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Gate, GateContext } from "../command-gate.js";
import { errorReport } from "../gate-support.js";
import { resolveGate } from "../resolve-gate.js";
import type { Assertion, GateRef, GateReport } from "../schema.js";
import { checkFinding } from "./finding-check.js";
import { FixTask } from "./fix-task.js";

/** This module's own path: loaded from the installed package, outside every working copy, so a fix's agent can neither read nor change it. */
export const FINDING_GATE_MODULE = fileURLToPath(import.meta.url);

/** How a fix's run pins this check: a new failure counts, which is what makes "the problem is gone" a requirement. */
export const FINDING_GATE_REF: GateRef = { type: "custom", modulePath: FINDING_GATE_MODULE, failOnNewAssertions: true };

export const findingAssertion = (id: string): string => `finding:${id}:resolved`;

/** What a project with no tests adds to a fix's check: nothing, so the problem's own check and the guards are the whole of it. */
const NO_TESTS: GateReport = { status: "PASS", assertions: [] };

/** Whether the problem is gone, as one more result; nothing for a problem that is tests only; an error when its check cannot run. */
async function resolvedAssertion(task: FixTask, worktreePath: string): Promise<Assertion[] | { error: string }> {
  if (task.finding.check.kind === "none") return [];
  const result = await checkFinding(task.finding, { worktreePath });
  if (typeof result !== "string") return result;
  const gone = result === "resolved";
  return [{ id: findingAssertion(task.finding.id), outcome: gone ? "PASS" : "FAIL", detail: gone ? "the problem is gone" : "the problem is still there" }];
}

/** The fix this run is for and the project's own check it wraps (none when the project has no tests), or why it cannot be judged. */
function regressionCheck(ctx: GateContext): { task: FixTask; gate: Gate | null; ctx: GateContext } | GateReport {
  const parsed = FixTask.safeParse(ctx.taskDef);
  if (!parsed.success) return errorReport("this check judges only the fix of a problem a review found, and this task is not one");
  const { verify } = parsed.data.authorisation;
  // Nothing checks the fix broke nothing else: which is why such a fix always waits for the owner's sign-off.
  if (verify === null) return { task: parsed.data, gate: null, ctx };
  if (verify.type === "custom" && !isAbsolute(verify.modulePath)) return errorReport(`the project's own check ${verify.modulePath} was not pinned by its full path`);
  return { task: parsed.data, gate: resolveGate(verify, ctx.worktreePath), ctx: { ...ctx, gateRef: verify } };
}

/**
 * A fix's check: the project's own (its tests), and, unless the problem is
 * tests only, one more result saying whether the problem is gone. That result
 * is absent at baseline, so the delta rule's new-assertion option makes a FAIL
 * count and a PASS harmless. A check of the problem that cannot run is an
 * error, never a pass. In a project with no tests there is no project check:
 * only the problem's own result is judged. The guards join this check as they
 * join every run's (`guardedGate`).
 */
const findingGate: Gate = {
  async baseline(ctx) {
    const resolved = regressionCheck(ctx);
    if (!("gate" in resolved)) return resolved;
    return resolved.gate === null ? NO_TESTS : resolved.gate.baseline(resolved.ctx);
  },
  async check(ctx) {
    const resolved = regressionCheck(ctx);
    if (!("gate" in resolved)) return resolved;
    const found = await resolvedAssertion(resolved.task, ctx.worktreePath);
    if ("error" in found) return errorReport(`the check of this problem could not run: ${found.error}`);
    const report = resolved.gate === null ? NO_TESTS : await resolved.gate.check(resolved.ctx);
    if (report.status === "ERROR") return report;
    const assertions = [...report.assertions, ...found];
    return { ...report, status: assertions.some((a) => a.outcome === "FAIL") ? "FAIL" : report.status, assertions };
  },
};

export default findingGate;
