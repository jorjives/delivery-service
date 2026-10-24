import { expect, it } from "vitest";
import type { GuardName, Severity } from "../../schema.js";
import { INSPECTION_SCHEMA, type Inspection, type InspectedWorkflow, NO_PROJECT, withFindings } from "../inspection.js";
import { comparePacks } from "./compare.js";

const PACK = "docs-drift";

function step(added: GuardName[] = []): InspectedWorkflow["steps"][number] {
  return { name: "do", instructions: { authored: "Do it.", harness: null }, guards: { added, off: [] } };
}

function act(local: string, overrides: Partial<InspectedWorkflow> = {}): InspectedWorkflow {
  return { name: `${PACK}:${local}`, local, kind: "act", summary: null, offers: null, steps: [step()], upgraded: [], widens: [], hold: "high", ...overrides };
}

function find(local: string, overrides: Partial<InspectedWorkflow> = {}): InspectedWorkflow {
  return { name: `${PACK}:${local}`, local, kind: "find", summary: null, offers: [], steps: [step()], upgraded: [], widens: [], hold: null, ...overrides };
}

function inspection(workflows: InspectedWorkflow[]): Inspection {
  return withFindings({
    schema: INSPECTION_SCHEMA,
    ok: true,
    pack: { name: PACK, version: "1.0.0", title: "Docs drift", summary: "S", format: "delivery.pack/3", hash: "a".repeat(64), source: { kind: "built-in", path: "/packs/docs-drift", package: null }, workflows: workflows.map(({ name }) => name) },
    defaultGuards: [],
    workflows,
    project: NO_PROJECT,
    files: [],
  });
}

const holdsOf = (before: Inspection, after: Inspection) => comparePacks(before, after).filter((change) => change.kind === "hold");

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
