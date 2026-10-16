import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parse, parseDocument } from "yaml";
import { git } from "./git-exec.js";
import { resolveBaseRef } from "./provision.js";
import type { TaskDef } from "./schema.js";

/** Where a project keeps its work items: tracked by git, beside the harness's own untracked records. */
export const BACKLOG_DIR = ".delivery/backlog";

/** `<timestamp>-<slug>.md`, so items added by tasks running at the same time never collide. */
export const ITEM_FILE = /^\d{8}T\d{6}Z-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const STATUSES = ["open", "idea", "resolved", "declined"] as const;
export type ItemStatus = (typeof STATUSES)[number];

export interface BacklogItem {
  file: string;
  status: ItemStatus;
  workflow?: string;
  priority?: number;
  cadenceMs?: number;
  fields: Record<string, unknown>;
  body: string;
}

export type ParsedItem = { ok: true; item: BacklogItem } | { ok: false; file: string; reason: string };

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

/** A cadence such as `7d` in milliseconds, or undefined for anything else. */
export function cadenceMs(text: string): number | undefined {
  const match = /^(\d+)([mhdw])$/.exec(text);
  return match ? Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS] : undefined;
}

const FrontMatter = z
  .object({
    status: z.enum(STATUSES, { error: "`status` must be one of open, idea, resolved or declined" }),
    workflow: z.string().min(1, "`workflow` must name a workflow").optional(),
    priority: z.number({ error: "`priority` must be a whole number" }).int("`priority` must be a whole number").optional(),
    cadence: z.string().refine((text) => cadenceMs(text) !== undefined, "`cadence` must be a number and a unit, such as 30m, 12h, 7d or 2w").optional(),
  })
  .catchall(z.unknown());

const SPLIT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** One item file read against the schema: the item, or the one reason it cannot be used. */
export function parseItem(file: string, text: string): ParsedItem {
  const refuse = (reason: string): ParsedItem => ({ ok: false, file, reason });
  if (!ITEM_FILE.test(file)) return refuse("it is not named <timestamp>-<slug>.md, such as 20261016T090000Z-greet-people.md");
  const split = SPLIT.exec(text);
  if (split === null) return refuse("it does not start with front matter between --- lines");
  let raw: unknown;
  try {
    raw = parse(split[1] ?? "");
  } catch {
    return refuse("its front matter is not valid YAML");
  }
  const parsed = FrontMatter.safeParse(raw ?? {});
  if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? "its front matter does not match the item format");
  const body = split[2] ?? "";
  if (body.trim() === "") return refuse("it has no brief below its front matter");
  const { status, workflow, priority, cadence, ...fields } = parsed.data;
  return {
    ok: true,
    item: {
      file,
      status,
      ...(workflow === undefined ? {} : { workflow }),
      ...(priority === undefined ? {} : { priority }),
      ...(cadence === undefined ? {} : { cadenceMs: cadenceMs(cadence) }),
      fields,
      body,
    },
  };
}

/** Lower priority first; an item with none after every item with one; ties by file name. */
export function orderItems(items: readonly BacklogItem[]): BacklogItem[] {
  const rank = (item: BacklogItem): number => item.priority ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Whether an item is due: it does not recur, it never closed, or its interval has passed since it last did. */
export function isDue(item: { cadenceMs?: number }, lastClosedAt: string | null, now: Date): boolean {
  if (item.cadenceMs === undefined || lastClosedAt === null) return true;
  return now.getTime() - Date.parse(lastClosedAt) >= item.cadenceMs;
}

/** The task an item becomes: its brief as `body`, the brief's first line as `intent`, and every other field. */
export function itemTask(item: BacklogItem): TaskDef {
  const first = item.body.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line !== "") ?? item.file;
  return { intent: first, body: item.body, ...item.fields };
}

/** The item's text with `status: resolved`, everything else (comments included) as it was. */
export function resolvedText(text: string): string {
  const split = SPLIT.exec(text);
  if (split === null) return text;
  const doc = parseDocument(split[1] ?? "");
  doc.set("status", "resolved");
  return `---\n${doc.toString()}---\n${split[2] ?? ""}`;
}

export interface Backlog {
  items: BacklogItem[];
  invalid: { file: string; reason: string }[];
  uncommitted: string[];
}

/**
 * The backlog as the base commit holds it: what a run would start from, so an item and the work on it agree.
 * Item files in the checkout that the commit lacks are named, never read.
 */
export async function readBacklog(repoPath: string): Promise<Backlog> {
  const { ref } = await resolveBaseRef(repoPath);
  const listed = (await git(repoPath, ["ls-tree", "-z", "--name-only", `${ref}:${BACKLOG_DIR}`], { raw: true }).catch(() => "")).split("\0").filter((name) => name.endsWith(".md"));
  const items: BacklogItem[] = [];
  const invalid: Backlog["invalid"] = [];
  for (const file of listed) {
    const parsed = parseItem(file, await git(repoPath, ["show", `${ref}:${BACKLOG_DIR}/${file}`], { raw: true }));
    if (parsed.ok) items.push(parsed.item);
    else invalid.push({ file: parsed.file, reason: parsed.reason });
  }
  // Named, never read: item files in the checkout that the base commit lacks. That covers a file never committed and,
  // when the base is `origin/HEAD`, one committed locally but not pushed yet; `ls-files --others` would miss the second.
  const onDisk = await readdir(join(repoPath, BACKLOG_DIR)).catch(() => [] as string[]);
  const uncommitted = onDisk.filter((name) => name.endsWith(".md") && !listed.includes(name)).sort();
  return { items: orderItems(items), invalid, uncommitted };
}
