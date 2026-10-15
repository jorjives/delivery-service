import type { Budget, BudgetPopulation, BudgetSet, CaseFile, CloseReport, UsageLimit, SessionUsage } from "./schema.js";
import type { CloseRepairBrief, EscalationPacket, SharpenedBrief, TriageEnvelope } from "./triage-role-config.js";

// --- AgentPort (createAgentPort in agent-invoke.ts is the SDK-backed implementation) ---

/** The roles a surface dispatches through the agent port. */
export type DispatchedRole = "worker" | "triage" | "gate-maintenance";

/**
 * Every role the harness configures: the three a surface dispatches, and the
 * scanner, which a review runs on its own, with no case file, through
 * `runSession`. The scanner is never dispatched through `AgentPort`.
 */
export type AgentRole = DispatchedRole | "scanner";

/**
 * The driver's handle for "which role is being dispatched". The full pinned
 * configuration for a role — prompt fragment, envelope schema, tool authority —
 * lives in `role-config.ts`; the driver never assembles one, it names a role and
 * the agent port resolves it.
 */
export interface RoleHandle {
  role: AgentRole;
}

export interface AgentContext {
  worktreePath: string;
  dir: string;
  sessionKey: string;
}

export type Terminus =
  | { status: "completed"; rationale: string }
  | { status: "escalate"; category: "exhaustion" | "authority"; rationale: string }
  | {
      status: "incomplete";
      rationale: string;
      /**
       * Set when no session happened at all — the runtime refused to start one.
       * The rationale already says so in prose, for the person reading the case
       * file; this says the same thing to the routing layer, which cannot read
       * prose and would otherwise treat every incomplete terminus alike.
       *
       * The distinction is the fact, not the policy: a session that ran and
       * answered badly may answer well next time, while nothing between
       * attempts can change for one that never started. What to do about that
       * is the surface's decision, not this flag's.
       */
      notRun?: true;
      /**
       * Set when a usage limit stopped the session. Like `notRun`, the fact for
       * a caller that cannot read prose: a limit says nothing about the task,
       * its check or the environment, and must never be reported as any of them.
       */
      limit?: UsageLimit;
    };

/** The harness's own verdict on a session that produced nothing usable, for any role. */
export type Incomplete = Extract<Terminus, { status: "incomplete" }>;

/**
 * A terminus as the agent port returns it: with what the agent runtime reported
 * for the session, when one ran and reported anything. Never part of what an
 * agent may say: the harness adds it after the reply is validated. Read only by
 * what records it; no routing decision reads it.
 */
export type Metered<T> = T & { usage?: SessionUsage };

/** The plain words a usage limit is always described with. One table, so every place that names a limit names it the same way. */
export const USAGE_LIMIT_WORDS: Record<UsageLimit, string> = {
  rate: "the AI service is limiting requests",
  spend: "the spending limit has been reached",
};

export type TriageTerminus = TriageEnvelope | Incomplete;

export interface RoleTerminusMap {
  worker: Metered<Terminus>;
  "gate-maintenance": Metered<Terminus>;
  triage: Metered<TriageTerminus>;
}

export interface AgentPort {
  invoke<R extends DispatchedRole>(roleCfg: RoleHandle & { role: R }, ctx: AgentContext): Promise<RoleTerminusMap[R]>;
}

// --- TriagePort (deterministicRouter in router.ts; createAgentTriage in triage.ts) ---

/** Why a surface escalated, when no agent wrote the packet. The surface builds the packet from it. */
export type EscalationCause =
  | { kind: "authority"; role: "worker" | "gate-maintenance" }
  | { kind: "repair_gave_up" }
  | { kind: "session_not_run"; role: "worker" | "gate-maintenance" }
  | { kind: "budget"; population: BudgetPopulation; budget: Budget; detail: string }
  | { kind: "triage_failure"; rationale: string }
  | { kind: "landed_outside_closer"; pullRequest: string; sessionKey: string };

export interface TriageInput {
  trigger: "gate_fail" | "gate_error" | "worker_escalate" | "close_failure";
  category?: "exhaustion" | "authority";
  caseFile: CaseFile;
  /** Log-derived {used, max} per population, computed immediately before the call. */
  remainingBudgets: BudgetSet;
  /** What an agent-backed port needs to invoke triage; the deterministic router ignores it. */
  ctx: AgentContext;
}

export type TriageArtifact = SharpenedBrief | EscalationPacket | { reason: string };

