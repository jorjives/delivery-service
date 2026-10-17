import { z } from "zod";
import { BACKLOG_DIR, isDue, itemTask, readBacklog } from "./backlog.js";
import { sourceName, structureTask, type DeliveryConfig, type SourceConfig } from "./cli/config.js";
import { awaitsMerge, type ItemState } from "./item-ledger.js";
import type { RunRecord } from "./run-records.js";
import type { TaskDef } from "./schema.js";
import { runShell } from "./shell.js";
import { stillToTake, taskId } from "./task-list.js";

export interface WorkItem {
  key: string;
  source: string;
  kind: SourceConfig["type"];
  id: string;
  taskDef: TaskDef;
  workflow?: string;
  resolve?: string;
  cadenceMs?: number;
  fallback: boolean;
}

export interface Listed {
  items: WorkItem[];
  notes: string[];
}

/** What `<command> list` prints: a JSON array of tasks, each with a string `id` and anything else the task carries. */
export const COMMAND_TASKS = z.array(z.looseObject({ id: z.string().min(1), intent: z.string().optional(), workflow: z.string().optional() }));

export const sourceSkipped = (name: string, reason: string): string => `Skipped the ${name} source for this run: ${reason}`;

const LIST_TIMEOUT_MS = 60_000;
const workflowOf = (taskDef: TaskDef): string | undefined => (typeof taskDef.workflow === "string" ? taskDef.workflow : undefined);
const withWorkflow = (taskDef: TaskDef): { workflow?: string } => {
  const workflow = workflowOf(taskDef);
  return workflow === undefined ? {} : { workflow };
};

async function listCommand(source: Extract<SourceConfig, { type: "command" }>, name: string, repoPath: string, env: NodeJS.ProcessEnv): Promise<Listed> {
  const skip = (reason: string): Listed => ({ items: [], notes: [sourceSkipped(name, reason)] });
  const what = `\`${source.command} list\``;
  let result;
  try {
    result = await runShell(source.command, ["list"], { cwd: repoPath, timeoutMs: LIST_TIMEOUT_MS, env });
  } catch (err) {
    return skip(`${what} could not be run: ${(err as Error).message}`);
  }
  if (result.exitCode !== 0) return skip(`${what} exited with code ${result.exitCode}: ${result.stderr.trim() || "it said nothing"}`);
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    return skip(`${what} did not print JSON`);
  }
  const tasks = COMMAND_TASKS.safeParse(raw);
  if (!tasks.success) return skip(`${what} printed tasks I can't read: each needs a string \`id\``);
  return {
    items: tasks.data.map(({ id, ...taskDef }) => ({
      key: `${name}:${id}`, source: name, kind: "command" as const, id, taskDef, fallback: source.fallback === true, ...withWorkflow(taskDef),
    })),
    notes: [],
  };
}

/** One source's open work, in the source's own order, with a note for anything it could not use. */
export async function listSource(source: SourceConfig, { repoPath, config, env }: { repoPath: string; config: DeliveryConfig; env: NodeJS.ProcessEnv }): Promise<Listed> {
  const name = sourceName(source);
  const fallback = source.fallback === true;
  switch (source.type) {
    case "backlog": {
      const backlog = await readBacklog(repoPath);
      return {
        items: backlog.items
          .filter((item) => item.status === "open")
          .map((item) => ({
            key: `${name}:${item.file}`, source: name, kind: "backlog" as const, id: item.file, taskDef: itemTask(item), fallback,
            ...(item.workflow === undefined ? {} : { workflow: item.workflow }),
            ...(item.cadenceMs === undefined ? { resolve: `${BACKLOG_DIR}/${item.file}` } : { cadenceMs: item.cadenceMs }),
          })),
        notes: [
          ...backlog.invalid.map(({ file, reason }) => `Left ${BACKLOG_DIR}/${file} alone: ${reason}.`),
          ...backlog.uncommitted.map((file) => `${BACKLOG_DIR}/${file} is not in your base branch's last commit yet, so it was left for now. Commit it, and push it if the project has an origin, to have it worked.`),
        ],
      };
    }
    case "list":
      return {
        // Keyed by what the task says, never by where it sits: the ledger parks, counts and answers by key, and a list is edited.
        items: (config.tasks ?? [])
          .map(structureTask)
          .map((taskDef) => ({ id: taskId(taskDef), taskDef }))
          .filter(({ id }, index, all) => all.findIndex((other) => other.id === id) === index)
          .map(({ id, taskDef }) => ({ key: `${name}:${id}`, source: name, kind: "list" as const, id, taskDef, fallback, ...withWorkflow(taskDef) })),
        notes: [],
      };
    case "command":
      return listCommand(source, name, repoPath, env);
  }
}

