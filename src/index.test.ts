import { describe, it, expect } from "vitest";
import { attempt, closedAt, FOOTER, FORM, ID, writeRecord } from "./report/report-fixtures.js";
import { initTempRepo } from "./temp-repo.js";

describe("index", () => {
  it("loads without errors", async () => {
    const index = await import("./index.js");
    expect(index).toBeDefined();
  });

  it("offers what the reports are made from: read a project's records, derive the document, list its events, tell it in words, and the schemas of both", async () => {
    const { deriveReport, EVENT_SCHEMA, eventsOf, loadSnapshot, publishedSchema, renderText, repoLocked, REPORT_SCHEMA, ReportDocument, ReportEvent, streamEnded, streamStarted } = await import("./index.js");
    const repo = initTempRepo("index-report-", { "README.md": "x\n" });
    await writeRecord(repo, { runId: ID.form, task: FORM, closerRef: { type: "merge-back" }, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") });

    const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: await repoLocked(repo), list: [{ intent: FORM }, { intent: FOOTER }] });
    const doc = deriveReport(snapshot);
    const events = [streamStarted(doc), ...eventsOf(snapshot), streamEnded(doc, "ended")];

    expect(ReportDocument.parse(doc)).toMatchObject({ schema: REPORT_SCHEMA, kind: "list", live: false, counts: { closed: 1, not_started: 1 } });
    expect(events.map((event) => ReportEvent.parse(event).type)).toEqual(["stream_started", "surface_state", "surface_state", "surface_outcome", "stream_ended"]);
    expect(renderText(doc, { colour: false })[0]).toBe("Your task list: 1 of 2 tasks completed and merged; 1 not started.");
    expect(Object.keys(publishedSchema())).toEqual([REPORT_SCHEMA, EVENT_SCHEMA]);
  });
});
