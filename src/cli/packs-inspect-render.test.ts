import { expect, it } from "vitest";
import { builtInPacks } from "../packs/manifest.js";
import { inspectionOf, type Inspection } from "../packs/inspection.js";
import type { Severity } from "../schema.js";
import { OWN_SETUP } from "./own-setup.js";
import { INSPECT_RULE, INSPECT_WIDTH, renderInspection } from "./packs-inspect-render.js";

const packs = await builtInPacks();
const deprecations = packs.find((pack) => pack.manifest.name === "deprecations");
if (!deprecations) throw new Error("the deprecations pack is not built in");
const builtInInspections = packs.map((pack) => inspectionOf(pack));

const DEFAULT_SUMMARY = "Changes the code a little.";

interface ModelOverrides {
  summary?: string | undefined;
  hold?: Severity | null;
  authored?: string;
}

/** A one-find, one-act synthetic inspection. The overrides apply to the act. */
function model(overrides: ModelOverrides = {}): Inspection {
  const summary = "summary" in overrides ? overrides.summary : DEFAULT_SUMMARY;
  const act = {
    name: "test:act",
    local: "act",
    kind: "act" as const,
    ...(summary === undefined ? {} : { summary }),
    steps: [{ name: "do", instructions: { authored: overrides.authored ?? "Do the thing.\nThen stop.", harness: null }, guards: { added: [], off: [] } }],
    hold: overrides.hold ?? null,
  };
  const find = {
    name: "test:find",
    local: "find",
    kind: "find" as const,
    offers: ["test:act"],
    steps: [{ name: "scan", instructions: { authored: "Look around.", harness: "Write each idea as one line." }, guards: { added: ["backlog-only" as const], off: [] } }],
    hold: null,
  };
  return {
    schema: "delivery.pack-inspection/1",
    pack: { name: "test", version: "1.0.0", title: "Test pack", summary: "A pack for tests.", format: "delivery.pack/3", hash: "a".repeat(64), source: { kind: "built-in", path: "/packs/test" } },
    defaultGuards: ["tests-untouched"],
    workflows: [find, act],
  } as Inspection;
}

/** Every line outside the instructions: the lines between each pair of rules are the pack's words and the harness's, and are left out. */
function linesOutsideInstructions(lines: string[]): string[] {
  const kept: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line === INSPECT_RULE) {
      inside = !inside;
      continue;
    }
    if (!inside) kept.push(line);
  }
  return kept;
}

/** The text with the pack's own words taken out: the title, the summaries and the instructions as the pack wrote them. */
function withoutPackWords(lines: string[], inspection: Inspection): string {
  let text = lines.join("\n");
  // Instructions first: a summary may repeat a phrase from them, and removing that phrase would hide the instruction.
  const packWords: string[] = [];
  for (const workflow of inspection.workflows) for (const step of workflow.steps) packWords.push(step.instructions.authored);
  packWords.push(inspection.pack.title, inspection.pack.summary);
  for (const workflow of inspection.workflows) if (workflow.summary !== undefined) packWords.push(workflow.summary);
  for (const word of packWords) if (word !== "") text = text.split(word).join("");
  return text;
}

it("puts the short account first, then limits, then the full instructions last", () => {
  const lines = renderInspection(inspectionOf(deprecations));
  const at = (text: string) => lines.indexOf(text);
  expect(lines.slice(0, 2)).toEqual(["Pack: Move off deprecated code", "deprecations, version 1.0.0, built in to delivery-service."]);
  expect(`${lines[3]}${lines[4]}`).toBe(`  ${deprecations.hash.slice(0, 32)}  ${deprecations.hash.slice(32)}`);
  expect(at("In short")).toBeLessThan(at("What it may touch"));
  expect(at("What it may touch")).toBeLessThan(at("How far each workflow goes before it asks you"));
  expect(at("How far each workflow goes before it asks you")).toBeLessThan(at("Checks and landing"));
  expect(at("Checks and landing")).toBeLessThan(lines.findIndex((l) => l.startsWith("Instructions for ")));
  expect(lines.join("\n")).toContain('  An idea from "scan" may go to "code" or "tests", and only\n  after you approve it.');
});

it("says how far each workflow goes in words", () => {
  const text = renderInspection(inspectionOf(deprecations)).join("\n");
  expect(text).toContain("  code:\n    Also refused if it edits an existing test.\n    Ideas rated high or critical wait for your sign-off\n    before they land.");
  expect(text).toContain("  tests:\n    No extra guards.\n    Lands without asking you again, once you have approved\n    the idea.");
  expect(text).toContain("    Also refused if it changes anything other than adding\n    ideas to the backlog.");
  expect(text).toContain("This pack chooses no checks and no way of landing.");
});

