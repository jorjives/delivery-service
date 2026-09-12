import { open, rename, readFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { CaseJson, CaseFile, CaseFileHeader, BudgetSet, BudgetPopulation, HistoryEntry, CreateHeader, CaseFileCursor, SurfaceState, GateReport, CaseFileOutcome } from "./schema.js";
import { FileNotFound, CorruptCaseFile, WriteFailure, ImmutabilityViolation } from "./errors.js";
import type { TriageInput } from "./ports.js";

async function writeAndSync(filePath: string, flag: "w" | "a", data: string): Promise<void> {
  const fd = await open(filePath, flag);
  try {
    await fd.write(data);
    await fd.datasync();
  } finally {
    await fd.close();
  }
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + ".tmp";
  await writeAndSync(tmp, "w", JSON.stringify(data, null, 2));
  await rename(tmp, filePath);
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

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

export async function create(
  dir: string,
  header: CreateHeader,
  budgetDefaults: BudgetSet,
): Promise<CaseFile> {
  const fullHeader: CaseFileHeader = { ...header, baseline: null, baseBranch: null };
  const cursor = {
    state: "PROVISIONING" as const,
    budgets: budgetDefaults,
    worktreeRef: "",
  };

  const caseJson: CaseJson = CaseJson.parse({ header: fullHeader, cursor });

  try {
    await Promise.all([
      atomicWriteJson(join(dir, "case.json"), caseJson),
      writeAndSync(join(dir, "log.jsonl"), "w", ""),
    ]);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }

  return { header: fullHeader, cursor, history: [] };
}

export async function appendEntry(
  dir: string,
  entry: HistoryEntry,
): Promise<void> {
  // Validate the entry against the schema
  HistoryEntry.parse(entry);

  const logPath = join(dir, "log.jsonl");
  try {
    await writeAndSync(logPath, "a", JSON.stringify(entry) + "\n");
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

  // Parse history entries
  const history: HistoryEntry[] = [];
  if (logRaw.trim().length > 0) {
    const lines = logRaw.trimEnd().split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      try {
        const parsed = JSON.parse(line);
        history.push(HistoryEntry.parse(parsed));
      } catch (err) {
        // Truncated final line from a crash — ignore it
        if (i === lines.length - 1) {
          break;
        }
        throw new CorruptCaseFile(
          dir,
          `Malformed log entry at line ${i + 1}: ${String(err)}`,
        );
      }
    }
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
export function setBaseBranch(dir: string, branch: string): Promise<void> {
  return setOnce(
    dir,
    "baseBranch",
    (caseJson) => caseJson.header.baseBranch !== null,
    (caseJson) => ({ ...caseJson, header: { ...caseJson.header, baseBranch: branch } }),
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
      // A repair sessions terminus of ANY status stays inside GATE_MAINTENANCE:
      // its edge decides between re-baselining, redispatching and escalating.
      if (entry.role === "gate-maintenance") return "GATE_MAINTENANCE";
      // An authority limit is terminal on the spot; an exhaustion-class
      // escalate still gets the deterministic routers first look, so a crash
      // between the terminus and the triage entry cannot skip triage entirely.
      if (entry.status === "escalate") {
        return entry.category === "authority" ? "ESCALATED" : "TRIAGE";
      }
      return terminusState[entry.status] as SurfaceState;
    case "gate": return gateState[entry.status] as SurfaceState;
    case "triage": return triageState[entry.verdict] as SurfaceState;
    case "close": return closeState[entry.status] as SurfaceState;
    // Baseline capture only ever runs when the report status isn't ERROR
    // (recordBaseline never calls setBaseline with one), and either way the
    // surface is ready to dispatch a worker once it's captured.
    case "baseline": return "AGENT_ACTIVE";
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
  }
}
