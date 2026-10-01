import { z } from "zod";
import { load, logTail, deriveStateFromEntry, setOutcome, updateCursor, appendEntry, deriveBudgetsFromLog, writeRef, readRef, setbackOf, setBaseBranch } from "./case-file.js";
import { IllegalStateTransition, ProvisioningFailure } from "./errors.js";
import { provisionWorktree, branchName } from "./provision.js";
import { messageOf } from "./gate-support.js";
import { recordBaseline, runCheck } from "./run-gate.js";
import { budgetExhausted } from "./budgets.js";
import { BriefRef } from "./prompt-assembly.js";
import { resolveEscalationPacket } from "./escalation-packet.js";
import { EscalationPacket, type SharpenedBrief } from "./triage-role-config.js";
import type { SurfaceLocation, SurfacePorts, TriageInput, EscalationCause, TriageVerdict, CloseContext } from "./ports.js";
import { OutcomeCause } from "./schema.js";
import type { CaseFile, CaseFileOutcome, SurfaceState, HistoryEntry } from "./schema.js";

export interface AdvanceResult {
  state: SurfaceState;
  done: boolean;
  /**
   * Present only when this advance recovered from an interruption, describing
   * what it recovered. Crash recovery is a primary debugging surface for this
   * item, so a resumed run says what it had to put right; it is returned as
   * data, never printed from here.
   */
  recovery?: string;
}

function worktreeOf(caseFile: CaseFile, location: SurfaceLocation): string {
  // `create` writes worktreeRef: "" — the "not yet provisioned" sentinel.
  return caseFile.cursor.worktreeRef || location.worktreePath;
}

/**
 * One place builds the closer's context, so the accept path and the
 * fire-and-log teardown path can never disagree about what a closer is given.
 * `baseBranch` is empty only if provisioning never completed, which no state
 * that reaches a closer can be; a closer that needs it reports the gap itself
 * rather than the driver guessing a branch.
 */
function closeContextOf(dir: string, caseFile: CaseFile, location: SurfaceLocation): CloseContext {
  return {
    worktreePath: worktreeOf(caseFile, location),
    dir,
    repoPath: location.repoPath,
    branch: branchName(caseFile.header.surfaceId),
    baseBranch: caseFile.header.baseBranch ?? "",
  };
}

function locationOf(caseFile: CaseFile, location: SurfaceLocation): SurfaceLocation {
  return { repoPath: location.repoPath, worktreePath: worktreeOf(caseFile, location) };
}

/**
 * Run `work`, a step that touches what every task of a run shares (taking
 * the baseline, checking the work, handing it off), once the run clears it.
 * Only the shared operation is held, so a task has let go before it asks for
 * a repair and never waits on itself. A task on its own has no coordinator
 * and runs `work` at once.
 */
async function onSharedGround<T>(ports: SurfacePorts, caseFile: CaseFile, work: () => Promise<T>): Promise<T> {
  const leave = await ports.repairCoordinator?.awaitClearance(caseFile.header.surfaceId);
  try {
    return await work();
  } finally {
    leave?.();
  }
}

/**
 * Where the surface actually is, derived rather than trusted.
 *
 * Every state-advancing event, baseline capture included, appends a
 * `HistoryEntry` — so once any entry exists the log tail is unconditionally
 * authoritative, which is what makes a resumed position and a rebuilt cursor
 * incapable of disagreeing. Only before the very first entry (fresh
 * provisioning, or a worktree that exists but hasn't been gated yet) is there
 * no tail to read, and the cursor decides between those two.
 */
