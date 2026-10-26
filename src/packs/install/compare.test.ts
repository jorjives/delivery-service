import { expect, it } from "vitest";
import type { GuardName, Severity } from "../../schema.js";
import { INSPECTION_SCHEMA, type Inspection, type InspectedSetting, type InspectedWorkflow, NO_PROJECT, withFindings } from "../inspection.js";
import { Change, comparePacks } from "./compare.js";

const PACK = "docs-drift";

const setting = (name: string, overrides: Partial<InspectedSetting> = {}): InspectedSetting =>
  ({ name, type: "path", summary: "S.", required: true, default: null, value: null, source: "unset", usedBy: [], ...overrides });

function step(added: GuardName[] = []): InspectedWorkflow["steps"][number] {
  return { name: "do", instructions: { authored: "Do it.", harness: null }, guards: { added, off: [] }, given: "Do it.", uses: [] };
}

function act(local: string, overrides: Partial<InspectedWorkflow> = {}): InspectedWorkflow {
  return { name: `${PACK}:${local}`, local, kind: "act", summary: null, offers: null, steps: [step()], upgraded: [], widens: [], hold: "high", holdSetting: null, holdKnown: true, ...overrides };
}

function find(local: string, overrides: Partial<InspectedWorkflow> = {}): InspectedWorkflow {
  return { name: `${PACK}:${local}`, local, kind: "find", summary: null, offers: [], steps: [step()], upgraded: [], widens: [], hold: null, holdSetting: null, holdKnown: true, ...overrides };
}

function inspection(workflows: InspectedWorkflow[], settings: InspectedSetting[] = []): Inspection {
  return withFindings({
    schema: INSPECTION_SCHEMA,
    ok: true,
    pack: { name: PACK, version: "1.0.0", title: "Docs drift", summary: "S", format: "delivery.pack/3", hash: "a".repeat(64), source: { kind: "built-in", path: "/packs/docs-drift", package: null }, workflows: workflows.map(({ name }) => name) },
    defaultGuards: [],
    settings,
    workflows,
    project: NO_PROJECT,
    files: [],
  });
}

const holdsOf = (before: Inspection, after: Inspection) => comparePacks(before, after).filter((change) => change.kind === "hold");

/** Every pair of inspections the tests in this file compare, so that each comparison can be checked against the published schema. */
const COMPARED: [Inspection, Inspection][] = [
  [inspection([act("fix", { hold: "high" })]), inspection([act("fix", { hold: null }), act("audit")])],
  [inspection([act("fix", { hold: "high" })]), inspection([act("fix", { hold: null, holdSetting: "h", holdKnown: false })])],
  [inspection([act("fix", { hold: null })]), inspection([act("fix", { hold: "high" })])],
  [inspection([act("fix", { hold: "high" })]), inspection([act("fix", { hold: "medium" })])],
  [inspection([act("fix", { hold: "medium" })]), inspection([act("fix", { hold: "critical" })])],
  [inspection([act("fix", { steps: [step(["no-skips"])] })]), inspection([act("fix", { steps: [step()] })])],
  [inspection([act("fix")]), inspection([act("fix"), act("audit")])],
  [inspection([act("fix"), find("scan")]), inspection([act("fix")])],
  [inspection([find("scan", { hold: "high" })]), inspection([act("scan")])],
  [inspection([act("fix")]), inspection([act("fix", { widens: ["follow-on steps of its own"] })])],
  [inspection([act("fix", { hold: "high" })]), inspection([act("fix", { hold: null })])],
  [inspection([act("fix", { steps: [step(["no-skips"])] }), find("scan")]), inspection([act("fix", { steps: [step(["no-skips"])] }), find("scan")])],
  [inspection([act("fix", { steps: [step(["no-skips"])] })]), inspection([act("fix", { steps: [step(["backlog"])] })])],
  [inspection([act("fix")]), inspection([act("fix")], [setting("docs-folder"), setting("max", { type: "text", required: false, default: "10" })])],
  [
    inspection([act("fix")], [setting("old"), setting("hold-from", { type: "severity", required: false, default: "high" }), setting("folder")]),
    inspection([act("fix")], [setting("hold-from", { type: "severity", required: false, default: "critical" }), setting("folder", { type: "text" })]),
  ],
];

it("gives only changes the published Change schema accepts", () => {
  for (const [before, after] of COMPARED) {
    for (const change of [...comparePacks(before, after), ...comparePacks(after, before)]) expect(Change.safeParse(change).success).toBe(true);
  }
});

it("reports a removed hold as wider, first", () => {
  const changes = comparePacks(inspection([act("fix", { hold: "high" })]), inspection([act("fix", { hold: null }), act("audit")]));
  expect(changes[0]).toEqual({ kind: "hold", workflow: "fix", from: "high", to: null, direction: "wider" });
});

it("reports a hold added as narrower and a lower threshold as narrower, and a higher one as wider", () => {
  const withHold = (hold: Severity | null) => inspection([act("fix", { hold })]);
  expect(holdsOf(withHold(null), withHold("high"))).toEqual([{ kind: "hold", workflow: "fix", from: null, to: "high", direction: "narrower" }]);
  expect(holdsOf(withHold("high"), withHold("medium"))).toEqual([{ kind: "hold", workflow: "fix", from: "high", to: "medium", direction: "narrower" }]);
  expect(holdsOf(withHold("medium"), withHold("critical"))).toEqual([{ kind: "hold", workflow: "fix", from: "medium", to: "critical", direction: "wider" }]);
});

