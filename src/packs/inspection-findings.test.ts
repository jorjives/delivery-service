import { expect, it } from "vitest";
import type { Severity } from "../schema.js";
import { resolvePack } from "./manifest.js";
import { inspectionOf, type InspectionBase, NO_PROJECT, withFindings } from "./inspection.js";

const RLO = "‮", ESC = "\x1b", ZWSP = "​";

function base(o: { hold?: Severity | null; widens?: string[]; authored?: string } = {}): InspectionBase {
  return {
    schema: "delivery.pack-inspection/1",
    ok: true,
    pack: { name: "t", version: "1.0.0", title: "T", summary: "S", format: "delivery.pack/3", hash: "a".repeat(64), workflows: ["t:find", "t:act"], source: { kind: "built-in", path: "/packs/t" } },
    defaultGuards: [],
    workflows: [
      { name: "t:find", local: "find", kind: "find", summary: null, offers: ["t:act"], steps: [{ name: "scan", instructions: { authored: "Look.", harness: null }, guards: { added: [], off: [] } }], upgraded: [], widens: [], hold: null },
      { name: "t:act", local: "act", kind: "act", summary: null, offers: null, steps: [{ name: "do", instructions: { authored: o.authored ?? "Do it.", harness: null }, guards: { added: [], off: [] } }], upgraded: [], widens: o.widens ?? [], hold: o.hold === undefined ? "high" : o.hold },
    ],
    project: NO_PROJECT,
    files: [],
  };
}

it("flags the deprecations pack's tests workflow as landing without sign-off, and nothing wider", async () => {
  const inspection = inspectionOf(await resolvePack("deprecations", process.cwd()), NO_PROJECT, []);
  expect(inspection.findings).toEqual([{ code: "lands-without-sign-off", relation: "note", workflow: "deprecations:tests", detail: null }]);
  expect(inspection.widens).toBe(false);
  expect(inspection.hiddenCharacters).toEqual([]);
  expect(inspection.pack.workflows).toEqual(["deprecations:scan", "deprecations:code", "deprecations:tests"]);
  expect(inspection.ok).toBe(true);
});

it("flags the code pack's upgraded guard as older-format-guards", async () => {
  const code = inspectionOf(await resolvePack("code", process.cwd()), NO_PROJECT, []);
  expect(code.findings).toContainEqual({ code: "older-format-guards", relation: "note", workflow: "code:fix", detail: "tests-unchanged" });
});

it.each([
  ["critical", [{ code: "hold-only-critical", relation: "note", workflow: "t:act", detail: "critical" }]],
  ["high", []],
])("a hold of %s gives %j", (hold, expected) => expect(withFindings(base({ hold: hold as Severity })).findings).toEqual(expected));

it("records a widening dimension as a wider finding and sets widens", () => {
  const inspection = withFindings(base({ widens: ["a guard turned off"] }));
  expect(inspection.findings[0]).toEqual({ code: "widens", relation: "wider", workflow: "t:act", detail: "a guard turned off" });
  expect(inspection.widens).toBe(true);
});

it("lists each hidden character with its place, workflow, line and column, raw text untouched", () => {
  const inspection = withFindings(base({ authored: `fine\nab${RLO}cd` }));
  expect(inspection.hiddenCharacters).toEqual([{ codePoint: "U+202E", shown: "\\u202e", place: "instructions", workflow: "t:act", file: null, line: 2, column: 3 }]);
  expect(inspection.workflows[1]?.steps[0]?.instructions.authored).toContain(RLO);
});

it("places a hidden character in the title and in a file name without a line", () => {
  const b = base();
  b.pack.title = `T${ESC}`;
  b.files = [{ path: `x${ZWSP}.md`, role: "documentation", bytes: 0 }];
  expect(withFindings(b).hiddenCharacters).toEqual([
    { codePoint: "U+001B", shown: "\\x1b", place: "title", workflow: null, file: null, line: null, column: 2 },
    { codePoint: "U+200B", shown: "\\u200b", place: "file-name", workflow: null, file: `x${ZWSP}.md`, line: null, column: 2 },
  ]);
});
