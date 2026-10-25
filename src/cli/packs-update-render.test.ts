import { describe, expect, it } from "vitest";
import type { Change } from "../packs/install/compare.js";
import type { FileDiff } from "../packs/install/file-diff.js";
import { INSPECTION_SCHEMA, NO_PROJECT, withFindings, type Inspection, type InspectedWorkflow } from "../packs/inspection.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import {
  badRequestLines,
  changedLinesBlock,
  filesLines,
  headlineLines,
  keptDiffersLines,
  lookupLines,
  NOTHING_UPDATED,
  notUpdatableLines,
  renamedLines,
  sameContentLines,
  stateHintLines,
  summaryLines,
  updatedLines,
  updateQuestion,
  upToDateLines,
} from "./packs-update-render.js";

/** The text of some lines with every run of white space made one space, so where a line wraps does not matter. */
const flat = (lines: readonly string[] | string): string => (typeof lines === "string" ? lines : lines.join(" ")).replace(/\s+/g, " ");

/** The widest line, in columns. */
const widest = (lines: readonly string[]): number => Math.max(...lines.map((line) => line.length));

/** A package name of exactly 40 characters, scoped. */
const LONG = `@acme/${"x".repeat(34)}`;

const workflow = (overrides: Partial<InspectedWorkflow> & { local: string }): InspectedWorkflow => ({
  name: `docs-drift:${overrides.local}`,
  kind: "act",
  summary: null,
  offers: null,
  steps: [],
  upgraded: [],
  widens: [],
  hold: null,
  ...overrides,
});

/** The model of the pack after an update, with the workflows given. */
const inspection = (workflows: InspectedWorkflow[]): Inspection =>
  withFindings({
    schema: INSPECTION_SCHEMA,
    ok: true,
    pack: {
      name: "docs-drift",
      version: "1.3.0",
      title: "Docs drift",
      summary: "Checks the docs.",
      format: "delivery.pack/3",
      hash: "b".repeat(64),
      workflows: workflows.map(({ name }) => name),
      source: { kind: "installed", path: ".delivery/packs/docs-drift", package: null },
    },
    defaultGuards: [],
    settings: [],
    workflows,
    project: NO_PROJECT,
    files: [],
  });

const after = inspection([]);

const diffs: FileDiff[] = [
  { path: "code.md", status: "changed", added: 1, removed: 1, lines: [{ kind: "removed", text: "old" }, { kind: "added", text: "new" }] },
  { path: "audit.md", status: "added", added: 2, removed: 0, lines: [{ kind: "added", text: "a" }, { kind: "added", text: "b" }] },
  { path: "pack.json", status: "changed", added: 3, removed: 1, lines: [{ kind: "removed", text: "x" }, { kind: "added", text: "y" }] },
  { path: "scan.md", status: "unchanged", added: 0, removed: 0, lines: [] },
];

