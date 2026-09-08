import { load, logTail, deriveStateFromEntry, setOutcome, updateCursor } from "./case-file.js";
import { IllegalStateTransition, ProvisioningFailure } from "./errors.js";
import { provisionWorktree } from "./provision.js";
import { messageOf } from "./gate-support.js";
import type { SurfaceLocation, SurfacePorts } from "./ports.js";
import type { CaseFile, CaseFileOutcome, SurfaceState } from "./schema.js";

export interface AdvanceResult {
  state: SurfaceState;
  done: boolean;
}

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
 * Escalation and abort are handled identically: no extra history entry (the
 * entries already in the log evidence the cause), an outcome, a cursor write so
 * the cursor names the terminal state the outcome records, and a fire-and-log
 * closer call for infra teardown. A teardown failure here is logged, never
 * re-triaged — the surface is already terminal.
 */
async function terminate(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  state: "ESCALATED" | "ABORTED",
  outcome: CaseFileOutcome,
): Promise<AdvanceResult> {
  await setOutcome(dir, outcome);
  await updateCursor(dir, { state });
  try {
    await ports.closer.close(
      { worktreePath: worktreeOf(caseFile, location), dir },
      { kind: outcome.kind === "closed" ? "accepted" : outcome.kind },
    );
  } catch (err) {
    console.warn(`Closer teardown failed for ${dir}: ${messageOf(err)}`);
  }
  return { state, done: true };
}

async function provisioning(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const worktreePath = worktreeOf(caseFile, location);
  try {
    await provisionWorktree(dir, location.repoPath, worktreePath, caseFile.header.surfaceId);
  } catch (err) {
    if (!(err instanceof ProvisioningFailure)) throw err;
    // Provisioning failure is infra-class and terminal: there is no worker or
    // triage move that helps, so it never reaches the caller as a throw.
    return terminate(dir, caseFile, location, ports, "ABORTED", {
      kind: "aborted",
      source: "provisioning",
      reason: err.detail,
      at: new Date().toISOString(),
    });
  }

  // The cursor advance is the commit point for "the worktree exists and belongs
  // to this surface" — provisioning has no history representation.
  await updateCursor(dir, { state: "PRE_GATING", worktreeRef: worktreePath });
  return { state: "PRE_GATING", done: false };
}

/**
 * Perform exactly one transition and commit it. Safe to call from a fresh
 * process against an existing `dir`: every branch reads pre-entry state or the
 * log tail, so a call after a crash always resumes onto a legal edge.
 */
export async function advance(
  dir: string,
  location: SurfaceLocation,
  ports: SurfacePorts,
): Promise<AdvanceResult> {
  const caseFile = await load(dir);

  // Terminal surfaces are recognised before any position is derived: escalation
  // and abort do not always append an entry, so a terminal surface's log tail
  // can still look mid-flight.
  if (caseFile.outcome) return { state: caseFile.cursor.state, done: true };

  const state = position(caseFile);
  switch (state) {
    case "PROVISIONING":
      return provisioning(dir, caseFile, location, ports);
    default:
      throw new IllegalStateTransition(dir, state, "advance");
  }
}
