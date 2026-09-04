import { open, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CaseJson, CaseFile, CaseFileHeader, BudgetSet, HistoryEntry, CreateHeader, CaseFileCursor, SurfaceState } from "./schema.js";
import { FileNotFound, CorruptCaseFile, WriteFailure } from "./errors.js";

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

function parseCaseJson(dir: string, raw: string): CaseJson {
  try {
    return CaseJson.parse(JSON.parse(raw));
  } catch (err) {
    throw new CorruptCaseFile(dir, String(err));
  }
}

async function readCaseJson(dir: string): Promise<CaseJson> {
  const caseJsonPath = join(dir, "case.json");
  let raw: string;
  try {
    raw = await readFile(caseJsonPath, "utf-8");
  } catch (err) {
    if (isEnoent(err)) throw new FileNotFound(dir, caseJsonPath);
    throw err;
  }
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
  const fullHeader: CaseFileHeader = { ...header, baseline: null };
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

const terminusState: Record<string, SurfaceState> = {
  completed: "GATING", escalate: "ESCALATED", incomplete: "INCOMPLETE_TERMINUS",
};
const gateState: Record<string, SurfaceState> = {
  PASS: "CLOSING", FAIL: "TRIAGE", ERROR: "TRIAGE",
};
const triageState: Record<string, SurfaceState> = {
  reroute: "AGENT_ACTIVE", escalate: "ESCALATED", fix_the_gate: "GATE_MAINTENANCE",
  retry_close: "CLOSING", abort: "ABORTED",
};
const closeState: Record<string, SurfaceState> = {
  DONE: "CLOSED", FAIL: "TRIAGE", ERROR: "TRIAGE",
};

function deriveStateFromEntry(entry: HistoryEntry): SurfaceState {
  switch (entry.t) {
    case "dispatch": return "AGENT_ACTIVE";
    case "terminus": return terminusState[entry.status] as SurfaceState;
    case "gate": return gateState[entry.status] as SurfaceState;
    case "triage": return triageState[entry.verdict] as SurfaceState;
    case "close": return closeState[entry.status] as SurfaceState;
  }
}

function deriveBudgetsFromLog(
  history: HistoryEntry[],
  maxima: BudgetSet,
): BudgetSet {
  const used = { correction: 0, gateError: 0, gateMaintenance: 0, terminus: 0, close: 0 };

  for (const entry of history) {
    switch (entry.t) {
      case "dispatch":
        if (entry.attempt > 1) used.correction++;
        break;
      case "terminus":
        used.terminus++;
        break;
      case "gate":
        if (entry.status === "ERROR") used.gateError++;
        break;
      case "triage":
        if (entry.verdict === "fix_the_gate") used.gateMaintenance++;
        break;
      case "close":
        used.close++;
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
  }
}
