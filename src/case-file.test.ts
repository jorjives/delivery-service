import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, writeFile, appendFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, appendEntry, load, logTail, updateCursor, rebuild, resumeAction, setBaseline, setBaseBranch, setOutcome, incrementBudget, writeRef, readRef, deriveStateFromEntry, deriveBudgetsFromLog, setbackOf } from "./case-file.js";
import { FileNotFound, CorruptCaseFile, ImmutabilityViolation } from "./errors.js";
import type { BudgetSet, HistoryEntry, GateReport } from "./schema.js";

const budgetDefaults: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef = { type: "command", command: "npm test", parseMode: "tap" } as const;

describe("create", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-test-"));
  });

  it("writes case.json and empty log.jsonl, returns initial CaseFile", async () => {
    const header = {
      surfaceId: "surface-1",
      taskDef: { intent: "fix bug" },
      gateRef,
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
      gateRef,
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
    expect(JSON.parse(lines[0] as string)).toEqual(entry);
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
    expect(JSON.parse(lines[0] as string)).toEqual(entry1);
    expect(JSON.parse(lines[1] as string)).toEqual(entry2);
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
      gateRef,
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
    const emptyDir = await mkdtemp(join(tmpdir(), "case-file-empty-"));
    await expect(load(emptyDir)).rejects.toThrow(FileNotFound);
  });

  it("throws CorruptCaseFile when case.json has invalid structure", async () => {
    const badDir = await mkdtemp(join(tmpdir(), "case-file-bad-"));
    await writeFile(join(badDir, "case.json"), '{"not":"a case file"}');
    await writeFile(join(badDir, "log.jsonl"), "");
    await expect(load(badDir)).rejects.toThrow(CorruptCaseFile);
  });

  it("throws CorruptCaseFile when case.json is not valid JSON", async () => {
    const badDir = await mkdtemp(join(tmpdir(), "case-file-bad-json-"));
    await writeFile(join(badDir, "case.json"), "not json at all {{{");
    await writeFile(join(badDir, "log.jsonl"), "");
    await expect(load(badDir)).rejects.toThrow(CorruptCaseFile);
  });
});

describe("crash recovery: case.json atomicity", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-crash-"));
  });

  it("a .tmp file left behind by a crashed write does not corrupt load", async () => {
    const header = {
      surfaceId: "surface-atomic",
      taskDef: { intent: "test atomicity" },
      gateRef,
    };

    await create(dir, header, budgetDefaults);

    // Simulate a crash mid-write: leave a .tmp file with garbage
    await writeFile(join(dir, "case.json.tmp"), "partial garbage data");

    // Load should still read the valid case.json, ignoring the orphan .tmp
    const loaded = await load(dir);
    expect(loaded.header.surfaceId).toBe("surface-atomic");
    expect(loaded.cursor.state).toBe("PROVISIONING");
  });
});

describe("crash recovery: truncated log line", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-trunc-"));
    await create(dir, {
      surfaceId: "surface-trunc",
      taskDef: { intent: "test truncation" },
      gateRef,
    }, budgetDefaults);
  });

  it("ignores a truncated final line and returns prior complete entries", async () => {
    const entry: HistoryEntry = {
      t: "dispatch",
      attempt: 1,
      sessionKey: "sess-1",
    };

    await appendEntry(dir, entry);

    // Simulate crash mid-append: write a partial JSON line at the end
    const logPath = join(dir, "log.jsonl");
    await appendFile(logPath, '{"t":"terminus","attempt":1,"ses');

    const loaded = await load(dir);
    expect(loaded.history).toHaveLength(1);
    expect(loaded.history[0]).toEqual(entry);
  });

  it("loads correctly when log has only a truncated line (no complete entries)", async () => {
    const logPath = join(dir, "log.jsonl");
    await writeFile(logPath, '{"t":"dispatch","at');

    const loaded = await load(dir);
    expect(loaded.history).toHaveLength(0);
  });
});

