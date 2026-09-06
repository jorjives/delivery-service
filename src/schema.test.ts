import { describe, it, expect } from "vitest";
import { GateRef } from "./schema.js";

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
