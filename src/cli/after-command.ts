import { resolve } from "node:path";
import { afterLedgerPath, isPending, readAfter } from "../after-ledger.js";
import { dropPending } from "../after-steps.js";
import { ledgerPath } from "../item-ledger.js";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import type { ItemOptions } from "./item-commands.js";
import { findRepository } from "./project.js";

export const nothingWaiting = "No after-landing step is waiting, so there is nothing to drop.";
export const noSuchBatch = (batch: string, waiting: string[]): string => `No batch called ${batch} has after-landing steps waiting. Waiting: ${waiting.join(", ")}.`;
export const dropped = (count: number): string =>
  `Dropped ${count === 1 ? "one waiting after-landing step" : `${count} waiting after-landing steps`}; the next \`delivery run --sources\` will not try ${count === 1 ? "it" : "them"}. Work that landed stays landed.`;
export const unraised = (file: string, source: string): string => `${file} was held for ${source} and has not been raised there; raise it by hand if you still want it.`;

/** `delivery drop-after [batch]`: skip every waiting after-landing step, of one batch or of all, so a step that cannot or need not be done stops stopping runs. */
export async function dropAfterCommand(batch: string | undefined, options: ItemOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const ledger = afterLedgerPath(ledgerPath(repoPath, ctx.env));
  const waiting = (await readAfter(ledger)).filter(isPending);
  if (waiting.length === 0) {
    ctx.writeLine(nothingWaiting);
    return EXIT.ok;
  }
  if (batch !== undefined && !waiting.some((state) => state.batch.batch === batch)) throw new Refusal(noSuchBatch(batch, waiting.map((state) => state.batch.batch)), EXIT.configuration);
  const gone = await dropPending(ledger, waiting, batch);
  ctx.writeLine(dropped(gone.length));
  for (const { batch: id, label } of gone) ctx.writeLine(`- ${id}: ${label}`);
  // A dropped raise step leaves its follow-ups unraised: name them, so dropping never loses one silently.
  for (const { batch: id } of gone.filter((step) => step.raise)) {
    const state = waiting.find((s) => s.batch.batch === id);
    for (const item of state?.batch.followUps ?? []) if (!state?.raised.has(item.file)) ctx.writeLine(unraised(item.file, item.source));
  }
  return EXIT.ok;
}
