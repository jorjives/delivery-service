import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deriveReport } from "./derive.js";
import { EVENT_SCHEMA, eventsOf, streamEnded, streamStarted } from "./events.js";
import { REPORT_SCHEMA } from "./document.js";
import { publishedKeys, publishedSchema } from "./json-schema.js";
import { attempt, failedCheck, fill, FOOTER, footerFailed, footerWorking, FORM, formDone, homepageAsks, ID, PACKET, recordOf, runFileOf, snapshotOf, stoppedAt, timed, ownRepair, CHANGES_TOUCHING_CHECK } from "./report-fixtures.js";
import type { RecordSnapshot } from "./snapshot.js";

const schema = publishedSchema();
/** The published schemas as a consumer would hold data to them: read back from the JSON Schema itself, not from the definitions it was generated from. */
const published = { report: z.fromJSONSchema(schema[REPORT_SCHEMA]), event: z.fromJSONSchema(schema[EVENT_SCHEMA]) };
/** As a consumer receives it: through JSON. */
const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const troubled = runFileOf(
  ID.run,
  timed(
    [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
      { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: ID.footer, reason: "the check could not run" } },
      { t: "held", surfaceId: ID.footer },
      { t: "repair_dispatch", attempt: 1, sessionKey: "repair-1-0", surfaceId: ID.footer },
      { t: "repair_terminus", attempt: 1, sessionKey: "repair-1-0", status: "completed", rationale: "reinstalled" },
      { t: "breaker_healthy" },
      { t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId: ID.form, surfaceIds: [ID.form, ID.footer] } },
    ],
    "2026-10-01T02:21:30.000Z",
  ),
  { kind: "escalated", cause: "usage_limit", reason: "the repair could not run", at: "2026-10-01T03:00:00.000Z" },
);
const withPacket = recordOf({
  runId: ID.footer,
  task: FOOTER,
  history: [...attempt(1, "first go"), ...failedCheck(1, "escalate")],
  outcome: { ...stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }), packetRef: "escalation" },
});

/** One snapshot of every kind a command reports on: a list, a list with nothing run, one task, a run of several, and a damaged record. */
const SNAPSHOTS: Record<string, RecordSnapshot> = {
  "a task list": snapshotOf({ records: [formDone, footerFailed, homepageAsks] }),
  "a list nothing has run": snapshotOf(),
  "one task that left a packet": snapshotOf({ subject: { kind: "task", runId: ID.footer }, records: [withPacket], refs: { [ID.footer]: { escalation: PACKET, "triage-0": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET } } } }),
  "a run of several tasks": snapshotOf({ subject: { kind: "run", runId: ID.run }, records: [formDone, footerWorking], runs: [troubled] }),
  "a damaged record": snapshotOf({ records: [formDone], damaged: [{ runId: ID.footer, file: ".delivery/runs/x/log.jsonl" }] }),
  "a task a repair changed": snapshotOf({
    subject: { kind: "task", runId: ID.footer },
    records: [recordOf({ runId: ID.footer, task: FOOTER, history: ownRepair(1, "repair-gate-maintenance-1-0") })],
    refs: { [ID.footer]: { "repair-gate-maintenance-1-0": CHANGES_TOUCHING_CHECK } },
  }),
  "a task whose session reported its cost": snapshotOf({
    subject: { kind: "task", runId: ID.form },
    records: [recordOf({ runId: ID.form, task: FORM, history: attempt(1, "added the form").map((entry) => (entry.t === "terminus" ? { ...entry, usage: { costUsd: 0.25, durationMs: 60_000 } } : entry)) })],
  }),
};

