import { describe, it, expect } from "vitest";
import { z } from "zod";
import { WorkerEnvelope, workerRoleConfig, gateMaintenanceRoleConfig, validateRoleConfig } from "./role-config.js";
import type { RoleConfig } from "./role-config.js";
import { InvalidRoleConfig } from "./errors.js";
import { triageRoleConfig, TriageEnvelope } from "./triage-role-config.js";

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

  it("accepts a decision escalation that carries its question", () => {
    expect(WorkerEnvelope.parse({ status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the task does not say" }))
      .toEqual({ status: "escalate", category: "decision", question: "Formal or casual greeting?", rationale: "the task does not say" });
  });

  it("refuses a decision escalation with no question, so the operator is never asked nothing", () => {
    expect(WorkerEnvelope.safeParse({ status: "escalate", category: "decision", rationale: "unsure" }).success).toBe(false);
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
  it("is a worker config with a prompt fragment", () => {
    expect(workerRoleConfig.role).toBe("worker");
    expect(workerRoleConfig.systemPromptFragment.length).toBeGreaterThan(0);
  });

  it("passes its own validation", () => {
    expect(() => validateRoleConfig(workerRoleConfig)).not.toThrow();
  });
});

describe("validateRoleConfig", () => {
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

  it("replies with the same completed/escalate shape as the worker", () => {
    expect(
      gateMaintenanceRoleConfig.envelopeSchema.safeParse({ status: "completed", rationale: "fixed .env" }).success,
    ).toBe(true);
    expect(
      gateMaintenanceRoleConfig.envelopeSchema.safeParse({ status: "fix_the_gate", rationale: "x" }).success,
    ).toBe(false);
  });
});

describe("what a role is", () => {
  it("is its context and reply shape alone, with no tool list", () => {
    for (const roleCfg of [workerRoleConfig, gateMaintenanceRoleConfig, triageRoleConfig]) {
      expect(roleCfg).not.toHaveProperty("allowedTools");
    }
  });

  it("accepts any role with a context and a reply schema, triage included", () => {
    expect(() => validateRoleConfig({ role: "triage", systemPromptFragment: "classify", envelopeSchema: TriageEnvelope })).not.toThrow();
  });

  it("no longer tells the worker to make the smallest change, nor that it cannot see the check", () => {
    expect(workerRoleConfig.systemPromptFragment).not.toMatch(/smallest change/);
    expect(workerRoleConfig.systemPromptFragment).not.toMatch(/cannot see/);
  });

  it("tells gate maintenance the check's definition is verified, not that it is out of reach", () => {
    expect(gateMaintenanceRoleConfig.systemPromptFragment).toContain("verified unchanged");
    expect(gateMaintenanceRoleConfig.systemPromptFragment).not.toMatch(/outside your working tree/);
  });
});
