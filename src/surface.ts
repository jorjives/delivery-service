import { load, logTail, deriveStateFromEntry, setOutcome, updateCursor, appendEntry, deriveBudgetsFromLog } from "./case-file.js";
import { IllegalStateTransition, ProvisioningFailure } from "./errors.js";
import { provisionWorktree } from "./provision.js";
import { messageOf } from "./gate-support.js";
import { recordBaseline } from "./run-gate.js";
import type { SurfaceLocation, SurfacePorts } from "./ports.js";
import type { CaseFile, CaseFileOutcome, SurfaceState, HistoryEntry } from "./schema.js";

export interface AdvanceResult {
  state: SurfaceState;
  done: boolean;
}

function worktreeOf(caseFile: CaseFile, location: SurfaceLocation): string {
  // `create` writes worktreeRef: "" — the "not yet provisioned" sentinel.
  return caseFile.cursor.worktreeRef || location.worktreePath;
}

/**
 * Where the surface actually is, derived rather than trusted.
 *
 * Before the first worker dispatch there are no worker log entries to read, so
 * the header's set-once `baseline` and the cursor are authoritative — this is
 * the one segment of the loop where that is true. Once a baseline exists the
 * surface is ready for a worker.
 *
 * Slice 1 stops here: no worker entry is ever written, so "baselined" and
 * "waiting for its first worker dispatch" are the same thing. Slice 2 replaces
 * the `AGENT_ACTIVE` arm with the design spec's full rule — once a worker
 * dispatch entry exists, position comes from `deriveStateFromEntry(logTail)`.
 */
function position(caseFile: CaseFile): SurfaceState {
  if (caseFile.header.baseline === null) {
    const tail = logTail(caseFile);
    if (tail) return deriveStateFromEntry(tail);
    return caseFile.cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING";
  }
  return "AGENT_ACTIVE";
}

/**
 * Escalation and abort are handled identically: no extra history entry (the
 * entries already in the log evidence the cause), an outcome, a cursor write so
 * the cursor names the terminal state the outcome records, and a fire-and-log
 * closer call for infra teardown. A teardown failure here is logged, never
 * re-triaged — the surface is already terminal.
 */
async function terminate(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  state: "ESCALATED" | "ABORTED",
  outcome: Omit<CaseFileOutcome, "kind"> & { kind: "escalated" | "aborted" },
): Promise<AdvanceResult> {
  await setOutcome(dir, outcome);
  await updateCursor(dir, { state });
  try {
    await ports.closer.close(
      { worktreePath: worktreeOf(caseFile, location), dir },
      { kind: outcome.kind },
    );
  } catch (err) {
    console.warn(`Closer teardown failed for ${dir}: ${messageOf(err)}`);
  }
  return { state, done: true };
}

function isGateMaintenanceTerminus(
  entry: HistoryEntry,
): entry is Extract<HistoryEntry, { t: "terminus" }> & { role: "gate-maintenance" } {
  return entry.t === "terminus" && entry.role === "gate-maintenance";
}

/**
 * The repair agent's own attempt counter, entirely separate from the worker's:
 * a resolved repair session (completed or escalate) advances it, an incomplete
 * one does not — that redispatches the same attempt.
 */
function gateMaintenanceAttempt(history: HistoryEntry[]): number {
  return (
    1 +
    history.filter(
      (e) => isGateMaintenanceTerminus(e) && (e.status === "completed" || e.status === "escalate"),
    ).length
  );
}

function gateMaintenanceRetries(history: HistoryEntry[], attempt: number): number {
  return history.filter(
    (e) => isGateMaintenanceTerminus(e) && e.attempt === attempt && e.status === "incomplete",
  ).length;
}

/**
 * Dispatch one repair session, or escalate if the gate-maintenance budget is
 * spent. The dispatch entry IS the budget burn: the count is derived from the
 * log first, and the entry appended only if under cap, so "burned live" and
 * "derived from the log on rebuild" are the same computation by construction.
 */