it("says the instructions run with everything the owner's setup can do, and the project's follow-on steps run after landing", () => {
  const flat = renderInspection(inspectionOf(deprecations)).join(" ").replace(/\s+/g, " ");
  expect(flat).toContain("This pack cannot give the agent extra powers, and nothing in it takes any away.");
  for (const sentence of OWN_SETUP) expect(flat).toContain(sentence);
  expect(flat).toContain("After a change from an act workflow lands, your project's own follow-on steps run.");
});

it("shows every instruction unaltered, the pack's words apart from the harness's", () => {
  const lines = renderInspection(inspectionOf(deprecations));
  for (const [name, { authored, harness }] of Object.entries(deprecations.instructions)) {
    const local = name.split(":")[1];
    const start = lines.findIndex((l) => l.startsWith(`Instructions for ${local}: the pack's own words`));
    expect(lines.slice(start + 2, start + 2 + authored.split("\n").length).join("\n")).toBe(authored);
    if (harness !== null) expect(lines.join("\n")).toContain(`${INSPECT_RULE}\n${harness}\n${INSPECT_RULE}`);
  }
});

it("counts an instruction's lines, so a delimiter inside it cannot pass for the end", () => {
  const lines = renderInspection(model({ authored: `one\n${INSPECT_RULE}\nthree` }));
  expect(lines).toContain("Instructions for act: the pack's own words, 3 lines");
});

it("keeps every line it writes within 60 columns, a word too long to wrap on its own line, nothing lost", () => {
  const url = `https://example.com/${"x".repeat(70)}`;
  const inspection = model({ summary: `Read this first: ${url} then carry on reading the rest of the summary.` });
  const lines = renderInspection(inspection);
  const ours = linesOutsideInstructions(lines);
  expect(ours.filter((l) => l.length > INSPECT_WIDTH && l.trim() !== url)).toEqual([]);
  expect(ours.join(" ").replace(/\s+/g, " ")).toContain(`Read this first: ${url} then carry on reading the rest of the summary.`);
});

it("says a hold of critical as one severity, and an act with no summary in a fixed sentence", () => {
  const text = renderInspection(model({ hold: "critical", summary: undefined })).join("\n");
  expect(text).toContain("Ideas rated critical wait for your sign-off");
  expect(text).toContain("act (act): Changes the project for one idea.");
});

it("carries no colour, no box drawing and none of the words safe, clean or verified", () => {
  for (const inspection of builtInInspections) {
    const ours = withoutPackWords(renderInspection(inspection), inspection);
    expect(ours.includes(String.fromCharCode(27))).toBe(false);
    expect(ours).not.toMatch(/[─-╿]/);
    expect(ours).not.toMatch(/\b(safe|clean|verified)\b/i);
  }
});

const ESC = String.fromCharCode(27);
const [ZWSP, LS, RLO] = [0x200b, 0x2028, 0x202e].map((code) => String.fromCodePoint(code));
/** Control, escape, zero-width, line-separator and direction characters other than newline and tab. */
const RAW = new RegExp(`[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f${ZWSP}-${String.fromCodePoint(0x200f)}${LS}-${RLO}\\u2060-\\u2069\\ufeff]`);

it("shows control, escape and direction characters in an instruction as visible text, never raw", () => {
  const authored = `fine\n${ESC}[2Aoverwrite${ZWSP}hidden${RLO}rtl\rback${LS}split\ttab`;
  const text = renderInspection(model({ authored })).join("\n");
  expect(text).toContain("\\x1b[2Aoverwrite\\u200bhidden\\u202ertl\\rback\\u2028split\ttab");
  expect(text).not.toMatch(RAW);
});

it("takes an instruction's line count from the text as shown", () => {
  const lines = renderInspection(model({ authored: `one\rtwo${LS}three` }));
  expect(lines).toContain("Instructions for act: the pack's own words, 1 line");
});

it("keeps pack metadata and the source path on the lines it writes, with control characters shown", () => {
  const inspection = model();
  inspection.pack.title = `Title${ESC}[31m\nforged`;
  inspection.pack.summary = `Summary\rforged${RLO}`;
  inspection.pack.source = { kind: "folder", path: `/p/${ESC}]0;x\x07\nforged` };
  const act = inspection.workflows[1];
  if (act) act.summary = `Act\nforged${ESC}`;
  const lines = renderInspection(inspection);
  expect(lines.some((l) => l.startsWith("forged"))).toBe(false);
  expect(lines.join("\n")).toContain("Pack: Title\\x1b[31m\\nforged");
  expect(lines.join("")).not.toMatch(RAW);
});
