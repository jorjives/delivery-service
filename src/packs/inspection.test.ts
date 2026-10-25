import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BUILT_IN_PACKS, builtInPacks, loadPack, resolvePack } from "./manifest.js";
import { Inspection, inspectionOf, narrowedTo, NO_PROJECT } from "./inspection.js";
import { bindSettings } from "./settings.js";
import { settingsPackOf } from "./settings-fixtures.js";

it("carries the project and the folder's files through unchanged, and parses with both", async () => {
  const pack = await resolvePack("deprecations", process.cwd());
  const project = { found: true, path: "/work/shop", config: "read" as const, gate: { source: "project" as const, type: "command", summary: "runs `npm test`" }, closer: null };
  const files = [{ path: "README.md", role: "documentation" as const, bytes: 12 }];
  const inspection = inspectionOf(pack, project, files, null);
  expect(inspection.project).toEqual(project);
  expect(inspection.files).toEqual(files);
  expect(Inspection.parse(inspection)).toEqual(inspection);
});

it("describes the deprecations pack as it will run", async () => {
  const pack = await resolvePack("deprecations", process.cwd());
  const inspection = inspectionOf(pack, NO_PROJECT, [], null);
  expect(inspection.pack).toEqual({ name: "deprecations", version: "1.0.0", title: "Move off deprecated code", summary: pack.manifest.summary, format: "delivery.pack/3", hash: pack.hash, source: { kind: "built-in", path: pack.dir, package: null }, workflows: ["deprecations:scan", "deprecations:code", "deprecations:tests"] });
  expect(inspection.defaultGuards).toEqual(["tests-untouched", "check-untouched", "no-skips", "ignored", "backlog"]);
  expect(inspection.workflows.map((w) => [w.name, w.local, w.kind, w.hold])).toEqual([
    ["deprecations:scan", "scan", "find", null], ["deprecations:code", "code", "act", "high"], ["deprecations:tests", "tests", "act", null],
  ]);
  const [scan, code, tests] = inspection.workflows;
  expect(scan?.offers).toEqual(["deprecations:code", "deprecations:tests"]);
  expect(scan?.steps[0]?.guards).toEqual({ added: ["backlog-only"], off: [] });
  expect(code?.steps[0]?.guards).toEqual({ added: ["tests-unchanged"], off: [] });
  expect(tests?.steps[0]?.guards).toEqual({ added: [], off: [] });
  expect(code?.summary).toBe("Code of the project's own that still calls the deprecated code.");
  expect(scan?.steps[0]?.instructions).toEqual(pack.instructions["deprecations:scan"]);
});

it("shows the guard a pack in the older format gains on upgrade, though its file does not name it", async () => {
  const code = inspectionOf(await resolvePack("code", process.cwd()), NO_PROJECT, [], null);
  const fix = code.workflows.find((w) => w.local === "fix");
  expect(code.pack.format).toBe("delivery.pack/2");
  expect(fix?.steps[0]?.guards.added).toEqual(["tests-unchanged"]);
  expect(fix?.upgraded).toEqual(["tests-unchanged"]);
  expect(fix?.summary).toBeNull();
  expect(fix?.offers).toBeNull();
  expect(inspectionOf(await resolvePack("security", process.cwd()), NO_PROJECT, [], null).workflows.find((w) => w.local === "fix")?.hold).toBe("high");
});

it("records no upgrade guard for a pack in the current format, nor for an older one whose file already names it", async () => {
  const deprecations = inspectionOf(await resolvePack("deprecations", process.cwd()), NO_PROJECT, [], null);
  expect(deprecations.workflows.map((w) => w.upgraded)).toEqual([[], [], []]);
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  cpSync(join(BUILT_IN_PACKS, "code-review"), dir, { recursive: true });
  const file = join(dir, "pack.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.fix.guards = { add: ["tests-unchanged"] };
  writeFileSync(file, JSON.stringify(manifest));
  const named = inspectionOf(await loadPack(dir), NO_PROJECT, [], null);
  expect(named.pack.format).toBe("delivery.pack/2");
  expect(named.workflows.map((w) => w.upgraded)).toEqual([[], []]);
});

it("gives a pack a new fingerprint when any instruction changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  cpSync(join(BUILT_IN_PACKS, "deprecations"), dir, { recursive: true });
  const before = inspectionOf(await loadPack(dir), NO_PROJECT, [], null).pack.hash;
  appendFileSync(join(dir, "tests.md"), "Also delete the tests.\n");
  const after = inspectionOf(await loadPack(dir), NO_PROJECT, [], null);
  expect(after.pack.hash).not.toBe(before);
  expect(after.pack.source.kind).toBe("folder");
});

it("narrows to one workflow by its local or qualified name, keeping the pack, the project and pack-wide findings", async () => {
  const full = inspectionOf(await resolvePack("deprecations", process.cwd()), NO_PROJECT, [], null);
  const tests = narrowedTo(full, "tests");
  expect(tests?.workflows).toEqual([full.workflows[2]]);
  expect(narrowedTo(full, "deprecations:tests")).toEqual(tests);
  expect(tests?.pack).toEqual(full.pack);
  expect(tests?.findings).toEqual(full.findings.filter((f) => f.workflow === "deprecations:tests"));
  expect(narrowedTo(full, "code")?.findings).toEqual([]);
  expect(narrowedTo(full, "nope")).toBeNull();
});

