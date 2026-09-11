import type { Gate } from "./command-gate.js";
import { createCommandGate } from "./command-gate.js";
import { createCustomGate } from "./custom-gate.js";
import { failedGate } from "./gate-support.js";
import { GateRef } from "./schema.js";

/**
 * Turn a pinned gate reference into a runnable gate. Total: an unparseable
 * reference (unknown type, unsupported parse mode) yields a gate that returns
 * an ERROR report from both methods, so resolution failure and run failure
 * reach the caller in the same shape.
 *
 * `baseDir` is what a custom gate's relative `modulePath` resolves against; it
 * defaults to the current working directory. A surface run passes its repo
 * root, never the worktree (see `run-gate.ts`).
 */
export function resolveGate(gateRef: GateRef, baseDir?: string): Gate {
  const parsed = GateRef.safeParse(gateRef);
  if (!parsed.success) {
    return failedGate(`Cannot resolve gate reference: ${parsed.error.message}`);
  }

  const ref = parsed.data;
  return ref.type === "command"
    ? createCommandGate(ref.command, ref.parseMode)
    : createCustomGate(ref.modulePath, ref.exportName, baseDir);
}
