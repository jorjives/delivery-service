import { z } from "zod";
import { BACKLOG_DIR, isDue, itemTask, parseItem, readBacklog } from "./backlog.js";
import { sourceName, structureTask, type DeliveryConfig, type SourceConfig } from "./cli/config.js";
import { listGithub, raiseIssue } from "./github-source.js";
import type { HeldItem } from "./follow-ups.js";
import type { Held, HoldReason } from "./held-sequences.js";
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
  /** Items sharing a name form one sequence, in the order sources list them: only its earliest undelivered item is taken (spec §5.10). */
  sequence?: string;
  /** Set for a github source's items, and for a command source that says it is a tracker: follow-ups its items add are raised through it, not landed (spec §5.5). */
  raise?: true;
  /** Set only for an item from a github source: its issue, and whether it carries the parked label. */
  issue?: { number: number; parked: boolean };
}

export interface Listed {
  items: WorkItem[];
  notes: string[];
}

/** What `<command> list` prints: a JSON array of tasks, each with a string `id` and anything else the task carries. */
export const COMMAND_TASKS = z.array(z.looseObject({ id: z.string().min(1), intent: z.string().optional(), workflow: z.string().optional(), sequence: z.string().min(1).optional() }));

export const sourceSkipped = (name: string, reason: string): string => `Skipped the ${name} source for this run: ${reason}`;

