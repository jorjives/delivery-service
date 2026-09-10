import { describe, it, expect } from "vitest";
import { z } from "zod";
import { WorkerEnvelope, workerRoleConfig, gateMaintenanceRoleConfig, validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import { InvalidRoleConfig } from "./errors.js";

describe("WorkerEnvelope", () => {
  it("accepts a clean completion", () => {
    const parsed = WorkerEnvelope.parse({ status: "completed", rationale: "added the feature" });
    expect(parsed).toEqual({ status: "completed", rationale: "added the feature" });
  });

  it("accepts an escalation carrying its category", () => {
    const parsed = WorkerEnvelope.parse({
      status: "escalate",
      category: "authority",
      rationale: "the change needs a credential I was not given",
    });
    expect(parsed).toEqual({
      status: "escalate",
      category: "authority",
      rationale: "the change needs a credential I was not given",
    });
  });

  it("rejects a triage-only status, so a worker cannot route itself", () => {
    expect(WorkerEnvelope.safeParse({ status: "reroute", rationale: "try again" }).success)
      .toBe(false);
  });

  it("rejects an escalation with no category", () => {
    expect(WorkerEnvelope.safeParse({ status: "escalate", rationale: "stuck" }).success)
      .toBe(false);
  });

  it("rejects an envelope with no rationale", () => {
    expect(WorkerEnvelope.safeParse({ status: "completed" }).success).toBe(false);
  });

  it("converts to a JSON Schema the SDK can constrain output with", () => {
    const schema = z.toJSONSchema(WorkerEnvelope) as { oneOf: unknown[] };
    expect(schema.oneOf).toHaveLength(2);
  });
});

describe("workerRoleConfig", () => {
  it("is a worker config with a prompt fragment and a non-empty tool list", () => {
    expect(workerRoleConfig.role).toBe("worker");
    expect(workerRoleConfig.systemPromptFragment.length).toBeGreaterThan(0);
    expect(workerRoleConfig.allowedTools.length).toBeGreaterThan(0);
  });

  it("passes its own validation", () => {
    expect(() => validateRoleConfig(workerRoleConfig)).not.toThrow();
  });
});

describe("validateRoleConfig", () => {
  it("names the offending field when the tool list is empty", () => {
    const cfg = { ...workerRoleConfig, allowedTools: [] };
    expect(() => validateRoleConfig(cfg)).toThrow(InvalidRoleConfig);
    try {
      validateRoleConfig(cfg);
    } catch (err) {
      expect((err as InvalidRoleConfig).field).toBe("allowedTools");
      expect((err as InvalidRoleConfig).message).toContain("allowedTools");
    }
  });

  it("names the offending field when the prompt fragment is blank", () => {
    try {
      validateRoleConfig({ ...workerRoleConfig, systemPromptFragment: "" });
      expect.unreachable("blank fragment should not validate");
    } catch (err) {
      expect((err as InvalidRoleConfig).field).toBe("systemPromptFragment");
    }
  });

  it("names the offending field when the envelope schema is not a zod schema", () => {
    const cfg = { ...workerRoleConfig, envelopeSchema: {} } as unknown as RoleConfig;
    try {
      validateRoleConfig(cfg);
      expect.unreachable("a non-schema should not validate");
    } catch (err) {
      expect((err as InvalidRoleConfig).field).toBe("envelopeSchema");
    }
  });
});

describe("gateMaintenanceRoleConfig", () => {
  it("is a gate-maintenance config that passes the same validation as the worker's", () => {
    expect(gateMaintenanceRoleConfig.role).toBe("gate-maintenance");
    expect(() => validateRoleConfig(gateMaintenanceRoleConfig)).not.toThrow();
  });

  it("may edit files, which is how it repairs the environment", () => {
    expect(gateMaintenanceRoleConfig.allowedTools).toEqual(
      expect.arrayContaining(["Edit", "Write"]),
    );
  });

  it("is not granted a shell, which could write past the worktree boundary", () => {
    expect(gateMaintenanceRoleConfig.allowedTools).not.toContain("Bash");
  });

  it("tells the session it repairs the environment and never the checks", () => {
    expect(gateMaintenanceRoleConfig.systemPromptFragment).toMatch(/environment/);
    expect(gateMaintenanceRoleConfig.systemPromptFragment).toMatch(/never .*checks/i);
  });

  it("replies with the same completed/escalate shape as the worker", () => {
    expect(
      gateMaintenanceRoleConfig.envelopeSchema.safeParse({ status: "completed", rationale: "fixed .env" }).success,
    ).toBe(true);
    expect(
      gateMaintenanceRoleConfig.envelopeSchema.safeParse({ status: "fix_the_gate", rationale: "x" }).success,
    ).toBe(false);
  });
});
