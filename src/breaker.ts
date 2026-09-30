import type { BreakerCause, BreakerState, RepairStatus, RunEntry } from "./schema.js";

/**
 * How each run-file entry moves the shared environment's breaker. Total over
 * the entry kinds, so a new kind does not compile until it says how it moves
 * the breaker. The breaker is never stored: it is this table folded over the
 * run's history, as a task's position is its log folded through
 * `deriveStateFromEntry`, so a resumed run and a live one cannot disagree.
 */
const BREAKER_EDGES: Record<RunEntry["t"], (state: BreakerState) => BreakerState> = {
  slot_fill: (state) => state,
  slot_free: (state) => state,
  held: (state) => state,
  repair_request: (state) => state,
  breaker_degraded: (state) => (state === "HEALTHY" ? "DEGRADED" : state),
  repair_dispatch: () => "REPAIRING",
  repair_terminus: () => "DEGRADED",
  breaker_healthy: () => "HEALTHY",
  // A run that gave up leaves its environment broken: that is what it gave up on.
  run_escalated: () => "DEGRADED",
};

export function nextBreaker(state: BreakerState, entry: RunEntry): BreakerState {
  return BREAKER_EDGES[entry.t](state);
}

export function breakerOf(history: readonly RunEntry[]): BreakerState {
  return history.reduce<BreakerState>(nextBreaker, "HEALTHY");
}

/** Repair attempts spent, over the whole run: the dispatch entry is the burn. */
export function repairsUsed(history: readonly RunEntry[]): number {
  return history.filter((entry) => entry.t === "repair_dispatch").length;
}

type Dispatch = Extract<RunEntry, { t: "repair_dispatch" }>;

/** The repair dispatched but never answered: what a crash in the middle of a repair leaves. */
export function openDispatch(history: readonly RunEntry[]): Dispatch | undefined {
  const last = history.findLast((entry): entry is Dispatch => entry.t === "repair_dispatch");
  if (last === undefined) return undefined;
  const answered = history.some((entry) => entry.t === "repair_terminus" && entry.sessionKey === last.sessionKey);
  return answered ? undefined : last;
}

export interface RepairAttempt {
  attempt: number;
  sessionKey: string;
  /** Whose copy and record the repair ran in: the task whose report tripped the breaker. */
  surfaceId: string;
  status: RepairStatus | null;
  rationale: string | null;
}

/** One time the shared environment broke: what broke it, every task it held, each repair, and how it ended. */
export interface Trip {
  cause: BreakerCause;
  /** Every task it held, each once, in the order held, the one that found it first. */
  held: string[];
  repairs: RepairAttempt[];
  ended: "repaired" | "gave_up" | null;
  /** Why the run gave up, when it did. */
  reason: string | null;
}

export function tripsOf(history: readonly RunEntry[]): Trip[] {
  const trips: Trip[] = [];
  for (const entry of history) {
    const last = trips.at(-1);
    const open = last !== undefined && last.ended === null ? last : undefined;
    switch (entry.t) {
      case "breaker_degraded":
        if (open === undefined) trips.push({ cause: entry.cause, held: [entry.cause.surfaceId], repairs: [], ended: null, reason: null });
        break;
      case "repair_request":
      case "held":
        if (open !== undefined && !open.held.includes(entry.surfaceId)) open.held.push(entry.surfaceId);
        break;
      case "repair_dispatch":
        open?.repairs.push({ attempt: entry.attempt, sessionKey: entry.sessionKey, surfaceId: entry.surfaceId, status: null, rationale: null });
        break;
      case "repair_terminus": {
        const attempt = open?.repairs.findLast((repair) => repair.sessionKey === entry.sessionKey);
        if (attempt !== undefined) {
          attempt.status = entry.status;
          attempt.rationale = entry.rationale;
        }
        break;
      }
      case "breaker_healthy":
        if (open !== undefined) open.ended = "repaired";
        break;
      case "run_escalated":
        if (open !== undefined) {
          open.ended = "gave_up";
          open.reason = entry.reason;
        }
        break;
      default:
        break;
    }
  }
  return trips;
}

/** The trip still unresolved, if any. */
export function openTrip(history: readonly RunEntry[]): Trip | undefined {
  const last = tripsOf(history).at(-1);
  return last?.ended === null ? last : undefined;
}

/** Whether this task's request about this setback was already answered by a repair: a crash landed between the repair and the task's re-check. */
export function servedAlready(history: readonly RunEntry[], surfaceId: string, key: string): boolean {
  const asked = history.findLastIndex((entry) => entry.t === "repair_request" && entry.surfaceId === surfaceId && entry.key === key);
  return asked !== -1 && history.slice(asked).some((entry) => entry.t === "breaker_healthy");
}

/** Whether this task already asked, about this setback, in the trip still open: a resumed task asking again adds nothing. */
export function requestedInOpenTrip(history: readonly RunEntry[], surfaceId: string, key: string | null): boolean {
  const opened = history.findLastIndex((entry) => entry.t === "breaker_degraded");
  if (opened === -1 || openTrip(history) === undefined) return false;
  return history.slice(opened).some((entry) => entry.t === "repair_request" && entry.surfaceId === surfaceId && entry.key === key);
}