function position(caseFile: CaseFile): SurfaceState {
  const tail = logTail(caseFile);
  if (tail) return deriveStateFromEntry(tail);
  return caseFile.cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING";
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
    await ports.closer.close(closeContextOf(dir, caseFile, location), { kind: outcome.kind });
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

/**
 * Terminate as ESCALATED with the standard `{kind, source, reason, at}` shape,
 * plus the packet a person reads. Every escalation, whatever caused it, comes
 * through here, so none can reach a person without one. One fixed ref key: a
 * surface escalates at most once, and a re-run after a crash rewrites the same
 * deterministic packet at the same place.
 */
async function escalate(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
  reason: string,
  // Absent only when resuming a record whose triage round was written before causes were recorded.
  cause: OutcomeCause | undefined,
  packet: EscalationPacket,
): Promise<AdvanceResult> {
  const packetRef = await writeRef(dir, "escalation", packet);
  return terminate(dir, caseFile, location, ports, "ESCALATED", {
    kind: "escalated",
    source,
    reason,
    at: new Date().toISOString(),
    packetRef,
    ...(cause ? { cause } : {}),
  });
}

/** The harness's packet for a cause, over the log as it now stands on disk. */
async function packetFor(dir: string, cause: EscalationCause): Promise<EscalationPacket> {
  return resolveEscalationPacket(dir, await load(dir), cause);
}

/** What the outcome records of an in-memory cause: its kind and what a reader switches on, never its prose. */
function outcomeCause(cause: EscalationCause): OutcomeCause {
  switch (cause.kind) {
    case "authority":
    case "session_not_run":
      return { kind: cause.kind, role: cause.role };
    case "budget":
      return { kind: "budget", population: cause.population };
    case "repair_gave_up":
    case "triage_failure":
      return { kind: cause.kind };
  }
}

/** Escalate for a cause the harness itself found: the one cause names the packet and what the outcome records. */
async function escalateFor(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
  reason: string,
  cause: EscalationCause,
): Promise<AdvanceResult> {
  return escalate(dir, caseFile, location, ports, source, reason, outcomeCause(cause), await packetFor(dir, cause));
}

/** The ref shape `triage()` writes for an escalate round. */
const PacketRef = z.object({ artifact: EscalationPacket, cause: OutcomeCause.optional() });

/**
 * What an escalate verdict's outcome records: the cause the port named, else
 * whether the agent wrote the packet itself or the harness had to stand in.
 */
function triageCause(verdict: TriageVerdict): OutcomeCause {
  if (verdict.cause) return outcomeCause(verdict.cause);
  return { kind: EscalationPacket.safeParse(verdict.artifact).success ? "triage_escalated" : "triage_failure" };
}

/**
 * The packet for an escalate verdict: the agent's own when it wrote one, else
 * the harness's, built from the cause the port named. A port that named none
 * is treated as triage failing to reach a verdict, so no escalation can ever
 * reach a person without a packet.
 */
async function packetForVerdict(
  dir: string,
  caseFile: CaseFile,
  verdict: TriageVerdict,
): Promise<EscalationPacket> {
  const authored = EscalationPacket.safeParse(verdict.artifact);
  if (authored.success) return authored.data;
  return resolveEscalationPacket(
    dir, caseFile, verdict.cause ?? { kind: "triage_failure", rationale: verdict.rationale },
  );
}

/** Terminate as ABORTED with the standard `{kind, source, reason, at, cause}` shape. */
function abort(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
  reason: string,
  cause: OutcomeCause,
): Promise<AdvanceResult> {
  return terminate(dir, caseFile, location, ports, "ABORTED", {
    kind: "aborted",
    source,
    reason,
    at: new Date().toISOString(),
    cause,
  });
}

/**
 * Terminal escalation for a log tail that already records one: an authority
 * terminus, a repair session's escalate, or a triage escalate whose outcome was
 * never written. The reason is the tail's own rationale, and a triage tail is
 * credited to triage, exactly as the live run would have credited it.
 */
async function escalateFromTail(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);
  if (tail?.t === "triage") {
    // TRIAGE wrote this round's packet into its ref before appending the entry.
    // The round's cause is there too: it cannot be worked out again from the log.
    const ref = PacketRef.safeParse(await readRef(dir, tail.artifactRef));
    if (!ref.success) {
      return escalateFor(dir, caseFile, location, ports, "triage", tail.rationale, { kind: "triage_failure", rationale: tail.rationale });
    }
    return escalate(dir, caseFile, location, ports, "triage", tail.rationale, ref.data.cause, ref.data.artifact);
  }
  const terminus = tail?.t === "terminus" ? tail : undefined;
  const cause: EscalationCause =
    terminus?.category === "authority"
      ? { kind: "authority", role: terminus.role ?? "worker" }
      : { kind: "repair_gave_up" };
  return escalateFor(dir, caseFile, location, ports, source, terminus ? terminus.rationale : "the session escalated", cause);
}

