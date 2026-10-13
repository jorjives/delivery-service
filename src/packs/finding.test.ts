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

  it("accepts a library version only in a version's shape, so no control text reaches the terminal", () => {
    const dependency = (version: string) => ({ ...scanned, check: { kind: "dependency-absent", package: "minimist", version } });
    expect(Envelope.safeParse({ findings: [dependency("1.2.5")], notes: "" }).success).toBe(true);
    expect(Envelope.safeParse({ findings: [dependency("1.2.5\u001b[2J")], notes: "" }).success).toBe(false);
  });

  it("leaves identity and the line to the harness: an id or a line the agent sends is dropped", () => {
    const parsed = Envelope.parse({ findings: [{ ...scanned, id: "abc", where: { path: "total.js", line: 9 } }], notes: "" });
    expect(parsed.findings[0]).not.toHaveProperty("id");
    expect(parsed.findings[0]?.where).toEqual({ path: "total.js" });
  });
});

it("takes a reply with or without a confidence, and only the three words", () => {
  const Envelope = scanEnvelopeFor(["correctness"]);
  const one = { title: "t", category: "correctness", severity: "low", where: { path: "a.js" }, problem: "p", whyItMatters: "w", fixedLooksLike: "f", anchor: "abcdefghij", check: { kind: "anchor-gone" } };
  expect(Envelope.safeParse({ findings: [one], notes: "" }).success).toBe(true);
  expect(Envelope.safeParse({ findings: [{ ...one, confidence: "low" }], notes: "" }).success).toBe(true);
  expect(Envelope.safeParse({ findings: [{ ...one, confidence: "certain" }], notes: "" }).success).toBe(false);
});
