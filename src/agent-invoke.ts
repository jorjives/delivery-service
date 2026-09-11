import { query, type CanUseTool, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { load } from "./case-file.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import type { AgentContext, Terminus, Incomplete } from "./ports.js";
import { authorityRefusal, createToolAuthority } from "./tool-authority.js";

/**
 * The four ways a session fails to produce a usable answer, and the one
 * sentence each is reported with.
 *
 * They collapse to a single terminus on purpose — the control flow treats "the
 * agent never cleanly signalled" as one edge with one budget, whatever the
 * cause — but the reason distinguishes them, because a project owner reading
 * the case file has to be able to tell a crash from a bad reply without an
 * engineer. Fixed strings, never an exception message: a stack trace in the log
 * tells that reader nothing and leaks harness internals.
 */
export const DID_NOT_COMPLETE = {
  errored: "the session ended in an error before it reported a result",
  noEnvelope: "the session ended without reporting a result",
  wrongShape: "the session replied with something that is not a valid result for this role",
  notRun: "the session could not be started or run to completion",
} as const;

function incomplete(roleCfg: RoleConfig<unknown>, reason: string): Incomplete {
  return { status: "incomplete", rationale: `${roleCfg.role} session did not complete: ${reason}` };
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
  return {
    cwd: ctx.worktreePath,
    systemPrompt,
    outputFormat: { type: "json_schema", schema: z.toJSONSchema(roleCfg.envelopeSchema) },
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
 * Throws `InvalidRoleConfig` — and only that — for a malformed config, before any
 * session is spawned. An extender's typo is a programming error, not a run
 * outcome: reporting it as `incomplete` would hide it behind a retry budget.
 * Every *agent* outcome, success or failure, returns as the role's envelope or an incomplete terminus.
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
  } catch {
    return authorityRefusal(roleCfg, authority.refusals, []) ?? incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  }

  const refusal = authorityRefusal(roleCfg, authority.refusals, result?.permission_denials ?? []);
  if (refusal) return refusal;

  if (!result) return incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  if (result.subtype !== "success" || result.is_error) {
    return incomplete(roleCfg, DID_NOT_COMPLETE.errored);
  }
  if (result.structured_output === undefined) {
    return incomplete(roleCfg, DID_NOT_COMPLETE.noEnvelope);
  }

  const envelope = roleCfg.envelopeSchema.safeParse(result.structured_output);
  if (!envelope.success) return incomplete(roleCfg, DID_NOT_COMPLETE.wrongShape);

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
