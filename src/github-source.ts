import { parse, stringify } from "yaml";
import { z } from "zod";
import { itemTask, parseItem } from "./backlog.js";
import { sourceName, type SourceConfig } from "./cli/config.js";
import type { HeldItem } from "./follow-ups.js";
import { ghAccess, ghFailureOf, ghReason, runGh, type GhAccess } from "./gh.js";
import type { TaskDef } from "./schema.js";
import { taskIntent } from "./task-list.js";
import { sourceSkipped, type Listed, type Raised, type WorkItem } from "./work-sources.js";

export type GithubSource = Extract<SourceConfig, { type: "github" }>;

/** The label that approves an issue for delivery when the source names none. */
export const DEFAULT_LABEL = "delivery";
/** The label an issue carries while its item is parked (spec §5.5). */
export const PARKED_LABEL = "delivery:parked";

const GH_TIMEOUT_MS = 60_000;

/** An open issue as listing reads it: `labelledAt` is when the source's label was last added, `renamedAt` the last title change. */
export interface Issue {
  number: number;
  title: string;
  body: string;
  createdAt: string;
  lastEditedAt: string | null;
  labels: string[];
  labelledAt: string | null;
  renamedAt: string | null;
}

const BLOCK = /\n*```delivery\n([\s\S]*?)```\s*$/;

/** The issue body without its trailing ```delivery block, and the machine fields that block carries (spec §5.5). */
export function machineFields(body: string): { text: string; fields: Record<string, unknown> } | { error: string } {
  const normal = body.replace(/\r\n/g, "\n");
  const match = BLOCK.exec(normal);
  if (match === null) return { text: normal.trim(), fields: {} };
  let fields: unknown;
  try {
    fields = parse(match[1] ?? "");
  } catch {
    return { error: "its delivery block is not valid YAML" };
  }
  if (fields !== null && (typeof fields !== "object" || Array.isArray(fields))) return { error: "its delivery block is not a set of fields" };
  return { text: normal.slice(0, match.index).trim(), fields: (fields ?? {}) as Record<string, unknown> };
}

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/** One issue as a work item, or the one reason it is left alone. Pure. */
export function issueItem(issue: Issue, source: GithubSource, name: string): { item: WorkItem } | { skip: string } {
  const label = source.label ?? DEFAULT_LABEL;
  const skip = (reason: string) => ({ skip: `Left GitHub issue #${issue.number} alone: ${reason}` });
  // The label is the trust boundary: text changed after it was added was never approved (spec §5.5).
  const changed = later(issue.lastEditedAt, issue.renamedAt);
  const approved = issue.labelledAt ?? issue.createdAt;
  if (changed !== null && Date.parse(changed) > Date.parse(approved)) {
    return skip(`its text was changed after it was labelled ${label}, so it is not approved as it reads now. Remove the label and add it again to approve it.`);
  }
  const split = machineFields(issue.body);
  if ("error" in split) return skip(`${split.error}.`);
  // The block's workflow and priority are read elsewhere; the rest travel on the task.
  const { workflow: blockWorkflow, ...withPriority } = split.fields;
  const fields = Object.fromEntries(Object.entries(withPriority).filter(([key]) => key !== "priority"));
  const workflowLabels = issue.labels.filter((l) => l.startsWith("workflow:")).sort();
  if (workflowLabels.length > 1) return skip(`it has more than one workflow: label (${workflowLabels.join(", ")}), so I can't tell which workflow delivers it.`);
  const workflow = workflowLabels[0]?.slice("workflow:".length) ?? (typeof blockWorkflow === "string" ? blockWorkflow : undefined) ?? source.workflow;
  // The block's fields go first, so an `intent:` or `body:` in it can never replace the title and text that were approved.
  const taskDef: TaskDef = { ...fields, intent: issue.title, body: split.text === "" ? issue.title : `${issue.title}\n\n${split.text}` };
  return {
    item: {
      key: `${name}:${issue.number}`, source: name, kind: "github", id: String(issue.number), taskDef, fallback: source.fallback === true,
      ...(workflow === undefined ? {} : { workflow }),
      raise: true,
      issue: { number: issue.number, parked: issue.labels.includes(PARKED_LABEL) },
    },
  };
}

