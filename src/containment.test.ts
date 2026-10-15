import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialCaseFile } from "./case-file.js";
import { DEFAULT_BUDGETS } from "./budgets.js";
import { containedSession } from "./containment.js";
import type { CaseFileHeader, FenceRecord } from "./schema.js";
import { initTempRepo } from "./temp-repo.js";

const headerWith = (fence: FenceRecord | undefined): CaseFileHeader => ({
  ...initialCaseFile({ surfaceId: "s", taskDef: { intent: "x" }, gateRef: { type: "command", command: "true", parseMode: "exitcode" } }, DEFAULT_BUDGETS).header,
  ...(fence === undefined ? {} : { fence }),
});

describe("a contained session", () => {
  const repo = initTempRepo("containment-", { "a.txt": "a\n" });
  const place = (fence: FenceRecord | undefined) => ({ header: headerWith(fence), repoPath: repo, worktreePath: "/elsewhere", env: { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "containment-state-")) } });

  it("starts its runtime through the fence when the run started with one", async () => {
    const session = await containedSession({ pathToClaudeCodeExecutable: "/opt/claude" }, place({ mode: "preferred", devices: [], state: { present: true } }));
    expect(session.pathToClaudeCodeExecutable).toMatch(/delivery-service\/fence\/[0-9a-f]{16}\.sh$/);
  });

  it("starts it as it is when the fence was absent or the record predates it", async () => {
    const absent: FenceRecord = { mode: "preferred", devices: [], state: { present: false, reason: "r" } };
    for (const fence of [absent, undefined]) {
      expect((await containedSession({ pathToClaudeCodeExecutable: "/opt/claude" }, place(fence))).pathToClaudeCodeExecutable).toBe("/opt/claude");
    }
  });
});