export interface Chosen {
  items: WorkItem[];
  notes: string[];
}

/** Whether a listed item is for this run to take. Recurring due-ness is decided by the caller, which orders those first. */
async function eligible(item: WorkItem, state: ItemState | undefined, repoPath: string, records: RunRecord[], taken: ReadonlySet<string>): Promise<boolean> {
  if (taken.has(item.key) || state?.parked) return false;
  if (state !== undefined && !state.settled && records.some((r) => r.runId === state.lastRunId && r.caseFile.outcome === undefined)) return false;
  if (item.fallback || item.cadenceMs !== undefined) return true;
  if (item.kind === "list" && !stillToTake(records, item.taskDef)) return false;
  // Landed, not yet merged: its work is on a branch that still exists, or already on the local base branch while the
  // backlog (read from origin) still shows it open. Not dispatched again until neither holds.
  return !(await awaitsMerge(repoPath, state));
}

/**
 * Up to `max` items for this run, in the spec's order: due recurring backlog items, then each source in turn,
 * then fallback sources only when nothing else had work. No further source is read once `max` are chosen.
 */
export async function chooseWork(
  sources: readonly SourceConfig[],
  { repoPath, config, env, ledger, records, now, max, taken }: {
    repoPath: string; config: DeliveryConfig; env: NodeJS.ProcessEnv; ledger: Map<string, ItemState>;
    records: RunRecord[]; now: Date; max: number; taken: ReadonlySet<string>;
  },
): Promise<Chosen> {
  const chosen: WorkItem[] = [];
  const notes: string[] = [];
  const listed = new Map<SourceConfig, Listed>();
  const listOf = async (source: SourceConfig): Promise<Listed> => {
    const known = listed.get(source);
    if (known) return known;
    // Any source that throws while listing (a backlog with no readable base commit, say) is skipped for this run, never the whole run.
    const fresh = await listSource(source, { repoPath, config, env }).catch(
      (err: unknown): Listed => ({ items: [], notes: [sourceSkipped(sourceName(source), (err as Error).message)] }),
    );
    listed.set(source, fresh);
    notes.push(...fresh.notes);
    return fresh;
  };
  const take = async (items: WorkItem[]): Promise<void> => {
    for (const item of items) {
      if (chosen.length >= max) return;
      if (chosen.some((c) => c.key === item.key)) continue;
      if (await eligible(item, ledger.get(item.key), repoPath, records, taken)) chosen.push(item);
    }
  };
  const recurring = (item: WorkItem): boolean => item.cadenceMs !== undefined;
  const dueNow = (item: WorkItem): boolean => isDue(item, ledger.get(item.key)?.lastClosedAt ?? null, now);

  const primary = sources.filter((s) => s.fallback !== true);
  for (const source of primary.filter((s) => s.type === "backlog")) {
    if (chosen.length >= max) break;
    await take((await listOf(source)).items.filter((item) => recurring(item) && dueNow(item)));
  }
  for (const source of primary) {
    if (chosen.length >= max) break;
    await take((await listOf(source)).items.filter((item) => !recurring(item)));
  }
  if (chosen.length === 0) {
    for (const source of sources.filter((s) => s.fallback === true)) {
      if (chosen.length >= max) break;
      await take((await listOf(source)).items.filter((item) => !recurring(item) || dueNow(item)));
    }
  }
  return { items: chosen, notes };
}
