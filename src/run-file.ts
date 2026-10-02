import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CorruptRunFile, ImmutabilityViolation, RunFileNotFound, WriteFailure } from "./errors.js";
import { appendLine, atomicWriteJson, isEnoent, MalformedLine, parseLines, writeAndSync } from "./journal.js";
import { RunEntry, RunJson, type RunFile, type RunHeader, type RunOutcome } from "./schema.js";

/**
 * The record a run of several tasks at once keeps of itself, beside the
 * per-task case files and never inside them: an immutable header, an
 * append-only history of which task took which slot, and an outcome written
 * once. The same three-part split and the same journal as the case file.
 */
const runJsonPath = (dir: string): string => join(dir, "run.json");
const logPath = (dir: string): string => join(dir, "log.jsonl");

export async function createRunFile(dir: string, header: RunHeader): Promise<void> {
  const runJson = RunJson.parse({ header });
  try {
    await Promise.all([atomicWriteJson(runJsonPath(dir), runJson), writeAndSync(logPath(dir), "w", "")]);
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

export async function appendRunEntry(dir: string, entry: RunEntry): Promise<void> {
  RunEntry.parse(entry);
  try {
    await appendLine(logPath(dir), { ...entry, at: new Date().toISOString() });
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}

async function readRunJson(dir: string): Promise<RunJson> {
  let raw: string;
  try {
    raw = await readFile(runJsonPath(dir), "utf-8");
  } catch (err) {
    if (isEnoent(err)) throw new RunFileNotFound(dir, runJsonPath(dir));
    throw err;
  }
  try {
    return RunJson.parse(JSON.parse(raw));
  } catch (err) {
    throw new CorruptRunFile(dir, String(err));
  }
}

export async function loadRunFile(dir: string): Promise<RunFile> {
  const runJson = await readRunJson(dir);
  const raw = await readFile(logPath(dir), "utf-8").catch((err: unknown) => {
    if (isEnoent(err)) return "";
    throw err;
  });
  try {
    return { header: runJson.header, history: parseLines(raw, (value) => RunEntry.parse(value)), outcome: runJson.outcome };
  } catch (err) {
    if (err instanceof MalformedLine) throw new CorruptRunFile(dir, err.message);
    throw err;
  }
}

export async function setRunOutcome(dir: string, outcome: RunOutcome): Promise<void> {
  const runJson = await readRunJson(dir);
  if (runJson.outcome !== undefined) throw new ImmutabilityViolation(dir, "outcome");
  try {
    await atomicWriteJson(runJsonPath(dir), RunJson.parse({ ...runJson, outcome }));
  } catch (err) {
    throw new WriteFailure(dir, String(err));
  }
}
