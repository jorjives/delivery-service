import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import type { CloserRef, GateRef } from "../schema.js";
import type { DeliveryConfig } from "./config.js";
import type { ProjectSettings } from "./settings.js";
import { checkedLines } from "./validate-command.js";

const NPM_TEST: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

function project(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return { gateRef: NPM_TEST, closerRef: { type: "commit-to-branch" }, budgets: DEFAULT_BUDGETS, ...overrides };
}

describe("what validate says a project is set up to do", () => {
  it("says the description is there, how many tasks are queued, what the check runs and what the closing action does", () => {
    const config: DeliveryConfig = { domain: "A tool.", tasks: ["add a page", "add a form", "add a test"] };
    expect(checkedLines(config, project({ domainPrompt: "A tool." }))).toEqual([
      "✓ domain description: present",
      "✓ 3 tasks queued",
      "✓ gate: runs `npm test`",
      "✓ closer: commits to a new branch",
    ]);
  });

  it("says a missing description is optional, rather than calling it a problem", () => {
    expect(checkedLines({}, project())[0]).toBe("✓ domain description: none (it's optional)");
  });

  it("counts one queued task in the singular", () => {
    expect(checkedLines({ tasks: ["add a page"] }, project())[1]).toBe("✓ 1 task queued");
  });

  it("says a single task set in `task` is there", () => {
    expect(checkedLines({ task: { intent: "add a page" } }, project())[1]).toBe("✓ 1 task, set in `task`");
  });

  it("says where to give a task when the file names none, which is still ready to run", () => {
    expect(checkedLines({}, project())[1]).toBe('✓ no tasks listed: name one when you run, with `delivery run --task "..."`');
  });

  it("names a custom check by the module it lives in", () => {
    const gateRef: GateRef = { type: "custom", modulePath: "./gates/mine.mjs" };
    expect(checkedLines({}, project({ gateRef }))[2]).toBe("✓ gate: your own check, in `./gates/mine.mjs`");
  });

  it.each<[CloserRef, string]>([
    [{ type: "commit-to-branch" }, "✓ closer: commits to a new branch"],
    [{ type: "merge-back" }, "✓ closer: merges into your base branch"],
    [{ type: "open-pr" }, "✓ closer: opens a pull request"],
    [{ type: "custom", modulePath: "./closers/mine.mjs" }, "✓ closer: your own closing action, in `./closers/mine.mjs`"],
  ])("says what the closing action %j does", (closerRef, line) => {
    expect(checkedLines({}, project({ closerRef }))[3]).toBe(line);
  });
});
