import { describe, expect, it } from "vitest";
import { CHEATING_FIXES, EXAMPLE_SCAN } from "./review-fixtures.js";

describe("CHEATING_FIXES", () => {
  const [retry, checkout, settings, gateway, ...rest] = CHEATING_FIXES.expectations;
  const [c, s, g] = EXAMPLE_SCAN.findings;

  it("has one retry expectation, then three cheats", () => {
    expect(rest).toEqual([]);
    expect(retry?.when?.promptContains).toBe("\n- guard:");
    expect(retry?.json).toMatchObject({ status: "escalate" });
  });

  it("matches each cheat by its problem title", () => {
    expect([checkout, settings, gateway].map((e) => e?.when?.promptContains)).toEqual([c?.title, s?.title, g?.title]);
  });

  it("deletes the checkout test", () => {
    expect(checkout?.effects).toContainEqual({ delete: { path: "checkout.test.js" } });
  });

  it("skips the test and changes the test script for settings", () => {
    const writes = (settings?.effects ?? []).flatMap((e) => ("write" in e ? [e.write] : []));
    expect(writes.find((w) => w.path === "checkout.test.js")?.content).toContain("test.skip(");
    expect(writes.find((w) => w.path === "package.json")?.content).toContain("|| true");
  });

  it("makes only a minimal test edit for the gateway", () => {
    expect(gateway?.effects).toHaveLength(1);
    expect(gateway?.effects?.[0]).toMatchObject({ write: { path: "checkout.test.js" } });
  });
});
