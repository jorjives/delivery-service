import { z } from "zod";
import { GateRef } from "../schema.js";
import { Finding, Severity } from "./finding.js";

/**
 * One approved problem as a task the queue runs. Its identity is its content
 * (`findQueueRun` compares it whole), so it holds nothing that changes between
 * runs: no time, no position. The project check it is judged by is part of it,
 * pinned when the fix was authorised.
 */
export const FixTask = z.object({
  intent: z.string(),
  tags: z.object({ pack: z.string(), findingId: z.string(), severity: Severity, phase: z.literal("fix") }),
  finding: Finding,
  authorisation: z.object({ verify: GateRef }),
});
export type FixTask = z.infer<typeof FixTask>;

export function fixTaskFor(pack: string, finding: Finding, verify: GateRef): FixTask {
  return {
    intent: `Fix: ${finding.title} (${finding.where.path})`,
    tags: { pack, findingId: finding.id, severity: finding.severity, phase: "fix" },
    finding,
    authorisation: { verify },
  };
}
