// Slice 5: Build Your Own Tools on Versioned Report Data
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-03 against commit 9974cc1
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project with a list of three
// tasks (two land, one stops for the owner), the agent routed to the vendored
// scripted agent through the contributor-only test seam: no network, no API key.
// Documents and events are held to the schema `delivery report --schema` prints.
// Acceptance criteria needing a live run, a run of several tasks, a pre-slice
// status document or an unrecorded one-at-a-time run are recorded as skipped
// below, each with its reason.

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed command output is held as untyped data, as a consumer would hold it */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { REPO_ROOT, runDelivery } from "../helpers.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";
const PURGE = "Remove every page under the old news section";
const SAID = "This would delete 14 published pages. I need the owner to confirm before I remove them.";

const writes = (path: string, said: string) => ({
  effects: [{ write: { path, content: `${said}\n` } }],
  json: { status: "completed", rationale: said },
});

const AGENT: MockScript = {
  expectations: [
    { when: { promptContains: PURGE }, json: { status: "escalate", category: "authority", rationale: SAID } },
    { when: { promptContains: FORM }, ...writes("contact.html", "added the contact form") },
    { when: { promptContains: PRICES }, ...writes("prices.html", "updated the prices page") },
  ],
};

/** A project whose list has run: two tasks landed, one stopped for the owner. */
async function stoppedProject() {
  const repo = initTempRepo("uat-data-", {
    "package.json": PACKAGE,
    ".gitignore": ".delivery/\n",
    "delivery.config.json": JSON.stringify({ closer: { type: "merge-back" }, tasks: [FORM, PRICES, PURGE] }, null, 2),
  });
  const env = {
    ...process.env,
    [TEST_MOCK_SCRIPT]: await scriptFile(AGENT),
    XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-data-state-")),
  };
  runDelivery(["run"], { cwd: repo, env });
  return { repo, env };
}

const ESC = String.fromCharCode(27);
const json = (text: string): Record<string, any> => JSON.parse(text);
const lines = (text: string) => text.split("\n").filter((l) => l !== "");

/** A consumer's validator for one format, built from nothing but the published schema. */
function validator(schema: unknown) {
  const check = z.fromJSONSchema(schema as never);
  return (value: unknown) => check.safeParse(value).success;
}

describe("UAT: feed a script or dashboard from the reports as data, with the schema alongside", () => {
  it("prints one versioned document with the stopped task's reason, audience and budgets; the schema describes it; the watch streams started-to-ended lines", async () => {
    const { repo, env } = await stoppedProject();

    // Step 1: `delivery report --json` prints one document naming its version.
    const report = runDelivery(["report", "--json"], { cwd: repo, env });
    expect(report.status).toBe(0);
    const doc = json(report.stdout);
    expect(doc.schema).toBe("delivery.report/1");
    expect(doc.kind).toBe("list");
    expect(doc.live).toBe(false);
    expect(doc.counts).toMatchObject({ closed: 2, escalated: 1 });
    const stopped = doc.surfaces.find((s: any) => s.task === PURGE);
    expect(stopped).toMatchObject({ standing: "escalated", cause: { kind: "authority" }, plain: { audience: expect.any(String) } });
    expect(stopped.reason).toBe(SAID);
    expect(stopped.budgets.map((b: any) => b.population)).toContain("correction");
    for (const b of stopped.budgets) expect(b).toEqual({ population: expect.any(String), used: expect.any(Number), max: expect.any(Number) });

    // Step 2: `delivery report --schema` describes the same keys, and the document is valid against it.
    const schemaRun = runDelivery(["report", "--schema"], { cwd: repo, env });
    expect(schemaRun.status).toBe(0);
    const schema = json(schemaRun.stdout);
    expect(Object.keys(schema).sort()).toEqual(["delivery.event/1", "delivery.report/1"]);
    for (const key of Object.keys(doc)) expect(schema["delivery.report/1"].properties).toHaveProperty(key);
    expect(validator(schema["delivery.report/1"])(doc)).toBe(true);

    // Step 3: the watch prints one JSON event per line, first a stream-started line, last a stream-ended line.
    const watch = runDelivery(["status", "--watch", "--json"], { cwd: repo, env });
    const events = lines(watch.stdout).map((l) => json(l));
    expect(events[0]).toMatchObject({ schema: "delivery.event/1", type: "stream_started", subject: "list" });
    expect(events.at(-1)).toMatchObject({ type: "stream_ended", ending: "ended", counts: { closed: 2, escalated: 1 } });
    expect(events.some((e) => e.type === "surface_outcome" && e.outcome === "escalated")).toBe(true);
    const isEvent = validator(schema["delivery.event/1"]);
    for (const e of events) expect(isEvent(e)).toBe(true);

    // Step 4: the documentation states the stability promise.
    const docs = readFileSync(join(REPO_ROOT, "docs", "reporting.md"), "utf-8");
    expect(docs).toContain("## What will not change");
    expect(docs).toContain("No key is ever removed, renamed or given another type");
  });
});