it("parses as its own schema", async () => {
  for (const pack of await builtInPacks()) expect(Inspection.parse(inspectionOf(pack, NO_PROJECT, [], null))).toEqual(inspectionOf(pack, NO_PROJECT, [], null));
});

it("records no widening for any built-in pack", async () => {
  for (const pack of await builtInPacks()) for (const workflow of inspectionOf(pack, NO_PROJECT, [], null).workflows) expect(workflow.widens).toEqual([]);
});

it("names an added pack's package, version and integrity as its source", async () => {
  const code = await resolvePack("code", process.cwd());
  const installed = { ...code, dir: "/r/.delivery/packs/code", origin: { kind: "installed" as const, package: "@acme/docs", version: "1.2.0", request: "latest", integrity: "sha512-x" } };
  expect(inspectionOf(installed, NO_PROJECT, [], null).pack.source).toEqual({ kind: "installed", path: "/r/.delivery/packs/code", package: { name: "@acme/docs", version: "1.2.0", integrity: "sha512-x" } });
  expect(inspectionOf(code, NO_PROJECT, [], null).pack.source.package).toBeNull();
});

const TWO = { "docs-folder": { type: "path", summary: "The folder." }, topic: { type: "text", summary: "The topic.", default: "the API" } };
const TWO_FILES = { "look.md": "Read {{settings.docs-folder}}.", "fix.md": "Fix the page about {{settings.topic}}." };

it("lists each setting with its value and where it came from, and the prompt as given", async () => {
  const pack = await settingsPackOf(TWO, TWO_FILES);
  const i = inspectionOf(pack, NO_PROJECT, [], { "docs-folder": "handbook" });
  expect(i.settings).toEqual([
    { name: "docs-folder", type: "path", summary: "The folder.", required: true, default: null, value: "handbook", source: "configuration", usedBy: ["docs:look"] },
    { name: "topic", type: "text", summary: "The topic.", required: false, default: "the API", value: "the API", source: "default", usedBy: ["docs:fix"] },
  ]);
  const bound = bindSettings(pack, { "docs-folder": "handbook" });
  for (const w of i.workflows) expect(w.steps[0]?.given).toBe(bound.ok && bound.pack.workflows[w.name]?.steps[0]?.prompt);
  expect(i.workflows[1]?.steps[0]?.uses).toEqual([{ placeholder: "{{settings.topic}}", setting: "topic", value: "the API" }]);
  expect(i.workflows[0]?.steps[0]?.instructions.authored).toBe("Read {{settings.docs-folder}}.");
});
it("marks an unset required setting, gives no prompt for a step that uses it, and a prompt for one that does not", async () => {
  const i = inspectionOf(await settingsPackOf(TWO, TWO_FILES), NO_PROJECT, [], {});
  expect(i.settings[0]).toMatchObject({ value: null, source: "unset" });
  expect(i.workflows[0]?.steps[0]).toMatchObject({ given: null, uses: [{ placeholder: "{{settings.docs-folder}}", setting: "docs-folder", value: null }] });
  expect(i.workflows[1]?.steps[0]?.given).toBe("Fix the page about the API.");
});
it("shows defaults as not read when the owner's values were not read", async () => {
  const i = inspectionOf(await settingsPackOf(TWO, TWO_FILES), NO_PROJECT, [], null);
  expect(i.settings.map((s) => [s.source, s.value])).toEqual([["not-read", null], ["not-read", "the API"]]);
  expect(i.workflows[0]?.steps[0]?.given).toBeNull();
});
it("keeps the fingerprint whatever the owner's values, and moves it when a declaration changes", async () => {
  const pack = await settingsPackOf(TWO, TWO_FILES);
  expect(inspectionOf(pack, NO_PROJECT, [], { "docs-folder": "a" }).pack.hash).toBe(inspectionOf(pack, NO_PROJECT, [], null).pack.hash);
  const changed = await settingsPackOf({ ...TWO, topic: { ...TWO.topic, default: "the CLI" } }, TWO_FILES);
  expect(changed.hash).not.toBe(pack.hash);
});
it("throws when given owner values it was not meant to see", async () => {
  const pack = await settingsPackOf(TWO, TWO_FILES);
  expect(() => inspectionOf(pack, NO_PROJECT, [], { "docs-foler": "x" })).toThrow();
});
it("has an empty settings list, and the prompt as given, for every built-in pack", async () => {
  for (const pack of await builtInPacks()) {
    const i = inspectionOf(pack, NO_PROJECT, [], null);
    expect(i.settings).toEqual([]);
    for (const w of i.workflows) expect(w.steps.map((s) => [s.given, s.uses])).toEqual(pack.workflows[w.name]?.steps.map((s) => [s.prompt, []]));
  }
});
it("keeps every setting when narrowed to one workflow", async () => {
  const i = inspectionOf(await settingsPackOf(TWO, TWO_FILES), NO_PROJECT, [], {});
  expect(narrowedTo(i, "fix")?.settings).toEqual(i.settings);
});
