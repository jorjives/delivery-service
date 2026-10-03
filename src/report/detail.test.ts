import { describe, expect, it } from "vitest";
import { deriveReport } from "./derive.js";
import { detailLines, RESUME_DOES_NOT_APPLY, repairLine, repairLines, rollUpLines, UNCHANGED_NOT_RUN_AGAIN } from "./detail.js";
import type { ReportRepair, ReportSurface } from "./document.js";
import { attempt, BRIEF, CHANGES_TOUCHING_CHECK, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, HOMEPAGE, homepageAsks, ID, PACKET, recordOf, runFileOf, snapshotOf, stoppedAt } from "./report-fixtures.js";
import type { RecordSnapshot } from "./snapshot.js";
import { renderText } from "./text.js";

const FOOTER_REFS = {
  [ID.footer]: {
    "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: BRIEF },
    // Round 2 wrote no brief, as the rule-based router never does; round 3's ref (`triage-2`) is lost.
    "triage-1": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
    "triage-3": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET },
  },
};

/** The one task a snapshot is about, as the report document holds it. */
function surfaceOf(record: typeof footerFailed, over: Partial<RecordSnapshot> = {}): ReportSurface {
  const [surface] = deriveReport(snapshotOf({ subject: { kind: "task", runId: record.runId }, records: [record], ...over })).surfaces;
  if (surface === undefined) throw new Error(`no surface for ${record.runId}`);
  return surface;
}

const short = (record: typeof footerFailed, over: Partial<RecordSnapshot> = {}): string[] => detailLines(surfaceOf(record, over), { full: false, patches: false });

describe("the detail under a stopped task's status", () => {
  it("reads, in full, as how it got here, the retries it had used, and what to do", () => {
    expect(short(footerFailed, { refs: FOOTER_REFS })).toEqual([
      "How it got here (triage rounds; --decisions for the full text):",
      "  After attempt 1: a gate failure; verdict: reroute",
      "  After attempt 2: a gate failure; verdict: reroute",
      "  After attempt 3: a gate failure; verdict: reroute",
      "  After attempt 4: a gate failure; verdict: escalate",
      "",
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Repairs: none ran for this task.",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
    ]);
  });

  it("gives the same advice the report gives for the same task", () => {
    const snapshot = snapshotOf({ records: [formDone, footerFailed, homepageAsks] });
    const report = renderText(deriveReport(snapshot), { colour: false });

    for (const record of [footerFailed, homepageAsks]) {
      const advice = short(record).filter((line) => /^(To act:| {8}\d\.)/.test(line));
      expect(advice.length).toBeGreaterThan(0);
      for (const line of advice) expect(report).toContain(`    ${line}`);
    }
  });

  it("does not say the list retells a task the list does not ask for", () => {
    const lines = short(footerFailed, { list: [] });

    expect(lines).not.toContain(UNCHANGED_NOT_RUN_AGAIN);
    expect(lines.slice(-2)).toEqual(['To act: Reword the task and run it again: delivery run --task "the reworded task"', RESUME_DOES_NOT_APPLY]);
  });

  it("never advises picking up a run that has ended", () => {
    for (const record of [footerFailed, homepageAsks]) {
      expect(short(record).filter((line) => line.includes("delivery resume"))).toEqual([RESUME_DOES_NOT_APPLY]);
    }
  });

  it("uses the harness's own words for the technical parts", () => {
    const technical = short(footerFailed).slice(0, 8).join("\n");

    for (const word of ["triage", "gate", "correction", "verdict", "reroute", "escalate"]) expect(technical).toContain(word);
  });

  it("shows a trigger it has no words for as the record holds it, with anything that could drive the terminal taken out", () => {
    const odd = recordOf({
      runId: ID.footer,
      task: FOOTER,
      history: [...attempt(1, "x"), { t: "triage", afterAttempt: 1, trigger: "moon_\u001B[31mphase", verdict: "abort", rationale: "no", artifactRef: "triage-0" }],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "triage_abort" }, "no", "aborted"),
    });

    expect(short(odd)[1]).toBe("  After attempt 1: moon_phase; verdict: abort");
  });
});

