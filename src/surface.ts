import { load, logTail, deriveStateFromEntry } from "./case-file.js";
import { IllegalStateTransition } from "./errors.js";
import type { SurfaceLocation, SurfacePorts } from "./ports.js";
import type { CaseFile, SurfaceState } from "./schema.js";

export interface AdvanceResult {
  state: SurfaceState;
  done: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function worktreeOf(caseFile: CaseFile, location: SurfaceLocation): string {
  // `create` writes worktreeRef: "" — the "not yet provisioned" sentinel.
  return caseFile.cursor.worktreeRef || location.worktreePath;
}

/**
 * Where the surface actually is, derived rather than trusted.
 *
 * Before the first worker dispatch there are no worker log entries to read, so
 * the header's set-once `baseline` and the cursor are authoritative — this is
 * the one segment of the loop where that is true. Once a baseline exists the
 * surface is ready for a worker.
 *
 * Slice 1 stops here: no worker entry is ever written, so "baselined" and
 * "waiting for its first worker dispatch" are the same thing. Slice 2 replaces
 * the `AGENT_ACTIVE` arm with the design spec's full rule — once a worker
 * dispatch entry exists, position comes from `deriveStateFromEntry(logTail)`.
 */
function position(caseFile: CaseFile): SurfaceState {
  if (caseFile.header.baseline === null) {
    const tail = logTail(caseFile);
    if (tail) return deriveStateFromEntry(tail);
    return caseFile.cursor.state === "PROVISIONING" ? "PROVISIONING" : "PRE_GATING";
  }
  return "AGENT_ACTIVE";
}

/**
 * Perform exactly one transition and commit it. Safe to call from a fresh
 * process against an existing `dir`: every branch reads pre-entry state or the
 * log tail, so a call after a crash always resumes onto a legal edge.
 */
export async function advance(
  dir: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  location: SurfaceLocation,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const caseFile = await load(dir);

  // Terminal surfaces are recognised before any position is derived: escalation
  // and abort do not always append an entry, so a terminal surface's log tail
  // can still look mid-flight.
  if (caseFile.outcome) return { state: caseFile.cursor.state, done: true };

  const state = position(caseFile);
  switch (state) {
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
}
