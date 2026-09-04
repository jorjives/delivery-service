import { describe, it, expect } from "vitest";

describe("index", () => {
  it("loads without errors", async () => {
    const index = await import("./index.js");
    expect(index).toBeDefined();
  });
});
