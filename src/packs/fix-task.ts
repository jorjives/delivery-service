import { z } from "zod";
import { CloserRef, GateRef } from "../schema.js";
import { Finding, Severity } from "./finding.js";
import { Guards } from "./guards.js";

/** Whether a fix waits for sign-off, and how it lands once it may: decided when it was authorised, from its severity and the pack's threshold. */
export const Release = z.object({ hold: z.boolean(), landing: CloserRef });
export type Release = z.infer<typeof Release>;

/**
 * One approved problem as a task the queue runs. Its identity is its content
 * (`findQueueRun` compares it whole), so it holds nothing that changes between
 * runs: no time, no position. The project check it is judged by is part of it,
 * pinned when the fix was authorised.
 */
export const FixTask = z.object({
  intent: z.string(),
  tags: z.object({ pack: z.string(), findingId: z.string(), severity: Severity, phase: z.literal("fix"), review: z.string().optional() }),
  finding: Finding,
  /** What the fix may not touch, pinned when it was authorised. Absent on a task authorised before guards travelled with it. */
  guards: Guards.optional(),
  /** Absent `hold` and `landing`: a fix authorised before fixes could wait for sign-off. `verify` null: the project has no tests, so the problem's own check is all there is, and the fix always waits for sign-off. */
  authorisation: z.object({ verify: GateRef.nullable(), hold: z.boolean().optional(), landing: CloserRef.optional() }),
});
export type FixTask = z.infer<typeof FixTask>;

export function fixTaskFor(pack: string, finding: Finding, verify: GateRef | null, guards?: Guards, release?: Release, review?: string): FixTask {
  return {
    intent: `Fix: ${finding.title} (${finding.where.path})`,
    tags: { pack, findingId: finding.id, severity: finding.severity, phase: "fix", ...(review === undefined ? {} : { review }) },
    finding,
    ...(guards === undefined ? {} : { guards }),
    authorisation: { verify, ...release },
  };
}
