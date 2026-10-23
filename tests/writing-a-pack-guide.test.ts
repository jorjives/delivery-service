// docs/writing-a-pack.md is how an extender learns to write and prove a review pack without
// reading the harness's source. It is held to the format, the fixture files and the phrases
// `delivery packs check` actually uses.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItemCheck } from "../src/schema.js";
import { PackManifest } from "../src/packs/pack-format.js";
import { ruleProblems } from "../src/packs/pack-rules.js";
import { FIXTURES, FixtureExpectations } from "../src/packs/pack-fixtures.js";
import { flatten, REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-pack.md"), "utf-8");
const flat = flatten(guide);

describe("the 'writing a pack' guide", () => {
  it("starts from a copy of a built-in pack and proves it with the pack check, then runs it", () => {
    for (const command of ["delivery packs check ./my-review", "delivery packs --schema"]) expect(guide).toContain(command);
    expect(guide).toContain("packs/code-review");
    expect(guide).toContain("`packs`");
  });

  it("names every key of a delivery.pack/3 pack.json, the find's and the act's included", () => {
    const keys = ["$schema", "schema", "name", "version", "title", "summary", "workflows", "kind", "prompt", "ideasFor", "guards", "add", "hold", "atOrAbove", "find", "act"];
    for (const key of keys) expect(guide).toContain(`\`${key}\``);
  });

  it("shows a delivery.pack/3 example that the harness reads with no mistake", () => {
    const block = /```json\n(\{\s*"schema": "delivery\.pack\/3"[\s\S]*?)```/.exec(guide)?.[1];
    const parsed = PackManifest.safeParse(JSON.parse(block ?? ""));
    expect(parsed.success && ruleProblems("pack.json", parsed.data)).toEqual([]);
  });

  it("says delivery.pack/2 packs still work and that settings are reserved", () => {
    expect(flat).toMatch(/delivery\.pack\/2 packs? (still|keep)/);
    expect(guide).toContain("`settings`");
    expect(guide).toContain("{{settings.");
  });

  it("lists every check a pack may offer", () => {
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

  it("uses no em-dashes", () => {
    expect(guide).not.toContain("—");
  });

  it("is listed in the README beside the guides to writing a gate and a closer", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("[Write a pack](docs/writing-a-pack.md)");
  });
});
