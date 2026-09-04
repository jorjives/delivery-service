import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create } from "./case-file.js";
import type { BudgetSet } from "./schema.js";

const budgetDefaults: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

describe("create", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-test-"));
  });

  it("writes case.json and empty log.jsonl, returns initial CaseFile", async () => {
    const header = {
      surfaceId: "surface-1",
      taskDef: { intent: "fix bug" },
      gateRef: { gateId: "gate-1", version: 1 },
      domainPrompt: "You are a helper.",
    };

    const result = await create(dir, header, budgetDefaults);

    // Returned CaseFile shape
    expect(result.header.surfaceId).toBe("surface-1");
    expect(result.header.baseline).toBeNull();
    expect(result.cursor.state).toBe("PROVISIONING");
    expect(result.cursor.budgets).toEqual(budgetDefaults);
    expect(result.history).toEqual([]);
    expect(result.outcome).toBeUndefined();

    // Files on disk
    const caseJsonRaw = await readFile(join(dir, "case.json"), "utf-8");
    const caseJson = JSON.parse(caseJsonRaw);
    expect(caseJson.header.surfaceId).toBe("surface-1");
    expect(caseJson.cursor.state).toBe("PROVISIONING");

    const logRaw = await readFile(join(dir, "log.jsonl"), "utf-8");
    expect(logRaw).toBe("");
  });
});