/** The order listing works issues in: a priority:<n> label (lower first), else after every prioritised one; then oldest first. */
function priorityOf(issue: Issue): number {
  const label = issue.labels.find((l) => /^priority:-?\d+$/.test(l));
  if (label !== undefined) return Number(label.slice("priority:".length));
  const split = machineFields(issue.body);
  const fromBlock = "fields" in split ? split.fields.priority : undefined;
  return typeof fromBlock === "number" && Number.isInteger(fromBlock) ? fromBlock : Number.POSITIVE_INFINITY;
}

// ponytail: the first 100 open labelled issues, and each one's last 100 label and rename events; page when a project approves more at once.
const QUERY = `query($owner: String!, $name: String!, $label: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: OPEN, labels: [$label], orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes {
        number title body createdAt lastEditedAt
        labels(first: 50) { nodes { name } }
        timelineItems(last: 100, itemTypes: [LABELED_EVENT, RENAMED_TITLE_EVENT]) {
          nodes { __typename ... on LabeledEvent { createdAt label { name } } ... on RenamedTitleEvent { createdAt } }
        }
      }
    }
  }
}`;

const Event = z.union([
  z.object({ __typename: z.literal("LabeledEvent"), createdAt: z.string(), label: z.object({ name: z.string() }) }),
  z.object({ __typename: z.literal("RenamedTitleEvent"), createdAt: z.string() }),
]);
const Response = z.object({
  data: z.object({
    repository: z.object({
      issues: z.object({
        nodes: z.array(z.object({
          number: z.number().int(), title: z.string(), body: z.string(), createdAt: z.string(), lastEditedAt: z.string().nullable(),
          labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
          timelineItems: z.object({ nodes: z.array(Event) }),
        })),
      }),
    }),
  }),
});

const latest = (times: string[]): string | null => times.reduce<string | null>((a, b) => later(a, b), null);

/** Plain words for what stopped gh, and how to fix it. */
export function accessReason(access: GhAccess): string {
  switch (access) {
    case "missing":
      return "the GitHub command-line tool (gh) is not installed, or not on the PATH the harness runs with. Install it from https://cli.github.com and run gh auth login.";
    case "signed-out":
      return "gh is not signed in, or its sign-in has expired. Run gh auth login as the account the harness runs as.";
    case "forbidden":
      return "the account gh is signed in as lacks permission to change this repository's issues. Run gh auth refresh -s repo, or get access to the repository.";
    case "offline":
      return "gh could not reach GitHub. Check the network.";
  }
}

/** Why a gh call failed, in plain words: an access problem with its fix, else gh's own first line. */
export function ghProblem(err: unknown): string {
  const failure = ghFailureOf(err);
  const access = ghAccess(failure);
  return access === null ? `gh said: ${ghReason(failure)}` : accessReason(access);
}

/** The source's open issues as work items, in its order, with a note for each issue left alone; the whole source skipped, with the reason, when gh cannot answer. */
export async function listGithub(source: GithubSource, name: string, { repoPath, env }: { repoPath: string; env: NodeJS.ProcessEnv }): Promise<Listed> {
  const label = source.label ?? DEFAULT_LABEL;
  const skipSource = (reason: string): Listed => ({ items: [], notes: [sourceSkipped(name, reason)] });
  let stdout: string;
  try {
    stdout = await runGh(["api", "graphql", "-f", `query=${QUERY}`, "-F", "owner={owner}", "-F", "name={repo}", "-f", `label=${label}`], { cwd: repoPath, env, timeoutMs: GH_TIMEOUT_MS });
  } catch (err) {
    return skipSource(ghProblem(err));
  }
  let parsed;
  try {
    parsed = Response.parse(JSON.parse(stdout));
  } catch {
    return skipSource("gh printed issues I can't read.");
  }
  const issues: Issue[] = parsed.data.repository.issues.nodes.map((node) => ({
    number: node.number, title: node.title, body: node.body, createdAt: node.createdAt, lastEditedAt: node.lastEditedAt,
    labels: node.labels.nodes.map((l) => l.name).sort(),
    labelledAt: latest(node.timelineItems.nodes.flatMap((e) => (e.__typename === "LabeledEvent" && e.label.name === label ? [e.createdAt] : []))),
    renamedAt: latest(node.timelineItems.nodes.flatMap((e) => (e.__typename === "RenamedTitleEvent" ? [e.createdAt] : []))),
  }));
  // Compared, not subtracted: two unprioritised issues are both Infinity, and Infinity - Infinity is NaN.
  const byPriority = (a: Issue, b: Issue): number => {
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    return pa === pb ? 0 : pa - pb;
  };
  const ordered = [...issues].sort((a, b) => byPriority(a, b) || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number);
  const items: WorkItem[] = [];
  const notes: string[] = [];
  for (const issue of ordered) {
    const read = issueItem(issue, source, name);
    if ("item" in read) items.push(read.item);
    else notes.push(read.skip);
  }
  return { items, notes };
}

