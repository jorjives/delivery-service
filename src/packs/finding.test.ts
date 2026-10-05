import { describe, expect, it } from "vitest";
import { scanEnvelopeFor } from "./finding.js";

const scanned = {
  title: "The total can go below zero",
  category: "correctness",
  severity: "high",
  where: { path: "total.js" },
  problem: "A discount larger than the price makes the total negative.",
  whyItMatters: "The shop would pay the customer.",
  fixedLooksLike: "A total never goes below zero.",
  anchor: "return price - discount;",
  check: { kind: "anchor-gone" },
};

describe("what a review's agent may reply", () => {
  const Envelope = scanEnvelopeFor(["correctness", "dead-code"]);

  it("accepts a list of problems in the pack's categories, with any of the three checks", () => {
    const pattern = { ...scanned, check: { kind: "pattern-absent", pattern: "price - discount", paths: ["total.js"] } };
    expect(Envelope.safeParse({ findings: [scanned, pattern, { ...scanned, check: { kind: "none" } }], notes: "" }).success).toBe(true);
  });

  it("refuses a category the pack does not name, a severity that is not a word it knows, and a check kind that does not exist", () => {
    expect(Envelope.safeParse({ findings: [{ ...scanned, category: "style" }], notes: "" }).success).toBe(false);
    expect(Envelope.safeParse({ findings: [{ ...scanned, severity: "9.8" }], notes: "" }).success).toBe(false);
    expect(Envelope.safeParse({ findings: [{ ...scanned, check: { kind: "page-contains" } }], notes: "" }).success).toBe(false);
  });

  it("leaves identity and the line to the harness: an id or a line the agent sends is dropped", () => {
    const parsed = Envelope.parse({ findings: [{ ...scanned, id: "abc", where: { path: "total.js", line: 9 } }], notes: "" });
    expect(parsed.findings[0]).not.toHaveProperty("id");
    expect(parsed.findings[0]?.where).toEqual({ path: "total.js" });
  });
});
