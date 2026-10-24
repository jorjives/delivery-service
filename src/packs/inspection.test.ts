import { appendFileSync, cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { BUILT_IN_PACKS, builtInPacks, loadPack, resolvePack } from "./manifest.js";
import { Inspection, inspectionOf } from "./inspection.js";

it("describes the deprecations pack as it will run", async () => {
  const pack = await resolvePack("deprecations", process.cwd());
  const inspection = inspectionOf(pack);
  expect(inspection.pack).toEqual({ name: "deprecations", version: "1.0.0", title: "Move off deprecated code", summary: pack.manifest.summary, format: "delivery.pack/3", hash: pack.hash, source: { kind: "built-in", path: pack.dir } });
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
  const code = inspectionOf(await resolvePack("code", process.cwd()));
  const fix = code.workflows.find((w) => w.local === "fix");
  expect(code.pack.format).toBe("delivery.pack/2");
  expect(fix?.steps[0]?.guards.added).toEqual(["tests-unchanged"]);
  expect(fix?.upgraded).toEqual(["tests-unchanged"]);
  expect(fix?.summary).toBeUndefined();
  expect(inspectionOf(await resolvePack("security", process.cwd())).workflows.find((w) => w.local === "fix")?.hold).toBe("high");
});

it("records no upgrade guard for a pack in the current format, nor for an older one whose file already names it", async () => {
  const deprecations = inspectionOf(await resolvePack("deprecations", process.cwd()));
  expect(deprecations.workflows.map((w) => w.upgraded)).toEqual([[], [], []]);
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  cpSync(join(BUILT_IN_PACKS, "code-review"), dir, { recursive: true });
  const file = join(dir, "pack.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.fix.guards = { add: ["tests-unchanged"] };
  writeFileSync(file, JSON.stringify(manifest));
  const named = inspectionOf(await loadPack(dir));
  expect(named.pack.format).toBe("delivery.pack/2");
  expect(named.workflows.map((w) => w.upgraded)).toEqual([[], []]);
});

it("gives a pack a new fingerprint when any instruction changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  cpSync(join(BUILT_IN_PACKS, "deprecations"), dir, { recursive: true });
  const before = inspectionOf(await loadPack(dir)).pack.hash;
  appendFileSync(join(dir, "tests.md"), "Also delete the tests.\n");
  const after = inspectionOf(await loadPack(dir));
  expect(after.pack.hash).not.toBe(before);
  expect(after.pack.source.kind).toBe("folder");
});

it("parses as its own schema", async () => {
  for (const pack of await builtInPacks()) expect(Inspection.parse(inspectionOf(pack))).toEqual(inspectionOf(pack));
});
