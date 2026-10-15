import type { RoleConfigs } from "../agent-invoke.js";
import { gateMaintenanceRoleConfig, validateRoleConfig, workerRoleConfig, type RoleConfig } from "../role-config.js";
import type { RoleOverride, RoleOverrides } from "../schema.js";
import { triageRoleConfig } from "../triage-role-config.js";

/**
 * A shipped role with whatever the project changed laid over it, field by
 * field: an omitted field keeps the built-in value, as `budgets` does. The
 * result goes through the library's own role check, so the command line
 * accepts exactly the roles `invoke` accepts and there is no second opinion.
 */
function withOverride(shipped: RoleConfig, override: RoleOverride | undefined): RoleConfig {
  const merged: RoleConfig = {
    ...shipped,
    systemPromptFragment: override?.systemPromptFragment ?? shipped.systemPromptFragment,
  };
  validateRoleConfig(merged);
  return merged;
}

/**
 * The roles a run from the command line is given, from the overrides it was
 * started with. One function, used by the run itself, by `preview` and by the
 * check every command makes before a run exists, so what is previewed and
 * validated is what a run is told. Triage is always the harness's own.
 */
export function rolesFor(overrides: RoleOverrides | undefined): RoleConfigs {
  return {
    worker: withOverride(workerRoleConfig, overrides?.worker),
    "gate-maintenance": withOverride(gateMaintenanceRoleConfig, overrides?.gateMaintenance),
    triage: triageRoleConfig,
  };
}
