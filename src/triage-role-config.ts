import { z } from "zod";
import { READ_ONLY_TOOLS, type RoleConfig } from "./role-config.js";

/**
 * What a retried session is told: what is failing, what earlier attempts tried
 * and why each missed, what to touch, where to look, and triage's diagnosis.
 * There is deliberately no `evidence` field: the prompt's `## Gate evidence`
 * slot renders the newly-failing assertions verbatim on every dispatch, so the
 * synthesis always arrives beside the ground truth and never replaces it.
 */
export const SharpenedBrief = z.object({
  problem: z.string().min(1),
  dead_ends: z.string().min(1),
  scope: z.string().min(1),
  references: z.array(z.string()),
  diagnosis: z.string().min(1),
});
export type SharpenedBrief = z.infer<typeof SharpenedBrief>;

/** Same job as the brief; the next session is gate maintenance. */
export const GateRepairBrief = SharpenedBrief;
export type GateRepairBrief = SharpenedBrief;

/** Same job as the brief; persisted for the closer. */
export const CloseRepairBrief = SharpenedBrief;
export type CloseRepairBrief = SharpenedBrief;

/** What a human reads at ESCALATED. Carries evidence: a human has no gate-evidence slot. */
export const EscalationPacket = z.object({
  decision: z.string().min(1),
  evidence: z.string().min(1),
  dead_ends: z.string().min(1),
  why_now: z.string().min(1),
  references: z.array(z.string()),
});
export type EscalationPacket = z.infer<typeof EscalationPacket>;

/**
 * A valid reply from a triage session. Uses the universal envelope field
 * `status`; the case file's `TriageEntry` calls it `verdict`, and
 * `toTriageVerdict` in `triage.ts` is the only place that translates.
 */
export const TriageEnvelope = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reroute"), rationale: z.string().min(1), payload: SharpenedBrief }),
  z.object({ status: z.literal("escalate"), rationale: z.string().min(1), payload: EscalationPacket }),
  z.object({ status: z.literal("fix_the_gate"), rationale: z.string().min(1), payload: GateRepairBrief }),
  z.object({ status: z.literal("retry_close"), rationale: z.string().min(1), payload: CloseRepairBrief }),
  z.object({ status: z.literal("abort"), rationale: z.string().min(1), payload: z.object({ reason: z.string().min(1) }) }),
]);
export type TriageEnvelope = z.infer<typeof TriageEnvelope>;

/** The reference triage configuration: a read-only classifier. */
export const triageRoleConfig: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: [
    "You are triage on a gated delivery harness: a read-only classifier.",
    "A worker, the gate, or the closer has hit a setback. Read the setback, the remaining",
    "budgets, and what earlier rounds decided, then choose what happens next.",
    "You never edit anything. You never overturn a passing gate or a worker's report that it",
    "lacked authority.",
    "On a reroute, write a brief the next worker cannot derive for itself: what earlier",
    "attempts tried and why each missed, what to touch and what to leave.",
    "On fix_the_gate, write the brief for the repair session: what the gate could not do and",
    "what in the environment to repair. The repair session never edits the checks themselves.",
    "Your diagnosis is a hypothesis for the next session to test, not an established fact.",
  ].join("\n"),
  envelopeSchema: TriageEnvelope,
  allowedTools: [...READ_ONLY_TOOLS],
};
