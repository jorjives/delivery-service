import type { BreakerCause, BreakerState, RepairStatus, RunEntry } from "./schema.js";
import { appendRunEntry } from "./run-file.js";
import { RunHalted } from "./errors.js";
import type { CheckErrorAnswer, CheckErrorReport, RepairCoordinator, Terminus } from "./ports.js";

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
  // Evidence, not a trip: the trip it may lead to is its own `breaker_degraded` entry.
  gate_error_signal: (state) => state,
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

/**
 * How many different tasks must each run out of re-checks on a check that
 * keeps erroring, since the environment was last healthy, before the run
 * treats it as shared.
 */
// ponytail: M=2 and no time window, so a scripted run reproduces it; retune (and consider a window) once real flake rates are known.
export const SHARED_ERROR_THRESHOLD = 2;

/** Every task that has reported since the environment was last healthy, each once, in the order first reported. */
export function signalsSinceHealthy(history: readonly RunEntry[]): string[] {
  const since = history.slice(history.findLastIndex((entry) => entry.t === "breaker_healthy") + 1);
  return [...new Set(since.flatMap((entry) => (entry.t === "gate_error_signal" ? [entry.surfaceId] : [])))];
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

export const RECOVERED_REPAIR = "the repair session ended without recording a result (recovered on resume)";

export const couldNotRepair = (attempts: number): string =>
  `the shared environment could not be repaired after ${attempts} ${attempts === 1 ? "attempt" : "attempts"}; no task caused this`;

/** A change in the shared environment's state, and every task it affects. */
export interface BreakerChange {
  state: BreakerState;
  affected: string[];
  repair?: { attempt: number; of: number };
}

export interface RunBreakerOptions {
  /** The run's own record. */
  dir: string;
  /** What that record already holds: empty for a new run, the stopped run's history when picked up. */
  history: readonly RunEntry[];
  /** Repair attempts the whole run may spend. */
  limit: number;
  /** One gate-maintenance session, in the copy and record of the task named. */
  dispatch(surfaceId: string, sessionKey: string): Promise<Terminus>;
  onChange(change: BreakerChange): void;
}

export interface RunBreaker extends RepairCoordinator {
  /** Why the run gave up on the shared environment, once it has: start nothing more. */
  readonly gaveUp: string | undefined;
  /** A task's check kept erroring until its re-checks ran out: is that its own problem, or everyone's? */
  reportCheckErrors(report: CheckErrorReport): Promise<CheckErrorAnswer>;
}

/**
 * The one coordinator of a run's shared environment. Everything it decides is
 * written to the run file first, in the order it was decided, so a crash
 * leaves a history the next process folds back into the same state.
 *
 * A trip holds every check and hand-off; the repair starts only once no task
 * is mid-check or mid-hand-off, and every request while it is pending shares
 * it. A task picked up while its run was repairing finds the repair started
 * again here at its first hold, since nobody else would start it.
 *
 * A trip opens two ways: a task finds the check cannot run before it has
 * started (`requestRepair`), or a second, different task reports that its
 * check kept erroring until its re-checks ran out (`reportCheckErrors`). One
 * such report alone trips nothing.
 */
export function createRunBreaker({ dir, history, limit, dispatch, onChange }: RunBreakerOptions): RunBreaker {
  const log: RunEntry[] = [...history];
  let state = breakerOf(log);
  let gaveUp = log.findLast((entry) => entry.t === "run_escalated")?.reason;
  let writing: Promise<void> = Promise.resolve();
  const inFlight = new Set<string>();
  let idleWaiters: (() => void)[] = [];
  let repairing: Promise<void> | undefined;

  // In memory at once, so two tasks asking in the same instant see one trip; on disk in the same order.
  function record(entry: RunEntry): Promise<void> {
    log.push(entry);
    state = nextBreaker(state, entry);
    writing = writing.then(() => appendRunEntry(dir, entry));
    return writing;
  }

  const affected = (): string[] => [...(openTrip(log)?.held ?? [])];

  function whenIdle(): Promise<void> {
    if (inFlight.size === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function leave(surfaceId: string): void {
    inFlight.delete(surfaceId);
    if (inFlight.size > 0) return;
    const waiting = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiting) resolve();
  }

  async function giveUp(reason: string): Promise<never> {
    // Set before the write, so a request or hold arriving while it is written is refused, not queued on a dead repair.
    gaveUp = reason;
    await record({ t: "run_escalated", reason });
    throw new RunHalted(reason);
  }

  async function repair(): Promise<void> {
    await whenIdle();
    const trip = openTrip(log);
    if (trip === undefined) return;
    for (;;) {
      const dangling = openDispatch(log);
      if (dangling !== undefined) {
        await record({ t: "repair_terminus", attempt: dangling.attempt, sessionKey: dangling.sessionKey, status: "incomplete", rationale: RECOVERED_REPAIR });
      }
      const used = repairsUsed(log);
      if (used >= limit) return giveUp(couldNotRepair(used));
      const attempt = used + 1;
      const sessionKey = `run-repair-${attempt}`;
      await record({ t: "repair_dispatch", attempt, sessionKey, surfaceId: trip.cause.surfaceId });
      onChange({ state: "REPAIRING", affected: affected(), repair: { attempt, of: limit } });
      const terminus = await dispatch(trip.cause.surfaceId, sessionKey);
      await record({ t: "repair_terminus", attempt, sessionKey, status: terminus.status, rationale: terminus.rationale });
      if (terminus.status === "completed") {
        const released = affected();
        // `record` makes the state HEALTHY at once, before the write lands. Let go of this repair and say so
        // in the same tick, so a task that trips the breaker again during the write opens a new repair (and
        // its "broken" line follows "Fixed. Resuming."), rather than joining this finished one and skipping its repair.
        const written = record({ t: "breaker_healthy" });
        repairing = undefined;
        onChange({ state: "HEALTHY", affected: released });
        await written;
        return;
      }
      // As for a task's own repair: an escalate, or a session that never started, will not go better next time.
      if (terminus.status === "escalate" || terminus.notRun) {
        return giveUp(`the repair could not fix the shared environment: ${terminus.rationale}; no task caused this`);
      }
    }
  }

  // Only this repair's own settling clears the slot: a later repair may already hold it.
  const ensureRepair = (): Promise<void> => {
    if (repairing === undefined) {
      const current: Promise<void> = repair().finally(() => {
        if (repairing === current) repairing = undefined;
      });
      repairing = current;
    }
    return repairing;
  };

  return {
    get gaveUp() {
      return gaveUp;
    },

    async awaitClearance(surfaceId) {
      for (;;) {
        if (gaveUp !== undefined) throw new RunHalted(gaveUp);
        if (state === "HEALTHY") {
          inFlight.add(surfaceId);
          return () => leave(surfaceId);
        }
        if (!affected().includes(surfaceId)) await record({ t: "held", surfaceId });
        await ensureRepair();
      }
    },

    async requestRepair({ surfaceId, key, reason }) {
      if (gaveUp !== undefined) throw new RunHalted(gaveUp);
      if (key !== null && servedAlready(log, surfaceId, key)) return;
      // No await between the trip and its request: both land in the log before any other task's request or hold,
      // so the trip's own request is recorded first (the order the first test asserts). `record` chains the writes.
      if (state === "HEALTHY") {
        void record({ t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId, reason } });
        onChange({ state: "DEGRADED", affected: [surfaceId] });
      }
      if (!requestedInOpenTrip(log, surfaceId, key)) await record({ t: "repair_request", surfaceId, key });
      await ensureRepair();
    },

    async reportCheckErrors({ surfaceId, key }) {
      if (gaveUp !== undefined) throw new RunHalted(gaveUp);
      if (servedAlready(log, surfaceId, key)) return "shared";
      if (state === "HEALTHY") {
        // One task's check erroring is that task's business; the same thing in a second, different task is the
        // environment's. The same task counts once. No await before the trip: as in `requestRepair`, two tasks
        // reporting in the same instant must see one count and one trip.
        if (!signalsSinceHealthy(log).includes(surfaceId)) void record({ t: "gate_error_signal", surfaceId });
        const surfaceIds = signalsSinceHealthy(log);
        if (surfaceIds.length < SHARED_ERROR_THRESHOLD) {
          // On disk before the task acts on the answer, like everything else decided here.
          await writing;
          return "alone";
        }
        void record({ t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId, surfaceIds } });
        onChange({ state: "DEGRADED", affected: [surfaceId] });
      }
      // A trip already open, whatever opened it, is repaired once for everyone: this report shares it.
      if (!requestedInOpenTrip(log, surfaceId, key)) await record({ t: "repair_request", surfaceId, key });
      await ensureRepair();
      return "shared";
    },
  };
}
