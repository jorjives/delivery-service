import { describe, it, expect } from "vitest";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initTempRepo } from "./temp-repo.js";
import { git } from "../tests/helpers.js";
import type { Gate } from "./command-gate.js";
import { guardedGate } from "./task-guards.js";
import { acceptedOf, judgedRepair } from "./repair-guards.js";
import type { CaseFileHeader, GateRef, HistoryEntry } from "./schema.js";

const TEST = "import { test } from 'node:test';\ntest('adds', () => {});\n";
const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };
const passing: Gate = { baseline: async () => ({ status: "PASS", assertions: [] }), check: async () => ({ status: "PASS", assertions: [] }) };

function run(files: Record<string, string> = { "sum.test.js": TEST, "vitest.config.js": "export default {};\n" }) {
  const repo = initTempRepo("repair-guards-", files);
  const header: CaseFileHeader = {
    surfaceId: "surface-1",
    taskDef: { intent: "fix bug" },
    gateRef: GATE,
    startCommit: git(repo, ["rev-parse", "HEAD"]),
    baseBranch: "main",
    baseline: null,
  };
  return { repo, header, run: { header, repoPath: repo, history: [] as HistoryEntry[] } };
}

describe("a gate repair, judged on its own change", () => {
  it("is accepted when it changes how tests run, and records the setting it was accepted as changing", async () => {
    const { repo, run: r } = run();
    const { verdict } = await judgedRepair(repo, r, async () => writeFileSync(join(repo, "vitest.config.js"), "export default { test: { pool: 'forks' } };\n"));
    expect(verdict.refused).toBeNull();
    expect(Object.keys(verdict.accepted)).toEqual(["vitest.config.js"]);
  });

  it("is refused when it deletes a test, and accepts nothing", async () => {
    const { repo, run: r } = run();
    const { verdict } = await judgedRepair(repo, r, async () => rmSync(join(repo, "sum.test.js")));
    expect(verdict.refused).toContain("sum.test.js deleted");
    expect(verdict.accepted).toEqual({});
  });

  it("is refused when it adds a skip marker to a test", async () => {
    const { repo, run: r } = run();
    const { verdict } = await judgedRepair(repo, r, async () => writeFileSync(join(repo, "sum.test.js"), `${TEST}test.skip('later', () => {});\n`));
    expect(verdict.refused).toContain("sum.test.js");
  });

  it("is refused when it hides a file from git", async () => {
    const { repo, run: r } = run();
    const { verdict } = await judgedRepair(repo, r, async () => git(repo, ["update-index", "--assume-unchanged", "sum.test.js"]));
    expect(verdict.refused).toContain("hidden from git");
  });

  it("is not blamed for what was already wrong before it ran", async () => {
    const { repo, run: r } = run();
    writeFileSync(join(repo, ".gitignore"), "hidden.test.js\n");
    writeFileSync(join(repo, "hidden.test.js"), "test.only('x', () => {});\n");
    const { verdict } = await judgedRepair(repo, r, async () => undefined);
    expect(verdict.refused).toBeNull();
  });

  it("is an error never a pass when the guards cannot be worked out", async () => {
    const { repo, run: r } = run();
    const broken = { ...r, header: { ...r.header, startCommit: "0".repeat(40) } };
    const { verdict } = await judgedRepair(repo, broken, async () => undefined);
    expect(verdict.refused).toContain("could not be checked");
  });
});

describe("the accepted settings", () => {
  it("stop counting against the worker while they stand as the repair left them, and count again once edited", async () => {
    const { repo, header, run: r } = run();
    const { verdict } = await judgedRepair(repo, r, async () => writeFileSync(join(repo, "vitest.config.js"), "export default { test: { pool: 'forks' } };\n"));
    const gate = guardedGate(passing, { commit: header.startCommit as string }, verdict.accepted);
    const ctx = { worktreePath: repo, taskDef: header.taskDef, gateRef: GATE };
    expect((await gate.check(ctx)).status).toBe("PASS");

    writeFileSync(join(repo, "vitest.config.js"), "export default { test: { include: [] } };\n");
    const after = await gate.check(ctx);
    expect(after.status).toBe("FAIL");
    expect(after.assertions.filter((a) => a.outcome === "FAIL").map((a) => a.id)).toEqual(["guard:check-untouched"]);
  });

  it("do not excuse a setting the worker had changed before the repair touched it too", async () => {
    const { repo, header, run: r } = run();
    writeFileSync(join(repo, "vitest.config.js"), "export default { test: { include: [] } };\n"); // the worker's own change
    const { verdict } = await judgedRepair(repo, r, async () => writeFileSync(join(repo, "vitest.config.js"), "export default { test: { include: [], pool: 'forks' } };\n"));
    expect(verdict.accepted).toEqual({});
    const gate = guardedGate(passing, { commit: header.startCommit as string }, verdict.accepted);
    expect((await gate.check({ worktreePath: repo, taskDef: header.taskDef, gateRef: GATE })).status).toBe("FAIL");
  });

  it("are read back from the history, a later repair's fingerprint winning", () => {
    const history = [
      { t: "repair_accepted", sessionKey: "a", settings: { "vitest.config.js": "1" } },
      { t: "repair_accepted", sessionKey: "b", settings: { "vitest.config.js": "2", Makefile: "3" } },
    ] as HistoryEntry[];
    expect(acceptedOf(history)).toEqual({ "vitest.config.js": "2", Makefile: "3" });
  });
});