const LIST_TIMEOUT_MS = 60_000;
const withWorkflow = ({ workflow }: TaskDef): { workflow?: string } => (typeof workflow === "string" ? { workflow } : {});
const withSequence = (sequence: unknown): { sequence?: string } => (typeof sequence === "string" ? { sequence } : {});

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
  if (!tasks.success) return skip(`${what} printed tasks I can't read: each needs a string \`id\`, and a \`sequence\`, where there is one, must be a name`);
  return {
    items: tasks.data.map(({ id, ...taskDef }) => ({
      key: `${name}:${id}`, source: name, kind: "command" as const, id, taskDef, fallback: source.fallback === true, ...withWorkflow(taskDef), ...withSequence(taskDef.sequence),
      ...(source.tracker === true ? { raise: true as const } : {}),
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
            ...withSequence(item.sequence),
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
          .map(({ id, taskDef }) => ({ key: `${name}:${id}`, source: name, kind: "list" as const, id, taskDef, fallback, ...withWorkflow(taskDef), ...withSequence(taskDef.sequence) })),
        notes: [],
      };
    case "command":
      return listCommand(source, name, repoPath, env);
    case "github":
      return listGithub(source, name, { repoPath, env });
  }
}

export interface Chosen {
  items: WorkItem[];
  notes: string[];
  /** Sequences waiting behind an earliest undelivered item, and why it has not moved on; only from the sources in `read`. */
  held: Held[];
  /** Names of the sources listed and scanned in full this run; the rest were not reached. */
  read: string[];
}

/** Where a listed item stands for this run: takeable, delivered already (landed, merged or not), or holding up what comes after it. */
type Standing = { kind: "takeable" } | { kind: "delivered" } | { kind: "held"; reason: HoldReason };

/** Recurring due-ness is decided by the caller, which orders those first. */
async function standingOf(item: WorkItem, state: ItemState | undefined, repoPath: string, records: RunRecord[], taken: ReadonlySet<string>): Promise<Standing> {
  if (taken.has(item.key)) return { kind: "held", reason: "in_flight" };
  if (state?.parked) return { kind: "held", reason: state.parked === "decision" ? "decision" : "parked" };
  if (state !== undefined && !state.settled && records.some((r) => r.runId === state.lastRunId && r.caseFile.outcome === undefined)) return { kind: "held", reason: "in_flight" };
  if (item.fallback || item.cadenceMs !== undefined) return { kind: "takeable" };
  if (item.kind === "list" && !stillToTake(records, item.taskDef)) return { kind: "delivered" };
  // Landed, not yet merged: its work is on a branch that still exists, or already on the local base branch while the
  // backlog (read from origin) still shows it open. Not dispatched again until neither holds.
  return (await awaitsMerge(repoPath, state)) ? { kind: "delivered" } : { kind: "takeable" };
}

/**
 * Up to `max` items for this run, in the spec's order: due recurring backlog items, then each source in turn,
 * then fallback sources only when nothing else had work. No further source is read once `max` are chosen, and at
 * most one item of each sequence is taken (spec §5.10).
 */
export async function chooseWork(
  sources: readonly SourceConfig[],
  { repoPath, config, env, ledger, records, now, max, taken, only }: {
    repoPath: string; config: DeliveryConfig; env: NodeJS.ProcessEnv; ledger: Map<string, ItemState>;
    records: RunRecord[]; now: Date; max: number; taken: ReadonlySet<string>; only?: string;
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
  // Each sequence's earliest undelivered item, once met: what holds it and why, or null when it was not taken this run.
  const heads = new Map<string, { item: string; source: string; reason: HoldReason } | null>();
  const waiting = new Set<string>(); // sequences with an item behind their head
  const read: string[] = [];
  const take = async (items: WorkItem[], source: string): Promise<void> => {
    for (const item of items) {
      // A fallback item is never "delivered" (always takeable today), so it keeps today's rule and joins no sequence.
      const sequence = item.fallback ? undefined : item.sequence;
      if (sequence !== undefined && heads.has(sequence)) {
        waiting.add(sequence);
        continue;
      }
      if (chosen.some((c) => c.key === item.key)) continue;
      const wanted = chosen.length < max && (only === undefined || item.key === only);
      if (sequence === undefined && !wanted) continue;
      const standing = await standingOf(item, ledger.get(item.key), repoPath, records, taken);
      if (sequence === undefined) {
        if (standing.kind === "takeable") chosen.push(item);
        continue;
      }
      if (standing.kind === "delivered") continue;
      if (standing.kind === "held") {
        heads.set(sequence, { item: item.key, source, reason: standing.reason });
        continue;
      }
      // The sequence's next item: in flight from here on when taken, and either way nothing after it is taken this run.
      heads.set(sequence, wanted ? { item: item.key, source, reason: "in_flight" } : null);
      if (wanted) chosen.push(item);
    }
  };
  const recurring = (item: WorkItem): boolean => item.cadenceMs !== undefined;
  const dueNow = (item: WorkItem): boolean => isDue(item, ledger.get(item.key)?.lastClosedAt ?? null, now);

  const primary = sources.filter((s) => s.fallback !== true);
  for (const source of primary.filter((s) => s.type === "backlog")) {
    if (chosen.length >= max) break;
    await take((await listOf(source)).items.filter((item) => recurring(item) && dueNow(item)), sourceName(source));
  }
  for (const source of primary) {
    if (chosen.length >= max) break;
    await take((await listOf(source)).items.filter((item) => !recurring(item)), sourceName(source));
    read.push(sourceName(source));
  }
  if (chosen.length === 0) {
    for (const source of sources.filter((s) => s.fallback === true)) {
      if (chosen.length >= max) break;
      await take((await listOf(source)).items.filter((item) => !recurring(item) || dueNow(item)), sourceName(source));
      read.push(sourceName(source));
    }
  }
  const held = [...heads].flatMap(([sequence, head]) => (head !== null && waiting.has(sequence) ? [{ sequence, ...head }] : []));
  return { items: chosen, notes, held, read };
}

export type Raised = { id: string } | { error: string };

const RAISE_TIMEOUT_MS = 60_000;

/** Open a held follow-up in the source's tracker: `<command> raise`, the item as JSON on stdin, the new id on stdout (spec §5.5). */
export async function raiseThrough(source: SourceConfig, item: HeldItem, { repoPath, env }: { repoPath: string; env: NodeJS.ProcessEnv }): Promise<Raised> {
  if (source.type === "github") return raiseIssue(item, { repoPath, env });
  if (source.type !== "command" || source.tracker !== true) return { error: `the ${sourceName(source)} source is not a command source with "tracker": true, so it cannot raise items; drop the waiting step with \`delivery drop-after\` or set "tracker": true on it` };
  const parsed = parseItem(item.file, item.text);
  if (!parsed.ok) return { error: `${item.file} is not a valid item: ${parsed.reason}` };
  const { file, status, workflow, priority, fields, body } = parsed.item;
  const input = JSON.stringify({ file, status, ...(workflow === undefined ? {} : { workflow }), ...(priority === undefined ? {} : { priority }), ...fields, body });
  const what = `\`${source.command} raise\``;
  try {
    const result = await runShell(source.command, ["raise"], { cwd: repoPath, timeoutMs: RAISE_TIMEOUT_MS, env, input });
    if (result.exitCode !== 0) return { error: `${what} exited with code ${result.exitCode}: ${result.stderr.trim() || "it said nothing"}` };
    const id = result.stdout.trim();
    return id === "" ? { error: `${what} printed no id` } : { id };
  } catch (err) {
    return { error: `${what} could not be run: ${(err as Error).message}` };
  }
}
