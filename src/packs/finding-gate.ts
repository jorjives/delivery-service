import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Gate, GateContext } from "../command-gate.js";
import { errorReport, messageOf } from "../gate-support.js";
import { resolveGate } from "../resolve-gate.js";
import type { Assertion, GateRef, GateReport } from "../schema.js";
import { checkFinding } from "./finding-check.js";
import { FixTask } from "./fix-task.js";
import { DEFAULT_GUARDS, guardAssertions, ignoredAssertions, type Guards } from "./guards.js";

/** This module's own path: loaded from the installed package, outside every working copy, so a fix's agent can neither read nor change it. */
export const FINDING_GATE_MODULE = fileURLToPath(import.meta.url);

/** How a fix's run pins this check: a new failure counts, which is what makes "the problem is gone" a requirement. */
export const FINDING_GATE_REF: GateRef = { type: "custom", modulePath: FINDING_GATE_MODULE, failOnNewAssertions: true };

export const findingAssertion = (id: string): string => `finding:${id}:resolved`;

/**
 * What a fix may not touch: as authorised, or the harness's own lists for a fix authorised before guards travelled
 * with it. A fix the owner let change tests may modify an existing test, as a problem in a test may; never delete or skip one.
 */
const guardsOf = (task: FixTask): Guards => {
  const guards = task.guards ?? { ...DEFAULT_GUARDS, testsCategory: false };
  return task.authorisation.allowTestEdits === true ? { ...guards, testsCategory: true } : guards;
};

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
 * count and a PASS harmless. The guard results join the check, absent at
 * baseline except the ignored-file ones already there, which `baseline`
 * records. A check of the problem that cannot run is an error, never a pass.
 * In a project with no tests there is no project check: only the problem's own result and the guards are judged.
 */
const findingGate: Gate = {
  async baseline(ctx) {
    const resolved = regressionCheck(ctx);
    if (!("gate" in resolved)) return resolved;
    const report = resolved.gate === null ? NO_TESTS : await resolved.gate.baseline(resolved.ctx);
    if (report.status === "ERROR") return report;
    // After the project's own run, so what that run leaves behind is part of the baseline, not a new failure.
    try {
      return { ...report, assertions: [...report.assertions, ...(await ignoredAssertions(ctx.worktreePath, guardsOf(resolved.task)))] };
    } catch (err) {
      return errorReport(`which files git ignores could not be checked: ${messageOf(err)}`);
    }
  },
  async check(ctx) {
    const resolved = regressionCheck(ctx);
    if (!("gate" in resolved)) return resolved;
    const { task, gate } = resolved;
    if (!ctx.baseBranch) return errorReport("the branch this fix started from was not recorded, so changes to the project's tests cannot be checked");
    // The guards and the problem are judged before the tests run, so what is judged is the agent's change, not what a test run leaves behind.
    let guards: Assertion[];
    try {
      guards = await guardAssertions(ctx.worktreePath, ctx.baseBranch, guardsOf(task), task.authorisation.verify);
    } catch (err) {
      return errorReport(`whether this fix changed the project's tests could not be checked: ${messageOf(err)}`);
    }
    const found = await resolvedAssertion(task, ctx.worktreePath);
    if ("error" in found) return errorReport(`the check of this problem could not run: ${found.error}`);
    const report = gate === null ? NO_TESTS : await gate.check(resolved.ctx);
    if (report.status === "ERROR") {
      // Even if the project's check can't run, return the guard assertions if any failed
      if (guards.some((a) => a.outcome === "FAIL")) {
        return { status: "FAIL", assertions: [...report.assertions, ...guards], detail: report.detail };
      }
      return report;
    }
    const assertions = [...report.assertions, ...found, ...guards];
    return { ...report, status: assertions.some((a) => a.outcome === "FAIL") ? "FAIL" : report.status, assertions };
  },
};

export default findingGate;
