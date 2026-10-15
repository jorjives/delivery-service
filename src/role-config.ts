import { z } from "zod";
import { InvalidRoleConfig } from "./errors.js";
import type { AgentRole, RoleHandle, Terminus } from "./ports.js";

/**
 * A valid reply from a worker or gate-maintenance session. Structurally it is
 * exactly a `Terminus` minus `incomplete` — `incomplete` is the harness's own
 * verdict on a session that produced nothing usable, never something an agent
 * may claim for itself — so mapping a parsed envelope to a terminus is the
 * identity. Deriving the type is what stops the two drifting apart.
 */
export type Envelope = Exclude<Terminus, { status: "incomplete" }>;

/**
 * The worker's legal statuses. A discriminated union, matching `GateRef` in
 * `schema.ts` — this codebase's one way of saying "one of these shapes".
 *
 * Strictness here is a security boundary, not tidiness: a worker that emits a
 * triage status (`reroute`, `fix_the_gate`, ...) fails this parse and becomes
 * INCOMPLETE_TERMINUS, so a confused or adversarial worker cannot route itself.
 */
export const WorkerEnvelope = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    rationale: z.string().min(1),
  }),
  z.object({
    status: z.literal("escalate"),
    category: z.enum(["exhaustion", "authority"]),
    rationale: z.string().min(1),
  }),
]) satisfies z.ZodType<Envelope>;

/**
 * Everything pinned about one role for the length of a run: out of every
 * agent's reach, and the only thing that varies between roles. The invocation
 * primitive itself never branches on `role`.
 */
export interface RoleConfig<E = Envelope> extends RoleHandle {
  /** Role identity and domain context. Becomes the session's system prompt. */
  systemPromptFragment: string;
  /** The reply shape this role may emit. Also constrains the SDK's output. */
  envelopeSchema: z.ZodType<E>;
  /**
   * Reserved for per-invocation SDK-level resource caps. Deliberately untyped
   * and unused: the budget design owns the field names, and guessing at them
   * here would bake in a contract nothing has verified.
   */
  budgets?: Record<string, unknown>;
}

/**
 * The reference worker configuration: the harness's context for the session,
 * appended to Claude Code's own system prompt. An extender copies this and
 * changes the sentences.
 */
export const workerRoleConfig: RoleConfig = {
  role: "worker",
  systemPromptFragment: [
    "You are carrying out one task for a delivery harness, in a working copy and branch it made for this task.",
    "Work as you normally would, with your own tools, skills and judgement.",
    "If you cannot finish and no further attempt would help, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
};

/** The reference gate-maintenance configuration. Same seam, same reply shape as the worker; only the content differs. */
export const gateMaintenanceRoleConfig: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: [
    "The project's check could not run in this working copy, so the delivery harness asked you to repair it.",
    "Repair the environment (configuration, fixtures, dependency manifests) so that the check can run.",
    "The check's own definition is verified unchanged afterward, so you do not need to protect it yourself; focus on the environment around it.",
    "Deleting, renaming or skipping a test, or hiding one from git, is refused, and so is a change to the check's own module.",
    "A change to how tests run (a test-runner setting, a CI file, the test script) is allowed for a repair, and is shown to the person afterwards.",
    "If only a change to the check would fix it, escalate instead.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
};

const RoleConfigShape = z.object({
  role: z.enum(["worker", "triage", "gate-maintenance", "scanner"] as const satisfies readonly AgentRole[]),
  systemPromptFragment: z.string().min(1),
  envelopeSchema: z.custom<z.ZodType<unknown>>((value) => value instanceof z.ZodType, {
    message: "must be a zod schema",
  }),
  budgets: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Check a role config before any session is spawned, and name the field that is
 * wrong. An extender's first mistake is a typo in a config, and finding it
 * costs nothing here versus a confusing session failure later.
 */
export function validateRoleConfig(cfg: RoleConfig<unknown>): void {
  const result = RoleConfigShape.safeParse(cfg);
  if (result.success) return;
  const { issues } = result.error;
  const firstIssue = issues.at(0);
  if (firstIssue === undefined) return;
  throw new InvalidRoleConfig(firstIssue.path.join(".") || "(root)", firstIssue.message);
}
