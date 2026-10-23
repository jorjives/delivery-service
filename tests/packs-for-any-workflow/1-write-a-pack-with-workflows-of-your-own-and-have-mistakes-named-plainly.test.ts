// Slice 1: Write a pack with workflows of your own and have mistakes named plainly
// Source: docs/superpowers/specs/2026-10-23-packs-for-any-workflow-slices.md
// Recorded: 2026-10-23 against commit dd6b7fc
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js) in a scratch project that lists a pack of
// its own under `packs`. Assertions are on exit codes and stable phrases of the
// plain-words sentences, never on full output.
//
// SKIPPED AC: "A backlog item naming code:fix or security:fix still runs" is proved
//   by tests/course-correction/8-*.test.ts, which runs security:fix items end to end;
//   it is not repeated here.
// SKIPPED AC: "The machine-readable schema ... the published-keys promise holds for
//   both format versions" is a property of the source, proved by the schema's own
//   unit tests; the UAT-visible part (the schema prints) is asserted below.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { PACKAGE, scriptFile } from "../../src/cli/command-fixtures.js";
import type { MockScript } from "../../src/mock-script.js";
import { ideaText } from "../../src/packs/review-fixtures.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { runDelivery } from "../helpers.js";

type Json = Record<string, unknown>;

const find = { kind: "find", ideasFor: ["code"], prompt: "scan.md" };
const act = { kind: "act", prompt: "code.md" };
const manifest = (extra: Json = {}, workflows: Json = { scan: find, code: act }): Json => ({
  schema: "delivery.pack/3",
  name: "mymoves",
  version: "1.0.0",
  title: "My moves",
  summary: "Moves calls off retired code.",
  workflows,
  ...extra,
});

// The documentation's example: one find offering two acts, one with a guard and a hold.
const EXAMPLE = manifest({}, {
  scan: { kind: "find", ideasFor: ["code", "tests"], prompt: "scan.md" },
  code: { kind: "act", summary: "Code that still calls the retired code.", prompt: "code.md", guards: { add: ["tests-unchanged"] }, hold: { atOrAbove: "high" } },
  tests: { kind: "act", summary: "A test file that still calls the retired code.", prompt: "tests.md" },
});

/** A scratch git project that lists ./mymoves (holding `pack`) under `packs`. */
function project(pack: Json, others: Record<string, Json> = {}) {
  const files: Record<string, string> = {};
  const folders = { mymoves: pack, ...others };
  for (const [name, json] of Object.entries(folders)) {
    files[`${name}/pack.json`] = JSON.stringify(json, null, 2);
    for (const prompt of ["scan.md", "code.md", "tests.md"]) files[`${name}/${prompt}`] = "Instructions.\n";
  }
  files["delivery.config.json"] = JSON.stringify({ packs: Object.keys(folders).map((n) => `./${n}`) });
  return initTempRepo("uat-pack-", files);
}
const packs = (dir: string, ...args: string[]) => runDelivery(["packs", ...args], { cwd: dir });

describe("UAT: write a pack of your own, get plain feedback, and keep the built-in reviews", () => {
  it("lists the pack, names the missing field, lists it again once restored, and still runs review code", async () => {
    const dir = project(EXAMPLE);

    // 1. The example pack is listed beside the built-ins.
    const listed = packs(dir);
    expect(listed.status, listed.stdout + listed.stderr).toBe(0);
    for (const text of ["  mymoves ", "Moves calls off retired code. Start it with: delivery review mymoves"]) expect(listed.stdout).toContain(text);

    // 2. Delete the line saying which workflows the find offers.
    const broken = structuredClone(EXAMPLE) as { workflows: { scan: Json } };
    delete broken.workflows.scan.ideasFor;
    writeFileSync(join(dir, "mymoves", "pack.json"), JSON.stringify(broken));
    const refused = packs(dir);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout + refused.stderr).toContain(join(dir, "mymoves", "pack.json"));
    expect(refused.stdout + refused.stderr).toContain('"workflows.scan.ideasFor" is missing');

    // 3. Put it back; list again; the built-in review runs as before on a project that used it.
    writeFileSync(join(dir, "mymoves", "pack.json"), JSON.stringify(EXAMPLE));
    expect(packs(dir).stdout).toContain("  mymoves ");

    const repo = initTempRepo("uat-pack-review-", { "package.json": PACKAGE, "total.js": "export const t = 1;\n" });
    const idea = { file: "20261023T120000Z-old.md", title: "Old total", severity: "low" as const, workflow: "code:fix", check: { kind: "anchor-gone" as const, path: "total.js", anchor: "export const t = 1;" }, body: "Old.\n\n## Why it matters\n\nIt is old.\n\n## What fixed looks like\n\nGone." };
    const script: MockScript = { expectations: [{ effects: [{ write: { path: `.delivery/backlog/${idea.file}`, content: ideaText(idea) } }], json: { status: "completed", rationale: "reviewed" } }] };
    const state = mkdtempSync(join(tmpdir(), "uat-pack-state-"));
    const env = { ...process.env, XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) };
    const review = runDelivery(["review", "code"], { cwd: repo, env });
    expect(review.status, review.stdout + review.stderr).toBe(0);
  }, 120_000);
});

