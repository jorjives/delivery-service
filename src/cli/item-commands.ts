import { resolve } from "node:path";
import { ledgerPath, parkedItems, readItemLedger, recordAnswer, recordUnpark, type ItemState } from "../item-ledger.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";

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

/** The parked item a person named, by its key or, when only one parked item has it, by its id. */
async function parkedNamed(item: string, options: ItemOptions, ctx: CommandContext): Promise<{ path: string; state: ItemState }> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const path = ledgerPath(repoPath, ctx.env);
  const parked = parkedItems(await readItemLedger(path));
  const byKey = parked.find((state) => state.key === item);
  const byId = parked.filter((state) => state.key.endsWith(`:${item}`));
  const state = byKey ?? (byId.length === 1 ? byId[0] : undefined);
  if (state === undefined) throw new Refusal(notParked(item, parked.map((s) => s.key)), EXIT.configuration);
  return { path, state };
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