describe("logTail", () => {
  it("returns undefined for empty history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "case-file-tail-"));
    const cf = await create(dir, {
      surfaceId: "s-1",
      taskDef: {},
      gateRef,
    }, budgetDefaults);
    expect(logTail(cf)).toBeUndefined();
  });

  it("returns the last history entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "case-file-tail-"));
    await create(dir, {
      surfaceId: "s-1",
      taskDef: {},
      gateRef,
    }, budgetDefaults);

    const entry1: HistoryEntry = {
      t: "dispatch",
      attempt: 1,
      sessionKey: "s1",
    };
    const entry2: HistoryEntry = {
      t: "terminus",
      attempt: 1,
      sessionKey: "s1",
      status: "completed",
      rationale: "Done",
    };

    await appendEntry(dir, entry1);
    await appendEntry(dir, entry2);

    const loaded = await load(dir);
    const tail = logTail(loaded);
    expect(tail).toEqual(entry2);
  });
});

describe("updateCursor", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-cursor-"));
    await create(dir, {
      surfaceId: "surface-cursor",
      taskDef: { intent: "test cursor update" },
      gateRef,
    }, budgetDefaults);
  });

  it("updates the state field and preserves other cursor fields", async () => {
    await updateCursor(dir, { state: "AGENT_ACTIVE" });

    const loaded = await load(dir);
    expect(loaded.cursor.state).toBe("AGENT_ACTIVE");
    expect(loaded.cursor.budgets).toEqual(budgetDefaults);
    expect(loaded.cursor.worktreeRef).toBe("");
  });

  it("updates the worktreeRef without changing state", async () => {
    await updateCursor(dir, { worktreeRef: "wt-abc-123" });

    const loaded = await load(dir);
    expect(loaded.cursor.state).toBe("PROVISIONING");
    expect(loaded.cursor.worktreeRef).toBe("wt-abc-123");
  });

  it("preserves header and outcome when rewriting case.json", async () => {
    await updateCursor(dir, { state: "GATING" });

    const loaded = await load(dir);
    expect(loaded.header.surfaceId).toBe("surface-cursor");
    expect(loaded.header.baseline).toBeNull();
    expect(loaded.outcome).toBeUndefined();
  });
});