describe("AC: a pack with several act workflows, each with its own settings, is accepted", () => {
  it("lists a pack with a guard and a hold on one act and a summary on each", () => {
    const listed = packs(project(EXAMPLE));
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("  mymoves ");
  });
});

describe("AC: the built-in packs are listed with their names unchanged", () => {
  it("lists code and security and offers delivery review code", () => {
    const listed = packs(project(EXAMPLE));
    expect(listed.stdout).toMatch(/^ {2}code {2,}/m);
    expect(listed.stdout).toMatch(/^ {2}security {2,}/m);
    expect(listed.stdout).toContain("delivery review code");
  });
});

describe("AC: a mistake is refused with a sentence naming the file and field", () => {
  const cases: [string, Json, string][] = [
    ["no find", manifest({}, { code: act }), 'must hold exactly one workflow with "kind": "find", but it holds none'],
    ["two finds", manifest({}, { scan: find, other: find, code: act }), "but it holds 2"],
    ["an idea target that is not an act", manifest({}, { scan: { ...find, ideasFor: ["scan"] }, code: act }), '"workflows.scan.ideasFor.0" is a find workflow'],
    ["an act no find offers", manifest({}, { scan: find, code: act, extra: act }), '"workflows.extra" is not listed in any find workflow\'s "ideasFor"'],
    ["an act-only key on a find", manifest({}, { scan: { ...find, hold: { atOrAbove: "high" } }, code: act }), '"workflows.scan.hold" is only for act workflows'],
    ["a missing summary where several targets exist", manifest({}, { scan: { ...find, ideasFor: ["code", "tests"] }, code: act, tests: act }), '"workflows.code.summary" is missing'],
    ["a reserved settings key", manifest({ settings: {} }), '"settings" is reserved for pack settings'],
    ["an unknown key", manifest({ bogus: 1 }), '"bogus" is not part of the pack format'],
    ["a wrong kind", manifest({}, { scan: find, code: { ...act, kind: "nope" } }), '"workflows.code.kind" is "nope"'],
  ];
  for (const [label, pack, phrase] of cases) {
    it(`refuses ${label}`, () => {
      const dir = project(pack);
      const result = packs(dir);
      const text = result.stdout + result.stderr;
      expect(result.status).not.toBe(0);
      expect(text).toContain(join(dir, "mymoves", "pack.json"));
      expect(text).toContain(phrase);
    });
  }
});

describe("AC: an unreadable format version is refused naming the readable ones", () => {
  it("names delivery.pack/2 and delivery.pack/3", () => {
    const result = packs(project(manifest({ schema: "delivery.pack/9" })));
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/"schema" is "delivery\.pack\/9".*delivery\.pack\/2 and delivery\.pack\/3/);
  });
});

describe("AC: a pack cannot supply a gate, agent, tools, closer or commands", () => {
  for (const key of ["gate", "agent", "allowedTools", "closer", "commands"]) {
    it(`refuses ${key} on an act with the data-only explanation`, () => {
      const result = packs(project(manifest({}, { scan: find, code: { ...act, [key]: "x" } })));
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain(`"workflows.code.${key}" is not part of the pack format: a pack holds only data`);
    });
  }
});

describe("AC: the machine-readable schema describes the new format", () => {
  it("prints a delivery.pack/3 schema that flags unknown keys in each kind of workflow", () => {
    const result = packs(project(EXAMPLE), "--schema");
    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout) as Json;
    expect(JSON.stringify(schema)).toContain("delivery.pack/3");
    const unclosed = JSON.stringify(schema).match(/"additionalProperties":false/g) ?? [];
    expect(unclosed.length).toBeGreaterThanOrEqual(3);
  });
});

describe("AC: two packs defining the same workflow name are reported by the clash sentence", () => {
  it("asks for one of them to be renamed", () => {
    const dir = project(EXAMPLE, { dup: manifest() });
    const result = packs(dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Two things define the workflow "mymoves:scan"');
  });
});
