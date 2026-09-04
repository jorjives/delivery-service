import { open, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CaseJson, CaseFile, CaseFileHeader, BudgetSet, HistoryEntry } from "./schema.js";
import { FileNotFound, CorruptCaseFile, WriteFailure } from "./errors.js";

type CreateHeader = Omit<CaseFileHeader, "baseline">;

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmp = filePath + ".tmp";
  const fd = await open(tmp, "w");
  try {
    await fd.write(JSON.stringify(data, null, 2));
    await fd.datasync();
  } finally {
    await fd.close();
  }
  await rename(tmp, filePath);
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

  const caseJson: CaseJson = { header: fullHeader, cursor };

  try {
    await atomicWriteJson(join(dir, "case.json"), caseJson);
    // Create empty log file
    const logFd = await open(join(dir, "log.jsonl"), "w");
    await logFd.datasync();
    await logFd.close();
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
    const fd = await open(logPath, "a");
    try {
      await fd.write(JSON.stringify(entry) + "\n");
      await fd.datasync();
    } finally {
      await fd.close();
    }
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

export async function load(dir: string): Promise<CaseFile> {
  const caseJsonPath = join(dir, "case.json");
  const logPath = join(dir, "log.jsonl");

  // Read case.json
  let caseJsonRaw: string;
  try {
    caseJsonRaw = await readFile(caseJsonPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new FileNotFound(dir, caseJsonPath);
    }
    throw err;
  }

  // Parse and validate case.json
  let caseJson: CaseJson;
  try {
    const parsed = JSON.parse(caseJsonRaw);
    caseJson = CaseJson.parse(parsed);
  } catch (err) {
    throw new CorruptCaseFile(dir, String(err));
  }

  // Read log.jsonl
  let logRaw: string;
  try {
    logRaw = await readFile(logPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      // No log file yet — treat as empty history
      logRaw = "";
    } else {
      throw err;
    }
  }

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
