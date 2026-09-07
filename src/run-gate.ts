import { load, setBaseline, appendEntry, writeRef } from "./case-file.js";
import { resolveGate } from "./resolve-gate.js";
import { computeDelta } from "./delta-rule.js";
import { MissingBaseline } from "./errors.js";
import type { GateContext } from "./command-gate.js";
import type { CaseFileHeader, GateEntry, GateReport, DeltaResult, NewFailure } from "./schema.js";

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

/**
 * Run the surface's pinned gate's `check`, compare it against the stored
 * baseline, and append the verdict to history. `attempt` is the dispatch
 * attempt this check judges; the caller (the state machine) owns that counter.
 */
export async function runCheck(
  dir: string,
  worktreePath: string,
  attempt: number,
): Promise<{ report: GateReport; delta: DeltaResult }> {
  const { header } = await load(dir);
  if (header.baseline === null) throw new MissingBaseline(dir);

  const gate = resolveGate(header.gateRef, worktreePath);
  const report = await gate.check(gateContext(header, worktreePath));
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

  // ponytail: refs are keyed `gate-<attempt>-<index>`, so a second `runCheck`
  // for the SAME attempt (a gate-maintenance re-check retries the identical
  // attempt) overwrites the earlier call's ref files while both history
  // entries still point at those ids. Ceiling: at most one runCheck per
  // attempt is safe under this scheme. Widen the key (e.g. include a
  // re-check counter) if gate maintenance ever re-checks an attempt more
  // than once.
  const newFailures: GateEntry["newFailures"] = [];
  for (const [index, failure] of failures.entries()) {
    newFailures.push({
      id: failure.id,
      detailRef: await writeRef(dir, `gate-${attempt}-${index}`, failure),
    });
  }

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