describe("every triage round in full", () => {
  const full = (record: typeof footerFailed, over: Partial<RecordSnapshot> = {}): string[] => detailLines(surfaceOf(record, over), { full: true, patches: false });

  it("prints each round's trigger, verdict and reasoning word for word, then the brief or packet it produced", () => {
    const lines = full(footerFailed, { refs: FOOTER_REFS });

    expect(lines.slice(0, lines.indexOf(""))).toEqual([
      "How it got here (4 triage rounds, in full):",
      "  Round 1, after attempt 1",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session:",
      "      Problem: Two footer links point at pages that were removed.",
      "      Dead ends: Attempt 1 rewrote the link text and left the targets alone.",
      "      Scope: Only src/footer.html.",
      "      References: worker-1-0",
      "      Diagnosis (a hypothesis to test, not an established fact): The targets moved under /about.",
      "  Round 2, after attempt 2",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session: none; this round wrote no brief.",
      "  Round 3, after attempt 3",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session: not recorded.",
      "  Round 4, after attempt 4",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: escalate",
      '    Rationale: "gate_fail: escalate"',
      "    Packet for a person:",
      '      Decision: "No correction budget remains (3/3 used). Decide whether to continue manually, amend the task, or abandon it."',
      '      Evidence: "footer-links: 2 of 6 links still fail"',
      '      Dead ends: "1. Rewrote the link text.\n      2. Pointed both links at the homepage."',
      '      Why now: "The correction budget is spent (3/3 used), so the harness cannot try again."',
      "      References: worker-4-0, triage-3",
    ]);
  });

  it("is followed by the retries and the advice, as the short account is", () => {
    const lines = full(footerFailed, { refs: FOOTER_REFS });

    expect(lines.slice(lines.indexOf(""))).toEqual([
      "",
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Repairs: none ran for this task.",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
    ]);
  });

  it("says not recorded for a packet that cannot be read back, rather than leaving the round out", () => {
    expect(full(footerFailed).slice(-15, -10)).toEqual([
      "  Round 4, after attempt 4",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: escalate",
      '    Rationale: "gate_fail: escalate"',
      "    Packet for a person: not recorded.",
    ]);
  });

  it("says what a round that produced nothing did instead", () => {
    const record = recordOf({
      runId: ID.footer,
      task: FOOTER,
      history: [
        ...attempt(1, "x"),
        { t: "triage", afterAttempt: 1, trigger: "gate_error", verdict: "recheck_gate", rationale: "gate_error: recheck (gateError 0/3)", artifactRef: "triage-0" },
        { t: "triage", afterAttempt: 1, trigger: "worker_escalate", verdict: "abort", rationale: "the task\u001B[2J cannot be done", artifactRef: "triage-1" },
      ],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "triage_abort" }, "the task cannot be done", "aborted"),
    });

    const lines = full(record);

    expect(lines.slice(0, lines.indexOf(""))).toEqual([
      "How it got here (2 triage rounds, in full):",
      "  Round 1, after attempt 1",
      "    Trigger: a gate error (gate_error)",
      "    Verdict: recheck_gate",
      '    Rationale: "gate_error: recheck (gateError 0/3)"',
      "    Produced nothing: the gate was run again as it was.",
      "  Round 2, after attempt 1",
      "    Trigger: a worker escalation (worker_escalate)",
      "    Verdict: abort",
      '    Rationale: "the task cannot be done"',
      "    Produced nothing: the run was abandoned.",
    ]);
  });

  it("says in one line that there were no rounds", () => {
    expect(full(formDone)[0]).toBe("How it got here: no triage rounds.");
  });
});

describe("the detail under a task that has less to tell", () => {
  it("says in one line that there were no triage rounds, and in one line that there was no stop", () => {
    expect(short(formDone)).toEqual([
      "How it got here: no triage rounds.",
      "",
      "Retry budgets when it finished, after 1 attempt:",
      "  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Repairs: none ran for this task.",
      "",
      "No stop: this run finished.",
    ]);
  });

  it("says the same of a run that has not finished, with the retries so far", () => {
    expect(short(footerWorking).slice(2)).toEqual([
      "Retry budgets so far, after 1 attempt:",
      "  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Repairs: none ran for this task.",
      "",
      "No stop: this run has not finished.",
    ]);
  });

  it("says the advice is not recorded for a stop made before stops recorded why, and invents none", () => {
    const old = recordOf({ runId: ID.footer, task: FOOTER, history: footerFailed.caseFile.history, outcome: stoppedAt("2026-09-01T10:00:00.000Z", undefined, "correction budget exhausted (3/3)") });

    const lines = short(old);

    expect(lines.slice(0, 5)).toEqual([
      "How it got here (triage rounds; --decisions for the full text):",
      "  After attempt 1: a gate failure; verdict: reroute",
      "  After attempt 2: a gate failure; verdict: reroute",
      "  After attempt 3: a gate failure; verdict: reroute",
      "  After attempt 4: a gate failure; verdict: escalate",
    ]);
    expect(lines.slice(-3)).toEqual(["To act: not recorded; the record does not say what kind of stop this was.", UNCHANGED_NOT_RUN_AGAIN, RESUME_DOES_NOT_APPLY]);
  });
});

