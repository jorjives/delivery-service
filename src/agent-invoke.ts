import { query, type Options, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { load } from "./case-file.js";
import { assemblePrompt, resolveEvidence } from "./prompt-assembly.js";
import { validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import type { AgentContext, Terminus } from "./ports.js";

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

function incomplete(roleCfg: RoleConfig, reason: string): Terminus {
  return { status: "incomplete", rationale: `${roleCfg.role} session did not complete: ${reason}` };
}

/**
 * One agent session in, exactly one terminus out.
 *
 * The primitive never retries and never branches on role: it assembles the
 * prompt, spawns one fresh session (no resume, no session id — sessions are
 * reconstructed from the case file, never continued), and validates whatever
 * came back. `sdkOverrides` exists so a test or demo can point the SDK at
 * `claude-mock` instead of the real CLI; the tool-authority fields are applied
 * after it, so an override can never widen what the role may do.
 *
 * Throws `InvalidRoleConfig` — and only that — for a malformed config, before any
 * session is spawned. An extender's typo is a programming error, not a run
 * outcome: reporting it as `incomplete` would hide it behind a retry budget.
 * Every *agent* outcome, success or failure, returns as a `Terminus`.
 */
export async function invoke(
  roleCfg: RoleConfig,
  ctx: AgentContext,
  sdkOverrides: Partial<Options> = {},
): Promise<Terminus> {
  validateRoleConfig(roleCfg);

  const caseFile = await load(ctx.dir);
  const { systemPrompt, prompt } = assemblePrompt(
    caseFile,
    roleCfg,
    await resolveEvidence(ctx.dir, caseFile),
  );

  let result: SDKResultMessage | undefined;
  try {
    result = await lastResult(prompt, systemPrompt, roleCfg, ctx, sdkOverrides);
  } catch {
    return incomplete(roleCfg, DID_NOT_COMPLETE.notRun);
  }

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
async function lastResult(
  prompt: string,
  systemPrompt: string,
  roleCfg: RoleConfig,
  ctx: AgentContext,
  sdkOverrides: Partial<Options>,
): Promise<SDKResultMessage | undefined> {
  let result: SDKResultMessage | undefined;
  for await (const message of query({
    prompt,
    options: {
      ...sdkOverrides,
      cwd: ctx.worktreePath,
      systemPrompt,
      // One authored list, two SDK options: `tools` is the real restriction on
      // the session's base tool set, `allowedTools` auto-approves what the role
      // is already entitled to so an unattended run never stalls on a prompt.
      tools: roleCfg.allowedTools,
      allowedTools: roleCfg.allowedTools,
      outputFormat: { type: "json_schema", schema: z.toJSONSchema(roleCfg.envelopeSchema) },
    },
  })) {
    if (message.type === "result") result = message;
  }
  return result;
}
