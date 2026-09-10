import * as os from "node:os";
import * as path from "node:path";
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

/**
 * The sentence for an in-role tool aimed outside the run's worktree.
 *
 * The worktree is the only place any role may act. Everything the harness pins
 * out of an agent's reach — the gate's checks, the case file — lives outside
 * it, so this is the rule that stops a gate-maintenance session "repairing" a
 * check into passing, however broad its tool list.
 */
export function outsideWorktreeSentence(roleCfg: RoleConfig, tool: string, target: string): string {
  return (
    `the ${roleCfg.role} role used ${tool} on ${target}, which is outside the worktree, ` +
    `so the harness refused the call before it ran. Every role may act only inside its worktree; ` +
    `the project's checks are kept outside it on purpose. ` +
    `That refusal is the harness's permission boundary working as intended, not a fault in the run.`
  );
}

/** The live guard for one session, plus what it refused. */
export interface ToolAuthority {
  /** Handed to the SDK. Consulted before each tool execution. */
  canUseTool: CanUseTool;
  /** The refusal sentence for each call this session was refused, in order. */
  refusals: readonly string[];
}

/** Input fields the SDK's file and search tools name their target with (Glob/Grep use `path`). */
const PATH_FIELDS = ["file_path", "notebook_path", "path"] as const;

/**
 * Every path this call would touch: whatever the runtime itself flagged as
 * outside the allowed directories, plus the file tools' own target fields.
 */
function targetsOf(input: Record<string, unknown>, blockedPath: string | undefined): string[] {
  const named = PATH_FIELDS.map((field) => input[field]).filter(
    (value): value is string => typeof value === "string",
  );
  return blockedPath === undefined ? named : [blockedPath, ...named];
}

function isInside(worktreePath: string, target: string): boolean {
  // ponytail: lexical resolve, not realpath. A symlink inside the worktree
  // pointing out of it is not caught; resolve through realpath (on the nearest
  // existing ancestor, since Write targets may not exist yet) if that ever matters.
  // Same ceiling for a worktree reached through a symlink (macOS /var -> /private/var):
  // a canonical target would be refused; realpath the root too if that matters.
  const root = path.resolve(worktreePath);
  // The file tools expand a leading `~`; resolving it lexically would land inside the worktree.
  const expanded = target === "~" || target.startsWith("~/") ? os.homedir() + target.slice(1) : target;
  const full = path.resolve(root, expanded);
  return full === root || full.startsWith(root + path.sep);
}

/**
 * Build the session's single authority decision point. Two rules, checked in
 * this order, for every role alike:
 *
 * 1. The tool must be in `roleCfg.allowedTools`.
 * 2. Every path the call would touch must be inside `worktreePath`.
 *
 * `tools` is left at the SDK's base set on purpose, so the model can still
 * *issue* an out-of-role call and this callback can refuse it observably. The
 * runtime already routes a call aimed outside its working directory to this
 * callback rather than running it; rule 2 is the harness answering "no".
 */
export function createToolAuthority(roleCfg: RoleConfig, worktreePath: string): ToolAuthority {
  const refusals: string[] = [];
  const deny = (message: string): Promise<PermissionResult> => {
    refusals.push(message);
    return Promise.resolve({ behavior: "deny", message });
  };
  const canUseTool: CanUseTool = (toolName, input, { blockedPath }) => {
    if (!roleCfg.allowedTools.includes(toolName)) {
      return deny(refusalSentence(roleCfg, toolName));
    }
    const outside = targetsOf(input, blockedPath).find((target) => !isInside(worktreePath, target));
    if (outside !== undefined) {
      return deny(outsideWorktreeSentence(roleCfg, toolName, outside));
    }
    return Promise.resolve({ behavior: "allow", updatedInput: input });
  };
  return { canUseTool, refusals };
}

/**
 * Decide whether this session ended against its authority boundary.
 *
 * Two sources, because neither alone is complete: the guard's own record, and
 * the SDK's `permission_denials` (which catches denials resolved before the
 * callback runs). The guard's record wins, because it carries the exact reason.
 * The SDK's record is classified, never believed wholesale: a denial of a tool
 * the role *was* permitted is an ordinary failed run and says nothing about
 * authority.
 */
export function authorityRefusal(
  roleCfg: RoleConfig,
  refusals: readonly string[],
  denials: readonly Pick<SDKPermissionDenial, "tool_name">[],
): Terminus | undefined {
  const outOfRole = denials
    .map((denial) => denial.tool_name)
    .find((tool) => !roleCfg.allowedTools.includes(tool));
  const sentence = refusals.at(0) ?? (outOfRole === undefined ? undefined : refusalSentence(roleCfg, outOfRole));
  if (sentence === undefined) return undefined;
  return { status: "incomplete", rationale: `${roleCfg.role} session did not complete: ${sentence}` };
}
