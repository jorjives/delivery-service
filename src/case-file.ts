import { readFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { CaseJson, CaseFile, BudgetSet, BudgetPopulation, HistoryEntry, CreateHeader, CaseFileCursor, SurfaceState, GateReport, CaseFileOutcome } from "./schema.js";
import { FileNotFound, CorruptCaseFile, WriteFailure, ImmutabilityViolation } from "./errors.js";
import { appendLine, atomicWriteJson, isEnoent, MalformedLine, parseLines, writeAndSync } from "./journal.js";
import type { TriageInput } from "./ports.js";

async function readFileOrNotFound(dir: string, filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (err) {
    if (isEnoent(err)) throw new FileNotFound(dir, filePath);
    throw err;
  }
}

function parseCaseJson(dir: string, raw: string): CaseJson {
  try {
    return CaseJson.parse(JSON.parse(raw));
  } catch (err) {
    throw new CorruptCaseFile(dir, String(err));
  }
}

async function readCaseJson(dir: string): Promise<CaseJson> {
  const raw = await readFileOrNotFound(dir, join(dir, "case.json"));
  return parseCaseJson(dir, raw);
}

async function writeCaseJson(dir: string, caseJson: CaseJson): Promise<void> {
  try {
    await atomicWriteJson(join(dir, "case.json"), caseJson);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

/**
 * The record a run starts with: nothing measured, nothing tried, every budget
 * at its default. Pure, so something that needs a new run's record without
 * writing one (what `delivery preview` shows an agent would be told) gets
 * exactly the record `create()` writes, not a copy of its shape.
 */
export function initialCaseFile(header: CreateHeader, budgetDefaults: BudgetSet): CaseFile {
  return {
    header: { ...header, baseline: null, baseBranch: null },
    cursor: { state: "PROVISIONING", budgets: budgetDefaults, worktreeRef: "" },
    history: [],
  };
}

export async function create(
  dir: string,
  header: CreateHeader,
  budgetDefaults: BudgetSet,
): Promise<CaseFile> {
  const caseFile = initialCaseFile(header, budgetDefaults);
  const caseJson: CaseJson = CaseJson.parse({ header: caseFile.header, cursor: caseFile.cursor });

  try {
    await Promise.all([
      atomicWriteJson(join(dir, "case.json"), caseJson),
      writeAndSync(join(dir, "log.jsonl"), "w", ""),
    ]);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }

  return caseFile;
}

export async function appendEntry(
  dir: string,
  entry: HistoryEntry,
): Promise<void> {
  // Validate the entry against the schema
  HistoryEntry.parse(entry);

  try {
    // The writer owns the time: every call site builds its entry in place, so none carries one of its own.
    await appendLine(join(dir, "log.jsonl"), { ...entry, at: new Date().toISOString() });
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

export async function load(dir: string): Promise<CaseFile> {
  const caseJsonPath = join(dir, "case.json");
  const logPath = join(dir, "log.jsonl");

  // Read both files in parallel
  const [caseJsonRaw, logRaw] = await Promise.all([
    readFile(caseJsonPath, "utf-8").catch((err: unknown) => {
      if (isEnoent(err)) throw new FileNotFound(dir, caseJsonPath);
      throw err;
    }),
    readFile(logPath, "utf-8").catch((err: unknown) => {
      if (isEnoent(err)) return "";
      throw err;
    }),
  ]);

  // Parse and validate case.json
  const caseJson = parseCaseJson(dir, caseJsonRaw);

  // Parse history entries: a torn final line is dropped by the journal itself.
  let history: HistoryEntry[];
  try {
    history = parseLines(logRaw, (value) => HistoryEntry.parse(value));
  } catch (err) {
    if (err instanceof MalformedLine) throw new CorruptCaseFile(dir, err.message);
    throw err;
  }

  return {
    header: caseJson.header,
    cursor: caseJson.cursor,
    history,
    outcome: caseJson.outcome,
  };
}

export function logTail(caseFile: CaseFile): HistoryEntry | undefined {
  return caseFile.history.at(-1);
}

export async function updateCursor(
  dir: string,
  patch: Partial<CaseFileCursor>,
): Promise<void> {
  const caseJson = await readCaseJson(dir);

  const updated: CaseJson = {
    ...caseJson,
    cursor: CaseFileCursor.parse({ ...caseJson.cursor, ...patch }),
  };

  await writeCaseJson(dir, updated);
}

async function setOnce(
  dir: string,
  field: string,
  isSet: (caseJson: CaseJson) => boolean,
  merge: (caseJson: CaseJson) => CaseJson,
): Promise<void> {
  const caseJson = await readCaseJson(dir);

  if (isSet(caseJson)) {
    throw new ImmutabilityViolation(dir, field);
  }

  await writeCaseJson(dir, merge(caseJson));
}

export async function setBaseline(dir: string, baseline: GateReport): Promise<void> {
  // Parse rather than trust: the baseline is immutable once written, so a
  // malformed one would poison the surface for its whole lifetime.
  //
  // This function is declared `async` deliberately, not left as a plain
  // Promise-returning function that happens to call `parse` first: `parse`
  // throws synchronously, and a non-async function propagates that throw at
  // the call site rather than as a promise rejection. `async` wraps it into
  // the returned promise's rejection instead, so `await setBaseline(dir, bad)`
  // rejects rather than the call itself throwing.
  const parsed = GateReport.parse(baseline);
  await setOnce(
    dir,
    "baseline",
    (caseJson) => caseJson.header.baseline !== null,
    (caseJson) => ({ ...caseJson, header: { ...caseJson.header, baseline: parsed } }),
  );
  // The baseline capture is a state-advancing event like any other, so it
  // gets its own log entry — the log tail stays unconditionally authoritative
  // for `deriveStateFromEntry`, rather than needing a special case for
  // "header.baseline was just set but nothing says so in the log".
  await appendEntry(dir, { t: "baseline", status: parsed.status });
}

/**
 * Pin the branch the surface was provisioned from. Set-once like the baseline,
 * and for the same reason: the close may happen much later, and must target the
 * branch the work actually started from. Unlike the baseline it records no
 * history entry — it advances no state, and the log tail must stay the single
 * authority for `deriveStateFromEntry`.
 */
export function setBaseBranch(dir: string, branch: string, startCommit?: string): Promise<void> {
  return setOnce(
    dir,
    "baseBranch",
    (caseJson) => caseJson.header.baseBranch !== null,
    (caseJson) => ({ ...caseJson, header: { ...caseJson.header, baseBranch: branch, ...(startCommit === undefined ? {} : { startCommit }) } }),
  );
}

export function setOutcome(dir: string, outcome: CaseFileOutcome): Promise<void> {
  return setOnce(
    dir,
    "outcome",
    (caseJson) => caseJson.outcome !== undefined,
    (caseJson) => ({ ...caseJson, outcome }),
  );
}

export async function incrementBudget(
  dir: string,
  population: BudgetPopulation,
): Promise<{ used: number; max: number; exhausted: boolean }> {
  const caseJson = await readCaseJson(dir);
  const budget = caseJson.cursor.budgets[population];
  const used = budget.used + 1;

  await updateCursor(dir, {
    budgets: { ...caseJson.cursor.budgets, [population]: { used, max: budget.max } },
  });

  return { used, max: budget.max, exhausted: used >= budget.max };
}

function safeRefId(dir: string, refId: string): void {
  if (basename(refId) !== refId || refId.includes("..")) {
    throw new CorruptCaseFile(dir, `Invalid refId: ${refId}`);
  }
}

export async function writeRef(dir: string, refId: string, data: unknown): Promise<string> {
  safeRefId(dir, refId);
  const refsDir = join(dir, "refs");
  await mkdir(refsDir, { recursive: true });
  try {
    await atomicWriteJson(join(refsDir, `${refId}.json`), data);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
  return refId;
}

export async function readRef(dir: string, refId: string): Promise<unknown> {
  safeRefId(dir, refId);
  const raw = await readFileOrNotFound(dir, join(dir, "refs", `${refId}.json`));
  try {
    return JSON.parse(raw);
  } catch {
    throw new CorruptCaseFile(dir, `Malformed ref ${refId}`);
  }
}

const terminusState: Record<string, SurfaceState> = {
  completed: "GATING", incomplete: "INCOMPLETE_TERMINUS",
};
const gateState: Record<string, SurfaceState> = {
  PASS: "CLOSING", FAIL: "TRIAGE", ERROR: "TRIAGE",
};
const triageState: Record<string, SurfaceState> = {
  reroute: "AGENT_ACTIVE", escalate: "ESCALATED", fix_the_gate: "GATE_MAINTENANCE",
  retry_close: "CLOSING", abort: "ABORTED",
  // Re-run the same check against the same pinned baseline: GATING, not PRE_GATING.
  recheck_gate: "GATING",
};
const closeState: Record<string, SurfaceState> = {
  DONE: "CLOSED", FAIL: "TRIAGE", ERROR: "TRIAGE",
};

export function deriveStateFromEntry(entry: HistoryEntry): SurfaceState {
  switch (entry.t) {
    case "dispatch":
      // A dispatch that is still the tail has no terminus — a session that
      // ended without emitting a valid result, whichever role ran it. A repair
      // session's recovery is GATE_MAINTENANCE's own edge; a worker's is the
      // INCOMPLETE_TERMINUS edge, which records the missing terminus and
      // retries on the terminus budget rather than dispatching unboundedly.
      return entry.role === "gate-maintenance" ? "GATE_MAINTENANCE" : "INCOMPLETE_TERMINUS";
    case "terminus":
      // A pull request the session opened itself is the operator's to look at, whatever the session reported.
      if (entry.landedOutside !== undefined) return "ESCALATED";
      // A repair sessions terminus of ANY status stays inside GATE_MAINTENANCE:
      // its edge decides between re-baselining, redispatching and escalating.
      if (entry.role === "gate-maintenance") return "GATE_MAINTENANCE";
      // An authority limit or a question for the operator is terminal on the
      // spot; an exhaustion-class escalate still gets the deterministic routers
      // first look, so a crash between the terminus and the triage entry
      // cannot skip triage entirely.
      if (entry.status === "escalate") {
        return entry.category === "authority" || entry.category === "decision" ? "ESCALATED" : "TRIAGE";
      }
      return terminusState[entry.status] as SurfaceState;
    case "gate": return gateState[entry.status] as SurfaceState;
    case "triage": return triageState[entry.verdict] as SurfaceState;
    case "close": return closeState[entry.status] as SurfaceState;
    // Baseline capture only ever runs when the report status isn't ERROR
    // (recordBaseline never calls setBaseline with one), and either way the
    // surface is ready to dispatch a worker once it's captured.
    case "baseline": return "AGENT_ACTIVE";
    // Written before the repair's own terminus (Task 8A); the terminus entry
    // that follows is what actually moves the state.
    case "repair_accepted": return "GATE_MAINTENANCE";
    // Written before the round's own triage entry (Task 8B); the gate FAIL
    // entry it follows already put the surface in TRIAGE.
    case "triage_accepted": return "TRIAGE";
    // The next workflow step opens: it takes its own baseline before its first worker.
    case "step": return "PRE_GATING";
    // A clean rebuild is re-checked; a conflicting one is a rejected attempt.
    case "landing": return entry.conflict === undefined ? "GATING" : "TRIAGE";
  }
}

/** What kind of setback a history entry records, as `TriagePort` names it. */
export type Setback = Pick<TriageInput, "trigger" | "category">;

/**
 * The setback a log tail records, or undefined when the tail is not one.
 * Pure over one entry, like `deriveStateFromEntry`, so the surface routing into
 * TRIAGE and the prompt shown to triage classify the same tail identically.
 */
export function setbackOf(tail: HistoryEntry | undefined): Setback | undefined {
  if (tail?.t === "gate") return { trigger: tail.status === "ERROR" ? "gate_error" : "gate_fail" };
  if (tail?.t === "close") return { trigger: "close_failure" };
  if (tail?.t === "terminus" && tail.status === "escalate") {
    return { trigger: "worker_escalate", category: tail.category };
  }
  return undefined;
}

export function deriveBudgetsFromLog(
  history: HistoryEntry[],
  maxima: BudgetSet,
): BudgetSet {
  const used = { correction: 0, gateError: 0, gateMaintenance: 0, terminus: 0, close: 0 };

  for (const entry of history) {
    switch (entry.t) {
      case "dispatch":
        // The dispatch entry IS the gateMaintenance burn: the count is derived
        // from the log, and the entry appended only if under cap, so "burned
        // live" and "derived on rebuild" are the same computation.
        if (entry.role === "gate-maintenance") used.gateMaintenance++;
        break;
      case "terminus":
        // `terminus` caps WORKER retries, so only a worker session that ended
        // without a valid result burns it. A completed or escalated terminus
        // resolved its attempt and costs nothing; a repair sessions terminus
        // is already paid for on gateMaintenance by its own dispatch entry.
        if (entry.role !== "gate-maintenance" && entry.status === "incomplete") used.terminus++;
        break;
      case "triage":
        // The triage entry IS the burn for the verdict it records — not the
        // dispatch, close or recheck that follows it, which a crash could land
        // before. An errored gate entry costs nothing by itself: counting it
        // would let an always-broken gate run the population past its cap.
        if (entry.verdict === "reroute") used.correction++;
        else if (entry.verdict === "retry_close") used.close++;
        else if (entry.verdict === "recheck_gate") used.gateError++;
        break;
      case "repair_accepted":
      case "triage_accepted":
        break;
    }
  }

  return Object.fromEntries(
    Object.entries(used).map(([k, u]) => [k, { used: u, max: maxima[k as keyof BudgetSet].max }]),
  ) as BudgetSet;
}

export async function rebuild(dir: string): Promise<CaseFile> {
  // Reuse load() — it already reads case.json + log.jsonl with
  // truncated-line handling and error mapping to FileNotFound/CorruptCaseFile
  const loaded = await load(dir);

  // Derive cursor from the log (the log wins over the stale cursor)
  const tail = loaded.history.at(-1);
  const state: SurfaceState = tail
    ? deriveStateFromEntry(tail)
    : loaded.cursor.state;
  const budgets = deriveBudgetsFromLog(loaded.history, loaded.cursor.budgets);

  const cursor = {
    state,
    budgets,
    worktreeRef: loaded.cursor.worktreeRef,
  };

  // Rewrite case.json with reconstructed cursor
  const updated: CaseJson = {
    header: loaded.header,
    cursor,
    ...(loaded.outcome ? { outcome: loaded.outcome } : {}),
  };

  await writeCaseJson(dir, updated);

  return { ...updated, history: loaded.history };
}

export type ResumeAction =
  | "start"
  | "incomplete_terminus"
  | "gate"
  | "triage"
  | "close"
  | "act_on_verdict"
  | "close_triage"
  | "done";

export function resumeAction(tail: HistoryEntry | undefined): ResumeAction {
  if (!tail) return "start";

  switch (tail.t) {
    case "dispatch":
      return "incomplete_terminus";
    case "terminus":
      return tail.status === "completed" ? "gate" : "triage";
    case "gate":
      return tail.status === "PASS" ? "close" : "triage";
    case "triage":
      return "act_on_verdict";
    case "close":
      return tail.status === "DONE" ? "done" : "close_triage";
    // Unconsumed by the driver (routes on deriveStateFromEntry instead, see
    // slice-2 plan); "start" fits — a baseline tail is ready to dispatch the
    // first worker, the same readiness a missing tail represents.
    case "baseline":
      return "start";
    // Unconsumed by the driver, same as "baseline" above: the terminus that
    // always follows it is what resumeAction actually reads.
    case "repair_accepted":
      return "start";
    // Written before the round's own triage entry (Task 8B); a crash between
    // them means the verdict itself was never recorded, so triage runs again.
    case "triage_accepted":
      return "triage";
    // Unconsumed by the driver, like "baseline": a step tail is ready to take the next step's baseline.
    case "step":
      return "start";
    case "landing":
      return tail.conflict === undefined ? "gate" : "triage";
  }
}
