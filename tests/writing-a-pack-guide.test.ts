// docs/writing-a-pack.md is how an extender learns to write and prove a review pack without
// reading the harness's source. It is held to the format, the fixture files and the phrases
// `delivery packs check` actually uses.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SENT_NOTHING } from "../src/cli/packs-check-command.js";
import { SPECIFIC_CHECKS } from "../src/packs/finding.js";
import { packSchema } from "../src/packs/manifest.js";
import { FIXTURES, FixtureExpectations } from "../src/packs/pack-fixtures.js";
import { REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/writing-a-pack.md"), "utf-8");
const flat = guide.replace(/\s+/g, " ");

describe("the 'writing a pack' guide", () => {
  it("starts from a copy of a built-in pack and proves it with the pack check, then runs it", () => {
    for (const command of ["delivery packs check ./my-review", "delivery review ./my-review", "delivery packs --schema"]) expect(guide).toContain(command);
    expect(guide).toContain("packs/code-review");
    expect(flat).toContain(SENT_NOTHING);
  });

  it("names every top-level and scan key of pack.json", () => {
    const schema = packSchema() as { properties: Record<string, { properties?: Record<string, unknown> }> };
    for (const key of Object.keys(schema.properties)) expect(guide).toContain(`\`${key}\``);
    for (const key of Object.keys(schema.properties.scan?.properties ?? {})) expect(guide).toContain(`\`${key}\``);
  });

  it("lists every check a pack may offer", () => {
    for (const kind of SPECIFIC_CHECKS) expect(guide).toContain(`\`${kind}\``);
  });

  it("names each fixture file, and its worked expect.json is valid", () => {
    for (const path of Object.values(FIXTURES)) expect(guide).toContain(path);
    const block = /```json\n(\{\s*"found"[\s\S]*?)```/.exec(guide)?.[1];
    expect(block).toBeDefined();
    expect(FixtureExpectations.safeParse(JSON.parse(block ?? "")).success).toBe(true);
  });

  it("says what a pack cannot do, how to end a refused cheat quickly, and how to run the check from a test suite", () => {
    expect(flat).toMatch(/cannot give the agent tools or commands/);
    expect(guide).toContain('"-> FAIL)"');
    expect(guide).toContain('from "delivery-service/testing"');
    expect(guide).toContain("checkPack(");
  });

  it("points at the demo, which exists, and uses no em-dashes", () => {
    expect(guide).toContain("npm run demo:packs-slice-7");
    expect(existsSync(join(REPO_ROOT, "demos/task-packs-slice-7-write-a-pack.ts"))).toBe(true);
    expect(guide).not.toContain("—");
  });

  it("is listed in the README beside the guides to writing a gate and a closer", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("[Writing a pack](docs/writing-a-pack.md)");
  });
});
