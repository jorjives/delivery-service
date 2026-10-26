import { z } from "zod";
import { GuardName, SEVERITIES, Severity } from "../../schema.js";
import { Finding } from "../inspection-findings.js";
import type { Inspection, InspectedWorkflow } from "../inspection.js";
import { SETTING_TYPES } from "../setting-types.js";

export const Direction = z.enum(["narrower", "wider", "neutral"]);
export type Direction = z.infer<typeof Direction>;

/** One change between two versions of a pack. The update document publishes these, so the schema is the one definition. */
export const Change = z.union([
  z.object({ kind: z.literal("hold"), workflow: z.string(), from: Severity.nullable(), to: Severity.nullable(), direction: Direction }),
  z.object({ kind: z.literal("hold-unknown"), workflow: z.string(), direction: Direction }),
  z.object({ kind: z.enum(["guard-added", "guard-removed"]), workflow: z.string(), guard: GuardName, direction: Direction }),
  z.object({ kind: z.enum(["workflow-added", "workflow-removed"]), workflow: z.string(), workflowKind: z.enum(["find", "act"]), direction: Direction }),
  z.object({ kind: z.literal("kind-changed"), workflow: z.string(), from: z.enum(["find", "act"]), to: z.enum(["find", "act"]), direction: Direction }),
  z.object({ kind: z.enum(["widens-added", "widens-removed"]), workflow: z.string(), dimension: z.string(), direction: Direction }),
  z.object({ kind: z.enum(["finding-gained", "finding-lost"]), finding: Finding, direction: Direction }),
  z.object({ kind: z.literal("setting-added"), setting: z.string(), type: z.enum(SETTING_TYPES), required: z.boolean(), default: z.string().nullable(), direction: Direction }),
  z.object({ kind: z.literal("setting-removed"), setting: z.string(), direction: Direction }),
  z.object({ kind: z.literal("setting-default-changed"), setting: z.string(), from: z.string().nullable(), to: z.string().nullable(), direction: Direction }),
  z.object({ kind: z.literal("setting-type-changed"), setting: z.string(), from: z.enum(SETTING_TYPES), to: z.enum(SETTING_TYPES), direction: Direction }),
]);
export type Change = z.infer<typeof Change>;

/** The direction of each kind of change, decided once here. A less severe hold lets more ideas wait, so it narrows. */
const DIRECTION = {
  holdLifted: "wider",
  holdAdded: "narrower",
  holdLowered: "narrower",
  holdRaised: "wider",
  holdUnknown: "wider",
  guardAdded: "narrower",
  guardRemoved: "wider",
  workflowAdded: "wider",
  workflowRemoved: "narrower",
  becameAct: "wider",
  becameFind: "narrower",
  widensAdded: "wider",
  widensRemoved: "narrower",
  settingChanged: "neutral",
} as const satisfies Record<string, Direction>;

/** A finding that is gained or lost: a wider one widens the pack, a note changes nothing it allows. */
const FINDING_DIRECTION: Record<"gained" | "lost", Record<Finding["relation"], Direction>> = {
  gained: { wider: "wider", note: "neutral" },
  lost: { wider: "narrower", note: "neutral" },
};

/** The order the kinds of change are listed in: sign-off, guards, workflows added, removed, kind, widens, findings, then settings. */
const GROUP = { hold: 0, guard: 1, added: 2, removed: 3, kind: 4, widens: 5, finding: 6, setting: 7 } as const;

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
    if (prev.holdKnown && next.holdKnown) {
      if (prev.hold !== next.hold) {
        add(GROUP.hold, at, workflow, { kind: "hold", workflow, from: prev.hold, to: next.hold, direction: holdDirection(prev.hold, next.hold) });
      }
    } else if (prev.holdSetting !== next.holdSetting) {
      // A hold that cannot be known has no severity to compare, and a null one would read as lifted. Naming a different setting is the change.
      add(GROUP.hold, at, workflow, { kind: "hold-unknown", workflow, direction: DIRECTION.holdUnknown });
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

  const beforeSettings = new Map(before.settings.map((setting) => [setting.name, setting]));
  const afterSettingNames = new Set(after.settings.map((setting) => setting.name));
  after.settings.forEach((next, at) => {
    const prev = beforeSettings.get(next.name);
    const name = next.name;
    if (prev === undefined) {
      add(GROUP.setting, at, name, { kind: "setting-added", setting: name, type: next.type, required: next.required, default: next.default, direction: DIRECTION.settingChanged });
      return;
    }
    if (prev.type !== next.type) {
      add(GROUP.setting, at, name, { kind: "setting-type-changed", setting: name, from: prev.type, to: next.type, direction: DIRECTION.settingChanged });
    }
    if (prev.default !== next.default) {
      add(GROUP.setting, at, name, { kind: "setting-default-changed", setting: name, from: prev.default, to: next.default, direction: DIRECTION.settingChanged });
    }
  });
  before.settings.forEach((prev, at) => {
    if (!afterSettingNames.has(prev.name)) {
      add(GROUP.setting, at, prev.name, { kind: "setting-removed", setting: prev.name, direction: DIRECTION.settingChanged });
    }
  });

  return entries
    .sort((a, b) => a.group - b.group || RANK[a.change.direction] - RANK[b.change.direction] || a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ change }) => change);
}
