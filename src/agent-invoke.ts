import { query, type CanUseTool, type Options, type SDKAssistantMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { load, writeRef } from "./case-file.js";
import { assemblePrompt, resolveEvidence, type AssembledPrompt } from "./prompt-assembly.js";
import { validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import type { AgentContext, AgentPort, DispatchedRole, RoleHandle, Incomplete, Metered } from "./ports.js";
import { USAGE_LIMIT_WORDS } from "./ports.js";
import { authorityRefusal, createToolAuthority } from "./tool-authority.js";
import { messageOf } from "./gate-support.js";
import type { TriageEnvelope } from "./triage-role-config.js";
import type { UsageLimit, SessionUsage } from "./schema.js";
import type { JsonSchema } from "./report/json-schema.js";

/**
 * The four ways a session fails to produce a usable answer, and the one
 * sentence each is reported with.
 *
 * They collapse to a single terminus on purpose — the control flow treats "the
 * agent never cleanly signalled" as one edge, whatever the cause — but the
 * reason distinguishes them, because a project owner reading the case file has
 * to be able to tell a crash from a bad reply without an engineer. Fixed
 * strings, never an exception message: a stack trace in the log tells that
 * reader nothing and leaks harness internals.
 *
 * `notRun` is the one the edge itself has to act on rather than merely report:
 * it alone means no session happened, so it alone cannot be retried into a
 * different answer. It carries the `notRun` mark on the terminus for that.
 *
 * A session that ended in an error because a usage limit stopped it is not
 * reported with `errored` but with the limit's own fixed words
 * (`USAGE_LIMIT_WORDS`), and carries the `limit` mark: it is the service
 * declining, not the session failing.
 */
export const DID_NOT_COMPLETE = {
  errored: "the session ended in an error before it reported a result",
  noEnvelope: "the session ended without reporting a result",
  wrongShape: "the session replied with something that is not a valid result for this role",
  notRun: "the session could not be started or run to completion",
} as const;

/**
 * The one place an incomplete terminus is built, so the `notRun` mark is
 * derived from the reason rather than remembered at each of the four call
 * sites. `notRun` is the only reason of the four that says no session happened
 * — nothing ran, so nothing between attempts can differ — and the routing layer
 * needs that as a fact it can act on, not only as a sentence it cannot read.
 */
function incomplete(roleCfg: RoleConfig<unknown>, reason: string, limit?: UsageLimit): Incomplete {
  return {
    status: "incomplete",
    rationale: `${roleCfg.role} session did not complete: ${reason}`,
    ...(reason === DID_NOT_COMPLETE.notRun ? { notRun: true as const } : {}),
    ...(limit ? { limit } : {}),
  };
}

/**
 * Where a session's failure cause is kept: a ref beside the case file, named
 * after the session that produced it. An escalation packet already lists every
 * dispatch's session key under `references`, so a person holding one can find
 * the record without being told the convention.
 */
export function sessionErrorRef(sessionKey: string): string {
  return `session-error-${sessionKey}`;
}

/** The runtime's own words about a session that ended badly, from either result shape. */
function errorTextOf(result: SDKResultMessage): string {
  return result.subtype === "success" ? result.result : result.errors.join("\n");
}

/**
 * Whether a usage limit is what stopped the session, and which. Read from what
 * the runtime types (the assistant message's `error`, the result's API status)
 * and then from the API's own machine identifiers in the error text, which is
 * all a scripted session can produce. Never from prose: a session that merely
 * talks about limits is not stopped by one. A spend cap is also a 429, so it is
 * looked for first; an overloaded or failing service is not a usage limit.
 */
// ponytail: classification only. A limited session is retried like any incomplete one, with no backoff; add
// retry-after backoff with the host resource governor the design defers (spec section 9).
export function usageLimitOf({ apiError, status, text }: { apiError: string | undefined; status: number | null | undefined; text: string }): UsageLimit | undefined {
  if (apiError === "billing_error" || /enforced_spend_limit_reached|billing_error/.test(text)) return "spend";
  if (apiError === "rate_limit" || status === 429 || text.includes("rate_limit_error")) return "rate";
  return undefined;
}

/**
 * What the runtime reported a session cost and took, from its result message.
 * A figure that is not a finite, non-negative number is left out rather than
 * recorded: it is the runtime's output, and the record would refuse it.
 */
export function usageOf(result: Pick<SDKResultMessage, "total_cost_usd" | "duration_ms">): SessionUsage {
  const { total_cost_usd: cost, duration_ms: duration } = result;
  return {
    ...(Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}),
    ...(Number.isFinite(duration) && duration >= 0 ? { durationMs: Math.round(duration) } : {}),
  };
}

/** How much of an unusable reply is kept: enough to diagnose, never a runaway file. */
const REPLY_LIMIT = 4_000;

/** Cut untrusted model output to size, saying how much was dropped. */
function truncateReply(reply: string): string {
  if (reply.length <= REPLY_LIMIT) return reply;
  return `${reply.slice(0, REPLY_LIMIT)}… [truncated: ${reply.length - REPLY_LIMIT} more characters]`;
}

/**
 * What is kept about a session that produced nothing usable. `cause` is the
 * runtime's or the harness's own account; `agentReply` is the agent's words,
 * kept apart and truncated because they are untrusted model output, not a
 * harness diagnosis.
 */
interface FailureEvidence {
  cause?: string;
  agentReply?: string;
}

/**
 * Keep the cause of a session that produced nothing usable where a person can
 * find it.
 *
 * Keeping it out of the rationale is not licence to destroy it. The fixed
 * sentences above are right for the *reader* of a case file, but the runtime's
 * own words are the only evidence of why a session would not start, and the
 * agent's own unusable reply is the only evidence of how it failed its role —
 * discarding either leaves no diagnosis path short of patching the built
 * harness by hand.
 *
 * Best effort on purpose: this is evidence, not an outcome. A failed write is a
 * disk problem with nowhere left to report it, and must never turn a session
 * that merely did not complete into a throw out of `invoke()`.
 */
async function recordFailureCause(
  roleCfg: RoleConfig<unknown>,
  ctx: AgentContext,
  reason: string,
  { cause, agentReply }: FailureEvidence,
): Promise<void> {
  if (!cause && !agentReply) return;
  try {
    await writeRef(ctx.dir, sessionErrorRef(ctx.sessionKey), {
      sessionKey: ctx.sessionKey,
      role: roleCfg.role,
      reason,
      ...(cause ? { cause } : {}),
      ...(agentReply ? { agentReply: truncateReply(agentReply) } : {}),
    });
  } catch {
    // The evidence is already lost with the disk that would hold it.
  }
}

/**
 * The only session settings a caller may supply: where the CLI binary is, and
 * what environment it runs with. Deliberately an allowlist rather than a
 * `Partial<Options>` with the permission fields written back over it — a
 * deny-list silently widens the day the SDK adds an option, and the whole
 * point of this seam is that a role's authority cannot be widened from
 * outside.
 */
export interface SessionEnvironment {
  pathToClaudeCodeExecutable?: string;
  env?: Record<string, string | undefined>;
}

/**
 * The runtime hands the reply schema to the API as a tool's input schema, whose
 * root must be typed as an object and carry no oneOf, anyOf or allOf. A union
 * envelope converts to a root `oneOf` of objects, so its branches are merged into
 * one object: each property takes its single schema, or an `anyOf` of the
 * distinct ones, and is required only where every branch requires it. That is
 * looser than the union, never stricter: the envelope schema still judges the
 * reply exactly when it comes back, and a mismatch is an incomplete attempt.
 */
function asApiRoot(schema: JsonSchema): JsonSchema {
  const branches = schema.oneOf as JsonSchema[] | undefined;
  if (!branches) return schema;
  const rest = { ...schema };
  delete rest.oneOf;
  const variants = new Map<string, JsonSchema[]>();
  for (const branch of branches) {
    for (const [key, property] of Object.entries((branch.properties ?? {}) as Record<string, JsonSchema>)) {
      const seen = variants.get(key) ?? [];
      if (!seen.some((other) => JSON.stringify(other) === JSON.stringify(property))) seen.push(property);
      variants.set(key, seen);
    }
  }
  const properties = Object.fromEntries(
    [...variants].map(([key, seen]) => [key, seen.length === 1 ? seen[0] : { anyOf: seen }]),
  );
  const required = [...variants.keys()].filter((key) =>
    branches.every((branch) => ((branch.required ?? []) as string[]).includes(key)),
  );
  return { ...rest, type: "object", properties, required, additionalProperties: false };
}

/**
 * Assemble the session's options field by field.
 *
 * `tools` is left alone on purpose: narrowing it to the role's list removes
 * out-of-role tools from the session entirely, so the model never issues the
 * call and there is nothing to refuse or report. `allowedTools` is left unset
 * for the mirror-image reason — a bare entry auto-approves before `canUseTool`
 * is consulted. Authority is decided in exactly one place, and the surrounding
 * routes to a decision are pinned shut: no filesystem settings, a fixed
 * permission mode, prompts answered by this process, no hooks, no plugins.
 */
export function buildSessionOptions(
  roleCfg: RoleConfig<unknown>,
  ctx: AgentContext,
  session: SessionEnvironment,
  canUseTool: CanUseTool,
  systemPrompt = "",
): Options {
  // Zod stamps a `$schema` meta-schema URI on the root, which the Claude Code
  // binary cannot resolve and rejects outright, failing every session before
  // the model is reached. The schema itself is unchanged by dropping it.
  const schema = asApiRoot(z.toJSONSchema(roleCfg.envelopeSchema));
  delete schema.$schema;
  return {
    cwd: ctx.worktreePath,
    systemPrompt,
    outputFormat: { type: "json_schema", schema },
    canUseTool,
    settingSources: [],
    permissionMode: "default",
    permissionPrompts: "host",
    pathToClaudeCodeExecutable: session.pathToClaudeCodeExecutable,
    env: session.env,
  };
}

/**
 * One agent session in, exactly one result out.
 *
 * The primitive never retries and never branches on role: it loads a case file,
 * assembles the prompt from it, then calls `runSession` to run the session and
 * validate the result.
 *
 * Throws, before any session is spawned, for exactly two kinds of problem that
 * are the run's rather than the agent's:
 * - `InvalidRoleConfig` for a malformed config. An extender's typo is a
 *   programming error, not a run outcome: reporting it as `incomplete` would
 *   hide it behind a retry budget.
 * - The case-file errors (`FileNotFound`, `CorruptCaseFile`, or the raw I/O
 *   error) when the case file or a ref it points at cannot be read. A terminus
 *   is reported into that same case file, so an unreadable one has nowhere to
 *   receive it.
 *
 * Every *agent* outcome, success or failure, returns as the role's envelope or
 * an incomplete terminus, carrying `usage` whenever the runtime produced a result.
 */
export async function invoke<E>(
  roleCfg: RoleConfig<E>,
  ctx: AgentContext,
  session: SessionEnvironment = {},
): Promise<Metered<E | Incomplete>> {
  // Validated before the case file is read, so a config typo is reported as itself, never as a missing record.
  validateRoleConfig(roleCfg);
  const caseFile = await load(ctx.dir);
  const assembled = assemblePrompt(caseFile, roleCfg, await resolveEvidence(ctx.dir, caseFile));
  return runSession(roleCfg, ctx, assembled, session);
}

/**
 * One agent session from a prompt the caller has already assembled: `invoke`
 * assembles it from a case file; a review, which has no case file, builds its
 * own. Everything about the session itself lives here, so every role, with or
 * without a case file, gets the same tool guard, the same structured-output
 * enforcement and re-validation, and the same failure evidence, written to
 * `ctx.dir`'s refs.
 */
export async function runSession<E>(
  roleCfg: RoleConfig<E>,
  ctx: AgentContext,
  { systemPrompt, prompt }: AssembledPrompt,
  session: SessionEnvironment = {},
): Promise<Metered<E | Incomplete>> {
  validateRoleConfig(roleCfg);
  const authority = createToolAuthority(roleCfg, ctx.worktreePath);
  const options = buildSessionOptions(roleCfg, ctx, session, authority.canUseTool, systemPrompt);

  let result: SDKResultMessage | undefined;
  let apiError: SDKAssistantMessage["error"];
  try {
    ({ result, apiError } = await sessionEnd(prompt, options));
  } catch (err) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.notRun, { cause: messageOf(err) });
    return authorityRefusal(roleCfg, authority.refusals, []) ?? incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  }

  // Whatever the session ended as, if it produced a result the runtime said what it cost and took.
  const usage = result === undefined ? undefined : usageOf(result);
  const metered = <T>(terminus: T): Metered<T> => (usage === undefined ? terminus : { ...terminus, usage }) as Metered<T>;

  const refusal = authorityRefusal(roleCfg, authority.refusals, result?.permission_denials ?? []);
  if (refusal) return metered(refusal);

  if (!result) return incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  if (result.subtype !== "success" || result.is_error) {
    const cause = errorTextOf(result);
    const limit = usageLimitOf({ apiError, status: result.subtype === "success" ? result.api_error_status : undefined, text: cause });
    const reason = limit ? USAGE_LIMIT_WORDS[limit] : DID_NOT_COMPLETE.errored;
    await recordFailureCause(roleCfg, ctx, reason, { cause });
    return metered(incomplete(roleCfg, reason, limit));
  }
  if (result.structured_output === undefined) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.noEnvelope, { agentReply: result.result });
    return metered(incomplete(roleCfg, DID_NOT_COMPLETE.noEnvelope));
  }

  const envelope = roleCfg.envelopeSchema.safeParse(result.structured_output);
  if (!envelope.success) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.wrongShape, {
      cause: z.prettifyError(envelope.error),
      agentReply: JSON.stringify(result.structured_output),
    });
    return metered(incomplete(roleCfg, DID_NOT_COMPLETE.wrongShape));
  }

  // A valid envelope IS the terminus — see `Envelope` in role-config.ts.
  return metered(envelope.data);
}

