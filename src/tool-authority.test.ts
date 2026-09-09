import { describe, it, expect } from "vitest";
import { createToolAuthority, refusalSentence, authorityRefusal } from "./tool-authority.js";
import type { RoleConfig } from "./role-config.js";
import { WorkerEnvelope } from "./role-config.js";

const readOnlyWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: "You are a read-only worker.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob"],
};

/** The options bag the SDK passes as `canUseTool`'s third argument. */
const sdkCallOptions = {
  signal: new AbortController().signal,
  toolUseID: "test-tool-use-id",
  requestId: "test-request-id",
};

describe("the guard the SDK consults before each tool call", () => {
  it("allows a tool the role's config names", async () => {
    const authority = createToolAuthority(readOnlyWorker);
    const decision = await authority.canUseTool("Read", { file_path: "/x" }, sdkCallOptions);
    expect(decision).toEqual({ behavior: "allow", updatedInput: { file_path: "/x" } });
    expect(authority.attempted).toEqual([]);
  });

  it("denies a tool outside the role's config and says why in plain English", async () => {
    const authority = createToolAuthority(readOnlyWorker);
    // `CanUseTool` returns `PermissionResult | null`; the guard never returns
    // null, and the assertions narrow it so `tsc --noEmit` (which typechecks
    // `src/**`, tests included) stays clean.
    const decision = await authority.canUseTool("Bash", { command: "rm -rf /" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toBe(refusalSentence(readOnlyWorker, "Bash"));
  });

  it("records each out-of-role attempt so the harness can report it afterwards", async () => {
    const authority = createToolAuthority(readOnlyWorker);
    await authority.canUseTool("Bash", {}, sdkCallOptions);
    await authority.canUseTool("Read", {}, sdkCallOptions);
    await authority.canUseTool("WebFetch", {}, sdkCallOptions);
    expect(authority.attempted).toEqual(["Bash", "WebFetch"]);
  });
});

describe("the sentence a refusal is reported with", () => {
  it("names the role, the tool, the permitted tools, and that this was deliberate", () => {
    const sentence = refusalSentence(readOnlyWorker, "Bash");
    expect(sentence).toContain("worker");
    expect(sentence).toContain("Bash");
    expect(sentence).toContain("Read, Glob");
    expect(sentence).toContain("working as intended");
  });

  it("never reads as an unexplained failure", () => {
    const sentence = refusalSentence(readOnlyWorker, "Bash");
    expect(sentence).toContain("refused");
    expect(sentence).toContain("not a fault in the run");
    expect(sentence).not.toMatch(/error|Error|exception|denied by the SDK/);
  });
});

describe("classifying what a finished session refused", () => {
  it("reports nothing when no out-of-role tool was attempted", () => {
    expect(authorityRefusal(readOnlyWorker, [], [])).toBeUndefined();
  });

  it("turns a recorded out-of-role attempt into one incomplete terminus", () => {
    const terminus = authorityRefusal(readOnlyWorker, ["Bash"], []);
    expect(terminus).toEqual({
      status: "incomplete",
      rationale: `worker session did not complete: ${refusalSentence(readOnlyWorker, "Bash")}`,
    });
  });

  it("reads the SDK's own denial record as a second source", () => {
    // Only `tool_name` is passed: the parameter is `Pick<SDKPermissionDenial,
    // "tool_name">`, and a fresh object literal carrying the other fields would
    // fail TypeScript's excess-property check.
    const terminus = authorityRefusal(readOnlyWorker, [], [{ tool_name: "Write" }]);
    expect(terminus?.rationale).toContain("Write");
  });

  it("makes no authority claim about a denial of a tool the role was permitted", () => {
    expect(
      authorityRefusal(readOnlyWorker, [], [{ tool_name: "Read" }]),
    ).toBeUndefined();
  });

  it("reports the first out-of-role tool once, however many sources saw it", () => {
    const terminus = authorityRefusal(readOnlyWorker, ["Bash"], [{ tool_name: "Bash" }]);
    expect(terminus?.rationale).toBe(
      `worker session did not complete: ${refusalSentence(readOnlyWorker, "Bash")}`,
    );
  });
});
