import { expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { builtInPacks, DATA_ONLY } from "../packs/manifest.js";
import { FOLDER_NOT_IN_A_PACK, NOT_IN_A_PACK, readPackFolder } from "../packs/pack-folder.js";
import { inspectionOf, narrowedTo, NO_PROJECT, type Inspection, type InspectionBase, withFindings } from "../packs/inspection.js";
import type { Severity } from "../schema.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { OWN_SETUP } from "./own-setup.js";
import { FIXTURES_NOT_READ, INSPECT_RULE, INSPECT_WIDTH, QUESTIONS_TO_ASK, renderInspection, renderRefusal, SHOWN_NOTHING } from "./packs-inspect-render.js";

const packs = await builtInPacks();
const deprecations = packs.find((pack) => pack.manifest.name === "deprecations");
if (!deprecations) throw new Error("the deprecations pack is not built in");
const builtInInspections = packs.map((pack) => inspectionOf(pack, NO_PROJECT, []));

const deprecationsFiles = await readPackFolder(deprecations.dir);
if (!deprecationsFiles.ok) throw new Error("the deprecations pack is not read by the folder check");
const deprecationsAccount = renderInspection(inspectionOf(deprecations, NO_PROJECT, deprecationsFiles.files));

/** The text of some lines, joined and with every run of white space made one space: the wrap points are not compared. */
const flat = (lines: readonly string[]): string => lines.join(" ").replace(/\s+/g, " ");
/** The lines a sentence wraps to, given as the sentence: `flat` compares the joined text, so the wrap points are not restated. */
const wrapped = (line: string): string[] => [line];

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
    summary: summary ?? null,
    offers: null,
    steps: [{ name: "do", instructions: { authored: overrides.authored ?? "Do the thing.\nThen stop.", harness: null }, guards: { added: [], off: [] } }],
    upgraded: [],
    widens: [],
    hold: "hold" in overrides ? (overrides.hold ?? null) : ("high" as const),
  };
  const find = {
    name: "test:find",
    local: "find",
    kind: "find" as const,
    summary: null,
    offers: ["test:act"],
    steps: [{ name: "scan", instructions: { authored: "Look around.", harness: "Write each idea as one line." }, guards: { added: ["backlog-only" as const], off: [] } }],
    upgraded: [],
    widens: [],
    hold: null,
  };
  const base: InspectionBase = {
    schema: "delivery.pack-inspection/1",
    ok: true,
    pack: { name: "test", version: "1.0.0", title: "Test pack", summary: "A pack for tests.", format: "delivery.pack/3", hash: "a".repeat(64), workflows: ["test:find", "test:act"], source: { kind: "built-in", path: "/packs/test", package: null } },
    defaultGuards: ["tests-untouched"],
    workflows: [find, act],
    project: NO_PROJECT,
    files: [],
  };
  return withFindings(base);
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
  for (const workflow of inspection.workflows) if (workflow.summary !== null) packWords.push(workflow.summary);
  for (const word of packWords) if (word !== "") text = text.split(word).join("");
  return text;
}

it("puts the short account first, then limits, then the full instructions last", () => {
  const lines = renderInspection(inspectionOf(deprecations, NO_PROJECT, []));
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
  const text = renderInspection(inspectionOf(deprecations, NO_PROJECT, [])).join("\n");
  expect(text).toContain("  code:\n    Also refused if it edits an existing test.\n    Ideas rated high or critical wait for your sign-off\n    before they land.");
  expect(text).toContain("  tests:\n    No extra guards.\n    Lands without asking you again, once you have approved\n    the idea.");
  expect(text).toContain("    Also refused if it changes anything other than adding\n    ideas to the backlog.");
  expect(text).toContain("This pack chooses no checks and no way of landing.");
});

