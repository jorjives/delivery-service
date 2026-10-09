import { describe, expect, it } from "vitest";
import { z } from "zod";
import { eachIssue, fieldOf, valueAt } from "./schema-issues.js";

describe("schema issues as a person fixes a file", () => {
  it("reads the value a file held at a path, and nothing past a value that is not an object", () => {
    const raw = { scan: { checks: ["anchor-gone", "page-contains"] } };
    expect(valueAt(raw, ["scan", "checks", 1])).toBe("page-contains");
    expect(valueAt(raw, ["scan", "missing", "deeper"])).toBeUndefined();
    expect(valueAt("text", ["scan"])).toBeUndefined();
  });

  it("splits several unknown keys into one issue each, named at their own place", () => {
    const error = z.strictObject({ scan: z.strictObject({ prompt: z.string() }) }).safeParse({ scan: { prompt: "x", tools: [], commands: [] } }).error;
    if (error === undefined) throw new Error("expected a parse error");
    expect(eachIssue(error).map(fieldOf)).toEqual(["scan.tools", "scan.commands"]);
  });

  it("names a problem with the file as a whole as no field", () => {
    const error = z.object({ a: z.string() }).safeParse("not an object").error;
    if (error === undefined) throw new Error("expected a parse error");
    expect(eachIssue(error).map(fieldOf)).toEqual([null]);
  });
});