/**
 * Drive the session to its end and keep the result message, and the last
 * error the runtime typed on an assistant message. The stream is drained
 * rather than broken out of, so the child process is never left behind.
 */
async function sessionEnd(prompt: string, options: Options): Promise<{ result: SDKResultMessage | undefined; apiError: SDKAssistantMessage["error"] }> {
  let result: SDKResultMessage | undefined;
  let apiError: SDKAssistantMessage["error"];
  for await (const message of query({ prompt, options })) {
    if (message.type === "assistant" && message.error !== undefined) apiError = message.error;
    if (message.type === "result") result = message;
  }
  return { result, apiError };
}

/** The pinned configuration for every role a surface dispatches. */
export interface RoleConfigs {
  worker: RoleConfig;
  "gate-maintenance": RoleConfig;
  triage: RoleConfig<TriageEnvelope>;
}

/**
 * The SDK-backed `AgentPort`: a role name in, that role's pinned config through
 * the one `invoke()` seam, its terminus out. `session` is passed through
 * unchanged, so a test or demo can point every role at `claude-mock`.
 */
export function createAgentPort(configs: RoleConfigs, session: SessionEnvironment = {}): AgentPort {
  // One cast: TypeScript cannot correlate `configs[role]`'s envelope type with
  // RoleTerminusMap[R] across a generic key. RoleConfigs pins that mapping.
  const run = (roleCfg: RoleHandle & { role: DispatchedRole }, ctx: AgentContext) =>
    invoke(configs[roleCfg.role] as RoleConfig<unknown>, ctx, session);
  return { invoke: run as AgentPort["invoke"] };
}