it("says the instructions run with everything the owner's setup can do, and the project's follow-on steps run after landing", () => {
  const flat = renderInspection(inspectionOf(deprecations, NO_PROJECT, [])).join(" ").replace(/\s+/g, " ");
  expect(flat).toContain("This pack cannot give the agent extra powers, and nothing in it takes any away.");
  for (const sentence of OWN_SETUP) expect(flat).toContain(sentence);
  expect(flat).toContain("After a change from an act workflow lands, your project's own follow-on steps run.");
});

it("shows every instruction unaltered, the pack's words apart from the harness's", () => {
  const lines = renderInspection(inspectionOf(deprecations, NO_PROJECT, []));
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

it("asks the fixed questions after Things to look at and before the instructions, in a narrowed view too", () => {
  for (const lines of [deprecationsAccount, renderInspection(narrowedTo(inspectionOf(deprecations, NO_PROJECT, deprecationsFiles.files), "tests") as Inspection)]) {
    const at = lines.indexOf("Questions to ask before you use it");
    expect(at).toBeGreaterThan(lines.indexOf("Things to look at"));
    expect(at).toBeLessThan(lines.indexOf(INSPECT_RULE));
    expect(flat(lines.slice(at + 1, at + 8))).toContain(QUESTIONS_TO_ASK.join(" "));
  }
});

it("names every fixture with its size, as not read when the pack is used, and never its content", () => {
  const at = deprecationsAccount.indexOf("Fixtures");
  expect(at).toBeGreaterThan(deprecationsAccount.indexOf("Questions to ask before you use it"));
  expect(flat(deprecationsAccount.slice(at, at + 4))).toContain(FIXTURES_NOT_READ);
  for (const { path } of deprecationsFiles.files.filter((f) => f.role === "fixture")) {
    expect(deprecationsAccount).toContain(`  ${path}, ${statSync(join(deprecations.dir, path)).size} bytes`);
  }
  expect(deprecationsAccount.join("\n")).not.toContain(readFileSync(join(deprecations.dir, "fixtures", "review.json"), "utf-8").slice(0, 40));
});

it("says 0 bytes and 1 byte, shows a hidden character in a fixture name, and has no Fixtures heading without fixtures", () => {
  const lines = renderInspection(withFindings({ ...model(), files: [{ path: "fixtures/a.json", role: "fixture", bytes: 0 }, { path: `fixtures/b‮.json`, role: "fixture", bytes: 1 }] }));
  expect(lines).toContain("  fixtures/a.json, 0 bytes");
  expect(lines).toContain("  fixtures/b<U+202E>.json, 1 byte");
  expect(renderInspection(model())).not.toContain("Fixtures");
});

it("keeps to the owner's vocabulary, with no colour or box drawing", async () => {
  for (const pack of packs) {
    const read = await readPackFolder(pack.dir);
    if (!read.ok) throw new Error(`the ${pack.manifest.name} pack is not read by the folder check`);
    const inspection = inspectionOf(pack, NO_PROJECT, read.files);
    const ours = withoutPackWords(linesOutsideInstructions(renderInspection(inspection)), inspection);
    expect(ours.includes(String.fromCharCode(27))).toBe(false);
    expect(ours).not.toMatch(/[─-╿]/);
    expect(ours).not.toMatch(REASSURING);
    expect(ours).not.toMatch(FORBIDDEN);
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
  inspection.pack.source = { kind: "folder", path: `/p/${ESC}]0;x\x07\nforged`, package: null };
  const act = inspection.workflows[1];
  if (act) act.summary = `Act\nforged${ESC}`;
  const lines = renderInspection(withFindings(inspection));
  expect(lines.some((l) => l.startsWith("forged"))).toBe(false);
  expect(lines.join("\n")).toContain("Pack: Title\\x1b[31m\\nforged");
  expect(lines.join("")).not.toMatch(RAW);
});

const thingsToLookAt = (lines: string[]): string[] => {
  const start = lines.indexOf("Things to look at");
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l !== "" && !l.startsWith(" "));
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => l !== "");
};

it("counts hidden characters and lists each with where it is, in a Things to look at list before the instructions", () => {
  const authored = `fine\nab${RLO}cd${ZWSP}\n${ESC}[2A`;
  const lines = renderInspection(model({ authored }));
  expect(thingsToLookAt(lines)).toEqual([
    "  3 hidden characters in the pack's words. Each is shown as",
    "  visible text where it sits.",
    "  1. \\u202e in the pack's own instructions for act, line 2,",
    "     column 3.",
    "  2. \\u200b in the pack's own instructions for act, line 2,",
    "     column 6.",
    "  3. \\x1b in the pack's own instructions for act, line 3,",
    "     column 1.",
  ]);
  expect(lines.indexOf("Things to look at")).toBeLessThan(lines.indexOf(INSPECT_RULE));
});

it("lists hidden characters in the title, summaries, the source path and the harness's words, each by where", () => {
  const inspection = model();
  inspection.pack.title = `T${ESC}`;
  inspection.pack.summary = `S\n`;
  inspection.pack.source = { kind: "folder", path: `/p${RLO}`, package: null };
  const act = inspection.workflows[1];
  if (act) act.summary = `A${ZWSP}`;
  const find = inspection.workflows[0];
  const scan = find?.steps[0];
  if (scan) scan.instructions.harness = `H${ESC}`;
  const text = thingsToLookAt(renderInspection(withFindings(inspection))).join(" ").replace(/\s+/g, " ");
  expect(text).toContain("5 hidden characters");
  expect(text).toContain("\\x1b in the title, column 2");
  expect(text).toContain("\\n in the summary, column 2");
  expect(text).toContain("\\u202e in the source path, column 3");
  expect(text).toContain("\\u200b in the summary of act, column 2");
  expect(text).toContain("\\x1b in the words delivery-service adds to find, line 1, column 2");
});

it("keeps a tab and a line break in an instruction out of the count", () => {
  expect(thingsToLookAt(renderInspection(model({ authored: "a\tb\nc", hold: "high" })))).toEqual(NOTHING_UNUSUAL);
});

const NOTHING_UNUSUAL = [
  "  Nothing unusual was found in what this command checks.",
  "  That is not a guarantee about the instructions.",
];

it("always has a Things to look at list, and says nothing unusual was found when nothing was, without calling the pack safe", () => {
  const lines = renderInspection(model({ hold: "high" }));
  expect(thingsToLookAt(lines)).toEqual(NOTHING_UNUSUAL);
  expect(lines.indexOf("Things to look at")).toBeLessThan(lines.indexOf(INSPECT_RULE));
  for (const inspection of builtInInspections) expect(renderInspection(inspection)).toContain("Things to look at");
});

it("flags a workflow that lands without sign-off, naming it", () => {
  const list = thingsToLookAt(renderInspection(model({ hold: null }))).join(" ").replace(/\s+/g, " ");
  expect(list).toContain('1. "act" lands without asking for your sign-off once you have approved the idea.');
  expect(list).not.toContain("Nothing unusual");
});

it("flags a sign-off that stops only critical ideas, but not one that stops high ideas too", () => {
  const critical = thingsToLookAt(renderInspection(model({ hold: "critical" }))).join(" ").replace(/\s+/g, " ");
  expect(critical).toContain('1. "act" asks for your sign-off only for critical ideas; anything rated lower lands without it.');
  expect(thingsToLookAt(renderInspection(model({ hold: "high" })))).toEqual(NOTHING_UNUSUAL);
});

it("flags a guard an older-format pack gains on upgrade that its file does not state", () => {
  const inspection = model({ hold: "high" });
  const act = inspection.workflows[1];
  if (act) act.upgraded = ["tests-unchanged"];
  const list = thingsToLookAt(renderInspection(withFindings(inspection))).join(" ").replace(/\s+/g, " ");
  expect(list).toContain('1. "act" is refused if it');
  expect(list).toContain("the pack's file does not say so");
});

it("numbers the flagged items and the hidden characters in one sequence", () => {
  const list = thingsToLookAt(renderInspection(model({ hold: null, authored: `a${ZWSP}` }))).join(" ").replace(/\s+/g, " ");
  expect(list).toContain('1. "act" lands without');
  expect(list).toContain("2. \\u200b in the pack's own instructions for act");
});

it("states every time that nothing in the pack widens what the agent may do, what was compared, and that the instructions are not analysed", () => {
  for (const inspection of [model(), ...builtInInspections]) {
    const lines = renderInspection(inspection);
    const flat = lines.join(" ").replace(/\s+/g, " ");
    expect(lines).toContain("Does it widen what the agent may do?");
    expect(flat).toContain("Nothing in this pack widens what the agent may do beyond your project's defaults.");
    expect(flat).toContain("Compared: guards, sign-off, checks, landing, follow-on steps and agent options.");
    expect(flat).toContain("The instructions themselves are not analysed, so read them.");
    expect(lines.indexOf("Does it widen what the agent may do?")).toBeLessThan(lines.indexOf("Things to look at"));
  }
});

it("says a workflow widens what the agent may do, and lists it in Things to look at, instead of saying nothing widens", () => {
  const inspection = model({ hold: "high" });
  const act = inspection.workflows[1];
  if (act) act.widens = ["a guard turned off"];
  const lines = renderInspection(withFindings(inspection));
  const flat = lines.join(" ").replace(/\s+/g, " ");
  expect(flat).not.toContain("Nothing in this pack widens");
  expect(flat).toContain('"act" widens what the agent may do beyond your project\'s defaults: a guard turned off.');
  expect(flat).toContain("Compared: guards, sign-off, checks, landing, follow-on steps and agent options.");
  expect(flat).toContain("The instructions themselves are not analysed, so read them.");
  const list = thingsToLookAt(lines).join(" ").replace(/\s+/g, " ");
  expect(list).toContain('1. "act" widens what the agent may do beyond your project\'s defaults: a guard turned off.');
  expect(list).not.toContain("Nothing unusual");
});

it("names the project's check and landing when a project is found", () => {
  const text = renderInspection(withFindings({ ...model(), project: { found: true, path: "/work/shop", config: "read",
    gate: { source: "project", type: "command", summary: "runs `npm test`" }, closer: { source: "project", type: "open-pr", summary: "opens a pull request" } } })).join("\n");
  expect(text).toContain("Your project, in /work/shop:\n  Check: runs `npm test`.\n  Landing: opens a pull request.");
});

it.each([
  [NO_PROJECT, "No project was found here, so which check and landing would be used is not known."],
  [{ ...NO_PROJECT, found: true, path: "/p", config: "code" as const }, "JavaScript file, which this command does not run"],
  [{ ...NO_PROJECT, found: true, path: "/p", config: "unreadable" as const }, "could not be read"],
])("says the check and landing are not known: %j", (project, words) => {
  expect(flat(renderInspection(withFindings({ ...model(), project })))).toContain(words);
});

it("lists documentation and housekeeping as not read, and never their content", () => {
  const lines = renderInspection(withFindings({ ...model(), files: [{ path: "README.md", role: "documentation", bytes: 12 }, { path: ".git/", role: "housekeeping", bytes: null }, { path: "look.md", role: "prompt", bytes: 40 }] }));
  const at = lines.indexOf("Also in the folder");
  expect(lines.slice(at, at + 4)).toEqual(["Also in the folder", "  Not read when the pack is used, and not shown here:", "  README.md", "  .git/"]);
  expect(at).toBeLessThan(lines.indexOf(INSPECT_RULE));
});

it("shows a hidden character in a file name as visible text, and counts it", () => {
  const lines = renderInspection(withFindings({ ...model(), files: [{ path: `READ‮ME.md`, role: "documentation", bytes: 0 }] }));
  expect(lines.join("\n")).not.toContain("‮");
  expect(lines).toContain("  READ<U+202E>ME.md");
  expect(flat(thingsToLookAt(lines))).toContain("the name of the file READ<U+202E>ME.md");
});

it("counts a hidden character in the project's path, and names it as the project's path", () => {
  const lines = renderInspection(withFindings({ ...model(), project: { ...NO_PROJECT, found: true, path: `/p/‮`, config: "read" } }));
  expect(flat(thingsToLookAt(lines))).toContain("in the project's path");
});

it("refuses with each problem by file, the advice for unnamed content, and the closing line, and shows no pack words", () => {
  const lines = renderRefusal("/w/p", [{ file: "/w/p/install.sh", field: null, message: NOT_IN_A_PACK }, { file: "/w/p/pack.json", field: "tools", message: `"tools" ${DATA_ONLY}` }], "/w");
  expect(flat(lines)).toBe(flat(["Not read: p", ...wrapped(`  p/install.sh ${NOT_IN_A_PACK}.`), ...wrapped(`  p/pack.json: "tools" ${DATA_ONLY}.`),
    ...wrapped("  If you wrote this pack, remove what is named above. If someone else did, ask them why it is there."), `  ${SHOWN_NOTHING}`]));
  expect(lines.at(-1)).toBe(`  ${SHOWN_NOTHING}`);
});

it("writes a hidden character in a refused path as visible text", () => {
  expect(renderRefusal("/w/p", [{ file: "/w/p/a‮b.sh", field: null, message: NOT_IN_A_PACK }], "/w").join("\n")).toContain("p/a<U+202E>b.sh");
});

it("says a folder sentence is advised about only when a problem is one of them", () => {
  expect(flat(renderRefusal("/w/p", [{ file: "/w/p/pack.json", field: "tools", message: `"tools" ${DATA_ONLY}` }], "/w"))).not.toContain("If you wrote this pack");
  expect(flat(renderRefusal("/w/p", [{ file: "/w/p/x", field: null, message: FOLDER_NOT_IN_A_PACK }], "/w"))).toContain("If you wrote this pack, remove what is named above.");
});

it("says how many workflows the pack has and that only one is shown, and drops the others' instructions and limits", () => {
  const full = model({ hold: null });
  const lines = renderInspection(narrowedTo(full, "act") as Inspection);
  const text = flat(lines);
  expect(text).toContain("It has 2 workflows.");
  expect(text).toContain('Only "act" is shown here; inspect the whole pack to see the others.');
  expect(text).not.toContain("Instructions for find");
  expect(text).toContain("Instructions for act");
  expect(text).toContain('"act" lands without asking for your sign-off');
});

it("does not say nothing widens when the workflow shown does not but another does", () => {
  const base = model({ hold: "high" });
  const find = base.workflows[0];
  if (find) find.widens = ["a guard turned off"];
  const text = flat(renderInspection(narrowedTo(withFindings(base), "act") as Inspection));
  expect(text).not.toContain("Nothing in this pack widens");
  expect(text).toContain("Nothing in the workflow shown widens what the agent may do, but another workflow in this pack does: inspect the whole pack.");
  expect(text).not.toContain("Nothing unusual was found in what this command checks. ");
  expect(text).toContain("Nothing unusual was found in what this command checks for the workflow shown. Inspect the whole pack for the others.");
});

it("says an added pack is from npm, naming the package and its version", () => {
  const inspection = model();
  inspection.pack.source = { kind: "installed", path: "/r/.delivery/packs/test", package: { name: "@acme/delivery-pack-docs", version: "1.2.0", integrity: "sha512-x" } };
  expect(renderInspection(inspection).slice(1, 3).join(" ")).toContain("test, version 1.0.0, from npm: @acme/delivery-pack-docs 1.2.0.");
});
