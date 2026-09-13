import { describe, it, expect } from "vitest";
import { GateRef, CloserRef, CloseReport } from "./schema.js";

describe("GateRef", () => {
  it("accepts a command ref with a supported parse mode", () => {
    const parsed = GateRef.safeParse({
      type: "command",
      command: "npm test",
      parseMode: "tap",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a custom ref with an optional export name", () => {
    const parsed = GateRef.safeParse({
      type: "custom",
      modulePath: "./gates/my-gate.mjs",
      exportName: "myGate",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a command ref naming an unsupported parse mode", () => {
    const parsed = GateRef.safeParse({
      type: "command",
      command: "npm test",
      parseMode: "xunit",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a ref with an unknown type", () => {
    const parsed = GateRef.safeParse({ type: "webhook", url: "http://x" });
    expect(parsed.success).toBe(false);
  });
});

describe("CloserRef", () => {
  it("accepts the merge-back closer named with no parameters", () => {
    expect(CloserRef.parse({ type: "merge-back" })).toEqual({ type: "merge-back" });
  });

  it("accepts an explicit request to keep the surface branch", () => {
    const parsed = CloserRef.parse({ type: "merge-back", deleteBranch: false });
    if (parsed.type === "merge-back") {
      expect(parsed.deleteBranch).toBe(false);
    } else {
      throw new Error("Expected merge-back variant");
    }
  });

  it("rejects a closer type it does not know", () => {
    expect(CloserRef.safeParse({ type: "teleport" }).success).toBe(false);
  });

  it("accepts the commit-to-branch closer named with no parameters", () => {
    expect(CloserRef.safeParse({ type: "commit-to-branch" }).success).toBe(true);
  });
});

describe("CloseReport", () => {
  it("accepts each of the three statuses with a detail", () => {
    for (const status of ["DONE", "FAIL", "ERROR"]) {
      expect(CloseReport.safeParse({ status, detail: "what happened" }).success).toBe(true);
    }
  });

  it("rejects an unknown status, a missing detail, and a non-object", () => {
    expect(CloseReport.safeParse({ status: "OK", detail: "x" }).success).toBe(false);
    expect(CloseReport.safeParse({ status: "DONE" }).success).toBe(false);
    expect(CloseReport.safeParse(undefined).success).toBe(false);
  });
});
