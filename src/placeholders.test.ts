import { describe, it, expect } from "vitest";
import { renderSettings, renderTask, settingNamesIn, unmatchedTaskPlaceholders } from "./placeholders.js";

describe("renderSettings", () => {
  it("replaces every use of a setting, and two settings on one line", () => {
    expect(renderSettings("Read {{settings.docs}}; then {{settings.docs}} and {{settings.old}}.", { docs: "docs/api", old: "src/old" }))
      .toBe("Read docs/api; then docs/api and src/old.");
  });
  it("leaves a setting it has no value for, and a task field, as written", () => {
    expect(renderSettings("{{settings.other}} {{task.file}}", { docs: "d" })).toBe("{{settings.other}} {{task.file}}");
  });
  it("renders in one pass: a value is never read again as a placeholder", () => {
    expect(renderSettings("{{settings.a}}", { a: "{{settings.b}}", b: "x" })).toBe("{{settings.b}}");
  });
});
describe("settingNamesIn", () => {
  it("names each setting once, in first-use order", () => {
    expect(settingNamesIn("{{settings.b}} {{settings.a}} {{settings.b}} {{task.x}}")).toEqual(["b", "a"]);
  });
});
describe("renderTask and unmatchedTaskPlaceholders", () => {
  it("fills task fields and leaves settings placeholders alone", () => {
    expect(renderTask("{{task.file}} {{settings.docs}}", { intent: "x", file: "a.js" })).toBe("a.js {{settings.docs}}");
  });
  it("names unmatched task placeholders once", () => {
    expect(unmatchedTaskPlaceholders("{{task.a}} {{task.a}} {{task.intent}}", { intent: "x" })).toEqual(["{{task.a}}"]);
  });
});
