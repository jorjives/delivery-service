import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SharpenedBrief, EscalationPacket, TriageEnvelope, triageRoleConfig } from "./triage-role-config.js";
import { validateRoleConfig } from "./role-config.js";
import { createToolAuthority } from "./tool-authority.js";

const brief = {
  problem: "the greeting endpoint returns 'hi', and the test expects 'hello'",
  dead_ends: "attempt 1 edited the template, but the string comes from the i18n table",
  scope: "touch src/i18n/en.json only",
  references: ["worker-1-0"],
  diagnosis: "the i18n key was renamed and the fallback is used",
};

const packet = {
  decision: "Decide whether to rename the key or amend the task.",
  evidence: "not ok 2 - beta",
  dead_ends: "attempt 1 edited the template",
  why_now: "worker_escalate (exhaustion), correction 1/3",
  references: ["worker-1-0"],
};

describe("triage reply shapes", () => {
  it("round-trips a sharpened brief", () => {
    expect(SharpenedBrief.parse(brief)).toEqual(brief);
  });

  it("rejects a brief with an empty dead_ends, so a retry can never receive an empty brief", () => {
    expect(SharpenedBrief.safeParse({ ...brief, dead_ends: "" }).success).toBe(false);
  });

  it("has no evidence field on the brief: the gate evidence slot carries it verbatim", () => {
    expect(Object.keys(SharpenedBrief.shape)).not.toContain("evidence");
  });

  it("round-trips an escalation packet", () => {
    expect(EscalationPacket.parse(packet)).toEqual(packet);
  });

  it("accepts each triage status with its own payload", () => {
    for (const reply of [
      { status: "reroute", rationale: "one more try", payload: brief },
      { status: "escalate", rationale: "no fix", payload: packet },
      { status: "fix_the_gate", rationale: "env", payload: brief },
      { status: "retry_close", rationale: "flaky", payload: brief },
      { status: "abort", rationale: "infra", payload: { reason: "disk full" } },
    ]) {
      expect(TriageEnvelope.safeParse(reply).success).toBe(true);
    }
  });

  it("rejects a worker status and a reroute without a brief", () => {
    expect(TriageEnvelope.safeParse({ status: "completed", rationale: "done" }).success).toBe(false);
    expect(TriageEnvelope.safeParse({ status: "reroute", rationale: "again" }).success).toBe(false);
  });

  it("converts to a JSON Schema the SDK can constrain output with", () => {
    expect(() => z.toJSONSchema(TriageEnvelope)).not.toThrow();
  });
});

describe("triageRoleConfig", () => {
  it("is a triage config that passes validation", () => {
    expect(triageRoleConfig.role).toBe("triage");
    expect(() => validateRoleConfig(triageRoleConfig)).not.toThrow();
  });

  it("is given read-only tools and nothing else", () => {
    expect(triageRoleConfig.allowedTools).toEqual(["Read", "Glob", "Grep"]);
  });

  it("is refused every editing or shell tool by the guard, even inside the worktree", async () => {
    const authority = createToolAuthority(triageRoleConfig, "/runs/s-1/tree");
    const options = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    for (const tool of ["Edit", "Write", "Bash", "NotebookEdit"]) {
      const decision = await authority.canUseTool(tool, { file_path: "/runs/s-1/tree/a.txt" }, options);
      expect(decision?.behavior).toBe("deny");
    }
  });

  it("tells the session it is a read-only classifier and that its diagnosis is a hypothesis", () => {
    expect(triageRoleConfig.systemPromptFragment).toContain("read-only");
    expect(triageRoleConfig.systemPromptFragment).toContain("hypothesis");
  });
});
