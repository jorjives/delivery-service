import { describe, expect, it } from "vitest";
import { gitGrepFiles } from "./helpers.js";

// Tests, demos and the agent guides reach claude-mock only through mockSessionEnvironment,
// which resolves the copy `npm install` provides. Naming the bare command, or skipping
// when it is not on PATH, brings back the machine-local setup vendoring removed: such a
// suite silently runs nothing in CI or on a fresh clone.
const SCOPE = [
  "src",
  "demos",
  "tests",
  "docs/configuring-a-role.md",
  "docs/testing-your-pipeline.md",
  ":(exclude)tests/scripted-agent-reachability.test.ts",
  ":(exclude)tests/agent-mock/2-the-scripted-agent-is-there-after-a-plain-install.test.ts",
];

describe("reaching the scripted agent", () => {
  it("no test, demo or guide names claude-mock as the executable to run", () => {
    expect(gitGrepFiles('pathToClaudeCodeExecutable: "claude-mock"', SCOPE)).toEqual([]);
  });

  it("no test or demo skips or refuses when claude-mock is not on PATH", () => {
    expect(gitGrepFiles("isOnPath|mockMissing|claude-mock is not on PATH", SCOPE)).toEqual([]);
  });
});
