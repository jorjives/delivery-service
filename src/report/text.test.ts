import { describe, expect, it } from "vitest";
import { deriveReport } from "./derive.js";
import {
  attempt,
  BANNER,
  CHANGES_TOUCHING_CHECK,
  closedAt,
  fill,
  FOOTER,
  footerFailed,
  footerWorking,
  FORBIDDEN,
  FORM,
  formDone,
  HOMEPAGE,
  homepageAsks,
  ID,
  ownRepair,
  recordOf,
  runFileOf,
  setupRepair,
  snapshotOf,
  stoppedAt,
  timed,
} from "./report-fixtures.js";
import type { RecordSnapshot } from "./snapshot.js";
import type { HistoryEntry } from "../schema.js";
import { closingSentence, durationWords, renderText, reportPointer, stripControl, usageSentence, type ReviewPart } from "./text.js";

const report = (snapshot: RecordSnapshot): string[] => renderText(deriveReport(snapshot), { colour: false });

const bannerDone = recordOf({ runId: ID.banner, task: BANNER, closerRef: { type: "merge-back" }, history: attempt(1, "done"), outcome: closedAt("2026-10-01T05:47:00.000Z") });
const going = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
const stopped = (cause: Parameters<typeof stoppedAt>[1], history = attempt(1, "done")): RecordSnapshot =>
  snapshotOf({ records: [formDone, recordOf({ runId: ID.footer, task: FOOTER, closerRef: { type: "merge-back" }, history, outcome: stoppedAt("2026-10-01T02:58:00.000Z", cause) })] });

describe("the report on a list worked one task at a time", () => {
  it("reads, in full, as what happened and what to do", () => {
    expect(report(snapshotOf({ records: [formDone, footerFailed] }))).toEqual([
      "Your task list: 1 of 4 tasks completed and merged; 1 failed after 4 attempts; 2 not started.",
      "Started 1 Oct 02:01 UTC; last activity 1 Oct 02:58 UTC.",
      "",
      "NEEDS YOU (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    Failed after 4 attempts. The agent tried 4 times and the check you set up still does not pass.",
      '    The agent said: "I fixed 4 of the 6 links.\n    The other 2 point at pages that no longer exist."',
      "    Where the work is: this task's changes were not added to main.",
      "    To act: 1. Reword the task, or remove it from your list.",
      "            2. Run: delivery run",
      "    Full account: delivery status fix-the-broken-footer-links-20261001T022000Z",
      "",
      "DONE (1)",
      '  Task 1 of 4: "Add a contact form": merged into main at 02:19',
      "",
      "NOT STARTED (2)",
      '  Task 3 of 4: "Replace the old homepage"',
      '  Task 4 of 4: "Add a cookie banner"',
      "  These are waiting behind task 2. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 2, then run `delivery run` to carry on with them.",
      "",
      "FOR WHOEVER TUNES THIS",
      "  Retries used across these tasks: agent corrections 3 of 6; check re-runs 0 of 6; check repairs 0 of 4; agent restarts 0 of 10; hand-off retries 0 of 6.",
      "  Time and cost were not recorded for this run.",
      "",
      "Next: delivery status --all (every run)",
    ]);
  });

  it("says tasks nobody has run have not been started, and how to start them", () => {
    expect(report(snapshotOf())).toEqual([
      "Your task list: 0 of 4 tasks completed; 4 not started.",
      "",
      "NOT STARTED (4)",
      '  Task 1 of 4: "Add a contact form"',
      '  Task 2 of 4: "Fix the broken footer links"',
      '  Task 3 of 4: "Replace the old homepage"',
      '  Task 4 of 4: "Add a cookie banner"',
      "  These have not been started yet. To start them: delivery run",
      "",
      "Next: delivery status --all (every run)",
    ]);
  });

  it("does not sound final, nor claim the work is going, when a task has no outcome", () => {
    const lines = report(snapshotOf({ records: [formDone, footerWorking] }));

    expect(lines.slice(0, 2)).toEqual([
      "Your task list has not finished (4 tasks: 1 done, 1 not finished, 2 not started); nothing records whether it is still going. If it is not, carry on with: delivery resume fix-the-broken-footer-links-20261001T022000Z",
      "Started 1 Oct 02:01 UTC; last activity not recorded.",
    ]);
    expect(lines).toContain('  Task 2 of 4: "Fix the broken footer links": not finished');
    expect(lines).toContain("    If it is no longer going, carry on with: delivery resume fix-the-broken-footer-links-20261001T022000Z");
    expect(lines).toContain("  These are waiting behind task 2. It has not finished, so they have been left alone.");
  });
});

