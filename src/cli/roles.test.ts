import { describe, expect, it } from "vitest";
import { InvalidRoleConfig } from "../errors.js";
import { gateMaintenanceRoleConfig, workerRoleConfig } from "../role-config.js";
import { triageRoleConfig } from "../triage-role-config.js";
import { rolesFor } from "./roles.js";

const OPS_RULE = "Never modify anything under the ops folder.";

describe("the roles a run from the command line is given", () => {
  it("is the three built-in roles when the file changes nothing", () => {
    const shipped = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };
    expect(rolesFor(undefined)).toEqual(shipped);
    expect(rolesFor({})).toEqual(shipped);
    expect(rolesFor({ worker: {} })).toEqual(shipped);
  });

  it("takes the file's instructions for the worker and keeps its built-in tools", () => {
    expect(rolesFor({ worker: { systemPromptFragment: OPS_RULE } }).worker).toEqual({ ...workerRoleConfig, systemPromptFragment: OPS_RULE });
  });

  it("takes the file's instructions for gate maintenance and keeps its built-in reply shape", () => {
    expect(rolesFor({ gateMaintenance: { systemPromptFragment: OPS_RULE } })["gate-maintenance"]).toEqual({
      ...gateMaintenanceRoleConfig,
      systemPromptFragment: OPS_RULE,
    });
  });

  it("changes one role without touching the other", () => {
    const roles = rolesFor({ worker: { systemPromptFragment: OPS_RULE } });
    expect(roles["gate-maintenance"]).toEqual(gateMaintenanceRoleConfig);
  });

  it("never changes triage, whatever the file says about the other two", () => {
    const roles = rolesFor({ worker: { systemPromptFragment: OPS_RULE }, gateMaintenance: { systemPromptFragment: OPS_RULE } });
    expect(roles.triage).toBe(triageRoleConfig);
  });

  it("passes every merged role through the library's own role check", () => {
    expect(() => rolesFor({ worker: { systemPromptFragment: "" } })).toThrow(InvalidRoleConfig);
    expect(() => rolesFor({ gateMaintenance: { systemPromptFragment: "" } })).toThrow(InvalidRoleConfig);
  });
});
