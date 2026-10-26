import { PACK_HASH_LABEL } from "../packs/install/lock.js";
import type { CommandContext } from "./context.js";
import type { Ask, ConfirmQuestion } from "./init.js";

/** Whether a fingerprint given on the command line is this pack's: the bare hash, or the hash under its label, and nothing else. */
export function approvalMatches(given: string, hash: string): boolean {
  return given === hash || given === PACK_HASH_LABEL + hash;
}

/** The owner's answer, or the one thing that stands in for it: a fingerprint that differs, or nobody to ask. */
export type Approval = "yes" | "no" | "nobody" | "differs";

/**
 * Whether a pack is approved. A fingerprint given is compared exactly and nothing is asked; without one, a person at a
 * terminal is asked, and nobody else (a pipe, or `--json`) is refused rather than answered for them.
 */
export async function decideApproval(given: string | undefined, hash: string, ctx: CommandContext, ask: Ask, question: ConfirmQuestion): Promise<Approval> {
  if (given !== undefined) return approvalMatches(given, hash) ? "yes" : "differs";
  if (ctx.json || ctx.stdin.isTTY !== true) return "nobody";
  return (await ask.confirm(question)) ? "yes" : "no";
}
