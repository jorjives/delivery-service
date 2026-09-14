import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../src/git-env.js";
import { REPO_ROOT } from "./helpers.js";

// Tests, demos and the role guide reach claude-mock only through mockSessionEnvironment,
// which resolves the copy `npm install` provides. Naming the bare command, or skipping
// when it is not on PATH, brings back the machine-local setup vendoring removed: such a
// suite silently runs nothing in CI or on a fresh clone.
const SCOPE = ["src", "demos", "tests", "docs/configuring-a-role.md", ":(exclude)tests/scripted-agent-reachability.test.ts"];

function filesMatching(pattern: string): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-E", pattern, "--", ...SCOPE], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: cleanGitEnv(),
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []; // git grep found nothing
    throw err;
  }
}

describe("reaching the scripted agent", () => {
  it("no test, demo or guide names claude-mock as the executable to run", () => {
    expect(filesMatching('pathToClaudeCodeExecutable: "claude-mock"')).toEqual([]);
  });

  it("no test or demo skips or refuses when claude-mock is not on PATH", () => {
    expect(filesMatching("isOnPath|mockMissing|claude-mock is not on PATH")).toEqual([]);
  });
});