/**
 * Escalate a terminus from a session that never started, or undefined when
 * there is one to retry.
 *
 * Every retry population exists because a further attempt might land
 * differently. For a session the runtime refused to start, nothing between
 * attempts can differ: the failure was decided before the first token, so each
 * further spawn is pure cost and pure delay, and the budget it spends buys
 * nothing. This is the same judgement the router makes for an authority limit,
 * and it is made the same way — ahead of the budget, never inside it.
 *
 * Both edges that retry an incomplete terminus route through here, so the rule
 * holds for a repair session as well as a worker, and holds identically whether
 * the terminus was just returned or is being re-read from the log on resume.
 */
function escalateIfNotRun(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  role: "worker" | "gate-maintenance",
  tail: Extract<HistoryEntry, { t: "terminus" }>,
): Promise<AdvanceResult> | undefined {
  if (!tail.notRun) return undefined;
  return escalateFor(dir, caseFile, location, ports, role, tail.rationale, { kind: "session_not_run", role });
}

/**
 * A dangling dispatch (no terminus recorded) is not a session to resurrect —
 * sessions are reconstructed, never resumed — so the missing terminus is
 * recorded first and the ordinary bounded retry handles it from there.
 */
async function recordMissingTerminus(
  dir: string,
  tail: Extract<HistoryEntry, { t: "dispatch" }>,
  role: "worker" | "gate-maintenance",
): Promise<string> {
  const label = role === "worker" ? "worker" : "repair";
  const entry: HistoryEntry = {
    t: "terminus",
    role,
    attempt: tail.attempt,
    sessionKey: tail.sessionKey,
    status: "incomplete",
    rationale: `${label} session ended without recording a terminus (recovered on resume)`,
  };
  await appendEntry(dir, entry);
  return `recorded a missing terminus for ${label} attempt ${tail.attempt} (${tail.sessionKey}): the interrupted session is retried, not re-dispatched`;
}

/** The triage verdict that starts a session of each role, and so may carry its brief. */
const BRIEFING_VERDICT = { worker: "reroute", "gate-maintenance": "fix_the_gate" } as const;

/**
 * The brief carried by the latest triage round with `verdict`, or undefined.
 *
 * The latest such round is the one that started the session or close about to
 * run. Its ref carries an artefact only when an agent wrote a brief, so a
 * deterministic verdict's round yields none, never an earlier round's. Derived
 * from the log, so a first run, a retry and a resumed run agree.
 */
async function briefStartedBy(
  dir: string,
  history: HistoryEntry[],
  verdict: "reroute" | "fix_the_gate" | "retry_close",
): Promise<{ artifactRef: string; brief: SharpenedBrief } | undefined> {
  const start = history.findLast((e) => e.t === "triage" && e.verdict === verdict);
  if (start?.t !== "triage") return undefined;
  const ref = BriefRef.safeParse(await readRef(dir, start.artifactRef));
  return ref.success ? { artifactRef: start.artifactRef, brief: ref.data.artifact } : undefined;
}

/**
 * The ref holding the brief for the session about to be dispatched, or undefined.
 * Every worker attempt after the first was started by a `reroute`, and every
 * post-task repair by a `fix_the_gate`. A pre-task repair has no triage entry.
 */
async function currentBriefRef(
  dir: string,
  history: HistoryEntry[],
  role: "worker" | "gate-maintenance",
): Promise<string | undefined> {
  return (await briefStartedBy(dir, history, BRIEFING_VERDICT[role]))?.artifactRef;
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

  const briefRef = await currentBriefRef(dir, caseFile.history, role);
  await appendEntry(dir, { t: "dispatch", role, attempt, sessionKey, ...(briefRef ? { briefRef } : {}) });
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
    ...(terminus.status === "incomplete" && terminus.notRun ? { notRun: true as const } : {}),
    ...(terminus.status === "incomplete" && terminus.limit ? { limit: terminus.limit } : {}),
    rationale: terminus.rationale,
  };
  await appendEntry(dir, entry);

  const state = deriveStateFromEntry(entry);
  if (state === "ESCALATED") {
    return escalateFor(dir, caseFile, location, ports, role, terminus.rationale, { kind: "authority", role });
  }
  await updateCursor(dir, { state });
  return { state, done: false };
}

