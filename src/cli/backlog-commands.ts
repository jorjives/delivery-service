import { resolve } from "node:path";
import { commitItemFields, itemsCalled, itemTask, readBacklog, uncommittedItemFiles, type BacklogItem } from "../backlog.js";
import { git } from "../git-exec.js";
import { resolveBaseRef } from "../provision.js";
import { taskIntent } from "../task-list.js";
import { loadConfig } from "./config.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";

export interface ChooseOptions {
  repo?: string;
  /** Every idea in the backlog, instead of the ones named. */
  all?: boolean;
  /** The workflow to fix them through, for ideas that name none. */
  workflow?: string;
  config?: string;
}

export const NO_IDEAS = "There are no ideas in your backlog to choose from. Run a review first, such as: delivery review code";
export const noSuchItem = (name: string): string => `No item in your backlog is called ${name}. See them all with: delivery backlog`;
export const ambiguousItem = (name: string, files: string[]): string => `More than one item is called ${name}: ${files.join(", ")}. Name one by its whole file name.`;
export const notAnIdea = (file: string, status: string): string => `${file} is not an idea waiting for your choice: it is ${status}.`;
export const uncommittedItems = (paths: string[]): string => `I changed nothing: ${paths.join(", ")} ${paths.length === 1 ? "has" : "have"} changes you have not committed. Commit or undo them, then try again.`;
export const unknownFixWorkflow = (file: string, workflow: string | undefined): string =>
  workflow === undefined
    ? `${file} does not say which workflow fixes it. Name one with --workflow.`
    : `${file} is to be fixed through the workflow "${workflow}", which your config file and your packs do not define.`;
const titles = (items: readonly BacklogItem[]): string => items.map((item) => taskIntent(itemTask(item))).join("; ");
const ideasWord = (n: number): string => (n === 1 ? "1 idea" : `${n} ideas`);
export const approved = (items: readonly BacklogItem[]): string[] => [`Approved ${ideasWord(items.length)} for fixing: ${titles(items)}.`, "They are fixed the next time you run: delivery run --sources"];
export const declined = (items: readonly BacklogItem[]): string[] => [`Set aside ${ideasWord(items.length)}: ${titles(items)}.`];
export const PUSH_FIRST = "Your backlog is read from origin, so push this commit before you run delivery run --sources.";
export const notOnBase = (base: string): string => `delivery run --sources reads the backlog on ${base}, so merge this commit into ${base} before you run it.`;

/** The ideas a person chose: every idea with `all`, else each name resolved to exactly one idea. */
async function chosenIdeas(ids: string[], options: ChooseOptions, repoPath: string): Promise<BacklogItem[]> {
  // The owner chooses from what they have: the current commit, which a review just merged its ideas onto.
  const { items } = await readBacklog(repoPath, { at: "HEAD" });
  const ideas = items.filter((item) => item.status === "idea");
  if (options.all === true) {
    if (ideas.length === 0) throw new Refusal(NO_IDEAS, EXIT.configuration);
    return ideas;
  }
  if (ids.length === 0) throw new Refusal(NO_IDEAS, EXIT.configuration);
  return ids.map((id) => {
    const named = itemsCalled(id, items);
    if (named.length === 0) throw new Refusal(noSuchItem(id), EXIT.configuration);
    if (named.length > 1) throw new Refusal(ambiguousItem(id, named.map((item) => item.file)), EXIT.configuration);
    const [item] = named as [BacklogItem];
    if (item.status !== "idea") throw new Refusal(notAnIdea(item.file, item.status), EXIT.configuration);
    return item;
  });
}

async function commitChoice(repoPath: string, items: readonly BacklogItem[], fields: (item: BacklogItem) => Record<string, unknown>, message: string): Promise<void> {
  // One fields object per distinct value, so ideas fixed through different workflows still go in one commit.
  const groups = new Map<string, { fields: Record<string, unknown>; files: string[] }>();
  for (const item of items) {
    const value = fields(item);
    const key = JSON.stringify(value);
    groups.set(key, { fields: value, files: [...(groups.get(key)?.files ?? []), item.file] });
  }
  const dirty = await uncommittedItemFiles(repoPath, items.map((item) => item.file));
  if (dirty.length > 0) throw new Refusal(uncommittedItems(dirty), EXIT.configuration);
  // ponytail: one commit per distinct workflow; ideas from one review share one, which is the common case.
  for (const { fields: value, files } of groups.values()) {
    const result = await commitItemFields(repoPath, files, value, message);
    if ("dirty" in result) throw new Refusal(uncommittedItems(result.dirty), EXIT.configuration);
  }
}

/** `delivery approve <ids...>`: open the chosen ideas, each with the workflow that fixes it, in a commit of those files alone. */
export async function approveCommand(ids: string[], options: ChooseOptions, ctx: CommandContext): Promise<ExitCode> {
  const startDir = resolve(ctx.cwd, options.repo ?? ".");
  const repoPath = await findRepository(startDir);
  const config = await loadConfig({ startDir, repoPath, flag: options.config, env: ctx.env });
  const ideas = await chosenIdeas(ids, options, repoPath);
  const workflowOf = (item: BacklogItem): string => {
    const workflow = item.workflow ?? options.workflow;
    if (workflow === undefined || config.workflows?.[workflow] === undefined) throw new Refusal(unknownFixWorkflow(item.file, workflow), EXIT.configuration);
    return workflow;
  };
  ideas.forEach(workflowOf); // every refusal before anything is written
  await commitChoice(repoPath, ideas, (item) => ({ status: "open", workflow: workflowOf(item) }), `Approve ${ideasWord(ideas.length)} for fixing`);
  for (const line of approved(ideas)) ctx.writeLine(line);
  // `delivery run --sources` reads the backlog at resolveBaseRef's ref, which is origin/<base> when there is an origin:
  // a local approval is not seen there until it is pushed.
  // The same holds for a branch other than the base: the run reads the base, so an approval made elsewhere is not seen.
  const base = await resolveBaseRef(repoPath);
  if (base.ref.startsWith("origin/")) ctx.writeLine(PUSH_FIRST);
  else if ((await git(repoPath, ["branch", "--show-current"])) !== base.localBranch) ctx.writeLine(notOnBase(base.localBranch));
  return EXIT.ok;
}

/** `delivery decline <ids...>`: set the chosen ideas aside, in a commit of those files alone. */
export async function declineCommand(ids: string[], options: ChooseOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const ideas = await chosenIdeas(ids, options, repoPath);
  await commitChoice(repoPath, ideas, () => ({ status: "declined" }), `Set aside ${ideasWord(ideas.length)}`);
  for (const line of declined(ideas)) ctx.writeLine(line);
  return EXIT.ok;
}
