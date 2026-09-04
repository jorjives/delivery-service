import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, appendEntry, load } from "./case-file.js";
import type { BudgetSet, HistoryEntry } from "./schema.js";

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

describe("appendEntry", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-test-"));
    await create(dir, {
      surfaceId: "surface-1",
      taskDef: { intent: "fix bug" },
      gateRef: { gateId: "gate-1", version: 1 },
    }, budgetDefaults);
  });

  it("appends a JSON line to log.jsonl", async () => {
    const entry: HistoryEntry = {
      t: "dispatch",
      attempt: 1,
      sessionKey: "session-abc",
    };

    await appendEntry(dir, entry);

    const logRaw = await readFile(join(dir, "log.jsonl"), "utf-8");
    const lines = logRaw.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const line = lines.at(0);
    expect(line).toBeDefined();
    if (line) {
      expect(JSON.parse(line)).toEqual(entry);
    }
  });

  it("appends multiple entries in order", async () => {
    const entry1: HistoryEntry = {
      t: "dispatch",
      attempt: 1,
      sessionKey: "session-1",
    };
    const entry2: HistoryEntry = {
      t: "terminus",
      attempt: 1,
      sessionKey: "session-1",
      status: "completed",
      rationale: "All done",
    };

    await appendEntry(dir, entry1);
    await appendEntry(dir, entry2);

    const logRaw = await readFile(join(dir, "log.jsonl"), "utf-8");
    const lines = logRaw.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const line0 = lines.at(0);
    const line1 = lines.at(1);
    expect(line0).toBeDefined();
    expect(line1).toBeDefined();
    if (line0 && line1) {
      expect(JSON.parse(line0)).toEqual(entry1);
      expect(JSON.parse(line1)).toEqual(entry2);
    }
  });
});

describe("load", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-test-"));
  });

  it("round-trips a case file with history entries", async () => {
    const header = {
      surfaceId: "surface-rt",
      taskDef: { intent: "round trip" },
      gateRef: { gateId: "gate-rt", version: 2 },
    };

    await create(dir, header, budgetDefaults);

    const entry1: HistoryEntry = {
      t: "dispatch",
      attempt: 1,
      sessionKey: "sess-1",
    };
    const entry2: HistoryEntry = {
      t: "terminus",
      attempt: 1,
      sessionKey: "sess-1",
      status: "completed",
      rationale: "Done",
    };

    await appendEntry(dir, entry1);
    await appendEntry(dir, entry2);

    const loaded = await load(dir);

    expect(loaded.header.surfaceId).toBe("surface-rt");
    expect(loaded.header.baseline).toBeNull();
    expect(loaded.cursor.state).toBe("PROVISIONING");
    expect(loaded.cursor.budgets).toEqual(budgetDefaults);
    expect(loaded.history).toHaveLength(2);
    expect(loaded.history[0]).toEqual(entry1);
    expect(loaded.history[1]).toEqual(entry2);
    expect(loaded.outcome).toBeUndefined();
  });

  it("throws FileNotFound when case.json does not exist", async () => {
    const { FileNotFound } = await import("./errors.js");
    const emptyDir = await mkdtemp(join(tmpdir(), "case-file-empty-"));
    await expect(load(emptyDir)).rejects.toThrow(FileNotFound);
  });

  it("throws CorruptCaseFile when case.json has invalid structure", async () => {
    const { CorruptCaseFile } = await import("./errors.js");
    const badDir = await mkdtemp(join(tmpdir(), "case-file-bad-"));
    await writeFile(join(badDir, "case.json"), '{"not":"a case file"}');
    await writeFile(join(badDir, "log.jsonl"), "");
    await expect(load(badDir)).rejects.toThrow(CorruptCaseFile);
  });

  it("throws CorruptCaseFile when case.json is not valid JSON", async () => {
    const { CorruptCaseFile } = await import("./errors.js");
    const badDir = await mkdtemp(join(tmpdir(), "case-file-bad-json-"));
    await writeFile(join(badDir, "case.json"), "not json at all {{{");
    await writeFile(join(badDir, "log.jsonl"), "");
    await expect(load(badDir)).rejects.toThrow(CorruptCaseFile);
  });
});