describe("summaryLines", () => {
  it("leads the summary with a removed sign-off", () => {
    const lines = summaryLines([{ kind: "hold", workflow: "fix", from: "high", to: null, direction: "wider" }], after);
    expect(lines[0]).toBe("What changed, in short");
    expect(lines[1]).toBe('  Sign-off: "fix" no longer waits for your sign-off.');
  });

  it("says a sign-off added, and a threshold moved, with what each rates", () => {
    const text = flat(
      summaryLines(
        [
          { kind: "hold", workflow: "fix", from: null, to: "high", direction: "narrower" },
          { kind: "hold", workflow: "scan", from: "high", to: "critical", direction: "wider" },
        ],
        after,
      ),
    );
    expect(text).toContain('Sign-off: "fix" now waits for your sign-off on ideas rated high or critical.');
    expect(text).toContain('Sign-off: "scan" now waits for your sign-off on ideas rated critical (before: high or critical).');
  });

  it("says no change for each part when nothing changed, and ends with the caveat", () => {
    expect(flat(summaryLines([], after))).toBe(
      flat(`What changed, in short Sign-off: no change. Guards: no change. Workflows added: none Workflows removed: none Checks and landing: no change. Widens what the agent may do: no. Read the changed lines below. This summary does not cover what the instructions say.`),
    );
  });

  it("names a guard removed and a guard added, with what each refuses", () => {
    const text = flat(
      summaryLines(
        [
          { kind: "guard-removed", workflow: "fix", guard: "no-skips", direction: "wider" },
          { kind: "guard-added", workflow: "fix", guard: "backlog", direction: "narrower" },
        ],
        after,
      ),
    );
    expect(text).toContain(
      'Guards: "fix" is no longer refused if it adds a skip marker to a test. Guards: "fix" is now also refused if it edits or removes an existing backlog item, rather than adding a new one.',
    );
  });

  it("lists workflows added and removed by name, and a change of kind", () => {
    const text = flat(
      summaryLines(
        [
          { kind: "workflow-added", workflow: "fix", workflowKind: "act", direction: "wider" },
          { kind: "workflow-removed", workflow: "scan", workflowKind: "find", direction: "narrower" },
          { kind: "kind-changed", workflow: "tidy", from: "find", to: "act", direction: "wider" },
        ],
        after,
      ),
    );
    expect(text).toContain("Workflows added: fix Workflows removed: scan");
    expect(text).toContain('Workflows changed: "tidy" is now an act (before: a find).');
  });

  it("says the new version widens, and lists the new things to look at with Item 2's sentences", () => {
    const widening = inspection([workflow({ local: "fix", widens: ["its own agent options"] })]);
    const text = flat(
      summaryLines(
        [
          { kind: "widens-added", workflow: "fix", dimension: "its own agent options", direction: "wider" },
          {
            kind: "finding-gained",
            finding: { code: "widens", relation: "wider", workflow: "docs-drift:fix", detail: "its own agent options" },
            direction: "wider",
          },
        ],
        widening,
      ),
    );
    expect(text).toContain("Widens what the agent may do: yes.");
    expect(text).toContain(`"fix" now widens what the agent may do beyond your project's defaults: its own agent options.`);
    expect(text).toContain(`New things to look at: 1. "fix" widens what the agent may do beyond your project's defaults: its own agent options.`);
  });

  it("puts a change to a check or a landing under checks and landing, not widening", () => {
    const text = flat(
      summaryLines(
        [
          { kind: "widens-added", workflow: "fix", dimension: "its own gate", direction: "wider" },
          { kind: "widens-removed", workflow: "fix", dimension: "follow-on steps of its own", direction: "narrower" },
          { kind: "widens-removed", workflow: "fix", dimension: "a guard turned off", direction: "narrower" },
        ],
        after,
      ),
    );
    expect(text).toContain('Checks and landing: "fix" now has its own gate. Checks and landing: "fix" no longer has follow-on steps of its own.');
    expect(text).toContain(`"fix" no longer widens what the agent may do beyond your project's defaults: a guard turned off.`);
    expect(text).not.toContain('"fix" no longer widens what the agent may do beyond your project\'s defaults: follow-on');
  });
});

describe("headlineLines", () => {
  it("starts with both versions and both full fingerprints", () => {
    expect(headlineLines("docs-drift", { version: "1.2.0", hash: "a".repeat(64) }, { version: "1.3.0", hash: "b".repeat(64) })).toEqual([
      "docs-drift: 1.2.0 to 1.3.0",
      "Fingerprint before:",
      `  ${"a".repeat(32)}`,
      `  ${"a".repeat(32)}`,
      "Fingerprint after:",
      `  ${"b".repeat(32)}`,
      `  ${"b".repeat(32)}`,
    ]);
  });
});

describe("filesLines", () => {
  it("lists each instruction file with its counts", () => {
    expect(filesLines(diffs)).toEqual([
      "Instruction files",
      "  code.md: changed, 1 line added, 1 removed",
      "  audit.md: new, 2 lines",
      "  pack.json: changed, 3 lines added, 1 removed",
      "  scan.md: unchanged",
    ]);
  });
});

describe("changedLinesBlock", () => {
  it("shows changed lines with a legend, and a gap", () => {
    const lines = changedLinesBlock([
      {
        path: "fix.md",
        status: "changed",
        added: 1,
        removed: 1,
        lines: [{ kind: "removed", text: "old" }, { kind: "added", text: "new" }, { kind: "gap" }, { kind: "context", text: "same" }, { kind: "no-line-break" }],
      },
    ]);
    expect(lines.slice(0, 4)).toEqual([
      "Changed lines",
      '  A line starting "-" was removed. A line starting "+" was',
      '  added. Two spaces start an unchanged line. "..." marks',
      "  lines left out.",
    ]);
    expect(lines.slice(4)).toEqual(["", "  fix.md", "  - old", "  + new", "  ...", "    same", "  (no line break at the end of the line above)"]);
  });

  it("shows a direction-changing character in a changed line as visible text", () => {
    const text = changedLinesBlock([{ path: "fix.md", status: "changed", added: 1, removed: 0, lines: [{ kind: "added", text: "a‮b\u001b" }] }]).join("\n");
    expect(text).toContain("  + a\\u202eb\\x1b");
    expect(text).not.toContain("‮");
    expect(text).not.toContain("\u001b");
  });
});

describe("updateQuestion", () => {
  it("asks to move the pack, with no as the default", () => {
    expect(updateQuestion("docs-drift", "1.2.0", "1.3.0")).toEqual({ message: "Move docs-drift from 1.2.0 to 1.3.0?", default: false });
  });
});

