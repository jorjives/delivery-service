import { resolve } from "node:path";
import { commitItemFields } from "../backlog.js";
import { ledgerPath, parkedItems, readItemLedger, recordAnswer, recordSignOff, recordUnpark, type ItemState } from "../item-ledger.js";
import { branchName } from "../provision.js";
import type { CommandContext } from "./context.js";
import { DEFAULT_SOURCES, loadConfig, sourceName } from "./config.js";
import { uncommittedItems } from "./backlog-commands.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { refuseIfRunGoing } from "./queue.js";
import { runSources } from "./sources-run.js";

export interface ItemOptions {
  repo?: string;
}

export const notParked = (item: string, parked: string[]): string =>
  parked.length === 0
    ? `No item called ${item} is parked here, and nothing is parked at the moment.`
    : `No item called ${item} is parked here. Parked: ${parked.join(", ")}.`;
export const notWaitingForAnswer = (key: string): string => `${key} isn't waiting on an answer. To try it again, use: delivery unpark ${key}`;
export const answered = (key: string): string => `Recorded your answer for ${key}. The next \`delivery run --sources\` carries on its work with it.`;
export const unparked = (key: string): string => `${key} is back in the queue: the next \`delivery run --sources\` starts it afresh.`;
export const notHeld = (key: string): string => `${key} isn't waiting for your sign-off. See what it is waiting for with: delivery backlog ${key}`;
export const signedOff = (key: string): string => `Signed off ${key}: checking it again where it lands, then landing it.`;
export const rejected = (key: string, branch: string): string => `Set ${key} aside: nothing was landed. Its work stays on branch ${branch} if you want it.`;
export const rejectOnTracker = (key: string): string => `${key} lives in your tracker, not your backlog folder: close it there to set it aside.`;

/** The parked item a person named, by its key or, when only one parked item has it, by its id. */
async function parkedNamed(item: string, options: ItemOptions, ctx: CommandContext): Promise<{ repoPath: string; path: string; state: ItemState }> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const path = ledgerPath(repoPath, ctx.env);
  const parked = parkedItems(await readItemLedger(path));
  const byKey = parked.find((state) => state.key === item);
  const byId = parked.filter((state) => state.key.endsWith(`:${item}`) || state.key.endsWith(`:${item}.md`) || state.key.endsWith(`-${item}.md`));
  const state = byKey ?? (byId.length === 1 ? byId[0] : undefined);
  if (state === undefined) throw new Refusal(notParked(item, parked.map((s) => s.key)), EXIT.configuration);
  return { repoPath, path, state };
}

/** `delivery answer <item> "<text>"`: record the operator's answer to a parked item's question and unpark it. */
export async function answerCommand(item: string, answer: string, options: ItemOptions, ctx: CommandContext): Promise<ExitCode> {
  const { path, state } = await parkedNamed(item, options, ctx);
  if (state.parked !== "decision") throw new Refusal(notWaitingForAnswer(state.key), EXIT.configuration);
  await recordAnswer(path, state.key, answer);
  ctx.writeLine(answered(state.key));
  return EXIT.ok;
}

/** `delivery unpark <item>`: put a parked item back in the queue, its earlier attempts forgotten. */
export async function unparkCommand(item: string, options: ItemOptions, ctx: CommandContext): Promise<ExitCode> {
  const { path, state } = await parkedNamed(item, options, ctx);
  await recordUnpark(path, state.key);
  ctx.writeLine(unparked(state.key));
  return EXIT.ok;
}

/** `delivery sign-off <item>`: land a held item, re-checked where it lands (spec 5.7), then the closer and the after steps, as a run does. */
export async function signOffCommand(item: string, options: ItemOptions & { config?: string }, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, path, state } = await parkedNamed(item, options, ctx);
  if (state.parked !== "held") throw new Refusal(notHeld(state.key), EXIT.configuration);
  await refuseIfRunGoing(repoPath);
  const config = await loadConfig({ startDir: repoPath, repoPath, flag: options.config, env: ctx.env });
  await recordSignOff(path, state.key);
  ctx.writeLine(signedOff(state.key));
  return runSources({ sources: true, ...(options.config === undefined ? {} : { config: options.config }) }, { repoPath, config }, ctx, { only: state.key });
}

/** `delivery reject <item>`: decline a held backlog item in a commit of that file alone; its work stays on its branch. */
export async function rejectCommand(item: string, options: ItemOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, path, state } = await parkedNamed(item, options, ctx);
  if (state.parked !== "held") throw new Refusal(notHeld(state.key), EXIT.configuration);
  const config = await loadConfig({ startDir: repoPath, repoPath, flag: undefined, env: ctx.env });
  const [sourceKey, file] = [state.key.slice(0, state.key.indexOf(":")), state.key.slice(state.key.indexOf(":") + 1)];
  const source = (config.sources ?? DEFAULT_SOURCES).find((s) => sourceName(s) === sourceKey);
  if (source?.type !== "backlog") throw new Refusal(rejectOnTracker(state.key), EXIT.configuration);
  const result = await commitItemFields(repoPath, [file], { status: "declined" }, `Reject ${file}`);
  if ("dirty" in result) throw new Refusal(uncommittedItems(result.dirty), EXIT.configuration);
  await recordUnpark(path, state.key);
  ctx.writeLine(rejected(state.key, branchName(state.lastRunId ?? "")));
  return EXIT.ok;
}
