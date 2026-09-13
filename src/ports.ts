import type { Budget, BudgetPopulation, BudgetSet, CaseFile, CloseReport } from "./schema.js";
import type { CloseRepairBrief, EscalationPacket, SharpenedBrief, TriageEnvelope } from "./triage-role-config.js";

// --- AgentPort (createAgentPort in agent-invoke.ts is the SDK-backed implementation) ---

export type AgentRole = "worker" | "triage" | "gate-maintenance";

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
  | { status: "incomplete"; rationale: string };

/** The harness's own verdict on a session that produced nothing usable, for any role. */
export type Incomplete = Extract<Terminus, { status: "incomplete" }>;

export type TriageTerminus = TriageEnvelope | Incomplete;

export interface RoleTerminusMap {
  worker: Terminus;
  "gate-maintenance": Terminus;
  triage: TriageTerminus;
}

export interface AgentPort {
  invoke<R extends AgentRole>(roleCfg: RoleHandle & { role: R }, ctx: AgentContext): Promise<RoleTerminusMap[R]>;
}

// --- TriagePort (deterministicRouter in router.ts; createAgentTriage in triage.ts) ---

/** Why a surface escalated, when no agent wrote the packet. The surface builds the packet from it. */
export type EscalationCause =
  | { kind: "authority"; role: "worker" | "gate-maintenance" }
  | { kind: "repair_gave_up" }
  | { kind: "budget"; population: BudgetPopulation; budget: Budget; detail: string }
  | { kind: "triage_failure"; rationale: string };

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

// --- What the driver is called with ---

export interface SurfacePorts {
  agent: AgentPort;
  triage: TriagePort;
  closer: CloserPort;
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
