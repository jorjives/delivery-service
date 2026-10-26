// docs/writing-a-pack.md is how an extender learns to write and prove a pack without
// reading the harness's source. It is held to the format, the fixture files and the phrases
// `delivery packs check` actually uses.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItemCheck } from "../src/schema.js";
import { PackManifest } from "../src/packs/pack-format.js";
import { ruleProblems } from "../src/packs/pack-rules.js";
import { FIXTURES, FixtureExpectations } from "../src/packs/pack-fixtures.js";
import { BUILT_IN_PACKS } from "../src/packs/manifest.js";
import { PACK_SENT_NOTHING, readyLine } from "../src/cli/packs-check-command.js";
import { firstParagraph, flatten, outputBlock, REPO_ROOT, runDelivery } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-pack.md"), "utf-8");
const flat = flatten(guide);
const builtIn = (path: string) => JSON.parse(readFileSync(join(BUILT_IN_PACKS, "deprecations", path), "utf-8"));
const jsonBlocks = [...guide.matchAll(/```json\n([^]*?)```/g)].map(([, body]) => body ?? "");

describe("the 'writing a pack' guide", () => {
  it("opens by saying a pack is a find-then-act job and a review one kind", () => {
    const opening = firstParagraph(guide);
    expect(opening).toContain("find-then-act");
    expect(opening).toMatch(/reviews? (is|are) one kind/i);
    expect(opening).toContain("`deprecations`");
  });

  it("starts from a copy of the built-in deprecations pack, proves it, then runs it by name", () => {
    for (const command of ["delivery packs check ./my-pack", "delivery packs --schema"]) expect(guide).toContain(command);
    expect(guide).toContain("packs/deprecations");
    expect(guide).not.toContain("delivery review ./");
  });

  it("still says delivery.pack/2 packs work, starting from the built-in code review", () => {
    expect(guide).toContain("packs/code-review");
    expect(flat).toMatch(/delivery\.pack\/2 packs? (still|keep)/);
  });

  it("names every key of a delivery.pack/3 pack.json, the find's and the act's included", () => {
    const keys = ["$schema", "schema", "name", "version", "title", "summary", "workflows", "kind", "prompt", "ideasFor", "guards", "add", "hold", "holdSetting", "atOrAbove", "find", "act"];
    for (const key of keys) expect(guide).toContain(`\`${key}\``);
  });

  it("shows a delivery.pack/3 example that the harness reads with no mistake", () => {
    const block = /```json\n(\{\s*"schema": "delivery\.pack\/3"[\s\S]*?)```/.exec(guide)?.[1];
    const parsed = PackManifest.safeParse(JSON.parse(block ?? ""));
    expect(parsed.success && ruleProblems("pack.json", parsed.data)).toEqual([]);
  });

  it("shows the built-in deprecations manifest exactly as it ships", () => {
    expect(jsonBlocks.map((b) => JSON.parse(b))).toContainEqual(builtIn("pack.json"));
  });

  it("shows the built-in's expect.json, and fixes.json expectations copied from it", () => {
    const expectBlock = jsonBlocks.find((b) => /^\{\s*"found"/.test(b));
    expect(JSON.parse(expectBlock ?? "")).toEqual(builtIn("fixtures/expect.json"));
    const fixesBlock = jsonBlocks.find((b) => /^\{\s*"expectations"/.test(b));
    for (const e of JSON.parse(fixesBlock ?? "").expectations) expect(builtIn("fixtures/fixes.json").expectations).toContainEqual(e);
  });

  it("shows the check passing exactly as it does for a copy made by the guide's own steps", () => {
    // Follow "Start from the deprecations pack" on a real copy, then run the check as a reader would.
    const cwd = mkdtempSync(join(tmpdir(), "writing-a-pack-"));
    cpSync(join(BUILT_IN_PACKS, "deprecations"), join(cwd, "my-pack"), { recursive: true });
    const manifestFile = join(cwd, "my-pack", "pack.json");
    writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(readFileSync(manifestFile, "utf-8")), name: "mymoves" }, null, 2));
    const review = join(cwd, "my-pack", FIXTURES.review);
    writeFileSync(review, readFileSync(review, "utf-8").replaceAll("workflow: deprecations:", "workflow: mymoves:"));
    const { status, stdout } = runDelivery(["packs", "check", "./my-pack", "--yes"], { cwd });
    expect(status).toBe(0);
    const run = guide.slice(guide.indexOf("## Run the check"));
    expect(outputBlock(run)).toEqual(stdout.split("\n").filter(Boolean));
    expect(outputBlock(run)).toContain(PACK_SENT_NOTHING);
    expect(stdout).toContain(readyLine("./my-pack", "mymoves", false));
  }, 120_000);

  it("names every check a pack may offer", () => {
    for (const option of ItemCheck.options) expect(guide).toContain(`\`${option.shape.kind.value}\``);
  });

  it("names each fixture file, and its worked expect.json is valid", () => {
    for (const path of Object.values(FIXTURES)) expect(guide).toContain(path);
    const block = /```json\n(\{\s*"found"[\s\S]*?)```/.exec(guide)?.[1];
    expect(block).toBeDefined();
    expect(FixtureExpectations.safeParse(JSON.parse(block ?? "")).success).toBe(true);
  });

  it("says what a pack cannot do, how to end a refused cheat quickly, and how to run the check from a test suite", () => {
    expect(flat).toMatch(/cannot give the agent tools or commands/);
    expect(guide).toContain('"still there"');
    expect(guide).toContain('from "delivery-service/testing"');
    expect(guide).toContain("checkPack(");
  });

  it("says what a scripted check cannot prove, routing included", () => {
    expect(guide).toContain("## What a scripted check cannot prove");
    expect(flat).toContain("the right act workflow");
  });

  it("says delivery.pack/2 packs still work and how a prompt uses a setting", () => {
    expect(flat).toMatch(/delivery\.pack\/2 packs? (still|keep)/);
    expect(guide).toContain("`settings`");
    expect(guide).toContain("{{settings.");
    expect(guide).toContain("packSettings");
    expect(flat).not.toContain("is reserved for pack settings");
  });

  it("uses no em-dashes", () => {
    expect(guide).not.toContain("—");
  });

  it("is listed in the README beside the guides to writing a gate and a closer", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("[Write a pack](docs/writing-a-pack.md)");
  });
});