/**
 * Dispatch one repair session on this task's own limit, or escalate if that
 * limit is spent. The dispatch entry IS the budget burn: the count is derived
 * from the log first, and the entry appended only if under cap, so "burned
 * live" and "derived from the log on rebuild" are the same computation by
 * construction. Whether the task should be repairing at all, in a run of
 * several at once, is decided by the two callers that learn the check cannot
 * run, never here.
 */
async function dispatchOwnRepair(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  reason: string,
): Promise<AdvanceResult> {
  const budgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);
  const { used, max } = budgets.gateMaintenance;
  if (used >= max) {
    return escalateFor(
      dir, caseFile, location, ports, "gate-maintenance",
      budgetExhausted("gateMaintenance", { used, max }, reason),
      { kind: "budget", population: "gateMaintenance", budget: { used, max }, detail: reason },
    );
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
  const report = await onSharedGround(ports, caseFile, () => recordBaseline(dir, locationOf(caseFile, location)));
  if (report.status !== "ERROR") {
    await updateCursor(dir, { state: "AGENT_ACTIVE" });
    return { state: "AGENT_ACTIVE", done: false };
  }
  // recordBaseline stores nothing on ERROR, so `caseFile` is still current.
  const reason = report.detail ?? "the gate could not run";
  // In a run of several at once, a check that cannot run before this task has done anything is the environment
  // every task shares: the run repairs it, once, on its own limit, and the baseline is taken again.
  if (ports.repairCoordinator) {
    await ports.repairCoordinator.requestRepair({ surfaceId: caseFile.header.surfaceId, reason });
    return preGating(dir, caseFile, location, ports);
  }
  return dispatchOwnRepair(dir, caseFile, location, ports, reason);
}

/**
 * Route a repair session's outcome.
 *
 * Three tails can land here. A `triage` entry means `fix_the_gate` was recorded
 * but the repair it pays for was not yet dispatched — the crash window between
 * those two writes, and also the ordinary post-task hand-off, since `TRIAGE`
 * deliberately leaves the dispatch to this edge. A `dispatch` with no terminus
 * is a session that ended without a result. A `terminus` is a session to route.
 *
 * A completed repair resolves differently by entry point, and the log — not the
 * cursor — must carry the distinction, or a crash right after would re-derive
 * `GATE_MAINTENANCE` with no way to tell the exits apart. Pre-task (no baseline
 * yet) re-baselines, appending a `baseline` entry. Post-task re-checks the
 * attempt that triggered the repair against the baseline already pinned,
 * appending a `gate` entry. The baseline is never recaptured post-task.
 */