export interface TriageVerdict {
  /**
   * `recheck_gate` is the lookup table's alone: re-running a gate needs no
   * judgement, so it is never in `TriageEnvelope` and no agent can answer it.
   */
  verdict: "reroute" | "escalate" | "fix_the_gate" | "retry_close" | "abort" | "recheck_gate";
  rationale: string;
  /** In memory only: what the surface writes into the round's ref. Never set by the deterministic router. */
  artifact?: TriageArtifact;
  /**
   * In memory only: why an `escalate` verdict escalated, when no agent wrote a
   * packet. The surface builds the packet a person reads from it. Never persisted.
   */
  cause?: EscalationCause;
  /**
   * What the agent runtime reported for the session that decided this round:
   * set exactly when an agent decided it, `{}` when its runtime reported
   * nothing. The surface writes it onto the round's entry; no decision reads it.
   */
  usage?: SessionUsage;
}

export interface TriagePort {
  triage(input: TriageInput): Promise<TriageVerdict>;
}

// --- CloserPort (Item 6 supplies merge-back / open-PR / teardown closers) ---

/**
 * What a closer is given. `worktreePath` and `dir` are this surface's own;
 * `repoPath` is the checkout the worktree was created from and is shared with
 * the operator, which is why a closer may act on it but must never switch its
 * checked-out branch. `branch` is derived from the surface id, and `baseBranch`
 * is the local branch pinned when the surface was provisioned. `repairBrief` is
 * set only on a close retried by triage's agent, which wrote it; a first close
 * and a deterministic retry have none. No built-in closer reads it.
 */
export interface CloseContext {
  worktreePath: string;
  dir: string;
  repoPath: string;
  branch: string;
  baseBranch: string;
  repairBrief?: CloseRepairBrief;
}

export interface CloseOutcome {
  kind: "accepted" | "escalated" | "aborted";
}

export type { CloseReport };

export interface CloserPort {
  close(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport>;
}

/**
 * An inert closer for tests and demos: reports DONE and performs no infra work,
 * so the worktree is left in place. The shipped closers are in
 * merge-back-closer.ts, commit-to-branch-closer.ts and open-pr-closer.ts.
 */
export const noopCloser: CloserPort = {
  close: () => Promise.resolve({ status: "DONE", detail: "no-op closer" }),
};

// --- RepairCoordinator (createRunBreaker in breaker.ts; absent for a task run on its own) ---

/** A task that found the check could not run before it had started, asking for the environment every task shares to be repaired. */
export interface RepairRequest {
  surfaceId: string;
  reason: string;
}

/** A task saying its check kept erroring until its own re-checks ran out. `key` names the setback, so a report answered before a crash is not answered twice. */
export interface CheckErrorReport {
  surfaceId: string;
  key: string;
}

/** "shared": the run repaired the environment every task shares, so check again. "alone": no other task has hit it, so deal with it as a task on its own would. */
export type CheckErrorAnswer = "shared" | "alone";

/**
 * How a task in a run of several at once shares one environment with the
 * others. A task checks and hands off its work only once cleared. A check that
 * cannot run before the task has started is the environment's, and the run
 * repairs it. A check that keeps erroring on the task's own finished work may
 * be the task's or the environment's, so the task asks which. Absent, a task
 * behaves exactly as it does on its own.
 */
export interface RepairCoordinator {
  /** Wait until the shared environment may be used, then return the function that says this task is done with it. */
  awaitClearance(surfaceId: string): Promise<() => void>;
  /** Resolve once the run's one repair has fixed it; rejects with `RunHalted` if the run gave up. */
  requestRepair(request: RepairRequest): Promise<void>;
  /** A check kept erroring until this task's re-checks ran out: shared and now repaired, or this task's alone? Rejects with `RunHalted` if the run gave up. */
  reportCheckErrors(report: CheckErrorReport): Promise<CheckErrorAnswer>;
}

// --- What the driver is called with ---

export interface SurfacePorts {
  agent: AgentPort;
  triage: TriagePort;
  closer: CloserPort;
  /** Set only for a task of a run of several at once. */
  repairCoordinator?: RepairCoordinator;
  /** Passed to the gate's `GateContext`. Unset: the gate's command inherits the process's own environment. */
  env?: NodeJS.ProcessEnv;
  /**
   * The pull request open for a branch, or null. Asked after every worker or repair session, before any close has
   * been tried; unset, nothing is looked for.
   */
  landed?: (branch: string) => Promise<string | null>;
}

/**
 * The two caller-supplied filesystem locations. `worktreePath` is read only
 * while `cursor.worktreeRef` is still the empty-string "not yet provisioned"
 * sentinel; afterwards `cursor.worktreeRef` is authoritative, so a replay
 * called with different arguments cannot divert a provisioned surface.
 * `repoPath` is also where a custom gate's relative `modulePath` resolves, at
 * every gate run, so the gate stays outside the worktree agents edit.
 */
export interface SurfaceLocation {
  repoPath: string;
  worktreePath: string;
}
