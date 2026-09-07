import { load, setBaseline } from "./case-file.js";
import { resolveGate } from "./resolve-gate.js";
import type { GateContext } from "./command-gate.js";
import type { CaseFileHeader, GateReport } from "./schema.js";

function gateContext(header: CaseFileHeader, worktreePath: string): GateContext {
  return { worktreePath, taskDef: header.taskDef, gateRef: header.gateRef };
}

/**
 * Run the surface's pinned gate's `baseline` and store the report in the case
 * file. Set-once: a second call for a surface that already has a baseline
 * rejects with `ImmutabilityViolation`.
 *
 * An ERROR report is returned but never stored — the baseline is immutable for
 * the surface's lifetime, so pinning a failed run would be unrecoverable. The
 * caller retries on the gateError budget.
 */
export async function recordBaseline(
  dir: string,
  worktreePath: string,
): Promise<GateReport> {
  const { header } = await load(dir);
  const gate = resolveGate(header.gateRef, worktreePath);
  const report = await gate.baseline(gateContext(header, worktreePath));

  if (report.status !== "ERROR") {
    await setBaseline(dir, report);
  }

  return report;
}