async function gateMaintenance(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);

  if (tail?.t === "triage") {
    // The check kept erroring until this task's re-checks ran out. In a run of several at once that may be this
    // task's own doing or the environment every task shares, so the run is asked: shared means it has been
    // repaired, once, for everyone, and the same attempt is checked again; alone means this task deals with it
    // exactly as a task on its own does. The round's ref names the setback, so a crash after the run's repair
    // does not have it repaired twice.
    const answer = await ports.repairCoordinator?.reportCheckErrors({ surfaceId: caseFile.header.surfaceId, key: tail.artifactRef });
    if (answer === "shared") return gating(dir, caseFile, location, ports);
    return dispatchOwnRepair(dir, caseFile, location, ports, "triage routed the setback to a gate repair");
  }

  if (tail?.t === "dispatch") {
    // A dispatch with no terminus is a session that ended without emitting a
    // valid result — an incomplete terminus, not a session to resurrect. Record
    // it and let the ordinary incomplete handling redispatch or escalate.
    const recovery = await recordMissingTerminus(dir, tail, "gate-maintenance");
    return { state: "GATE_MAINTENANCE", done: false, recovery };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "GATE_MAINTENANCE", "resolve-repair");
  }

  switch (tail.status) {
    case "completed":
      return caseFile.header.baseline === null
        ? preGating(dir, caseFile, location, ports)
        : gating(dir, caseFile, location, ports);
    case "escalate":
      return escalateFromTail(dir, caseFile, location, ports, "gate-maintenance");
    case "incomplete":
      return (
        escalateIfNotRun(dir, caseFile, location, ports, "gate-maintenance", tail) ??
        dispatchOwnRepair(
          dir,
          caseFile,
          location,
          ports,
          "the repair session ended without a result",
        )
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
  let restarted: boolean;
  let baseBranch: string;
  try {
    ({ restarted, baseBranch } = await provisionWorktree(
      dir, location.repoPath, worktreePath, caseFile.header.surfaceId,
    ));
  } catch (err) {
    if (!(err instanceof ProvisioningFailure)) throw err;
    // Provisioning failure is infra-class and terminal: there is no worker or
    // triage move that helps, so it never reaches the caller as a throw.
    return abort(dir, caseFile, location, ports, "provisioning", err.detail, { kind: "provisioning" });
  }

  // Guarded rather than unconditional: provisioning legitimately runs twice
  // when a crash lands before the cursor advance, and the pin is set-once.
  if (caseFile.header.baseBranch === null) await setBaseBranch(dir, baseBranch);

  // The cursor advance is the commit point for "the worktree exists and belongs
  // to this surface" — provisioning has no history representation.
  await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
  return {
    state: "PRE_GATING",
    done: false,
    ...(restarted
      ? { recovery: "restarted an interrupted provision: cleared what a torn attempt left behind and re-created the worktree" }
      : {}),
  };
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
    const recovery = await recordMissingTerminus(dir, tail, "worker");
    return { state: "INCOMPLETE_TERMINUS", done: false, recovery };
  }

  if (tail?.t !== "terminus") {
    throw new IllegalStateTransition(dir, "INCOMPLETE_TERMINUS", "retry-worker");
  }

  const notRun = escalateIfNotRun(dir, caseFile, location, ports, "worker", tail);
  if (notRun) return notRun;

  // The terminus entry that triggered this edge is already in the log, so the
  // count is correct with zero additional writes — including at cap, where no
  // redispatch ever follows to record the final burn.
  const { used, max } = deriveBudgetsFromLog(
    caseFile.history,
    caseFile.cursor.budgets,
  ).terminus;
  if (used >= max) {
    return escalateFor(
      dir, caseFile, location, ports, "worker",
      budgetExhausted("terminus", { used, max }, tail.rationale),
      { kind: "budget", population: "terminus", budget: { used, max }, detail: tail.rationale },
    );
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
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const { delta } = await onSharedGround(ports, caseFile, () =>
    runCheck(
      dir,
      locationOf(caseFile, location),
      workerAttempt(caseFile.history),
    ),
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
 * the detail an earlier close entry still points at. A close retried by triage's
 * agent is handed the brief it wrote as ctx.repairBrief.
 */
async function closing(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  // Inlined rather than passed on as a ref: a closer has no later reader to
  // defer to. Only a retry_close round can precede a close, so the latest one
  // is the round that ordered this retry.
  const repairBrief = (await briefStartedBy(dir, caseFile.history, "retry_close"))?.brief;
  const ctx: CloseContext = { ...closeContextOf(dir, caseFile, location), ...(repairBrief ? { repairBrief } : {}) };
  const report = await onSharedGround(ports, caseFile, () => ports.closer.close(ctx, { kind: "accepted" }));

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
 * The trigger `TriagePort` reads, derived from the entry that routed the
 * surface into `TRIAGE`. The state alone does not carry it, and the tail is the
 * same thing a resumed run reads — so a live route and a resumed one classify
 * the setback identically.
 */
export function triageTrigger(
  dir: string,
  tail: HistoryEntry | undefined,
): Pick<TriageInput, "trigger" | "category"> {
  const setback = setbackOf(tail);
  if (!setback) throw new IllegalStateTransition(dir, "TRIAGE", "triage");
  return setback;
}

/**
 * Ask the router what to do about the setback on the log tail, and carry out
 * its verdict.
 *
 * The `triage` entry appended here IS the `correction`/`close`/`gateError` burn
 * for a `reroute`/`retry_close`/`recheck_gate` verdict — there is no separate
 * increment, and the budgets handed to the router are derived from the log immediately before the
 * call, never read from the cursor's stale copy. Routing then goes through
 * `deriveStateFromEntry` on the entry just appended, so a live route and a
 * resumed one are the same computation rather than two rules that can drift.
 *
 * `fix_the_gate` deliberately stops at `GATE_MAINTENANCE` without dispatching:
 * that edge already has to dispatch from a `fix_the_gate` tail to recover the
 * crash window between the two writes, so doing it here as well would be a
 * second copy of the same code guarded by nothing.
 */
async function triage(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const { trigger, category } = triageTrigger(dir, logTail(caseFile));
  const remainingBudgets = deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets);

  const priorTriages = caseFile.history.filter((e) => e.t === "triage").length;
  const verdict = await ports.triage.triage({
    trigger,
    ...(category ? { category } : {}),
    caseFile,
    remainingBudgets,
    // The session key is the round's ref key: one string per round, derived from
    // the log, so a resumed triage mints the same session it would have run.
    ctx: { worktreePath: worktreeOf(caseFile, location), dir, sessionKey: `triage-${priorTriages}` },
  });

  // Every escalate carries a packet a person can act on. It goes into the
  // round's ref like any artefact, before the entry, so a resumed escalation
  // finds it there. Keyed by prior triage count so repeated rounds never
  // overwrite each other's artefacts; a crash between the ref and the entry
  // leaves an orphan ref that the re-run overwrites at the same key.
  const packet = verdict.verdict === "escalate" ? await packetForVerdict(dir, caseFile, verdict) : undefined;
  const cause = packet ? triageCause(verdict) : undefined;
  const artifact = packet ?? verdict.artifact;
  const artifactRef = await writeRef(dir, `triage-${priorTriages}`, {
    trigger,
    rationale: verdict.rationale,
    ...(artifact ? { artifact } : {}),
    ...(cause ? { cause } : {}),
  });

  const entry: HistoryEntry = {
    t: "triage",
    afterAttempt: workerAttempt(caseFile.history),
    trigger,
    verdict: verdict.verdict,
    rationale: verdict.rationale,
    artifactRef,
  };
  await appendEntry(dir, entry);

  const state = deriveStateFromEntry(entry);
  // `packet` is set exactly when the verdict is escalate, which is exactly when
  // the entry routes to ESCALATED.
  if (state === "ESCALATED" && packet) {
    return escalate(dir, caseFile, location, ports, "triage", verdict.rationale, cause, packet);
  }
  if (state === "ABORTED") {
    return abort(dir, caseFile, location, ports, "triage", verdict.rationale, { kind: "triage_abort" });
  }
  await updateCursor(dir, { state });
  return { state, done: false };
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
      return gating(dir, caseFile, location, ports);
    case "TRIAGE":
      return triage(dir, caseFile, location, ports);
    case "CLOSING":
      return closing(dir, caseFile, location, ports);
    case "CLOSED":
      // The crash window between appending an accepted close entry and writing
      // the outcome. The close already happened — never re-run the closer.
      return closed(dir, "the closer accepted the work (outcome recorded on resume)");
    case "ESCALATED":
      // The crash window between recording an escalation (an authority-class
      // terminus, or a triage escalate) and writing the outcome: resume onto
      // the terminal edge, not into a throw.
      return escalateFromTail(dir, caseFile, location, ports, "worker");
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
}

export interface RunResult {
  state: SurfaceState;
  outcome?: CaseFileOutcome;
}

/**
 * Advance the surface until it is terminal, then read back its outcome.
 *
 * No step cap: every non-terminal advance either appends an entry or throws,
 * and the budget caps bound how many entries the loop can produce. Safe to
 * call from a fresh process against an existing `dir` — it is just `advance`,
 * which resumes onto a legal edge from whatever is on disk.
 */
export async function run(
  dir: string,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<RunResult> {
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
  } while (!result.done);

  const { outcome } = await load(dir);
  return { state: result.state, outcome };
}
