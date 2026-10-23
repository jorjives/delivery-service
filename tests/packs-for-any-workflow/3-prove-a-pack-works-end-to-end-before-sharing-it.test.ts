// Slice 3: Prove a pack works end to end before sharing it
// Source: docs/superpowers/specs/2026-10-23-packs-for-any-workflow-slices.md
// Recorded: 2026-10-23 against commit c1613db
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js, which runs signed out) on scratch copies of
// examples/moves-pack and the built-in code-review pack. Assertions are on exit
// codes and stable phrases, never on full output.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDelivery, REPO_ROOT } from "../helpers.js";

const MOVES = join(REPO_ROOT, "examples", "moves-pack");
const CODE_REVIEW = join(REPO_ROOT, "packs", "code-review");

/** A scratch folder holding a copy of `source` as `pack`, edited by `edit`, plus the check's result. */
const check = (source: string, edit: (file: (relative: string) => string) => void = () => {}) => {
  const cwd = mkdtempSync(join(tmpdir(), "uat-pack-check-"));
  cpSync(source, join(cwd, "pack"), { recursive: true });
  edit((relative) => join(cwd, "pack", relative));
  return runDelivery(["packs", "check", "pack", "--yes"], { cwd });
};
const rewrite = (path: string, from: string | RegExp, to: string) => writeFileSync(path, readFileSync(path, "utf-8").replaceAll(from, to));
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

describe("UAT: see that your pack really works, end to end, before anyone else uses it", () => {
  it("passes naming each step, fails naming the unreached act workflow, then passes again once restored", () => {
    // 1. The example pack passes, naming each step it proved in the pack's own words.
    const first = check(MOVES);
    expect(first.status, out(first)).toBe(0);
    expect(first.stdout).toContain("The scripted find moves:look added 3 ideas");
    expect(first.stdout).toContain("Every idea was approved and run under the act workflow it names: moves:code, moves:tests.");
    expect(first.stdout).toContain("passed its check under moves:tests");
    expect(first.stdout).toContain("was refused under moves:code");

    // 2. An idea no longer names moves:tests: the check fails and says which workflow nothing reached.
    const broken = check(MOVES, (file) => rewrite(file("fixtures/review.json"), "workflow: moves:tests", "workflow: moves:code"));
    expect(broken.status).not.toBe(0);
    expect(out(broken)).toContain('added no idea for the act workflow "moves:tests"');

    // 3. Restored, it passes again.
    const restored = check(MOVES);
    expect(restored.status, out(restored)).toBe(0);
  }, 240_000);
});

describe("AC: a cheat that is expected to be refused but is not fails the check", () => {
  it("fails when the scripted change for the cheat idea is an honest fix that passes", () => {
    const result = check(MOVES, (file) => {
      const fixes = file("fixtures/fixes.json");
      rewrite(fixes, /,\s*\{ "edit": \{ "path": "label.test.js"[^}]*\} \}/g, "");
      rewrite(fixes, "export const label = (n) => `x${n}`;\\n", 'import { twice } from \\"./new.js\\";\\n\\nexport const label = (n) => `x${twice(n)}`;\\n');
    });
    expect(result.status, out(result)).not.toBe(0);
    expect(out(result)).toContain("Labels still use the old doubling code");
    expect(out(result)).not.toContain("was refused under moves:code");
  }, 120_000);
});

describe("AC: the check for an existing review pack gives the same result and wording", () => {
  it("passes the built-in code-review pack in the review's own words", () => {
    const result = check(CODE_REVIEW, (file) => {
      const manifest = file("pack.json");
      rewrite(manifest, '"name": "code"', '"name": "mine"');
      rewrite(file("fixtures/review.json"), "workflow: code:fix", "workflow: mine:fix");
    });
    expect(result.status, out(result)).toBe(0);
    expect(result.stdout).toContain("The scripted review found");
    expect(result.stdout).toContain("was refused");
  }, 120_000);
});

describe("AC: the check sends nothing to a real agent and needs no sign-in", () => {
  it("says so, and passes in an environment with no credentials", () => {
    const result = check(MOVES);
    expect(result.status, out(result)).toBe(0);
    expect(result.stdout).toContain("Nothing was sent to a real agent");
  }, 120_000);
});