async function dispatchGateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  reason: string,
): Promise<AdvanceResult> {
  const budgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);
  const { used, max } = budgets.gateMaintenance;
  if (used >= max) {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: "gate-maintenance",
      reason: `gateMaintenance budget exhausted (${used}/${max}): ${reason}`,
      at: new Date().toISOString(),
    });
  }

  const attempt = gateMaintenanceAttempt(caseFile.history);
  const sessionKey = `gate-maintenance-${attempt}-${gateMaintenanceRetries(caseFile.history, attempt)}`;

  await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt, sessionKey });
  const terminus = await ports.agent.invoke(
    { role: "gate-maintenance" },
    { worktreePath: worktreeOf(caseFile, location), dir, sessionKey },
  );
  await appendEntry(dir, {
    t: "terminus",
    role: "gate-maintenance",
    attempt,
    sessionKey,
    status: terminus.status,
    ...(terminus.status === "escalate" ? { category: terminus.category } : {}),
    rationale: terminus.rationale,
  });
  await updateCursor(dir, { state: "GATE_MAINTENANCE" });
  return { state: "GATE_MAINTENANCE", done: false };
}

/**
 * Capture the baseline. A gate that ran — green or known-red — is a trustworthy
 * measuring stick, so the surface is ready for a worker; only a gate-level
 * ERROR (the gate could not run at all) needs the environment repaired first.
 */
async function preGating(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const report = await recordBaseline(dir, worktreeOf(caseFile, location));
  if (report.status !== "ERROR") {
    await updateCursor(dir, { state: "AGENT_ACTIVE" });
    return { state: "AGENT_ACTIVE", done: false };
  }
  // recordBaseline stores nothing on ERROR, so `caseFile` is still current.
  return dispatchGateMaintenance(
    dir,
    caseFile,
    location,
    ports,
    report.detail ?? "the gate could not run",
  );
}

/**
 * Route a repair session's outcome.
 *
 * Slice 1 only reaches here pre-task (no baseline yet), so a completed repair
 * resolves by re-baselining. That re-baseline — writing the set-once
 * `header.baseline`, or appending another repair dispatch when the gate is
 * still broken — is what makes the exit distinguishable on resume: without it
 * the log tail would still derive GATE_MAINTENANCE and the surface would
 * re-enter this edge forever.
 */
async function gateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);

  if (tail?.t === "dispatch") {
    // A dispatch with no terminus is a session that ended without emitting a
    // valid result — an incomplete terminus, not a session to resurrect. Record
    // it and let the ordinary incomplete handling redispatch or escalate.
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: tail.attempt,
      sessionKey: tail.sessionKey,
      status: "incomplete",
      rationale: "repair session ended without recording a terminus (recovered on resume)",
    });
    return { state: "GATE_MAINTENANCE", done: false };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "GATE_MAINTENANCE", "resolve-repair");
  }

  switch (tail.status) {
    case "completed":
      return preGating(dir, caseFile, location, ports);
    case "escalate":
      return terminate(dir, caseFile, location, ports, "ESCALATED", {
        kind: "escalated",
        source: "gate-maintenance",
        reason: tail.rationale,
        at: new Date().toISOString(),
      });
    case "incomplete":
      return dispatchGateMaintenance(
        dir,
        caseFile,
        location,
        ports,
        "the repair session ended without a result",
      );
  }
}

async function provisioning(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const worktreePath = worktreeOf(caseFile, location);
  try {
    await provisionWorktree(dir, location.repoPath, worktreePath, caseFile.header.surfaceId);
  } catch (err) {
    if (!(err instanceof ProvisioningFailure)) throw err;
    // Provisioning failure is infra-class and terminal: there is no worker or
    // triage move that helps, so it never reaches the caller as a throw.
    return terminate(dir, caseFile, location, ports, "ABORTED", {
      kind: "aborted",
      source: "provisioning",
      reason: err.detail,
      at: new Date().toISOString(),
    });
  }

  // The cursor advance is the commit point for "the worktree exists and belongs
  // to this surface" — provisioning has no history representation.
  await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
  return { state: "PRE_GATING", done: false };
}

/**
 * Perform exactly one transition and commit it. Safe to call from a fresh
 * process against an existing `dir`: every branch reads pre-entry state or the
 * log tail, so a call after a crash always resumes onto a legal edge.
 */
export async function advance(
  dir: string,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const caseFile = await load(dir);

  // Terminal surfaces are recognised before any position is derived: escalation
  // and abort do not always append an entry, so a terminal surface's log tail
  // can still look mid-flight.
  if (caseFile.outcome) return { state: caseFile.cursor.state, done: true };

  const state = position(caseFile);
  switch (state) {
    case "PROVISIONING":
      return provisioning(dir, caseFile, location, ports);
    case "PRE_GATING":
      return preGating(dir, caseFile, location, ports);
    case "GATE_MAINTENANCE":
      return gateMaintenance(dir, caseFile, location, ports);
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
}