/** An issue body carrying machine fields in a trailing ```delivery block; the text alone when there are none. */
export function withMachineFields(text: string, fields: Record<string, unknown>): string {
  const trimmed = text.trim();
  return Object.keys(fields).length === 0 ? `${trimmed}\n` : `${trimmed}\n\n\`\`\`delivery\n${stringify(fields)}\`\`\`\n`;
}

/**
 * Open a held follow-up as an issue, unlabelled: an agent cannot approve work, so the owner labels it to have it
 * worked (spec §5.13). Its brief's first line is the title, its whole brief the body, and its workflow, priority and
 * other fields go in the delivery block that listing reads back.
 */
export async function raiseIssue(item: HeldItem, { repoPath, env }: { repoPath: string; env: NodeJS.ProcessEnv }): Promise<Raised> {
  const parsed = parseItem(item.file, item.text);
  if (!parsed.ok) return { error: `${item.file} is not a valid item: ${parsed.reason}` };
  const { workflow, priority, fields, body } = parsed.item;
  const machine = { ...(workflow === undefined ? {} : { workflow }), ...(priority === undefined ? {} : { priority }), ...fields };
  try {
    const out = await runGh(["issue", "create", "--title", taskIntent(itemTask(parsed.item)), "--body", withMachineFields(body, machine)], { cwd: repoPath, env, timeoutMs: GH_TIMEOUT_MS });
    const number = /\/issues\/(\d+)\s*$/.exec(out)?.[1];
    return number === undefined ? { error: `gh did not print the new issue's address: ${out || "it printed nothing"}` } : { id: number };
  } catch (err) {
    return { error: ghProblem(err) };
  }
}

/** The issue a landed item's key names, when its source is a github source; undefined for any other item. */
export function githubIssueOf(key: string, sources: readonly SourceConfig[]): number | undefined {
  const source = sources.find((s) => s.type === "github" && key.startsWith(`${sourceName(s)}:`));
  const id = source === undefined ? undefined : key.slice(sourceName(source).length + 1);
  return id !== undefined && /^\d+$/.test(id) ? Number(id) : undefined;
}

/** Close a delivered issue with a comment saying where the work is: undefined when done (or already closed), otherwise why not. */
export async function closeIssue(number: number, comment: string, { repoPath, env }: { repoPath: string; env: NodeJS.ProcessEnv }): Promise<string | undefined> {
  try {
    await runGh(["issue", "close", String(number), "--comment", comment], { cwd: repoPath, env, timeoutMs: GH_TIMEOUT_MS });
    return undefined;
  } catch (err) {
    return ghProblem(err);
  }
}

/**
 * Show on the issue that its item is parked (spec §5.5): the parked label, created first when the repository lacks it
 * (gh refuses to add a label that does not exist), and a comment saying why, the question included. The ledger stays
 * the record. Undefined when done, otherwise why not.
 */
export async function markParked(number: number, why: string, { repoPath, env }: { repoPath: string; env: NodeJS.ProcessEnv }): Promise<string | undefined> {
  const gh = (args: string[]) => runGh(args, { cwd: repoPath, env, timeoutMs: GH_TIMEOUT_MS });
  try {
    await gh(["label", "create", PARKED_LABEL, "--color", "D93F0B", "--description", "Set aside by the delivery harness: see its comment", "--force"]);
    await gh(["issue", "edit", String(number), "--add-label", PARKED_LABEL]);
    await gh(["issue", "comment", String(number), "--body", why]);
    return undefined;
  } catch (err) {
    return ghProblem(err);
  }
}

/** Take the parked label off an issue that is being worked again. Undefined when done, otherwise why not. */
export async function clearParked(number: number, { repoPath, env }: { repoPath: string; env: NodeJS.ProcessEnv }): Promise<string | undefined> {
  try {
    await runGh(["issue", "edit", String(number), "--remove-label", PARKED_LABEL], { cwd: repoPath, env, timeoutMs: GH_TIMEOUT_MS });
    return undefined;
  } catch (err) {
    return ghProblem(err);
  }
}
