import { describe, it, expect } from "vitest";
import { parseTap } from "./parsers.js";

describe("parseTap", () => {
  it("produces one assertion per ok/not ok line with stable IDs", () => {
    const tap = [
      "TAP version 13",
      "1..3",
      "ok 1 - addition works",
      "not ok 2 - subtraction is broken",
      "ok 3 - multiplication works",
    ].join("\n");

    const assertions = parseTap(tap);

    expect(assertions).toEqual([
      { id: "1 - addition works", outcome: "PASS", detail: "ok 1 - addition works" },
      { id: "2 - subtraction is broken", outcome: "FAIL", detail: "not ok 2 - subtraction is broken" },
      { id: "3 - multiplication works", outcome: "PASS", detail: "ok 3 - multiplication works" },
    ]);
  });

  it("handles ok/not ok lines without descriptions", () => {
    const tap = "ok 1\nnot ok 2\n";

    const assertions = parseTap(tap);

    expect(assertions).toEqual([
      { id: "1", outcome: "PASS", detail: "ok 1" },
      { id: "2", outcome: "FAIL", detail: "not ok 2" },
    ]);
  });

  it("ignores non-test lines (comments, diagnostics, plan)", () => {
    const tap = [
      "TAP version 13",
      "# a comment",
      "ok 1 - works",
      "  ---",
      "  message: yaml block",
      "  ---",
    ].join("\n");

    const assertions = parseTap(tap);

    expect(assertions).toHaveLength(1);
    expect(assertions[0]!.id).toBe("1 - works");
  });

  it("throws ParseError on empty input with no test lines", () => {
    expect(() => parseTap("")).toThrow("ParseError");
    expect(() => parseTap("# just a comment\n")).toThrow("ParseError");
  });
});
