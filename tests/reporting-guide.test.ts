// Observability and reporting, slice 5: docs/reporting.md is what an extender builds
// against, so it is held to the schemas it describes. Every key and every event type
// the two formats publish is named in it, the lines it shows are valid events, the
// promise is stated, and the code it shows compiles against the package's own exports.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Decision, HeldSequence, Plain, ReportAfter, ReportDelivery, RepairFile, ReportDocument, ReportRepair, ReportRun, ReportSurface, ReportTrip, SurfaceCause, TripCause, UsageCoverage, UsageTotal } from "../src/report/document.js";
import { ReportEvent, StreamEnding } from "../src/report/events.js";
import * as library from "../src/index.js";
import { EVENT_SCHEMA, publishedSchema } from "../src/index.js";
import { flatten, outputBlock, REPO_ROOT, sectionOf, snippetFrom } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/reporting.md"), "utf-8");
const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
/** Whether the guide names `word` as code. */
const named = (word: string): boolean => guide.includes(`\`${word}\``) || guide.includes(`"${word}"`);

describe("the reporting guide", () => {
  it("names every key of the report document: its own, a run's, a task's, a triage round's, the plain-words block's, a trip's and the two causes'", () => {
    const keys = [ReportDocument, ReportDelivery, ReportAfter, HeldSequence, ReportRun, ReportSurface, Decision, Plain, ReportRepair, RepairFile, ReportTrip, SurfaceCause, TripCause, UsageTotal, UsageCoverage].flatMap((schema) => Object.keys(schema.shape));

    expect(keys.filter((key) => !named(key))).toEqual([]);
  });

  it("names every type of event, every key an event carries, and every way a stream ends", () => {
    const types = ReportEvent.options.map((option) => option.shape.type.value);
    const keys = ReportEvent.options.flatMap((option) => Object.keys(option.shape));

    expect([...types, ...keys, ...StreamEnding.options].filter((word) => !named(word))).toEqual([]);
  });

  it("shows a stream whose every line is a valid event, from the line that starts it to the line that ends it", () => {
    const event = z.fromJSONSchema(publishedSchema()[EVENT_SCHEMA]);
    const lines = outputBlock(sectionOf(guide, "## The event stream", "## The schema")).map((line) => JSON.parse(line));

    for (const line of lines) expect(event.safeParse(line).error).toBeUndefined();
    expect([lines.at(0).type, lines.at(-1).type]).toEqual(["stream_started", "stream_ended"]);
  });

  it("says every key is always present, inside a cause as well, and leaves out no exception to it", () => {
    const flat = flatten(guide);

    expect(flat).toContain("Every key is always present");
    expect(flat).toContain("a task's `cause` and a trip's `cause` each name every key their kinds can have");
    expect(flat).not.toMatch(/optional|one exception/i);
  });

  it("states the promise: what never changes, what a reader must ignore, what not to parse, and what is outside it", () => {
    const promise = sectionOf(guide, "## What will not change", "## From your own code");

    expect(promise).toContain("No key is ever removed, renamed or given another type");
    expect(promise).toContain("Ignore keys you do not know");
    expect(promise).toContain("a name or an event type you do not know");
    expect(promise).toContain("Do not parse sentences meant for people");
    expect(promise).toMatch(/Outside the promise: the step-by-step lines `delivery run --json`/);
  });

  it("imports, in the code it shows, only what the package exports", () => {
    const [, names = ""] = /import \{([^}]+)\} from "delivery-service";/.exec(snippetFrom(guide, "reporting from your own code")) ?? [];
    const imported = names.split(",").map((name) => name.trim());

    expect(imported.length).toBeGreaterThan(5);
    expect(imported.filter((name) => !(name in library))).toEqual([]);
  });

  it("is where the README sends a reader who wants the reports as data", () => {
    expect(readme).toContain("(docs/reporting.md)");
    expect(readme).not.toMatch(/for now, with `--json`|text only for now/);
  });
});
