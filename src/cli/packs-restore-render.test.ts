import { describe, expect, it } from "vitest";
import type { LockEntry } from "../packs/install/lock.js";
import { changedAtSourceLines } from "./packs-restore-render.js";

const entry: LockEntry = {
  source: "npm",
  package: "@acme/docs",
  request: "1.0.0",
  version: "1.0.0",
  integrity: "sha512-abc",
  fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
  approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
  files: {},
};

describe("changedAtSourceLines", () => {
  it("shows a hidden character in the integrity npm now serves, never as itself", () => {
    const text = changedAtSourceLines("Not restored:", entry, "sha512-x\u001b[2J").join("\n");
    expect(text).not.toContain("\u001b");
    expect(text).toContain("<U+001B>");
  });

  it("leads with Not updated when the lead is Not updated", () => {
    expect(changedAtSourceLines("Not updated:", entry, "sha512-B")[0]?.startsWith("Not updated: npm now serves different contents for")).toBe(true);
  });
});
