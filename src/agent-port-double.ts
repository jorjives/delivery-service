import type { AgentContext, AgentPort, DispatchedRole, RoleHandle, RoleTerminusMap } from "./ports.js";

/**
 * One optional reply function per role, keyed the way `RoleConfigs` keys a
 * role's pinned configuration. Each function must return that role's own
 * terminus, so a worker reply shaped like a triage verdict does not compile.
 */
export type RoleHandlers = { [R in DispatchedRole]?: (ctx: AgentContext) => Promise<RoleTerminusMap[R]> };

/**
 * An in-process `AgentPort` for tests and demos, built from the replies a test
 * exercises. It runs nothing below `AgentPort.invoke`: no prompt assembly, no
 * envelope validation, no SDK. Invoking a role with no reply rejects, naming
 * the role, so a test cannot pass by reaching a role it never scripted.
 */
export function fakeAgentPort(handlers: RoleHandlers): AgentPort {
  const run = (roleCfg: RoleHandle & { role: DispatchedRole }, ctx: AgentContext) => {
    const handler = handlers[roleCfg.role];
    if (!handler) {
      return Promise.reject(
        new Error(
          `fakeAgentPort was given no reply for the ${roleCfg.role} role: the test must supply a "${roleCfg.role}" handler`,
        ),
      );
    }
    return handler(ctx);
  };
  // One cast, for the same reason as createAgentPort's: TypeScript cannot
  // correlate `handlers[role]`'s reply type with RoleTerminusMap[R] across a
  // generic key. RoleHandlers pins that mapping for every caller.
  return { invoke: run as AgentPort["invoke"] };
}
