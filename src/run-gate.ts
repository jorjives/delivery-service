import { load, setBaseline, appendEntry, writeRef } from "./case-file.js";
import { resolveGate } from "./resolve-gate.js";
import { computeDelta } from "./delta-rule.js";
import { MissingBaseline } from "./errors.js";
import type { GateContext } from "./command-gate.js";
import type { SurfaceLocation } from "./ports.js";
import type { CaseFileHeader, GateEntry, GateReport, DeltaResult, NewFailure } from "./schema.js";

function gateContext(header: CaseFileHeader, worktreePath: string): GateContext {
  return { worktreePath, taskDef: header.taskDef, gateRef: header.gateRef, baseBranch: header.baseBranch };
}

// The gate measures the worktree but is loaded from the repo root: a relative
// custom `modulePath` resolved against the worktree would put the gate in reach
// of the very roles it judges.
function gateOf(header: CaseFileHeader, location: SurfaceLocation) {
  return resolveGate(header.gateRef, location.repoPath);
}

/**
 * Run the surface's pinned gate's `baseline` and store the report in the case
 * file. Set-once: a second call for a surface that already has a baseline
 * rejects with `ImmutabilityViolation`.
 *
 * An ERROR report is returned but never stored — the baseline is immutable for
 * the surface's lifetime, so pinning a failed run would be unrecoverable. What
 * the caller does with it is the caller's: this item's driver routes it to
 * gate maintenance, on the gateMaintenance budget.
 */
export async function recordBaseline(
  dir: string,
  location: SurfaceLocation,
): Promise<GateReport> {
  const { header } = await load(dir);
  const report = await gateOf(header, location).baseline(gateContext(header, location.worktreePath));

  if (report.status !== "ERROR") {
    await setBaseline(dir, report);
  }

  return report;
}

/**
 * Run the surface's pinned gate's `check`, compare it against the stored
 * baseline, and append the verdict to history. `attempt` is the dispatch
 * attempt this check judges; the caller (the state machine) owns that counter.
 */
export async function runCheck(
  dir: string,
  location: SurfaceLocation,
  attempt: number,
): Promise<{ report: GateReport; delta: DeltaResult }> {
  const { header, history } = await load(dir);
  if (header.baseline === null) throw new MissingBaseline(dir);

  const report = await gateOf(header, location).check(gateContext(header, location.worktreePath));
  const delta = computeDelta(header.baseline, report, {
    failOnNewAssertions: header.gateRef.failOnNewAssertions,
  });

  // A gate-level error produces no reliable assertions, so every baseline
  // assertion looks ABSENT. Those are artefacts of the failed run, not the
  // worker's regressions, so an error entry records none. Filtered once here,
  // then used for the refs, the appended entry AND the returned delta, so the
  // value the caller sees is the value on disk.
  // ponytail: the ERROR report's `detail` is dropped — GateEntry has no field
  // for it; add one when triage needs the diagnostic rather than a re-run.
  const failures: NewFailure[] = delta.class === "error" ? [] : delta.newFailures;

  // Keyed by attempt AND by how many times this attempt has already been
  // checked: a gate-maintenance repair re-checks the SAME attempt against the
  // immutable baseline, and a bare `gate-<attempt>-<index>` key would overwrite
  // the ref files the earlier check's `gate` entry still points at.
  const recheckCount = history.filter((e) => e.t === "gate" && e.attempt === attempt).length;

  const newFailures: GateEntry["newFailures"] = await Promise.all(
    failures.map(async (failure, index) => ({
      id: failure.id,
      detailRef: await writeRef(dir, `gate-${attempt}-${recheckCount}-${index}`, failure),
    })),
  );

  const status = delta.pass ? "PASS" : delta.class === "error" ? "ERROR" : "FAIL";
  await appendEntry(dir, {
    t: "gate",
    attempt,
    status,
    newFailures,
    ...(delta.class ? { class: delta.class } : {}),
  });

  return { report, delta: { ...delta, newFailures: failures } };
}