describe("the published schema", () => {
  it("covers both formats, each under the version it names itself by", () => {
    expect(Object.keys(schema)).toEqual(["delivery.report/1", "delivery.event/1"]);
    expect(schema[REPORT_SCHEMA]).toMatchObject({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" });
  });

  it.each(Object.entries(SNAPSHOTS))("accepts the document and every event of %s", (_name, snapshot) => {
    const doc = deriveReport(snapshot);

    expect(published.report.safeParse(overTheWire(doc)).error).toBeUndefined();
    for (const event of [streamStarted(doc), ...eventsOf(snapshot), streamEnded(doc, "ended")]) expect(published.event.safeParse(overTheWire(event)).error, event.type).toBeUndefined();
  });

  it("still accepts a document with a key, and a name, that a later release added", () => {
    const doc = deriveReport(SNAPSHOTS["a task list"] as RecordSnapshot);
    const later = { ...doc, trend: { costUsd: 1 }, surfaces: doc.surfaces.map((surface) => ({ ...surface, standing: "a_later_standing", repairs: [] })) };

    expect(published.report.safeParse(overTheWire(later)).success).toBe(true);
  });

  it("still accepts an event of a type a later release added, so long as it says what every event says of itself", () => {
    const later = { schema: "delivery.event/1", run: null, surface: ID.footer, seq: 3, at: null, type: "budget_spent", population: "correction" };

    expect(published.event.safeParse(later).success).toBe(true);
    expect(published.event.safeParse({ schema: "delivery.event/1", type: "budget_spent" }).success).toBe(false);
  });

  it("refuses a document that lacks a published key, or holds another kind of value under one", () => {
    const doc = overTheWire(deriveReport(SNAPSHOTS["a task list"] as RecordSnapshot)) as Record<string, unknown>;
    const without = { ...doc };
    delete without.counts;

    expect(published.report.safeParse(without).success).toBe(false);
    expect(published.report.safeParse({ ...doc, surfaces: "none" }).success).toBe(false);
  });

  it("forbids no key it does not name, and closes no set of names", () => {
    const text = JSON.stringify(schema);

    expect(text).not.toContain('"additionalProperties":false');
    expect(text).not.toContain('"enum"');
    expect(text).not.toContain('"oneOf"');
  });
});

describe("what a schema promises, line by line", () => {
  it("is every key by its path with the kind of value it holds, every name a value takes today, and whether a key may be left out", () => {
    const small = z.toJSONSchema(z.object({ kind: z.literal("x"), at: z.string().nullable(), rows: z.array(z.object({ used: z.number().int(), note: z.string().optional() })) }), { io: "input" });

    expect(publishedKeys(small)).toEqual([
      '$.at: null|string',
      '$.kind = "x"',
      "$.kind: string",
      "$.rows: array",
      "$.rows[].note: string (optional)",
      "$.rows[].used: integer",
      "$.rows[]: object",
    ]);
  });
});

/**
 * A reader of the document may rely on a key being there. Two things break that
 * quietly: a key marked optional, and a union of object shapes (one names a key
 * the others do not, so a value of one of the others lacks it). The document
 * has neither, and this holds it to that before the golden freezes it.
 */
describe("the report document's keys are always present", () => {
  /** The path of every union in a schema that holds more than one object shape. */
  const unionsOfShapes = (node: unknown, path = "$"): string[] => {
    if (typeof node !== "object" || node === null) return [];
    const shapes = Array.isArray((node as { anyOf?: unknown }).anyOf) ? (node as { anyOf: object[] }).anyOf.filter((branch) => "properties" in branch) : [];
    return [...(shapes.length > 1 ? [path] : []), ...Object.entries(node).flatMap(([key, child]) => unionsOfShapes(child, `${path}.${key}`))];
  };

  it("leaves no key optional", () => {
    expect(publishedKeys(schema[REPORT_SCHEMA], REPORT_SCHEMA).filter((line) => line.endsWith("(optional)"))).toEqual([]);
  });

  it("tells no two object shapes apart by a union, so no key is present in one and missing from another", () => {
    expect(unionsOfShapes(schema[REPORT_SCHEMA])).toEqual([]);
  });

  it("names every key of a cause whatever its kind, null where the kind has none", () => {
    const doc = overTheWire(deriveReport(SNAPSHOTS["a run of several tasks"] as RecordSnapshot)) as { trips: { cause: object }[] };

    expect(doc.trips.map((trip) => Object.keys(trip.cause).sort())).toEqual([["kind", "reason", "surfaceId", "surfaceIds"], ["kind", "reason", "surfaceId", "surfaceIds"]]);
    expect(published.report.safeParse(doc).error).toBeUndefined();
  });
});

/**
 * The stability promise, held: `published-keys.txt` is every key and every name
 * `delivery.report/1` and `delivery.event/1` have ever published. A line of it
 * may never be removed or changed; a release that publishes more adds lines.
 */
describe("the stability promise", () => {
  const promised = readFileSync(new URL("./published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
  const current = Object.entries(schema).flatMap(([name, format]) => publishedKeys(format, name));

  it("keeps every key and name ever published, each the kind of value it was", () => {
    expect(promised.filter((line) => !current.includes(line))).toEqual([]);
  });

  it("puts every key and name published now under the promise: add its line to published-keys.txt", () => {
    expect(current.filter((line) => !promised.includes(line))).toEqual([]);
  });

  it("promises what the reports rest on: the version, the counts, who must act, and how a stream starts and ends", () => {
    expect(promised).toEqual(
      expect.arrayContaining([
        'delivery.report/1.schema = "delivery.report/1"',
        "delivery.report/1.live: boolean|null",
        "delivery.report/1.counts.*: integer",
        'delivery.report/1.surfaces[].standing = "not_started"',
        'delivery.report/1.surfaces[].plain.audience = "owner"',
        "delivery.report/1.surfaces[].escalation: null|object",
        "delivery.report/1.surfaces[].cause.population: null|string",
        "delivery.report/1.trips[].cause.reason: null|string",
        "delivery.report/1.run.governs: boolean",
        "delivery.report/1.surfaces[].decisions[].rationale: string",
        "delivery.report/1.incomplete[].file: string",
        "delivery.event/1.type: string",
        'delivery.event/1<stream_started>.type = "stream_started"',
        "delivery.event/1<stream_ended>.ending: string",
        "delivery.event/1<triage_decision>.rationale: string",
      ]),
    );
  });
});