describe("the other sentences", () => {
  it("says what is being checked, and that nothing changes until a yes", () => {
    expect(lookupLines("docs-drift", "^1.2.0", "1.3.0", "1.2.0")).toEqual([
      "Checking docs-drift on npm.",
      'Found 1.3.0 for "^1.2.0" (you have 1.2.0).',
      "Nothing is changed until you say yes.",
    ]);
  });

  it("says a pack is up to date, and that nothing was changed when the content is the same", () => {
    expect(upToDateLines("docs-drift", "1.2.0", "latest")).toEqual(["docs-drift is up to date at 1.2.0.", '  "latest" on npm is still the pack you have.']);
    expect(sameContentLines("docs-drift", "1.2.0", "1.2.1")).toEqual(["docs-drift 1.2.1 has the same content as the 1.2.0 you have.", `  ${NOTHING_UPDATED}`]);
  });

  it("tells the owner how to go back when the kept copy has changed, and how to approve when it is unapproved", () => {
    expect(stateHintLines("docs-drift", "ok")).toEqual([]);
    expect(stateHintLines("docs-drift", "changed")).toEqual([
      "The kept copy differs from what was approved. To go back:",
      "  delivery packs restore docs-drift",
    ]);
    expect(flat(stateHintLines("docs-drift", "unapproved"))).toBe(
      flat(["The record says docs-drift has not been approved. To read it and decide:", "  delivery packs approve docs-drift"]),
    );
  });

  it("refuses an update whose kept files are missing or invalid, and changes nothing", () => {
    expect(notUpdatableLines("docs-drift", "missing")).toEqual([
      "Not updated: the kept files of docs-drift are missing.",
      "  Put them back first: delivery packs restore docs-drift",
      `  ${NOTHING_UPDATED}`,
    ]);
    expect(flat(notUpdatableLines("docs-drift", "invalid"))).toContain("Not updated: the kept files of docs-drift do not read as a pack.");
  });

  it("refuses a pack that holds another name, and says how to take it under the new one", () => {
    expect(flat(renamedLines("docs-drift", "docs-drift-pack", "1.3.0", "other"))).toBe(
      flat([
        "Not updated: docs-drift-pack 1.3.0 holds a pack named other, but this project keeps it as docs-drift.",
        "  To take it under its new name, remove this one, then add it again:",
        "    delivery packs remove docs-drift",
        "    delivery packs add docs-drift-pack",
        `  ${NOTHING_UPDATED}`,
      ]),
    );
  });

  it("refuses a request that is not a version, range or tag", () => {
    expect(badRequestLines("nope")).toEqual(["Not updated: nope is not a version, range or tag.", `  ${NOTHING_UPDATED}`]);
  });

  it("says the changes are from the kept copy as it is now", () => {
    expect(flat(keptDiffersLines())).toBe(
      "The kept copy differs from what was approved; the changes below are from the kept copy as it is now.",
    );
  });

  it("says what was updated, the two items to commit, and the version runs now use", () => {
    expect(updatedLines("docs-drift", "1.3.0")).toEqual([
      "Updated docs-drift to 1.3.0.",
      "  Recorded: .delivery/packs.lock.json",
      "  Kept as:  .delivery/packs/docs-drift",
      "Commit both. Runs use 1.3.0 from now on.",
    ]);
  });
});

describe("the width and the words", () => {
  it("keeps every line it writes itself within 60 columns, with no reassuring words, for a 40-character scoped name", () => {
    const changes: Change[] = [
      { kind: "hold", workflow: LONG, from: null, to: "high", direction: "narrower" },
      { kind: "workflow-added", workflow: LONG, workflowKind: "act", direction: "wider" },
      { kind: "guard-added", workflow: LONG, guard: "backlog", direction: "narrower" },
    ];
    const lines = [
      ...lookupLines(LONG, "^1.0.0", "1.3.0", "1.2.0"),
      ...upToDateLines(LONG, "1.2.0", "^1.0.0"),
      ...sameContentLines(LONG, "1.2.0", "1.2.1"),
      ...stateHintLines(LONG, "changed"),
      ...stateHintLines(LONG, "unapproved"),
      ...notUpdatableLines(LONG, "missing"),
      ...notUpdatableLines(LONG, "invalid"),
      ...renamedLines(LONG, LONG, "1.3.0", "other"),
      ...badRequestLines("nope"),
      ...keptDiffersLines(),
      ...headlineLines(LONG, { version: "1.2.0", hash: "a".repeat(64) }, { version: "1.3.0", hash: "b".repeat(64) }),
      ...summaryLines(changes, after),
      ...filesLines(diffs),
      ...updatedLines(LONG, "1.3.0"),
    ];
    expect(widest(lines)).toBeLessThanOrEqual(60);
    expect(flat(lines)).not.toMatch(REASSURING);
    expect(flat(lines)).not.toMatch(FORBIDDEN);
  });
});