describe("the report on work that has not finished", () => {
  const footerAt = (history: Parameters<typeof recordOf>[0]["history"]) => recordOf({ runId: ID.footer, task: FOOTER, closerRef: { type: "merge-back" }, history });
  const timedFooter = footerAt(timed(attempt(1, "first go"), "2026-10-01T02:21:00.000Z"));

  it("states the last recorded activity of a list worked one task at a time as a time", () => {
    expect(report(snapshotOf({ records: [formDone, timedFooter] }))[1]).toBe("Started 1 Oct 02:01 UTC; last activity 1 Oct 02:22 UTC.");
  });

  it("states the last recorded activity of a run of several tasks, and says not recorded when the record holds none", () => {
    const run = (records: RecordSnapshot["records"], fills = [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]) =>
      report(snapshotOf({ subject: { kind: "run", runId: ID.run }, live: true, records, runs: [runFileOf(ID.run, fills)] }))[1];

    expect(run([formDone, timedFooter])).toBe("Run run-20261001T020000Z, started 1 Oct 02:00 UTC, up to 2 tasks at once; last activity 1 Oct 02:22 UTC.");
    expect(run([footerAt(attempt(1, "first go"))], [fill(2, ID.footer, FOOTER)])).toBe("Run run-20261001T020000Z, started 1 Oct 02:00 UTC, up to 2 tasks at once; last activity not recorded.");
  });

  it("says how to follow a run that is going, by its id unless it is the task list", () => {
    const going = (subject: RecordSnapshot["subject"]) => report(snapshotOf({ subject, live: true, records: [formDone, timedFooter], runs: [runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)])] }))[0];

    expect(going({ kind: "list" })).toMatch(/\. Follow it: delivery status --watch$/);
    expect(going({ kind: "run", runId: ID.run })).toMatch(/\. Follow it: delivery status --watch run-20261001T020000Z$/);
    expect(going({ kind: "task", runId: ID.footer })).toMatch(/\. Follow it: delivery status --watch fix-the-broken-footer-links-20261001T022000Z$/);
  });
});

