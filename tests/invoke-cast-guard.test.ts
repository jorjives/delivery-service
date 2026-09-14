import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { REPO_ROOT } from "./helpers.js";

// Linted as if it were the named file's content, through the project's own
// ESLint config. The paths must be real files so the type-aware parser accepts them.
const CAST = `import type { AgentPort } from "./ports.js";
export const agent: AgentPort = { invoke: (() => Promise.reject(new Error("x"))) as AgentPort["invoke"] };
`;

async function castFindings(filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(CAST, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("the agent port cast guard", () => {
  it("fails lint for a cast to the agent port's invoke signature in a test", async () => {
    expect(await castFindings("src/surface.test.ts")).toEqual([
      'Build agent doubles with fakeAgentPort from src/testing.ts: a cast to AgentPort["invoke"] lets a reply of the wrong shape for its role compile.',
    ]);
  }, 60_000);

  it("fails lint for the same cast in a demo", async () => {
    expect(await castFindings("demos/single-surface-slice-2-happy-path.ts")).toHaveLength(1);
  }, 60_000);

  it("allows the cast only where the two agent ports dispatch", async () => {
    expect(await castFindings("src/agent-invoke.ts")).toEqual([]);
    expect(await castFindings("src/agent-port-double.ts")).toEqual([]);
  }, 60_000);
});