describe("rebuild", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-rebuild-"));
    await create(dir, {
      surfaceId: "surface-rebuild",
      taskDef: { intent: "test rebuild" },
      gateRef,
    }, budgetDefaults);
  });

  it("reconstructs cursor state from the log when case.json is stale", async () => {
    // Append entries that should move state to GATING
    await appendEntry(dir, {
      t: "dispatch",
      attempt: 1,
      sessionKey: "sess-1",
    });
    await appendEntry(dir, {
      t: "terminus",
      attempt: 1,
      sessionKey: "sess-1",
      status: "completed",
      rationale: "Done",
    });

    // Manually desync: case.json still says PROVISIONING
    // (which it does, because appendEntry doesn't update cursor)
    const beforeRebuild = await load(dir);
    expect(beforeRebuild.cursor.state).toBe("PROVISIONING");

    // Rebuild should fix the cursor
    const rebuilt = await rebuild(dir);
    expect(rebuilt.cursor.state).toBe("GATING");
    expect(rebuilt.header.surfaceId).toBe("surface-rebuild");
    expect(rebuilt.history).toHaveLength(2);

    // Verify it was persisted
    const reloaded = await load(dir);
    expect(reloaded.cursor.state).toBe("GATING");
  });

  it("reconstructs budget used counts from the log", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      attempt: 1,
      sessionKey: "sess-1",
    });
    await appendEntry(dir, {
      t: "terminus",
      attempt: 1,
      sessionKey: "sess-1",
      status: "completed",
      rationale: "Done",
    });
    await appendEntry(dir, {
      t: "gate",
      attempt: 1,
      status: "ERROR",
      newFailures: [],
      class: "error",
    });

    const rebuilt = await rebuild(dir);
    // A completed terminus resolves its attempt and costs nothing — the
    // terminus budget caps sessions that ended WITHOUT a valid result.
    expect(rebuilt.cursor.budgets.terminus.used).toBe(0);
    // An errored gate costs nothing by itself: the recheck triage verdict is the burn.
    expect(rebuilt.cursor.budgets.gateError.used).toBe(0);
    expect(rebuilt.cursor.budgets.correction.used).toBe(0);
    // Max values preserved from case.json
    expect(rebuilt.cursor.budgets.terminus.max).toBe(5);
    expect(rebuilt.cursor.budgets.gateError.max).toBe(3);
  });

  it("fails with FileNotFound when case.json is missing", async () => {
    await unlink(join(dir, "case.json"));

    await expect(rebuild(dir)).rejects.toThrow(FileNotFound);
  });

  it("fails with CorruptCaseFile when case.json is unparseable", async () => {
    await writeFile(join(dir, "case.json"), "not valid json {{{");

    await expect(rebuild(dir)).rejects.toThrow(CorruptCaseFile);
  });

  it("derives GATE_MAINTENANCE from a gate-maintenance dispatch tail", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });

    const rebuilt = await rebuild(dir);
    expect(rebuilt.cursor.state).toBe("GATE_MAINTENANCE");
  });

  it("derives GATE_MAINTENANCE from a gate-maintenance terminus of any status", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
      status: "completed",
      rationale: "reinstalled the gate's dependencies",
    });

    const rebuilt = await rebuild(dir);
    // A worker terminus(completed) would derive GATING; the repair agent's does not.
    expect(rebuilt.cursor.state).toBe("GATE_MAINTENANCE");
  });

  it("derives AGENT_ACTIVE, not GATE_MAINTENANCE, once a gate-maintenance repair has re-baselined", async () => {
    // Reproduces issue #14: a gate-maintenance repair completes, then
    // setBaseline re-baselines the surface — advancing it to AGENT_ACTIVE —
    // without appending a history entry marking that. The log tail is still
    // the repair's own completed terminus, so a live `position()` and a
    // resumed `rebuild()` must not disagree about where that leaves the
    // surface.
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
      status: "completed",
      rationale: "reinstalled the gate's dependencies",
    });
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });

    const rebuilt = await rebuild(dir);
    expect(rebuilt.cursor.state).toBe("AGENT_ACTIVE");
  });

  it("counts the gateMaintenance budget off gate-maintenance dispatch entries", async () => {
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
    });
    await appendEntry(dir, {
      t: "terminus",
      role: "gate-maintenance",
      attempt: 1,
      sessionKey: "gate-maintenance-1-0",
      status: "completed",
      rationale: "fixed",
    });
    await appendEntry(dir, {
      t: "dispatch",
      role: "gate-maintenance",
      attempt: 2,
      sessionKey: "gate-maintenance-2-0",
    });

    const rebuilt = await rebuild(dir);
    expect(rebuilt.cursor.budgets.gateMaintenance.used).toBe(2);
    // attempt 2 is a repair attempt, not a worker correction
    expect(rebuilt.cursor.budgets.correction.used).toBe(0);
    // …and a repair session's terminus is not a worker terminus either
    expect(rebuilt.cursor.budgets.terminus.used).toBe(0);
  });
});

