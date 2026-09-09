import type { CanUseTool, PermissionResult, SDKPermissionDenial } from "@anthropic-ai/claude-agent-sdk";
import type { RoleConfig } from "./role-config.js";
import type { Terminus } from "./ports.js";

/**
 * The one sentence a refusal is ever reported with — to the model in the deny
 * message, and to the project owner in the terminus rationale.
 *
 * It is deliberately not phrased as an error. A reader with no source access
 * has to be able to tell an intentional boundary from a malfunction, so the
 * sentence names the role, the tool it reached for, what it may use instead,
 * and says outright that the refusal was the point.
 */
export function refusalSentence(roleCfg: RoleConfig, tool: string): string {
  return (
    `the ${roleCfg.role} role is not permitted to use ${tool}, so the harness refused the call ` +
    `before it ran. This role may use only: ${roleCfg.allowedTools.join(", ")}. ` +
    `That refusal is the harness's permission boundary working as intended, not a fault in the run.`
  );
}

/** The live guard for one session, plus what it caught. */
export interface ToolAuthority {
  /** Handed to the SDK. Consulted before each tool execution. */
  canUseTool: CanUseTool;
  /** Out-of-role tools this session reached for, in the order it reached for them. */
  attempted: readonly string[];
}

/**
 * Build the session's single authority decision point.
 *
 * This is the whole enforcement mechanism: `tools` is left at the SDK's base
 * set on purpose, so the model can still *issue* an out-of-role call and this
 * callback can refuse it observably. Narrowing `tools` would make the attempt
 * impossible and the refusal unreportable — which is the guarantee this seam
 * exists to demonstrate.
 */
export function createToolAuthority(roleCfg: RoleConfig): ToolAuthority {
  const attempted: string[] = [];
  const canUseTool: CanUseTool = (toolName, input): Promise<PermissionResult> => {
    if (roleCfg.allowedTools.includes(toolName)) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    attempted.push(toolName);
    return Promise.resolve({ behavior: "deny", message: refusalSentence(roleCfg, toolName) });
  };
  return { canUseTool, attempted };
}

/**
 * Decide whether this session ended against its authority boundary.
 *
 * Two sources, because neither alone is complete: the guard's own record, and
 * the SDK's `permission_denials` (which catches denials resolved before the
 * callback runs). The SDK's record is classified, never believed wholesale —
 * a denial of a tool the role *was* permitted is an ordinary failed run and
 * says nothing about authority.
 */
export function authorityRefusal(
  roleCfg: RoleConfig,
  attempted: readonly string[],
  denials: readonly Pick<SDKPermissionDenial, "tool_name">[],
): Terminus | undefined {
  const outOfRole = [...attempted, ...denials.map((denial) => denial.tool_name)].filter(
    (tool) => !roleCfg.allowedTools.includes(tool),
  );
  const first = outOfRole.at(0);
  if (first === undefined) return undefined;
  return {
    status: "incomplete",
    rationale: `${roleCfg.role} session did not complete: ${refusalSentence(roleCfg, first)}`,
  };
}
