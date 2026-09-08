import { load, logTail, deriveStateFromEntry, setOutcome, updateCursor, appendEntry, deriveBudgetsFromLog, writeRef } from "./case-file.js";
import { IllegalStateTransition, ProvisioningFailure } from "./errors.js";
import { provisionWorktree } from "./provision.js";
import { messageOf } from "./gate-support.js";
import { recordBaseline, runCheck } from "./run-gate.js";
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
 * the one segment of the loop where that is true. Once a worker dispatch entry
 * exists the log tail is authoritative, which is what makes a resumed position
 * and a rebuilt cursor incapable of disagreeing.
 */
function position(caseFile: CaseFile): SurfaceState {
  const tail = logTail(caseFile);
  const workerStarted = caseFile.history.some(
    (e) => e.t === "dispatch" && e.role !== "gate-maintenance",
  );
  if (workerStarted && tail) return deriveStateFromEntry(tail);
  if (caseFile.header.baseline === null) {
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

/**
 * Prior same-role, same-attempt sessions that ended without a valid result.
 * Log-derived, so a crashed dispatch's own re-run computes the same sessionKey
 * and stays idempotent, while a genuine retry after a recorded incomplete
 * terminus gets a new one.
 */
function retriesOf(
  history: HistoryEntry[],
  role: "worker" | "gate-maintenance",
  attempt: number,
): number {
  return history.filter(
    (e) =>
      e.t === "terminus" &&
      (e.role ?? "worker") === role &&
      e.attempt === attempt &&
      e.status === "incomplete",
  ).length;
}

/**
 * The worker attempt in flight. Only a reroute verdict advances it: a
 * terminus-retry re-dispatches the SAME attempt, which is what keeps its cost
 * attributed to the terminus population rather than to corrections.
 */
function workerAttempt(history: HistoryEntry[]): number {
  return 1 + history.filter((e) => e.t === "triage" && e.verdict === "reroute").length;
}

/** Terminal escalation whose reason is the tail terminus's own rationale. */
function escalateFromTail(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);
  return terminate(dir, caseFile, location, ports, "ESCALATED", {
    kind: "escalated",
    source,
    reason: tail?.t === "terminus" ? tail.rationale : "the session escalated",
    at: new Date().toISOString(),
  });
}

/**
 * Dispatch one agent session and route on what it returned.
 *
 * The dispatch entry, the invoke and the terminus entry are one edge: routing
 * goes through `deriveStateFromEntry` on the terminus just appended, so the
 * state a live run moves to and the state a resumed run derives from the log
 * are the same computation rather than two rules that can drift apart.
 */
async function dispatchSession(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  role: "worker" | "gate-maintenance",
  attempt: number,
): Promise<AdvanceResult> {
  const sessionKey = `${role}-${attempt}-${retriesOf(caseFile.history, role, attempt)}`;

  await appendEntry(dir, { t: "dispatch", role, attempt, sessionKey });
  const terminus = await ports.agent.invoke(
    { role },
    { worktreePath: worktreeOf(caseFile, location), dir, sessionKey },
  );
  const entry: HistoryEntry = {
    t: "terminus",
    role,
    attempt,
    sessionKey,
    status: terminus.status,
    ...(terminus.status === "escalate" ? { category: terminus.category } : {}),
    rationale: terminus.rationale,
  };
  await appendEntry(dir, entry);

  const state = deriveStateFromEntry(entry);
  if (state === "ESCALATED") {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: role,
      reason: terminus.rationale,
      at: new Date().toISOString(),
    });
  }
  await updateCursor(dir, { state });
  return { state, done: false };
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

  return dispatchSession(
    dir, caseFile, location, ports,
    "gate-maintenance", gateMaintenanceAttempt(caseFile.history),
  );
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
      return escalateFromTail(dir, caseFile, location, ports, "gate-maintenance");
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
 * Dispatch the worker session for the attempt in flight. Every terminus this
 * can return is routed by `dispatchSession`: completed to GATING, an authority
 * limit straight out, an exhaustion-class escalate to the deterministic
 * router, and a session that ended without a result to INCOMPLETE_TERMINUS.
 */
function agentActive(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  return dispatchSession(
    dir, caseFile, location, ports, "worker", workerAttempt(caseFile.history),
  );
}

