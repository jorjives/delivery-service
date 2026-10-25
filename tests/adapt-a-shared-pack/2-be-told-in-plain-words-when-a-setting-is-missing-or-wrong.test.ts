// Slice 2: Be told in plain words when a setting is missing or wrong
// Source: docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-slices.md
// Recorded: 2026-10-25 against commit c87e7cd
//
// Drives the compiled `delivery` command as a subprocess against a copy of the
// shipped docs example pack, edited so its one setting is required (no default).
//
// SKIPPED AC: several unset settings are listed together, one block each
//   (needs a second pack with a required setting; covered by unit tests).
// SKIPPED AC: a packSettings entry for a removed pack is refused
//   (needs an installed-then-removed pack; covered by unit tests).
// SKIPPED AC: pack author file-and-field messages (no summary, bad default, unused or
//   undeclared placeholder, /3 prompt, more than 32 settings)
//   (pack-check wording; covered by unit tests).
// SKIPPED AC: a scheduled run is refused in the same way
//   (needs a scheduler; covered by unit tests).

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, git, runDelivery } from "../helpers.js";

/** A git-initialised scratch project whose docs pack requires `docs-folder`. */
function project(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-adapt-slice-2-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  cpSync(join(REPO_ROOT, "examples", "docs-pack"), join(repo, "docs-pack"), { recursive: true });
  const packPath = join(repo, "docs-pack", "pack.json");
  const pack = JSON.parse(readFileSync(packPath, "utf-8"));
  delete pack.settings["docs-folder"].default;
  writeFileSync(packPath, JSON.stringify(pack));
  setConfig(repo, undefined);
  git(repo, ["init", "-q"]);
  return repo;
}

function setConfig(repo: string, packSettings: object | undefined): void {
  const config = { domain: "A tiny maths library.", tasks: ["do a thing"], gate: { type: "command", command: "npm test", parseMode: "exitcode" }, packs: ["docs-pack"], ...(packSettings ? { packSettings } : {}) };
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config));
}

const run = (repo: string, args: string[]) => {
  const result = runDelivery(args, { cwd: repo });
  return { status: result.status, text: (result.stdout + result.stderr).replace(/\s+/g, " ") };
};

describe("UAT: find out what is missing from your configuration before anything runs", () => {
  it("refuses with the lines to add, proceeds once set, then lists the real settings after a typo", () => {
    const repo = project();

    const first = run(repo, ["run"]);
    expect(first.status).toBe(2);
    expect(first.text).toContain("the pack docs needs a setting you have not given");
    expect(first.text).toContain("docs-folder: the folder that holds your documentation.");
    expect(first.text).toContain('"packSettings": { "docs": { "docs-folder": "..." } }');
    expect(first.text).toContain("This stops every run in this project");

    setConfig(repo, { docs: { "docs-folder": "handbook" } });
    const second = run(repo, ["validate"]);
    expect(second.status).toBe(0);
    expect(second.text).toContain("Ready to run.");

    setConfig(repo, { docs: { "docs-folder-x": "handbook" } });
    const third = run(repo, ["validate"]);
    expect(third.status).toBe(2);
    expect(third.text).toContain('"docs-folder-x" is not a setting of this pack');
    expect(third.text).toContain("Its settings are: docs-folder.");
  });
});

describe("AC: an unset required setting stops the whole project", () => {
  it.each([
    ["run", ["run"]],
    ["review", ["review", "docs"]],
    ["validate", ["validate"]],
  ])("stops %s with exit 2 and says why", (_name, args) => {
    const { status, text } = run(project(), args);
    expect(status).toBe(2);
    expect(text).toContain("docs-folder");
    expect(text).toContain("Nothing was run.");
  });
});

describe("AC: pack-management commands still work with a setting unset", () => {
  it.each([
    ["packs", ["packs"]],
    ["packs inspect", ["packs", "inspect", "docs"]],
  ])("%s exits 0", (_name, args) => {
    expect(run(project(), args).status).toBe(0);
  });
});

describe("AC: a bad packSettings entry is refused, all problems at once", () => {
  it("names an unused pack and an absolute path together", () => {
    const repo = project();
    setConfig(repo, { nope: { a: "b" }, docs: { "docs-folder": "/abs" } });
    const { status, text } = run(repo, ["validate"]);
    expect(status).toBe(2);
    expect(text).toContain("no pack called nope is used by this project");
    expect(text).toContain('"/abs" is not inside this project');
  });

  it.each([
    [".git", 'names .git'],
    ["../x", "is not inside this project"],
  ])("refuses the path %j", (value, reason) => {
    const repo = project();
    setConfig(repo, { docs: { "docs-folder": value } });
    const { status, text } = run(repo, ["validate"]);
    expect(status).toBe(2);
    expect(text).toContain(reason);
  });
});
