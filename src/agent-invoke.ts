import { query, type CanUseTool, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { load, writeRef } from "./case-file.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import type { AgentContext, AgentPort, RoleHandle, Incomplete } from "./ports.js";
import { authorityRefusal, createToolAuthority } from "./tool-authority.js";
import { messageOf } from "./gate-support.js";
import type { TriageEnvelope } from "./triage-role-config.js";

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
function incomplete(roleCfg: RoleConfig<unknown>, reason: string): Incomplete {
  return {
    status: "incomplete",
    rationale: `${roleCfg.role} session did not complete: ${reason}`,
    ...(reason === DID_NOT_COMPLETE.notRun ? { notRun: true as const } : {}),
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
  const schema = z.toJSONSchema(roleCfg.envelopeSchema);
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
 * The primitive never retries and never branches on role: it assembles the
 * prompt, spawns one fresh session (no resume, no session id — sessions are
 * reconstructed from the case file, never continued), and validates whatever
 * came back. `session` exists so a test or demo can point the SDK at
 * `claude-mock` instead of the real CLI; it can name the binary and its
 * environment and nothing else, so a caller can never widen what the role may do.
 *
 * An out-of-role tool call outranks every other outcome. A session that reached
 * outside its authority is reported as that refusal even if it went on to emit a
 * clean envelope: the boundary event is the thing a reader must not miss, and a
 * "completed" that quietly swallowed a refusal would be the harness hiding its
 * own security boundary from the person relying on it.
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
 * an incomplete terminus.
 */
export async function invoke<E>(
  roleCfg: RoleConfig<E>,
  ctx: AgentContext,
  session: SessionEnvironment = {},
): Promise<E | Incomplete> {
  validateRoleConfig(roleCfg);

  const caseFile = await load(ctx.dir);
  const { systemPrompt, prompt } = assemblePrompt(
    caseFile,
    roleCfg,
    await resolveEvidence(ctx.dir, caseFile),
  );

  const authority = createToolAuthority(roleCfg, ctx.worktreePath);
  const options = buildSessionOptions(roleCfg, ctx, session, authority.canUseTool, systemPrompt);

  let result: SDKResultMessage | undefined;
  try {
    result = await lastResult(prompt, options);
  } catch (err) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.notRun, { cause: messageOf(err) });
    return authorityRefusal(roleCfg, authority.refusals, []) ?? incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  }

  const refusal = authorityRefusal(roleCfg, authority.refusals, result?.permission_denials ?? []);
  if (refusal) return refusal;

  if (!result) return incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  if (result.subtype !== "success" || result.is_error) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.errored, { cause: errorTextOf(result) });
    return incomplete(roleCfg, DID_NOT_COMPLETE.errored);
  }
  if (result.structured_output === undefined) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.noEnvelope, { agentReply: result.result });
    return incomplete(roleCfg, DID_NOT_COMPLETE.noEnvelope);
  }

  const envelope = roleCfg.envelopeSchema.safeParse(result.structured_output);
  if (!envelope.success) {
    await recordFailureCause(roleCfg, ctx, DID_NOT_COMPLETE.wrongShape, {
      cause: z.prettifyError(envelope.error),
      agentReply: JSON.stringify(result.structured_output),
    });
    return incomplete(roleCfg, DID_NOT_COMPLETE.wrongShape);
  }

  // A valid envelope IS the terminus — see `Envelope` in role-config.ts.
  return envelope.data;
}

/**
 * Drive the session to its end and keep the result message. The stream is
 * drained rather than broken out of, so the child process is never left behind.
 */
async function lastResult(prompt: string, options: Options): Promise<SDKResultMessage | undefined> {
  let result: SDKResultMessage | undefined;
  for await (const message of query({ prompt, options })) {
    if (message.type === "result") result = message;
  }
  return result;
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
  const run = (roleCfg: RoleHandle, ctx: AgentContext) =>
    invoke(configs[roleCfg.role] as RoleConfig<unknown>, ctx, session);
  return { invoke: run as AgentPort["invoke"] };
}
