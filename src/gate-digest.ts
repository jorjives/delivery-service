import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Assertion, CaseFileHeader, GateRef } from "./schema.js";
import { messageOf } from "./gate-support.js";

export const GATE_GUARD = "guard:gate-unchanged";

/**
 * A hash of a custom gate's module, read where the run loads it from (the main checkout). Undefined for a command
 * gate. ponytail: the module alone is hashed, not what it imports; hash its folder if a gate split across files is seen.
 */
export async function gateDigestOf(gateRef: GateRef, repoPath: string): Promise<string | undefined> {
  if (gateRef.type !== "custom") return undefined;
  return createHash("sha256").update(await readFile(resolve(repoPath, gateRef.modulePath))).digest("hex");
}

/** Whether the gate's module is as it was when the run started, as one more result. Unreadable is a failure, never a pass. */
export async function integrityOf(header: CaseFileHeader, repoPath: string): Promise<Assertion[]> {
  if (header.gateDigest === undefined || header.gateRef.type !== "custom") return [];
  const where = header.gateRef.modulePath;
  let now: string | undefined;
  try {
    now = await gateDigestOf(header.gateRef, repoPath);
  } catch (err) {
    return [{ id: GATE_GUARD, outcome: "FAIL", detail: `Refused: the check ${where} could not be read to confirm it is unchanged: ${messageOf(err)}` }];
  }
  return now === header.gateDigest
    ? [{ id: GATE_GUARD, outcome: "PASS", detail: "the check is unchanged" }]
    : [{ id: GATE_GUARD, outcome: "FAIL", detail: `Refused: the check ${where} has changed since this task started. Put it back; the work is judged by the check as it was.` }];
}