describe("the report on a list worked several tasks at once", () => {
  const five = snapshotOf({
    records: [formDone, footerFailed, homepageAsks, bannerDone],
    runs: [runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER), fill(1, ID.homepage, HOMEPAGE), fill(2, ID.banner, BANNER)], { kind: "drained", at: "2026-10-01T05:47:00.000Z" })],
  });

  it("opens with the counts, the run and how long it took", () => {
    expect(report(five).slice(0, 2)).toEqual([
      "Your task list: 2 of 4 tasks completed and merged; 1 needs your decision; 1 failed after 4 attempts.",
      "Run run-20261001T020000Z, 1 Oct 02:00 to 05:47 UTC (3 h 47 min), up to 2 tasks at once.",
    ]);
  });

  it("tells each stopped task apart: the kind of stop, the agent's own words, and the route", () => {
    const lines = report(five);

    expect(lines.slice(lines.indexOf('  Task 3 of 4: "Replace the old homepage"'), lines.indexOf("DONE (2)") - 1)).toEqual([
      '  Task 3 of 4: "Replace the old homepage"',
      "    Needs your decision. The agent stopped and said it could not go on without your say-so.",
      '    The agent said: "This would delete 14 published pages. I need the owner to confirm."',
      "    Where the work is: this task's changes were not added to main.",
      "    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.",
      "            2. Run: delivery run",
      "    Full account: delivery status replace-the-old-homepage-20261001T030000Z",
    ]);
  });

  it("counts the shared repairs and ends on the run's own detail", () => {
    const lines = report(five);

    expect(lines).toContain("  Repairs of the setup every task shares: 0 of 2.");
    expect(lines.at(-1)).toBe("Next: delivery status run-20261001T020000Z (detail), delivery status --all (every run)");
  });

  it("says a run is still going, with no final headline", () => {
    const lines = report(snapshotOf({ live: true, records: [formDone, footerWorking], runs: [going] }));

    expect(lines.slice(0, 2)).toEqual([
      "Your task list is still being worked on (4 tasks: 1 done, 1 working, 2 waiting to start). Follow it: delivery status --watch",
      "Run run-20261001T020000Z, started 1 Oct 02:00 UTC, up to 2 tasks at once; last activity 1 Oct 02:19 UTC.",
    ]);
    expect(lines.slice(lines.indexOf("NOT FINISHED (3)"), lines.indexOf("NOT FINISHED (3)") + 4)).toEqual([
      "NOT FINISHED (3)",
      '  Task 2 of 4: "Fix the broken footer links": working',
      '  Task 3 of 4: "Replace the old homepage": waiting to start',
      '  Task 4 of 4: "Add a cookie banner": waiting to start',
    ]);
  });

  it("says a run that is no longer going stopped part way, and how to carry on", () => {
    const [first] = report(snapshotOf({ live: false, records: [formDone, footerWorking], runs: [going] }));

    expect(first).toBe("Work on your task list stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery run");
  });

  it("says in words which usage limit stopped the run itself", () => {
    const limited = runFileOf(ID.run, [fill(1, ID.form, FORM), { t: "run_escalated", reason: "the repair could not run", limit: "spend" }], {
      kind: "escalated",
      cause: "usage_limit",
      reason: "the repair could not run",
      at: "2026-10-01T02:30:00.000Z",
    });

    expect(report(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [formDone], runs: [limited] })).slice(0, 3)).toEqual([
      "This run stopped part way (4 tasks: 1 done, 3 waiting to start).",
      "Run run-20261001T020000Z, 1 Oct 02:00 to 02:30 UTC (30 min), up to 2 tasks at once.",
      "The run stopped because a usage limit was reached: the spending limit has been reached; no task caused this. Once the limit no longer applies, carry on with: delivery run",
    ]);
  });
});

describe("the report on one named run", () => {
  it("reports that run, and points back to the list", () => {
    const lines = report(snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [formDone, footerFailed] }));

    expect(lines[0]).toBe("This run: 0 of 1 task completed; 1 failed after 4 attempts.");
    expect(lines).toContain("  Retries used across this task: agent corrections 3 of 3; check re-runs 0 of 3; check repairs 0 of 2; agent restarts 0 of 5; hand-off retries 0 of 3.");
    expect(lines.at(-1)).toBe("Next: delivery status fix-the-broken-footer-links-20261001T022000Z (detail), delivery report (your task list)");
  });
});