describe("a task's repairs, as status says them", () => {
  const surfaceWith = (repairs: ReportRepair[]): ReportSurface => ({ ...(deriveReport(snapshotOf({ records: [formDone] })).surfaces[0] as ReportSurface), repairs });
  const base = { of: "check" as const, attempt: 1, max: 2, at: null, status: "completed" as const, truncated: false };
  const files = CHANGES_TOUCHING_CHECK.files.map((file) => ({ ...file, patch: file.patch ?? null }));

  it("gives each repair one line: which, how many files, lines added and removed, and the names, marking a file the check runs", () => {
    expect(repairLine({ ...base, recorded: true, files, truncated: true }, 0)).toBe(
      "Repair 1 (of the check, attempt 1 of 2) changed 3 files, +3 -1: check.mjs (the check runs this file), notes.txt, big.bin",
    );
  });

  it("says a repair changed no files, one from before changes were kept was not recorded, and one going is still going", () => {
    expect(repairLine({ ...base, recorded: true, files: [] }, 0)).toBe("Repair 1 (of the check, attempt 1 of 2) changed no files.");
    expect(repairLine({ ...base, of: "setup", recorded: false, files: [] }, 1)).toBe("Repair 2 (of the setup, attempt 1 of 2): what this repair changed was not recorded.");
    expect(repairLine({ ...base, status: null, recorded: false, files: [] }, 0)).toBe("Repair 1 (of the check, attempt 1 of 2) is still going.");
  });

  it("lists every repair under the task's account, and says so when none ran", () => {
    expect(detailLines(surfaceWith([]), { full: false, patches: false })).toContain("Repairs: none ran for this task.");
    expect(detailLines(surfaceWith([{ ...base, recorded: true, files: [] }]), { full: false, patches: false })).toEqual(
      expect.arrayContaining(["Repairs (--repairs for each patch):", "  Repair 1 (of the check, attempt 1 of 2) changed no files."])
    );
  });

  it("prints each file's patch with --repairs, and a file it could not keep as too large to keep", () => {
    const lines = repairLines([{ ...base, recorded: true, files, truncated: true }], { patches: true });

    expect(lines.slice(0, 3)).toEqual([
      "Repairs (1, each with what it changed):",
      "  Repair 1 (of the check, attempt 1 of 2) changed 3 files, +3 -1: check.mjs (the check runs this file), notes.txt, big.bin",
      "    check.mjs (the check runs this file): modified, +2 -1",
    ]);
    expect(lines).toContain("      +export default lenient;");
    expect(lines).toContain("      +why");
    expect(lines.slice(-2)).toEqual(["    big.bin: added, +0 -0", "      patch too large to keep"]);
  });

  it("takes control characters out of paths and patches", () => {
    const hostile = [{ path: "a\u001b[2Jb.txt", status: "added" as const, added: 1, removed: 0, touchesCheck: false, patch: "+\u001b]0;x\u0007ok" }];

    const rendered = repairLines([{ ...base, recorded: true, files: hostile }], { patches: true }).join("\n");
    expect(rendered).not.toContain("\u001b");
    expect(rendered).not.toContain("\u0007");
  });
});

describe("the retries of a run of several tasks, added up", () => {
  const roll = (over: Partial<RecordSnapshot>): string[] => rollUpLines(deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, ...over })));

  it("adds each kind up across the tasks the run has taken, and says the run's shared repair limit beside them", () => {
    const run = runFileOf(ID.run, [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
      { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: ID.footer },
      fill(1, ID.homepage, HOMEPAGE),
    ]);

    expect(roll({ records: [formDone, footerFailed], runs: [run] })).toEqual([
      "Retry budgets across the 2 tasks this run has taken:",
      "  correction 3 of 6, gate recheck 0 of 6, gate repair 0 of 4, session retry 0 of 10, close retry 0 of 6",
      "  shared repair limit for the run: 1 of 2 used",
    ]);
  });

  it("says so, with the shared limit, when no task of the run has started", () => {
    expect(roll({ runs: [runFileOf(ID.run, [])] })).toEqual(["Retry budgets: no task of this run has started.", "  shared repair limit for the run: 0 of 2 used"]);
  });
});
