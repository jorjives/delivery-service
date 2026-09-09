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
export interface RoleConfig extends RoleHandle {
  /** Role identity and domain context. Becomes the session's system prompt. */
  systemPromptFragment: string;
  /** The reply shape this role may emit. Also constrains the SDK's output. */
  envelopeSchema: z.ZodType<Envelope>;
  /** The authored, positive tool list. This role's entire blast radius. */
  allowedTools: string[];
  /**
   * Reserved for per-invocation SDK-level resource caps. Deliberately untyped
   * and unused: the budget design owns the field names, and guessing at them
   * here would bake in a contract nothing has verified.
   */
  budgets?: Record<string, unknown>;
}

/**
 * The reference worker configuration. An extender copies this, changes the
 * domain sentences in the fragment, and has a working role.
 */
export const workerRoleConfig: RoleConfig = {
  role: "worker",
  systemPromptFragment: [
    "You are the worker on a gated delivery harness.",
    "You make the smallest change to the working tree that satisfies the task below.",
    "You do not run, edit, or reason about the project's gate: a separate, pinned gate",
    "judges your work, and you cannot see or influence it.",
    "If you cannot proceed and no further attempt would help, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};

const RoleConfigShape = z.object({
  role: z.enum(["worker", "triage", "gate-maintenance"] as const satisfies readonly AgentRole[]),
  systemPromptFragment: z.string().min(1),
  envelopeSchema: z.custom<z.ZodType<Envelope>>((value) => value instanceof z.ZodType, {
    message: "must be a zod schema",
  }),
  allowedTools: z.array(z.string().min(1)).min(1),
  budgets: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Check a role config before any session is spawned, and name the field that is
 * wrong. An extender's first mistake is a typo in a config, and finding it
 * costs nothing here versus a confusing session failure later.
 */
export function validateRoleConfig(cfg: RoleConfig): void {
  const result = RoleConfigShape.safeParse(cfg);
  if (result.success) return;
  const { issues } = result.error;
  const firstIssue = issues.at(0);
  if (firstIssue === undefined) return;
  throw new InvalidRoleConfig(firstIssue.path.join(".") || "(root)", firstIssue.message);
}