/**
 * Retry a worker session that ended without a valid result, or escalate.
 *
 * A dangling dispatch is not a session to resurrect — sessions are
 * reconstructed, never resumed — so the missing terminus is recorded first and
 * the ordinary bounded retry handles it from there. That terminus is the one
 * and only one ever written for the dispatch, so no double burn arises whether
 * the crash was observed live or only on the next process's resume.
 */
async function incompleteTerminus(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);

  if (tail?.t === "dispatch") {
    await appendEntry(dir, {
      t: "terminus",
      role: "worker",
      attempt: tail.attempt,
      sessionKey: tail.sessionKey,
      status: "incomplete",
      rationale: "worker session ended without recording a terminus (recovered on resume)",
    });
    return { state: "INCOMPLETE_TERMINUS", done: false };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "INCOMPLETE_TERMINUS", "retry-worker");
  }

  // The terminus entry that triggered this edge is already in the log, so the
  // count is correct with zero additional writes — including at cap, where no
  // redispatch ever follows to record the final burn.
  const { used, max } = deriveBudgetsFromLog(
    caseFile.history,
    caseFile.cursor.budgets,
  ).terminus;
  if (used >= max) {
    return terminate(dir, caseFile, location, ports, "ESCALATED", {
      kind: "escalated",
      source: "worker",
      reason: `terminus budget exhausted (${used}/${max}): ${tail.rationale}`,
      at: new Date().toISOString(),
    });
  }

  // Re-dispatch onto the worktree as the crashed or capped session left it,
  // with the SAME attempt number: this is a retry of that attempt, not a new
  // one, which is what keeps its cost on terminus rather than correction.
  return dispatchSession(dir, caseFile, location, ports, "worker", tail.attempt);
}

/**
 * Judge the worker's change against the recorded baseline. `runCheck` writes
 * the gate entry and the failure refs itself; the attempt it judges is the one
 * in flight, which is the same attempt the terminus just recorded — a
 * terminus-retry re-checks the attempt it retried, never a new one.
 */
async function gating(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
): Promise<AdvanceResult> {
  const { delta } = await runCheck(
    dir,
    worktreeOf(caseFile, location),
    workerAttempt(caseFile.history),
  );
  const state: SurfaceState = delta.pass ? "CLOSING" : "TRIAGE";
  await updateCursor(dir, { state });
  return { state, done: false };
}

/**
 * Do something with the accepted work. Acceptance and close are separate
 * events: GATING decided the change is good, this decides what happens to it.
 *
 * The ref key counts prior close entries so a retried close cannot overwrite
 * the detail an earlier close entry still points at.
 */
async function closing(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const report = await ports.closer.close(
    { worktreePath: worktreeOf(caseFile, location), dir },
    { kind: "accepted" },
  );

  const priorCloses = caseFile.history.filter((e) => e.t === "close").length;
  const detailRef = await writeRef(dir, `close-${priorCloses}`, report);
  await appendEntry(dir, { t: "close", status: report.status, detailRef });

  if (report.status !== "DONE") {
    await updateCursor(dir, { state: "TRIAGE" });
    return { state: "TRIAGE", done: false };
  }

  return closed(dir, report.detail);
}

/**
 * Record the terminal CLOSED outcome. Split out so the resume case can reuse
 * it without re-running the closer.
 */
async function closed(dir: string, reason: string): Promise<AdvanceResult> {
  await setOutcome(dir, {
    kind: "closed",
    source: "closer",
    reason,
    at: new Date().toISOString(),
  });
  await updateCursor(dir, { state: "CLOSED" });
  return { state: "CLOSED", done: true };
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
    case "AGENT_ACTIVE":
      return agentActive(dir, caseFile, location, ports);
    case "INCOMPLETE_TERMINUS":
      return incompleteTerminus(dir, caseFile, location, ports);
    case "GATING":
      return gating(dir, caseFile, location);
    case "CLOSING":
      return closing(dir, caseFile, location, ports);
    case "CLOSED":
      // The crash window between appending an accepted close entry and writing
      // the outcome. The close already happened — never re-run the closer.
      return closed(dir, "the closer accepted the work (outcome recorded on resume)");
    case "ESCALATED":
      // The crash window between recording an authority-class terminus and
      // writing the outcome: resume onto the terminal edge, not into a throw.
      return escalateFromTail(dir, caseFile, location, ports, "worker");
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
}
