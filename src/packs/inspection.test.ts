import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BUILT_IN_PACKS, builtInPacks, loadPack, resolvePack } from "./manifest.js";
import { Inspection, inspectionOf, narrowedTo, NO_PROJECT } from "./inspection.js";

it("carries the project and the folder's files through unchanged, and parses with both", async () => {
  const pack = await resolvePack("deprecations", process.cwd());
  const project = { found: true, path: "/work/shop", config: "read" as const, gate: { source: "project" as const, type: "command", summary: "runs `npm test`" }, closer: null };
  const files = [{ path: "README.md", role: "documentation" as const, bytes: 12 }];
  const inspection = inspectionOf(pack, project, files);
  expect(inspection.project).toEqual(project);
  expect(inspection.files).toEqual(files);
  expect(Inspection.parse(inspection)).toEqual(inspection);
});

it("describes the deprecations pack as it will run", async () => {
  const pack = await resolvePack("deprecations", process.cwd());
  const inspection = inspectionOf(pack, NO_PROJECT, []);
  expect(inspection.pack).toEqual({ name: "deprecations", version: "1.0.0", title: "Move off deprecated code", summary: pack.manifest.summary, format: "delivery.pack/3", hash: pack.hash, source: { kind: "built-in", path: pack.dir }, workflows: ["deprecations:scan", "deprecations:code", "deprecations:tests"] });
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
  const code = inspectionOf(await resolvePack("code", process.cwd()), NO_PROJECT, []);
  const fix = code.workflows.find((w) => w.local === "fix");
  expect(code.pack.format).toBe("delivery.pack/2");
  expect(fix?.steps[0]?.guards.added).toEqual(["tests-unchanged"]);
  expect(fix?.upgraded).toEqual(["tests-unchanged"]);
  expect(fix?.summary).toBeNull();
  expect(fix?.offers).toBeNull();
  expect(inspectionOf(await resolvePack("security", process.cwd()), NO_PROJECT, []).workflows.find((w) => w.local === "fix")?.hold).toBe("high");
});

it("records no upgrade guard for a pack in the current format, nor for an older one whose file already names it", async () => {
  const deprecations = inspectionOf(await resolvePack("deprecations", process.cwd()), NO_PROJECT, []);
  expect(deprecations.workflows.map((w) => w.upgraded)).toEqual([[], [], []]);
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  cpSync(join(BUILT_IN_PACKS, "code-review"), dir, { recursive: true });
  const file = join(dir, "pack.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.fix.guards = { add: ["tests-unchanged"] };
  writeFileSync(file, JSON.stringify(manifest));
  const named = inspectionOf(await loadPack(dir), NO_PROJECT, []);
  expect(named.pack.format).toBe("delivery.pack/2");
  expect(named.workflows.map((w) => w.upgraded)).toEqual([[], []]);
});

it("gives a pack a new fingerprint when any instruction changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  cpSync(join(BUILT_IN_PACKS, "deprecations"), dir, { recursive: true });
  const before = inspectionOf(await loadPack(dir), NO_PROJECT, []).pack.hash;
  appendFileSync(join(dir, "tests.md"), "Also delete the tests.\n");
  const after = inspectionOf(await loadPack(dir), NO_PROJECT, []);
  expect(after.pack.hash).not.toBe(before);
  expect(after.pack.source.kind).toBe("folder");
});

it("narrows to one workflow by its local or qualified name, keeping the pack, the project and pack-wide findings", async () => {
  const full = inspectionOf(await resolvePack("deprecations", process.cwd()), NO_PROJECT, []);
  const tests = narrowedTo(full, "tests");
  expect(tests?.workflows).toEqual([full.workflows[2]]);
  expect(narrowedTo(full, "deprecations:tests")).toEqual(tests);
  expect(tests?.pack).toEqual(full.pack);
  expect(tests?.findings).toEqual(full.findings.filter((f) => f.workflow === "deprecations:tests"));
  expect(narrowedTo(full, "code")?.findings).toEqual([]);
  expect(narrowedTo(full, "nope")).toBeNull();
});

it("parses as its own schema", async () => {
  for (const pack of await builtInPacks()) expect(Inspection.parse(inspectionOf(pack, NO_PROJECT, []))).toEqual(inspectionOf(pack, NO_PROJECT, []));
});

it("records no widening for any built-in pack", async () => {
  for (const pack of await builtInPacks()) for (const workflow of inspectionOf(pack, NO_PROJECT, []).workflows) expect(workflow.widens).toEqual([]);
});