describe("where a stopped task is told", () => {
  it("puts a stop only an engineer can deal with under their heading, with one thing for the owner to do", () => {
    const lines = report(stopped({ kind: "budget", population: "gateError" }));

    expect(lines.slice(lines.indexOf("STOPPED, FOR YOUR ENGINEERS (1)"), lines.indexOf("DONE (1)") - 1)).toEqual([
      "STOPPED, FOR YOUR ENGINEERS (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    The check you set up could not be run, even after trying it again. This is a problem with the setup, not a decision for you.",
      '    The agent said: "done"',
      "    To act: Pass this to whoever maintains your checks: delivery status fix-the-broken-footer-links-20261001T022000Z",
    ]);
    expect(lines[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 stopped, for your engineers; 2 not started.");
  });

  it("tells a stop recorded before causes were by its recorded reason, with no advice", () => {
    const lines = report(stopped(undefined));

    expect(lines.slice(lines.indexOf("STOPPED, FOR YOUR ENGINEERS (1)"), lines.indexOf("DONE (1)") - 1)).toEqual([
      "STOPPED, FOR YOUR ENGINEERS (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    Stopped. The record does not say what kind of stop this was.",
      '    The run recorded this reason: "recorded reason"',
      '    The agent said: "done"',
      "    Full account: delivery status fix-the-broken-footer-links-20261001T022000Z",
    ]);
  });

  it("writes `not recorded` where the agent left no explanation", () => {
    const silent = [{ t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" } as const];

    expect(report(stopped({ kind: "session_not_run", role: "worker" }, silent))).toContain("    The agent said: not recorded");
  });

  it("says a task stopped at a usage limit, in the headline and at the task", () => {
    const limited = [
      { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" } as const,
      { t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0", status: "incomplete", rationale: "limited", limit: "spend" } as const,
    ];

    const lines = report(stopped({ kind: "budget", population: "terminus" }, limited));

    expect(lines[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 stopped at a usage limit; 2 not started.");
    expect(lines).toContain("    Stopped because a usage limit was reached: the spending limit has been reached.");
    expect(lines.slice(lines.indexOf("    To act: 1. Wait until the limit no longer applies."), lines.indexOf("    To act: 1. Wait until the limit no longer applies.") + 3)).toEqual([
      "    To act: 1. Wait until the limit no longer applies.",
      '            2. Run this task again on its own: delivery run --task "the task, exactly as it is written"',
      "            3. Then carry on with your list: delivery run",
    ]);
  });
});

describe("how delivered work is described", () => {
  const delivered = (closerRef: Parameters<typeof recordOf>[0]["closerRef"]): string[] =>
    report(snapshotOf({ list: [{ intent: FORM }], records: [recordOf({ runId: ID.form, task: FORM, ...(closerRef ? { closerRef } : {}), history: attempt(1, "done"), outcome: closedAt("2026-10-01T02:19:10.000Z") })] }));

  it("says merged only for a project that merges", () => {
    expect(delivered({ type: "merge-back" })[0]).toBe("Your task list: 1 of 1 task completed and merged.");
    expect(delivered({ type: "merge-back" })).toContain('  Task 1 of 1: "Add a contact form": merged into main at 02:19');
  });

  it("names the branch for a project that commits each task to its own", () => {
    expect(delivered(undefined)[0]).toBe("Your task list: 1 of 1 task completed and committed to its own branch.");
    expect(delivered(undefined)).toContain('  Task 1 of 1: "Add a contact form": committed on branch surface/add-a-contact-form-20261001T020100Z at 02:19');
  });

  it("names the branch and the pull request for a project that opens one", () => {
    expect(delivered({ type: "open-pr" })).toContain('  Task 1 of 1: "Add a contact form": on branch surface/add-a-contact-form-20261001T020100Z, with a pull request open at 02:19');
  });

  it("claims nothing about where the work went for a project's own closer", () => {
    expect(delivered({ type: "custom", modulePath: "./closer.js" })[0]).toBe("Your task list: 1 of 1 task completed.");
    expect(delivered({ type: "custom", modulePath: "./closer.js" })).toContain('  Task 1 of 1: "Add a contact form": your own closer handled this task; check what it did at 02:19');
  });
});

describe("a damaged record", () => {
  const damaged = { runId: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, taskDef: { intent: FOOTER } };

  it("is named first, with its file, and the rest is still reported", () => {
    const lines = report(snapshotOf({ records: [formDone], damaged: [damaged] }));

    expect(lines.slice(0, 2)).toEqual([
      "Incomplete report: the record for task 2 is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/log.jsonl); the other 3 tasks are reported below.",
      "Your task list: 1 of 4 tasks completed and merged; 1 could not be read; 2 not started.",
    ]);
    expect(lines).toContain("  These are waiting behind task 2, whose record is damaged. They are left alone until that is put right.");
  });

  it("is all the report says when it is the one run asked about", () => {
    expect(report(snapshotOf({ subject: { kind: "task", runId: ID.footer }, damaged: [damaged] }))).toEqual([
      "Incomplete report: the record for task 2 is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/log.jsonl); nothing else could be read.",
      "",
      "Next: delivery status --all (every run)",
    ]);
  });
});

describe("words taken from the record", () => {
  const hostile = "line one\u001B[2J\u001B]0;owned\u0007\r\nline\ttwo\u0007\u009B";

  it("lose every control character but line breaks and tabs", () => {
    expect(stripControl(hostile)).toBe("line one\nline\ttwo");
  });

  it("are stripped wherever the report quotes them: the task, the agent and the recorded reason", () => {
    const record = recordOf({ runId: ID.footer, task: `Fix\u001B[31m the footer`, history: attempt(1, hostile), outcome: stoppedAt("2026-10-01T02:58:00.000Z", undefined, "why\u001B[0m\u0008") });

    const lines = report(snapshotOf({ subject: { kind: "task", runId: ID.footer }, list: [], records: [record] }));

    expect(lines).toContain('  Task: "Fix the footer"');
    expect(lines).toContain('    The agent said: "line one\n    line\ttwo"');
    expect(lines).toContain('    The run recorded this reason: "why"');
    // eslint-disable-next-line no-control-regex
    expect(lines.join("\n")).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
  });
});

describe("the report's own words", () => {
  const changed = recordOf({ runId: ID.footer, task: FOOTER, history: [...ownRepair(1, "repair-gate-maintenance-1-0"), ...attempt(1, "first go")] });
  const everyReport = [
    snapshotOf(),
    snapshotOf({ records: [formDone, footerFailed] }),
    snapshotOf({ records: [formDone, footerWorking] }),
    snapshotOf({ live: true, records: [formDone, footerWorking], runs: [going] }),
    snapshotOf({ live: false, records: [formDone, footerWorking], runs: [going] }),
    snapshotOf({ records: [formDone, homepageAsks] }),
    snapshotOf({ records: [formDone, changed], refs: { [ID.footer]: { "repair-gate-maintenance-1-0": CHANGES_TOUCHING_CHECK } } }),
    stopped({ kind: "budget", population: "gateError" }),
    stopped({ kind: "budget", population: "gateMaintenance" }),
    stopped({ kind: "budget", population: "close" }),
    stopped({ kind: "budget", population: "terminus" }),
    stopped({ kind: "triage_failure" }),
    stopped({ kind: "triage_abort" }),
    stopped({ kind: "provisioning" }),
    stopped({ kind: "repair_gave_up" }),
    stopped(undefined),
  ];

  /** The report with what it quotes from the record, and the identifiers it names, taken out: those are data. */
  const ownWords = (lines: string[]): string =>
    lines
      .join("\n")
      .replace(/"[^"]*"/g, "")
      .replace(/\b(surface\/\S+|\S+-\d{8}T\d{6}Z)/g, "");

  it("never use the harness's internal names for things", () => {
    for (const snapshot of everyReport) expect(ownWords(report(snapshot))).not.toMatch(FORBIDDEN);
  });

  it("end on a `Next:` line naming only commands that exist", () => {
    for (const snapshot of everyReport) {
      const last = report(snapshot).at(-1) ?? "";
      expect(last).toMatch(/^Next: delivery (status|report)/);
      expect(last.match(/delivery [a-z]+( --?[a-z-]+)?/g)?.every((command) => /^delivery (status|report|status --all)$/.test(command))).toBe(true);
    }
  });

  it("never send a task that has ended to `delivery resume`", () => {
    for (const snapshot of everyReport.filter((each) => each.records.every((record) => record.caseFile.outcome !== undefined))) {
      expect(report(snapshot).join("\n")).not.toContain("delivery resume");
    }
  });

  it("keep every word when the text is viewed as Markdown: nothing is taken for a tag, a heading, a rule or a block of code", () => {
    const typedAgain = snapshotOf({ subject: { kind: "task", runId: ID.footer }, list: [], records: [footerFailed] });

    for (const snapshot of [...everyReport, typedAgain]) {
      const lines = renderText(deriveReport(snapshot), { colour: false, saved: "Saved to: .delivery/last-report.txt and .delivery/last-report.json" });
      // Angle brackets around words are an HTML tag to a Markdown viewer, which shows nothing in their place.
      expect(lines.join("\n")).not.toMatch(/<[A-Za-z/][^>]*>/);
      for (const [index, line] of lines.entries()) {
        expect(line).not.toMatch(/^ {0,3}(#{1,6} |[-=*_]{3,}\s*$)/);
        // Four spaces open a block of code only after a blank line; under a line of text they continue it.
        if (index === 0 || lines[index - 1] === "") expect(line).not.toMatch(/^ {4}/);
      }
    }
  });

  it("set the tuning section apart, under its own heading, after everything the owner acts on", () => {
    const lines = report(snapshotOf({ records: [formDone, footerFailed] }));

    expect(lines.indexOf("FOR WHOEVER TUNES THIS")).toBeGreaterThan(lines.indexOf("NOT STARTED (2)"));
  });
});

describe("where a report was saved", () => {
  const SAVED = "Saved to: .delivery/last-report.txt and .delivery/last-report.json";
  const told = (snapshot: RecordSnapshot, saved?: string): string[] => renderText(deriveReport(snapshot), { colour: false, saved });

  it("is the last line of the tuning section, when the report is told it was saved", () => {
    const lines = told(snapshotOf({ records: [formDone, footerFailed] }), SAVED);

    expect(lines.slice(-4)).toEqual(["  Time and cost were not recorded for this run.", `  ${SAVED}`, "", "Next: delivery status --all (every run)"]);
  });

  it("is not mentioned by a report that was not saved", () => {
    expect(told(snapshotOf({ records: [formDone, footerFailed] })).join("\n")).not.toContain("Saved to");
  });

  it("still has its section when no task has run, so the sentence always has a place", () => {
    expect(told(snapshotOf(), SAVED).slice(-4)).toEqual(["FOR WHOEVER TUNES THIS", `  ${SAVED}`, "", "Next: delivery status --all (every run)"]);
    expect(told(snapshotOf()).join("\n")).not.toContain("FOR WHOEVER TUNES THIS");
  });
});

describe("what a command says as it stops working on something", () => {
  it("is the counts the report opens with, in one sentence", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));

    expect(closingSentence(doc)).toBe(renderText(doc, { colour: false })[0]);
    expect(closingSentence(doc)).toBe("Your task list: 1 of 4 tasks completed and merged; 1 failed after 4 attempts; 2 not started.");
  });

  it("counts what is left without wondering whether the work is still going", () => {
    expect(closingSentence(deriveReport(snapshotOf({ records: [formDone, footerWorking] })))).toBe("Your task list: 4 tasks: 1 done, 1 not finished, 2 not started.");
  });

  it("points at the report: the list by default, one run by its id", () => {
    expect(reportPointer(deriveReport(snapshotOf({ records: [formDone] })))).toBe("Run `delivery report` for what to do.");
    expect(reportPointer(deriveReport(snapshotOf({ subject: { kind: "task", runId: ID.form }, records: [formDone] })))).toBe(`Run \`delivery report ${ID.form}\` for what to do.`);
  });
});

describe("the text of a report", () => {
  it("is the same every time for the same records", () => {
    const snapshot = snapshotOf({ records: [formDone, footerFailed] });

    expect(report(structuredClone(snapshot)).join("\n")).toBe(report(snapshot).join("\n"));
  });

  it("carries no colour codes unless colour is asked for, and only on headings when it is", () => {
    const doc = deriveReport(snapshotOf({ records: [formDone, footerFailed] }));
    const plain = renderText(doc, { colour: false });
    const coloured = renderText(doc, { colour: true });

    expect(plain.join("\n")).not.toContain("\u001B");
    // eslint-disable-next-line no-control-regex
    expect(coloured.map((line) => line.replace(/\u001B\[[0-9;]*m/g, ""))).toEqual(plain);
    expect(coloured.filter((line, index) => line !== plain[index]).length).toBe(4);
  });
});

describe("a repair that changed a file the check runs", () => {
  const changed = recordOf({ runId: ID.footer, task: FOOTER, history: [...ownRepair(1, "repair-gate-maintenance-1-0"), ...attempt(1, "first go")] });
  const snapshot = snapshotOf({ records: [formDone, changed], refs: { [ID.footer]: { "repair-gate-maintenance-1-0": CHANGES_TOUCHING_CHECK } } });

  it("is worth a look: which task and file, that the report cannot tell whether it was safe, and the command that shows it", () => {
    const lines = renderText(deriveReport(snapshot), { colour: false });
    const at = lines.indexOf("WORTH A LOOK");

    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at, at + 4)).toEqual([
      "WORTH A LOOK",
      '  A repair of the check changed a file the check runs ("check.mjs") during task 2.',
      "    This report shows what changed; it cannot tell you whether the change was safe.",
      `    See it: delivery status ${ID.footer} --repairs`,
    ]);
    expect(lines.indexOf("WORTH A LOOK")).toBeLessThan(lines.findIndex((line) => line.startsWith("FOR WHOEVER TUNES THIS")));
  });

  it("keeps a path with a line break in it on the line that names it", () => {
    const forged = { files: [{ path: "check.mjs\nDONE (5)", status: "modified" as const, added: 1, removed: 0, touchesCheck: true }], truncated: false };
    const lines = renderText(deriveReport(snapshotOf({ records: [formDone, changed], refs: { [ID.footer]: { "repair-gate-maintenance-1-0": forged } } })), { colour: false });

    expect(lines).toContain('  A repair of the check changed a file the check runs ("check.mjs\\nDONE (5)") during task 2.');
  });

  it("carries no patch: the summary only, as the saved text report does", () => {
    expect(renderText(deriveReport(snapshot), { colour: false }).join("\n")).not.toMatch(/lenient|diff --git/);
  });

  it("is not there when no repair changed a file the check runs, or none was recorded", () => {
    const harmless = { files: [{ path: "notes.txt", status: "added" as const, added: 1, removed: 0, touchesCheck: false }], truncated: false };
    for (const refs of <Record<string, Record<string, unknown>>[]>[{ [ID.footer]: { "repair-gate-maintenance-1-0": harmless } }, {}]) {
      expect(renderText(deriveReport(snapshotOf({ records: [formDone, changed], refs })), { colour: false })).not.toContain("WORTH A LOOK");
    }
  });

  it("names the repair of the setup as such", () => {
    const run = runFileOf(ID.run, [fill(1, ID.footer, FOOTER), ...setupRepair(1, ID.footer, "repair-run-repair-1")]);
    const lines = renderText(deriveReport(snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [footerWorking], runs: [run], refs: { [ID.run]: { "repair-run-repair-1": CHANGES_TOUCHING_CHECK } } })), { colour: false });

    expect(lines).toContain('  A repair of the setup changed a file the check runs ("check.mjs") during task 2.');
  });
});

describe("time and cost", () => {
  const formPaid = recordOf({
    runId: ID.form,
    task: FORM,
    closerRef: { type: "merge-back" },
    history: attempt(1, "added the form").map((entry): HistoryEntry => (entry.t === "terminus" ? { ...entry, usage: { costUsd: 0.25, durationMs: 60_000 } } : entry)),
    outcome: closedAt("2026-10-01T02:19:10.000Z"),
  });

  it("says, for whoever tunes this, the session time and estimated cost across the run, and how many sessions they cover", () => {
    expect(report(snapshotOf({ records: [formPaid, footerFailed] }))).toContain(
      "  Time and cost, recorded for 1 of 5 agent sessions: 1 min of session time; USD 0.25, estimated by the agent runtime.",
    );
  });

  it("still says it was not recorded, never zero, when no session recorded it", () => {
    expect(report(snapshotOf({ records: [formDone, footerFailed] }))).toContain("  Time and cost were not recorded for this run.");
  });

  it("says a figure the runtime reported as zero as it was reported, and one too small for cents as under a cent", () => {
    expect(usageSentence({ usage: { costUsd: 0, durationMs: 0 }, usageRecorded: { recorded: 1, sessions: 1 } }, "this task")).toBe(
      "Time and cost, recorded for 1 of 1 agent session: 0 s of session time; USD 0.00, estimated by the agent runtime.",
    );
    expect(usageSentence({ usage: { costUsd: 0.004, durationMs: 1_000 }, usageRecorded: { recorded: 2, sessions: 3 } }, "this task")).toBe(
      "Time and cost, recorded for 2 of 3 agent sessions: 1 s of session time; under USD 0.01, estimated by the agent runtime.",
    );
  });

  it("says a length of time in seconds, minutes and seconds, or hours and minutes", () => {
    expect([0, 45_400, 59_600, 60_000, 125_000, 3_600_000, 7_380_000].map(durationWords)).toEqual(["0 s", "45 s", "1 min", "1 min", "2 min 5 s", "1 h", "2 h 3 min"]);
  });
});

describe("a task waiting on a repair of the setup every task shares", () => {
  const tripped = runFileOf(ID.run, [
    fill(1, ID.form, FORM),
    fill(2, ID.footer, FOOTER),
    { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.footer, reason: "the check could not run" } },
    { t: "held", surfaceId: ID.footer },
  ]);

  it("is said to be paused, never held", () => {
    const lines = report(snapshotOf({ live: true, records: [formDone, footerWorking], runs: [tripped] }));

    expect(lines[0]).toContain("1 paused");
    expect(lines).toContain(`  Task 2 of 4: "${FOOTER}": paused while the setup every task shares is repaired`);
    expect(lines.join("\n")).not.toMatch(/\bheld\b/);
  });
});

describe("a report told by a review's problems", () => {
  const part: ReviewPart = {
    opening: ["Code review of shop: 2 problems found; you approved 2 and skipped 0."],
    sections: ["", "DONE (1)", '  Problem 1 of 2: "Totals can be negative" (high): fixed and merged'],
    next: "Next: delivery findings (every problem and where it stands), delivery status --all (every run)",
    carryOn: "delivery fix",
  };
  const told = (snapshot: RecordSnapshot): string[] => renderText(deriveReport(snapshot), { colour: false, review: part });

  it("opens with the review's lines and tells its sections and next step in place of the tasks'", () => {
    const lines = told(snapshotOf({ records: [formDone, footerFailed] }));

    expect(lines[0]).toBe(part.opening[0]);
    expect(lines.some((line) => line.startsWith("Your task list:"))).toBe(false);
    expect(lines).toEqual(expect.arrayContaining(part.sections.slice(1)));
    expect(lines.some((line) => line.startsWith("NEEDS YOU") || line.startsWith("  Task "))).toBe(false);
    expect(lines.at(-1)).toBe(part.next);
  });

  it("still says the work is going, as from another terminal, after the review's opening", () => {
    const lines = told(snapshotOf({ live: true, records: [formDone, footerWorking], runs: [going] }));

    expect(lines.slice(0, 2)).toEqual([part.opening[0], "Your task list is still being worked on (4 tasks: 1 done, 1 working, 2 waiting to start). Follow it: delivery status --watch"]);
  });

  it("says how to carry on with the review's own command once the work stopped part way", () => {
    const lines = told(snapshotOf({ live: false, records: [formDone, footerWorking], runs: [going] }));

    expect(lines[1]).toBe("Work on your task list stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery fix");
  });

  it("says how to carry on with the review's own command when nothing records whether the work is going", () => {
    const lines = told(snapshotOf({ records: [formDone, footerWorking] }));

    expect(lines[1]).toBe("Your task list has not finished (4 tasks: 1 done, 1 not finished, 2 not started); nothing records whether it is still going. If it is not, carry on with: delivery fix");
  });

  it("names the review's own command when a run stopped for the shared setup", () => {
    const broken = runFileOf(ID.run, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)], { kind: "escalated", cause: "shared_environment", reason: "the setup could not be repaired", at: "2026-10-01T03:00:00.000Z" });
    const lines = told(snapshotOf({ live: false, records: [formDone, footerWorking], runs: [broken] }));

    expect(lines).toContain("The run stopped because the setup every task shares could not be repaired; no task caused this. Once it is fixed, carry on with: delivery fix");
  });

  it("says nothing different without a review part", () => {
    const snapshot = snapshotOf({ live: false, records: [formDone, footerWorking], runs: [going] });
    expect(renderText(deriveReport(snapshot), { colour: false })[0]).toBe("Work on your task list stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery run");
  });
});
