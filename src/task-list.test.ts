import { describe, expect, it } from "vitest";
import { taskId } from "./task-list.js";

describe("taskId", () => {
  it("is the same for the same task however its keys are ordered", () => {
    expect(taskId({ intent: "a", workflow: "build" })).toBe(taskId({ workflow: "build", intent: "a" }));
  });
  it("differs when the task's words differ, and is twelve hex characters", () => {
    expect(taskId({ intent: "a" })).not.toBe(taskId({ intent: "b" }));
    expect(taskId({ intent: "a" })).toMatch(/^[0-9a-f]{12}$/);
  });
  it("reads nested values by content too", () => {
    expect(taskId({ intent: "a", spec: { path: "x", n: 1 } })).toBe(taskId({ intent: "a", spec: { n: 1, path: "x" } }));
  });
});