describe("AC: the document", () => {
  it("is the same for `delivery report` and `status --json`, which still carries what it did and now holds the report", async () => {
    const { repo, env } = await stoppedProject();
    const report = json(runDelivery(["report", "--json"], { cwd: repo, env }).stdout);

    // Every key is always present: an absent value is explicit.
    const closed = report.surfaces.find((s: any) => s.task === FORM);
    expect(closed).toMatchObject({ escalation: null, plain: null, cause: null, limit: null, decisions: [] });
    expect(report.run).toBeNull();
    expect(report.incomplete).toEqual([]);

    // The escalation packet and plain-language block ride along on the stopped task.
    const stopped = report.surfaces.find((s: any) => s.task === PURGE);
    expect(Object.keys(stopped.escalation).sort()).toEqual(["dead_ends", "decision", "evidence", "references", "why_now"]);
    expect(Object.keys(stopped.plain).sort()).toEqual(["agentSaid", "audience", "group", "next", "sentence"]);
    expect(stopped.states.map((s: any) => s.state)).toEqual(["AGENT_ACTIVE", "ESCALATED"]);

    // A named run's document has kind "task", and `status <run> --json` carries it as `report`.
    const [runId] = readdirSync(join(repo, ".delivery", "runs")).filter((d) => d.startsWith("remove-every"));
    if (!runId) throw new Error("the stopped task left no record");
    const named = json(runDelivery(["report", runId, "--json"], { cwd: repo, env }).stdout);
    expect(named.kind).toBe("task");
    const status = runDelivery(["status", runId, "--json"], { cwd: repo, env });
    expect(status.status).toBe(0);
    const statusDoc = json(status.stdout);
    expect(statusDoc.report).toEqual(named);
    expect(Object.keys(statusDoc).length).toBeGreaterThan(1);
  });

  it("with --json holds only data on standard output: no colour, no prose", async () => {
    const { repo, env } = await stoppedProject();
    for (const args of [["report", "--json"], ["report", "--schema"], ["status", "--json"], ["status", "--watch", "--json"]]) {
      const out = runDelivery(args, { cwd: repo, env });
      expect(out.stdout).not.toContain(ESC);
      for (const line of lines(out.stdout)) {
        // Each line is complete JSON or a line of the one pretty-printed document; the whole stream parses either way.
        if (args.includes("--watch")) expect(() => json(line)).not.toThrow();
      }
      if (!args.includes("--watch")) expect(() => json(out.stdout)).not.toThrow();
    }
  });

  it("marks a damaged task record as making it incomplete, and still carries the other tasks", async () => {
    const { repo, env } = await stoppedProject();
    const [runId] = readdirSync(join(repo, ".delivery", "runs")).filter((d) => d.startsWith("update-the-prices"));
    if (!runId) throw new Error("the task left no record");
    const log = join(repo, ".delivery", "runs", runId, "log.jsonl");
    const [firstEntry] = lines(readFileSync(log, "utf-8"));
    writeFileSync(log, `this is not a log line\n${firstEntry}\n`);

    const report = runDelivery(["report", "--json"], { cwd: repo, env });
    expect(report.status).toBe(0);
    const doc = json(report.stdout);
    expect(doc.incomplete).toHaveLength(1);
    expect(doc.incomplete[0]).toMatchObject({ run: runId, file: `.delivery/runs/${runId}/log.jsonl` });
    expect(doc.surfaces.map((s: any) => s.task)).toEqual(expect.arrayContaining([FORM, PURGE]));
  });
});

describe("AC: the event stream", () => {
  it("replaying a finished run prints exactly the events watching it printed", async () => {
    const { repo, env } = await stoppedProject();
    const first = runDelivery(["status", "--watch", "--json"], { cwd: repo, env });
    const second = runDelivery(["status", "--watch", "--json"], { cwd: repo, env });
    expect(second.stdout).toBe(first.stdout);
    expect(lines(first.stdout).length).toBeGreaterThan(2);
  });
});

describe("AC: the published schema", () => {
  it("accepts a document with an extra key, and the documentation says to ignore unknown keys and not to parse sentences", async () => {
    const { repo, env } = await stoppedProject();
    const schema = json(runDelivery(["report", "--schema"], { cwd: repo, env }).stdout);
    const doc = json(runDelivery(["report", "--json"], { cwd: repo, env }).stdout);
    const isDoc = validator(schema["delivery.report/1"]);
    expect(isDoc({ ...doc, aKeyFromALaterRelease: 1, surfaces: doc.surfaces.map((s: any) => ({ ...s, another: [] })) })).toBe(true);
    // The schema is not vacuous: a document missing a published key, or re-typing one, is refused.
    const without = { ...doc };
    delete without.counts;
    expect(isDoc(without)).toBe(false);
    expect(isDoc({ ...doc, live: "yes" })).toBe(false);

    const docs = readFileSync(join(REPO_ROOT, "docs", "reporting.md"), "utf-8");
    expect(docs).toContain("Ignore keys you do not know");
    expect(docs).toContain("Do not parse sentences meant for people");
  });

  it("needs no project: `delivery report --schema` prints it from anywhere", () => {
    const out = runDelivery(["report", "--schema"], { cwd: mkdtempSync(join(tmpdir(), "uat-data-bare-")), env: process.env });
    expect(out.status).toBe(0);
    expect(json(out.stdout)["delivery.event/1"]).toBeDefined();
  });
});

describe("AC: recorded as skipped", () => {
  it.skip("AC: a run of several tasks is a document of kind run, with its own breaker, trips and budgets (needs a shared-environment run; covered by src/report/derive.test.ts)", () => {});
  it.skip("AC: `status --json` printed before this item keeps every name and meaning (needs a pre-slice document to compare with; held by src/report/published-keys.txt and src/cli/status-command.test.ts)", () => {});
  it.skip("AC: a list run one at a time is marked as having no run of its own, and a live document says live (needs a run in progress; covered by src/report/events.test.ts and src/cli/watch-command.test.ts)", () => {});
  it.skip("AC: the document's liveness is null when nothing records it (needs a killed one-at-a-time run; covered by src/report/derive.test.ts)", () => {});
  it.skip("AC: the library functions and schemas are importable from the package (a library-import surface, not a command; covered by src/index.test.ts)", () => {});
});
