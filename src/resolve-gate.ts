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
 * `repoPath` is what a custom gate's relative `modulePath` resolves against.
 * It is required: a caller that omitted it would silently resolve the gate
 * against wherever the process happens to be running, which during a surface
 * run is the worktree the gate is meant to judge (see `run-gate.ts`).
 */
export function resolveGate(gateRef: GateRef, repoPath: string): Gate {
  const parsed = GateRef.safeParse(gateRef);
  if (!parsed.success) {
    return failedGate(`Cannot resolve gate reference: ${parsed.error.message}`);
  }

  const ref = parsed.data;
  return ref.type === "command"
    ? createCommandGate(ref.command, ref.parseMode, undefined, ref)
    : createCustomGate(repoPath, ref.modulePath, ref.exportName);
}