it("reports a guard removed as wider and a guard added as narrower", () => {
  const guarded = (added: GuardName[]) => inspection([act("fix", { steps: [step(added)] })]);
  expect(comparePacks(guarded(["no-skips"]), guarded([]))).toEqual([{ kind: "guard-removed", workflow: "fix", guard: "no-skips", direction: "wider" }]);
  expect(comparePacks(guarded([]), guarded(["no-skips"]))).toEqual([{ kind: "guard-added", workflow: "fix", guard: "no-skips", direction: "narrower" }]);
});

it("reports workflows added and removed, with the kind", () => {
  expect(comparePacks(inspection([act("fix")]), inspection([act("fix"), act("audit")]))).toEqual([
    { kind: "workflow-added", workflow: "audit", workflowKind: "act", direction: "wider" },
  ]);
  expect(comparePacks(inspection([act("fix"), find("scan")]), inspection([act("fix")]))).toEqual([
    { kind: "workflow-removed", workflow: "scan", workflowKind: "find", direction: "narrower" },
  ]);
});

it("reports a find that became an act as wider", () => {
  expect(comparePacks(inspection([find("scan", { hold: "high" })]), inspection([act("scan")]))).toEqual([
    { kind: "kind-changed", workflow: "scan", from: "find", to: "act", direction: "wider" },
  ]);
});

it("reports a widening gained as wider", () => {
  expect(comparePacks(inspection([act("fix")]), inspection([act("fix", { widens: ["follow-on steps of its own"] })]))).toEqual([
    { kind: "widens-added", workflow: "fix", dimension: "follow-on steps of its own", direction: "wider" },
    { kind: "finding-gained", finding: { code: "widens", relation: "wider", workflow: "docs-drift:fix", detail: "follow-on steps of its own" }, direction: "wider" },
  ]);
});

it("reports a sign-off finding the new version gains as neutral", () => {
  expect(comparePacks(inspection([act("fix", { hold: "high" })]), inspection([act("fix", { hold: null })]))).toEqual([
    { kind: "hold", workflow: "fix", from: "high", to: null, direction: "wider" },
    { kind: "finding-gained", finding: { code: "lands-without-sign-off", relation: "note", workflow: "docs-drift:fix", detail: null }, direction: "neutral" },
  ]);
});

it("reports a new required setting and a new optional one with its default", () => {
  expect(comparePacks(inspection([act("fix")]), inspection([act("fix")], [setting("docs-folder"), setting("max", { type: "text", required: false, default: "10" })]))).toEqual([
    { kind: "setting-added", setting: "docs-folder", type: "path", required: true, default: null, direction: "neutral" },
    { kind: "setting-added", setting: "max", type: "text", required: false, default: "10", direction: "neutral" },
  ]);
});

it("reports a removed setting, a changed default and a changed type, none as wider or narrower", () => {
  const before = inspection([act("fix")], [setting("old"), setting("hold-from", { type: "severity", required: false, default: "high" }), setting("folder")]);
  const after = inspection([act("fix")], [setting("hold-from", { type: "severity", required: false, default: "critical" }), setting("folder", { type: "text" })]);
  // One group, one direction: ordered by index (after's, before's for a removed one), then by name.
  expect(comparePacks(before, after)).toEqual([
    { kind: "setting-default-changed", setting: "hold-from", from: "high", to: "critical", direction: "neutral" },
    { kind: "setting-removed", setting: "old", direction: "neutral" },
    { kind: "setting-type-changed", setting: "folder", from: "path", to: "text", direction: "neutral" },
  ]);
});

it("reports a hold that moved with its setting's default through the hold kind, first", () => {
  const before = inspection([act("fix", { hold: "high", holdSetting: "hold-from" })], [setting("hold-from", { type: "severity", required: false, default: "high" })]);
  const after = inspection([act("fix", { hold: "critical", holdSetting: "hold-from" })], [setting("hold-from", { type: "severity", required: false, default: "critical" })]);
  const changes = comparePacks(before, after);
  expect(changes[0]).toEqual({ kind: "hold", workflow: "fix", from: "high", to: "critical", direction: "wider" });
});

it("does not report a hold that cannot be known as lifted", () => {
  expect(holdsOf(inspection([act("fix", { hold: "high", holdSetting: "h" })]), inspection([act("fix", { hold: null, holdSetting: "h", holdKnown: false })]))).toEqual([]);
});

it("reports a hold that becomes unknown, or is re-pointed to a setting that is unknown, as wider and as its own kind", () => {
  const literal = inspection([act("fix", { hold: "high" })]);
  const unknown = (holdSetting: string) => inspection([act("fix", { hold: null, holdSetting, holdKnown: false })]);
  const expected = [{ kind: "hold-unknown", workflow: "fix", direction: "wider" }];
  expect(comparePacks(literal, unknown("h"))).toEqual(expected);
  expect(comparePacks(inspection([act("fix", { hold: "high", holdSetting: "a" })]), unknown("b"))).toEqual(expected);
  expect(comparePacks(unknown("a"), inspection([act("fix", { hold: "high", holdSetting: "b" })]))).toEqual(expected);
  expect(comparePacks(unknown("a"), unknown("b"))).toEqual(expected);
});

it("reports nothing for identical inspections", () => {
  const same = inspection([act("fix", { steps: [step(["no-skips"])] }), find("scan")]);
  expect(comparePacks(same, same)).toEqual([]);
});

it("orders wider before narrower within a kind", () => {
  expect(comparePacks(inspection([act("fix", { steps: [step(["no-skips"])] })]), inspection([act("fix", { steps: [step(["backlog"])] })]))).toEqual([
    { kind: "guard-removed", workflow: "fix", guard: "no-skips", direction: "wider" },
    { kind: "guard-added", workflow: "fix", guard: "backlog", direction: "narrower" },
  ]);
});