describe("resumeAction", () => {
  it("returns 'start' when there are no entries", () => {
    expect(resumeAction(undefined)).toBe("start");
  });

  it("returns 'incomplete_terminus' for a dispatch with no terminus", () => {
    expect(resumeAction({
      t: "dispatch", attempt: 1, sessionKey: "s1",
    })).toBe("incomplete_terminus");
  });

  it("returns 'gate' for terminus(completed)", () => {
    expect(resumeAction({
      t: "terminus", attempt: 1, sessionKey: "s1",
      status: "completed", rationale: "Done",
    })).toBe("gate");
  });

  it("returns 'triage' for terminus(escalate)", () => {
    expect(resumeAction({
      t: "terminus", attempt: 1, sessionKey: "s1",
      status: "escalate", rationale: "Need help",
    })).toBe("triage");
  });

  it("returns 'triage' for terminus(incomplete)", () => {
    expect(resumeAction({
      t: "terminus", attempt: 1, sessionKey: "s1",
      status: "incomplete", rationale: "Ran out",
    })).toBe("triage");
  });

  it("returns 'triage' for gate(FAIL)", () => {
    expect(resumeAction({
      t: "gate", attempt: 1, status: "FAIL",
      newFailures: [{ id: "f1", detailRef: "ref-1" }], class: "fail",
    })).toBe("triage");
  });

  it("returns 'triage' for gate(ERROR)", () => {
    expect(resumeAction({
      t: "gate", attempt: 1, status: "ERROR",
      newFailures: [], class: "error",
    })).toBe("triage");
  });

  it("returns 'close' for gate(PASS)", () => {
    expect(resumeAction({
      t: "gate", attempt: 1, status: "PASS", newFailures: [],
    })).toBe("close");
  });

  it("returns 'act_on_verdict' for a triage entry", () => {
    expect(resumeAction({
      t: "triage", afterAttempt: 1, trigger: "gate_fail",
      verdict: "reroute", rationale: "Try again", artifactRef: "ref-1",
    })).toBe("act_on_verdict");
  });

  it("returns 'close_triage' for close(FAIL)", () => {
    expect(resumeAction({
      t: "close", status: "FAIL", detailRef: "ref-1",
    })).toBe("close_triage");
  });

  it("returns 'close_triage' for close(ERROR)", () => {
    expect(resumeAction({
      t: "close", status: "ERROR", detailRef: "ref-1",
    })).toBe("close_triage");
  });

  it("returns 'done' for close(DONE)", () => {
    expect(resumeAction({
      t: "close", status: "DONE", detailRef: "ref-1",
    })).toBe("done");
  });
});

describe("header immutability", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-immut-"));
    await create(dir, {
      surfaceId: "surface-immut",
      taskDef: { intent: "test immutability" },
      gateRef,
      domainPrompt: "You are a helper.",
    }, budgetDefaults);
  });

  it("header is unchanged after cursor updates and history appends", async () => {
    const original = await load(dir);

    await updateCursor(dir, { state: "AGENT_ACTIVE" });
    await updateCursor(dir, { worktreeRef: "wt-123" });
    await appendEntry(dir, {
      t: "dispatch",
      attempt: 1,
      sessionKey: "sess-1",
    });
    await appendEntry(dir, {
      t: "terminus",
      attempt: 1,
      sessionKey: "sess-1",
      status: "completed",
      rationale: "Done",
    });
    await updateCursor(dir, { state: "GATING" });

    const after = await load(dir);

    expect(after.header).toEqual(original.header);
  });
});

describe("setBaseline", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-baseline-"));
    await create(dir, {
      surfaceId: "surface-bl",
      taskDef: { intent: "test baseline" },
      gateRef,
    }, budgetDefaults);
  });

  it("sets the baseline when it is null", async () => {
    const baseline: GateReport = {
      status: "PASS",
      assertions: [{ id: "1 - alpha", outcome: "PASS", detail: "ok 1 - alpha" }],
    };
    await setBaseline(dir, baseline);

    const loaded = await load(dir);
    expect(loaded.header.baseline).toEqual(baseline);
  });

  it("rejects a second setBaseline with ImmutabilityViolation", async () => {
    const first: GateReport = {
      status: "PASS",
      assertions: [{ id: "1 - alpha", outcome: "PASS", detail: "ok 1 - alpha" }],
    };
    const second: GateReport = {
      status: "PASS",
      assertions: [{ id: "1 - alpha", outcome: "FAIL", detail: "not ok 1 - alpha" }],
    };
    await setBaseline(dir, first);

    await expect(setBaseline(dir, second)).rejects.toThrow(ImmutabilityViolation);

    // Original baseline unchanged
    const loaded = await load(dir);
    expect(loaded.header.baseline).toEqual(first);
  });
  it("rejects a baseline that is not a GateReport", async () => {
    await expect(
      setBaseline(dir, { assertion1: "pass" } as unknown as GateReport),
    ).rejects.toThrow();
  });
});

