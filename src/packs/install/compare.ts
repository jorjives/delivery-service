import { SEVERITIES, type GuardName, type Severity } from "../../schema.js";
import type { Finding } from "../inspection-findings.js";
import type { Inspection, InspectedWorkflow } from "../inspection.js";

export type Direction = "narrower" | "wider" | "neutral";

export type Change =
  | { kind: "hold"; workflow: string; from: Severity | null; to: Severity | null; direction: Direction }
  | { kind: "guard-added" | "guard-removed"; workflow: string; guard: GuardName; direction: Direction }
  | { kind: "workflow-added" | "workflow-removed"; workflow: string; workflowKind: "find" | "act"; direction: Direction }
  | { kind: "kind-changed"; workflow: string; from: "find" | "act"; to: "find" | "act"; direction: Direction }
  | { kind: "widens-added" | "widens-removed"; workflow: string; dimension: string; direction: Direction }
  | { kind: "finding-gained" | "finding-lost"; finding: Finding; direction: Direction };

/** The direction of each kind of change, decided once here. A less severe hold lets more ideas wait, so it narrows. */
const DIRECTION = {
  holdLifted: "wider",
  holdAdded: "narrower",
  holdLowered: "narrower",
  holdRaised: "wider",
  guardAdded: "narrower",
  guardRemoved: "wider",
  workflowAdded: "wider",
  workflowRemoved: "narrower",
  becameAct: "wider",
  becameFind: "narrower",
  widensAdded: "wider",
  widensRemoved: "narrower",
} as const satisfies Record<string, Direction>;

/** A finding that is gained or lost: a wider one widens the pack, a note changes nothing it allows. */
const FINDING_DIRECTION: Record<"gained" | "lost", Record<Finding["relation"], Direction>> = {
  gained: { wider: "wider", note: "neutral" },
  lost: { wider: "narrower", note: "neutral" },
};

/** The order the kinds of change are listed in: sign-off, guards, workflows added, removed, kind, widens, then findings. */
const GROUP = { hold: 0, guard: 1, added: 2, removed: 3, kind: 4, widens: 5, finding: 6 } as const;

const RANK: Record<Direction, number> = { wider: 0, narrower: 1, neutral: 2 };

type Entry = { group: number; at: number; name: string; change: Change };

function holdDirection(from: Severity | null, to: Severity | null): Direction {
  if (to === null) return DIRECTION.holdLifted;
  if (from === null) return DIRECTION.holdAdded;
  return SEVERITIES.indexOf(to) > SEVERITIES.indexOf(from) ? DIRECTION.holdLowered : DIRECTION.holdRaised;
}

const guardsOf = (workflow: InspectedWorkflow): Set<GuardName> => new Set(workflow.steps.flatMap((step) => step.guards.added));

const minus = <T>(a: Set<T>, b: Set<T>): T[] => [...a].filter((item) => !b.has(item));

const findingKey = (finding: Finding): string => JSON.stringify([finding.code, finding.workflow, finding.detail]);

/** The changes from one pack inspection to another, each with the direction it moves what the pack allows. Pure: no I/O. */
export function comparePacks(before: Inspection, after: Inspection): Change[] {
  const entries: Entry[] = [];
  const add = (group: number, at: number, name: string, change: Change): void => {
    entries.push({ group, at, name, change });
  };
  const beforeByLocal = new Map(before.workflows.map((workflow) => [workflow.local, workflow]));
  const afterLocals = new Set(after.workflows.map((workflow) => workflow.local));

  after.workflows.forEach((next, at) => {
    const prev = beforeByLocal.get(next.local);
    const workflow = next.local;
    if (prev === undefined) {
      add(GROUP.added, at, workflow, { kind: "workflow-added", workflow, workflowKind: next.kind, direction: DIRECTION.workflowAdded });
      return;
    }
    if (prev.hold !== next.hold) {
      add(GROUP.hold, at, workflow, { kind: "hold", workflow, from: prev.hold, to: next.hold, direction: holdDirection(prev.hold, next.hold) });
    }
    for (const guard of minus(guardsOf(next), guardsOf(prev))) {
      add(GROUP.guard, at, guard, { kind: "guard-added", workflow, guard, direction: DIRECTION.guardAdded });
    }
    for (const guard of minus(guardsOf(prev), guardsOf(next))) {
      add(GROUP.guard, at, guard, { kind: "guard-removed", workflow, guard, direction: DIRECTION.guardRemoved });
    }
    if (prev.kind !== next.kind) {
      const direction = next.kind === "act" ? DIRECTION.becameAct : DIRECTION.becameFind;
      add(GROUP.kind, at, workflow, { kind: "kind-changed", workflow, from: prev.kind, to: next.kind, direction });
    }
    for (const dimension of minus(new Set(next.widens), new Set(prev.widens))) {
      add(GROUP.widens, at, dimension, { kind: "widens-added", workflow, dimension, direction: DIRECTION.widensAdded });
    }
    for (const dimension of minus(new Set(prev.widens), new Set(next.widens))) {
      add(GROUP.widens, at, dimension, { kind: "widens-removed", workflow, dimension, direction: DIRECTION.widensRemoved });
    }
  });

  before.workflows.forEach((prev, at) => {
    if (!afterLocals.has(prev.local)) {
      add(GROUP.removed, at, prev.local, { kind: "workflow-removed", workflow: prev.local, workflowKind: prev.kind, direction: DIRECTION.workflowRemoved });
    }
  });

  const beforeKeys = new Set(before.findings.map(findingKey));
  const afterKeys = new Set(after.findings.map(findingKey));
  const position = (inspection: Inspection, finding: Finding): number => inspection.workflows.findIndex((workflow) => workflow.name === finding.workflow);
  for (const finding of after.findings) {
    if (!beforeKeys.has(findingKey(finding))) {
      add(GROUP.finding, position(after, finding), finding.detail ?? "", { kind: "finding-gained", finding, direction: FINDING_DIRECTION.gained[finding.relation] });
    }
  }
  for (const finding of before.findings) {
    if (!afterKeys.has(findingKey(finding))) {
      add(GROUP.finding, position(before, finding), finding.detail ?? "", { kind: "finding-lost", finding, direction: FINDING_DIRECTION.lost[finding.relation] });
    }
  }

  return entries
    .sort((a, b) => a.group - b.group || RANK[a.change.direction] - RANK[b.change.direction] || a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ change }) => change);
}
