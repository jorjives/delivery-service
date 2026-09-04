import { open, rename } from "node:fs/promises";
import { join } from "node:path";
import { CaseJson, CaseFile, CaseFileHeader, BudgetSet } from "./schema.js";
import { WriteFailure } from "./errors.js";

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