describe("setOutcome", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-outcome-"));
    await create(dir, {
      surfaceId: "surface-oc",
      taskDef: { intent: "test outcome" },
      gateRef,
    }, budgetDefaults);
  });

  it("sets the outcome when none exists", async () => {
    const outcome = {
      kind: "closed" as const,
      source: "gate",
      reason: "All assertions passed",
      at: "2026-09-04T12:00:00Z",
    };
    await setOutcome(dir, outcome);

    const loaded = await load(dir);
    expect(loaded.outcome).toEqual(outcome);
  });

  it("rejects a second setOutcome with ImmutabilityViolation", async () => {
    const outcome = {
      kind: "closed" as const,
      source: "gate",
      reason: "All assertions passed",
      at: "2026-09-04T12:00:00Z",
    };
    await setOutcome(dir, outcome);

    await expect(
      setOutcome(dir, {
        kind: "escalated" as const,
        source: "triage",
        reason: "Cannot fix",
        at: "2026-09-04T13:00:00Z",
      }),
    ).rejects.toThrow(ImmutabilityViolation);

    // Original outcome unchanged
    const loaded = await load(dir);
    expect(loaded.outcome).toEqual(outcome);
  });
});

describe("incrementBudget", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-budget-"));
    await create(dir, {
      surfaceId: "surface-budget",
      taskDef: { intent: "test budgets" },
      gateRef,
    }, budgetDefaults);
  });

  it("increments the used counter by one and persists it", async () => {
    const result = await incrementBudget(dir, "correction");

    expect(result.used).toBe(1);
    expect(result.max).toBe(3);
    expect(result.exhausted).toBe(false);

    // Verify persistence
    const loaded = await load(dir);
    expect(loaded.cursor.budgets.correction.used).toBe(1);
  });

  it("tracks each of the five populations independently", async () => {
    await incrementBudget(dir, "correction");
    await incrementBudget(dir, "correction");
    await incrementBudget(dir, "terminus");

    const loaded = await load(dir);
    expect(loaded.cursor.budgets.correction.used).toBe(2);
    expect(loaded.cursor.budgets.terminus.used).toBe(1);
    expect(loaded.cursor.budgets.gateError.used).toBe(0);
    expect(loaded.cursor.budgets.gateMaintenance.used).toBe(0);
    expect(loaded.cursor.budgets.close.used).toBe(0);
  });

  it("reports exhausted exactly when used reaches max", async () => {
    // gateMaintenance has max: 2
    const r1 = await incrementBudget(dir, "gateMaintenance");
    expect(r1).toEqual({ used: 1, max: 2, exhausted: false });

    const r2 = await incrementBudget(dir, "gateMaintenance");
    expect(r2).toEqual({ used: 2, max: 2, exhausted: true });
  });

  it("allows incrementing past the cap and still reports exhausted", async () => {
    // gateMaintenance has max: 2
    await incrementBudget(dir, "gateMaintenance");
    await incrementBudget(dir, "gateMaintenance");

    const r3 = await incrementBudget(dir, "gateMaintenance");
    expect(r3).toEqual({ used: 3, max: 2, exhausted: true });

    // Verify it persisted the over-cap value
    const loaded = await load(dir);
    expect(loaded.cursor.budgets.gateMaintenance.used).toBe(3);
  });
});

