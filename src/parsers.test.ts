import { describe, it, expect } from "vitest";
import { parseTap, parseJunit } from "./parsers.js";

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

describe("parseJunit", () => {
  it("produces one assertion per testcase with stable IDs", () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="3">
  <testcase classname="MathTest" name="addition"/>
  <testcase classname="MathTest" name="subtraction">
    <failure message="expected 5 got 3"/>
  </testcase>
  <testcase classname="MathTest" name="multiplication"/>
</testsuite>`;

    const assertions = parseJunit(xml);

    expect(assertions).toEqual([
      { id: "MathTest::addition", outcome: "PASS", detail: "MathTest::addition" },
      { id: "MathTest::subtraction", outcome: "FAIL", detail: "expected 5 got 3" },
      { id: "MathTest::multiplication", outcome: "PASS", detail: "MathTest::multiplication" },
    ]);
  });

  it("marks testcases with <error> as ERROR outcome", () => {
    const xml = `<testsuite>
  <testcase classname="Net" name="fetch">
    <error message="timeout"/>
  </testcase>
</testsuite>`;

    const assertions = parseJunit(xml);

    expect(assertions).toEqual([
      { id: "Net::fetch", outcome: "ERROR", detail: "timeout" },
    ]);
  });

  it("handles nested testsuites", () => {
    const xml = `<testsuites>
  <testsuite name="suite1">
    <testcase classname="A" name="one"/>
  </testsuite>
  <testsuite name="suite2">
    <testcase classname="B" name="two"/>
  </testsuite>
</testsuites>`;

    const assertions = parseJunit(xml);

    expect(assertions).toHaveLength(2);
    expect(assertions[0]!.id).toBe("A::one");
    expect(assertions[1]!.id).toBe("B::two");
  });

  it("uses name alone when classname is absent", () => {
    const xml = `<testsuite>
  <testcase name="standalone"/>
</testsuite>`;

    const assertions = parseJunit(xml);

    expect(assertions[0]!.id).toBe("standalone");
  });

  it("throws ParseError on non-XML input", () => {
    expect(() => parseJunit("not xml at all")).toThrow("ParseError");
  });

  it("throws ParseError when no testcase elements found", () => {
    expect(() => parseJunit("<testsuite></testsuite>")).toThrow("ParseError");
  });
});