describe("reference storage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-file-ref-"));
    await create(dir, {
      surfaceId: "surface-ref",
      taskDef: { intent: "test refs" },
      gateRef,
    }, budgetDefaults);
  });

  it("round-trips a reference blob by ID", async () => {
    const data = {
      assertion: "homepage-loads",
      expected: 200,
      actual: 500,
      diff: "status code mismatch",
    };

    const returnedId = await writeRef(dir, "gate-detail-1", data);

    expect(returnedId).toBe("gate-detail-1");

    const retrieved = await readRef(dir, "gate-detail-1");
    expect(retrieved).toEqual(data);
  });

  it("throws FileNotFound when reading a ref that does not exist", async () => {
    await expect(readRef(dir, "no-such-ref")).rejects.toThrow(FileNotFound);
  });

  it("stores multiple refs independently", async () => {
    await writeRef(dir, "gate-detail-1", { id: "first" });
    await writeRef(dir, "gate-detail-2", { id: "second" });

    const first = await readRef(dir, "gate-detail-1");
    const second = await readRef(dir, "gate-detail-2");

    expect(first).toEqual({ id: "first" });
    expect(second).toEqual({ id: "second" });
  });

  it("a history entry's detailRef can be followed to retrieve the referenced content", async () => {
    const failureDetail = {
      assertion: "homepage-loads",
      expected: 200,
      actual: 500,
      screenshot: "base64-data-would-go-here",
      logs: ["GET / -> 500", "Internal Server Error"],
    };

    // Write the ref before the history entry (crash-safe ordering)
    await writeRef(dir, "gate-detail-1", failureDetail);

    // Record a gate failure that points to the ref
    const gateEntry: HistoryEntry = {
      t: "gate",
      attempt: 1,
      status: "FAIL",
      newFailures: [{ id: "homepage-loads", detailRef: "gate-detail-1" }],
      class: "fail",
    };
    await appendEntry(dir, gateEntry);

    // Load the case file and follow the pointer
    const loaded = await load(dir);
    const tail = loaded.history.at(-1);
    if (!tail || tail.t !== "gate") {
      throw new Error("expected a gate history entry");
    }

    const firstFailure = tail.newFailures[0];
    if (!firstFailure) {
      throw new Error("expected at least one failure on the gate entry");
    }
    const retrieved = await readRef(dir, firstFailure.detailRef);

    expect(retrieved).toEqual(failureDetail);
  });
});

describe("deriveStateFromEntry", () => {
  it("derives INCOMPLETE_TERMINUS from a worker dispatch that is still the tail", () => {
    // A dispatch with no terminus is a session that ended without a valid
    // result — not a session to resurrect by dispatching a second one.
    expect(deriveStateFromEntry({
      t: "dispatch", attempt: 1, sessionKey: "worker-1-0",
    })).toBe("INCOMPLETE_TERMINUS");
    expect(deriveStateFromEntry({
      t: "dispatch", attempt: 1, sessionKey: "worker-1-0", role: "worker",
    })).toBe("INCOMPLETE_TERMINUS");
  });

  it("derives ESCALATED from an authority-class worker escalate", () => {
    expect(deriveStateFromEntry({
      t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate",
      category: "authority", rationale: "needs a credential I do not hold",
    })).toBe("ESCALATED");
  });

  it("derives TRIAGE from an exhaustion-class worker escalate", () => {
    // The deterministic router still gets first look at an exhaustion-class
    // escalate; only an authority limit is terminal on the spot.
    expect(deriveStateFromEntry({
      t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate",
      category: "exhaustion", rationale: "out of ideas",
    })).toBe("TRIAGE");
  });
});

describe("deriveBudgetsFromLog attribution", () => {
  const maxima: BudgetSet = {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  };

  it("charges nothing for a worker session that resolved", () => {
    const history: HistoryEntry[] = [
      { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" },
      { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "done" },
      { t: "close", status: "DONE", detailRef: "close-0" },
    ];

    const budgets = deriveBudgetsFromLog(history, maxima);

    // Budgets cap RETRIES. A clean run through burns none of them.
    expect(budgets.terminus.used).toBe(0);
    expect(budgets.close.used).toBe(0);
    expect(budgets.correction.used).toBe(0);
  });

  it("charges the terminus budget once per worker session that ended without a result", () => {
    const history: HistoryEntry[] = [
      { t: "dispatch", attempt: 1, sessionKey: "worker-1-0" },
      { t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "incomplete", rationale: "crashed" },
      { t: "dispatch", attempt: 1, sessionKey: "worker-1-1" },
      { t: "terminus", attempt: 1, sessionKey: "worker-1-1", status: "incomplete", rationale: "capped" },
    ];

    expect(deriveBudgetsFromLog(history, maxima).terminus.used).toBe(2);
  });

  it("never charges a repair sessions incomplete terminus to the workers budget", () => {
    const history: HistoryEntry[] = [
      { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" },
      { t: "terminus", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0", status: "incomplete", rationale: "crashed" },
    ];

    const budgets = deriveBudgetsFromLog(history, maxima);

    // The repair sessions cost is burned on gateMaintenance by its own
    // dispatch entry — counting it twice would charge a repair to the worker.
    expect(budgets.terminus.used).toBe(0);
    expect(budgets.gateMaintenance.used).toBe(1);
  });

  it("charges correction and close to the triage verdicts that caused them", () => {
    const history: HistoryEntry[] = [
      { t: "triage", afterAttempt: 1, trigger: "gate_fail", verdict: "reroute", rationale: "regression", artifactRef: "triage-0" },
      { t: "triage", afterAttempt: 2, trigger: "close_failure", verdict: "retry_close", rationale: "flaked", artifactRef: "triage-1" },
      { t: "triage", afterAttempt: 2, trigger: "gate_fail", verdict: "escalate", rationale: "out of road", artifactRef: "triage-2" },
    ];

    const budgets = deriveBudgetsFromLog(history, maxima);

    expect(budgets.correction.used).toBe(1);
    expect(budgets.close.used).toBe(1);
  });

  it("burns gateError on a recheck_gate triage verdict, never on the ERROR gate entry itself", () => {
    const maxima = {
      correction: { used: 0, max: 3 },
      gateError: { used: 0, max: 3 },
      gateMaintenance: { used: 0, max: 2 },
      terminus: { used: 0, max: 5 },
      close: { used: 0, max: 3 },
    };
    const history: HistoryEntry[] = [
      { t: "gate", attempt: 1, status: "ERROR", newFailures: [], class: "error" },
      { t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "recheck_gate", rationale: "r", artifactRef: "triage-0" },
      { t: "gate", attempt: 1, status: "ERROR", newFailures: [], class: "error" },
    ];
    expect(deriveBudgetsFromLog(history, maxima).gateError).toEqual({ used: 1, max: 3 });
  });

  it("routes a recheck_gate verdict back to GATING", () => {
    expect(
      deriveStateFromEntry({ t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "recheck_gate", rationale: "r", artifactRef: "triage-0" }),
    ).toBe("GATING");
  });
});

describe("setbackOf", () => {
  it("classifies a failed gate as gate_fail and an errored gate as gate_error", () => {
    expect(setbackOf({ t: "gate", attempt: 1, status: "FAIL", newFailures: [] })).toEqual({ trigger: "gate_fail" });
    expect(setbackOf({ t: "gate", attempt: 1, status: "ERROR", newFailures: [] })).toEqual({ trigger: "gate_error" });
  });

  it("classifies a close entry as close_failure", () => {
    expect(setbackOf({ t: "close", status: "FAIL", detailRef: "close-0" })).toEqual({ trigger: "close_failure" });
  });

  it("classifies a worker escalate with its category", () => {
    expect(
      setbackOf({ t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "escalate", category: "exhaustion", rationale: "stuck" }),
    ).toEqual({ trigger: "worker_escalate", category: "exhaustion" });
  });

  it("returns undefined for a tail that is not a setback", () => {
    expect(setbackOf(undefined)).toBeUndefined();
    expect(setbackOf({ t: "dispatch", attempt: 1, sessionKey: "worker-1-0" })).toBeUndefined();
    expect(setbackOf({ t: "terminus", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "ok" })).toBeUndefined();
  });
});

const header = { surfaceId: "surface-base", taskDef: { intent: "x" }, gateRef };

describe("setBaseBranch", () => {
  it("starts null and records the branch the surface was started from", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-branch-"));
    await create(dir, header, budgetDefaults);
    expect((await load(dir)).header.baseBranch).toBeNull();

    await setBaseBranch(dir, "main");

    expect((await load(dir)).header.baseBranch).toBe("main");
  });

  it("refuses a second write, like every other set-once header field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-branch-"));
    await create(dir, header, budgetDefaults);
    await setBaseBranch(dir, "main");

    await expect(setBaseBranch(dir, "release")).rejects.toThrow(ImmutabilityViolation);
  });

  it("records no history entry, so the log tail still drives the state machine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "base-branch-"));
    await create(dir, header, budgetDefaults);

    await setBaseBranch(dir, "main");

    expect((await load(dir)).history).toEqual([]);
  });
});
