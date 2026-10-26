// Slice 3: See a pack's settings and what they would do before trusting it
// Source: docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-slices.md
// Recorded: 2026-10-25 against commit 32cb00a
//
// Drives the compiled `delivery packs inspect` command as a subprocess against a copy of
// the shipped docs example pack (a `path` setting, `docs-folder`, default `docs`, and a severity setting, `hold-from`, default `high`).
//
// SKIPPED AC: a code (`.js`) configuration shows defaults only
//   (needs a JS config project; covered by unit tests).
// SKIPPED AC: a pack the project does not use shows defaults only
//   (the pack must be reachable by path first; covered by unit tests).
// SKIPPED AC: a change to a declaration changes the fingerprint and approval
//   (covered by the pack-hash unit tests; this test pins only that owner values do not).

import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, git, runDelivery } from "../helpers.js";

/** A git-initialised scratch project that lists the docs example pack. */
function project(): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-adapt-slice-3-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  cpSync(join(REPO_ROOT, "examples", "docs-pack"), join(repo, "docs-pack"), { recursive: true });
  setConfig(repo, undefined);
  git(repo, ["init", "-q"]);
  return repo;
}

function setConfig(repo: string, packSettings: object | undefined): void {
  const config = { domain: "A tiny maths library.", tasks: ["do a thing"], gate: { type: "command", command: "npm test", parseMode: "exitcode" }, packs: ["docs-pack"], ...(packSettings ? { packSettings } : {}) };
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config));
}

function requireSetting(repo: string): void {
  const packPath = join(repo, "docs-pack", "pack.json");
  const pack = JSON.parse(readFileSync(packPath, "utf-8"));
  delete pack.settings["docs-folder"].default;
  writeFileSync(packPath, JSON.stringify(pack));
}

const inspect = (cwd: string, args: string[] = ["docs"]) => {
  const result = runDelivery(["packs", "inspect", ...args], { cwd });
  return { status: result.status, text: (result.stdout + result.stderr).replace(/\s+/g, " "), raw: result.stdout };
};

describe("UAT: read what a shared pack will ask of you before running it", () => {
  it("shows each value and its source, then 'not set' with the lines to add once the value is removed", () => {
    const repo = project();
    setConfig(repo, { docs: { "docs-folder": "handbook" } });

    const filled = inspect(repo);
    expect(filled.status).toBe(0);
    expect(filled.text).toContain("Settings (2)");
    expect(filled.text).toContain("docs-folder path, default docs");
    expect(filled.text).toContain("The folder that holds your documentation.");
    expect(filled.text).toContain("Your value: handbook (your configuration)");
    expect(filled.text).toContain("Changes: what the agent is told.");
    // The Settings section follows the summary and precedes what the pack may touch.
    expect(filled.text.indexOf("In short")).toBeLessThan(filled.text.indexOf("Settings (2)"));
    expect(filled.text.indexOf("Settings (2)")).toBeLessThan(filled.text.indexOf("What it may touch"));

    setConfig(repo, undefined);
    const defaulted = inspect(repo);
    expect(defaulted.text).toContain("Your value: docs (default)");

    requireSetting(repo);
    const unset = inspect(repo);
    expect(unset.status).toBe(0);
    expect(unset.text).toContain("docs-folder path, required");
    expect(unset.text).toContain("Your value: not set.");
    expect(unset.text).toContain("Add this to delivery.config.json");
    expect(unset.text).toContain('"packSettings": { "docs": { "docs-folder": "..." } }');
  });
});

describe("AC: the instructions keep each placeholder visible beside its value", () => {
  it("shows the resolved text with the placeholder", () => {
    const repo = project();
    setConfig(repo, { docs: { "docs-folder": "handbook" } });
    const { text } = inspect(repo);
    expect(text).toContain("Each value is shown before its placeholder");
    expect(text).toContain("handbook [{{settings.docs-folder}}]");
  });
});

describe("AC: inspection says in words what settings do and do not change", () => {
  it("states that settings change what the agent is told and when it waits, not the project's check", () => {
    const { text } = inspect(project());
    expect(text).toContain("These change what the agent is told and when it waits.");
    expect(text).toContain("They do not change your project's own check.");
  });
});

describe("AC: outside a project, inspection says so and shows defaults only", () => {
  it("names the missing project and shows the default value", () => {
    const folder = join(REPO_ROOT, "examples", "docs-pack");
    const outside = mkdtempSync(join(tmpdir(), "uat-adapt-slice-3-outside-"));
    const { status, text } = inspect(outside, [folder]);
    expect(status).toBe(0);
    expect(text).toContain("No project found. Values shown are defaults.");
    expect(text).toContain("Value: docs (default)");
  });
});

describe("AC: a pack with no settings says so once", () => {
  it("says 'This pack has no settings.' exactly once", () => {
    const { status, raw } = inspect(project(), ["code"]);
    expect(status).toBe(0);
    expect(raw.split("This pack has no settings.").length - 1).toBe(1);
  });
});

describe("AC: the data form always carries a settings list with the same facts", () => {
  it("lists the setting with value and source, and an empty list for a pack without settings", () => {
    const repo = project();
    setConfig(repo, { docs: { "docs-folder": "handbook" } });
    const doc = JSON.parse(inspect(repo, ["docs", "--json"]).raw);
    expect(doc.settings).toEqual([
      expect.objectContaining({
        name: "docs-folder",
        type: "path",
        summary: "The folder that holds your documentation.",
        required: false,
        default: "docs",
        value: "handbook",
        source: "configuration",
      }),
      expect.objectContaining({ name: "hold-from", type: "severity", default: "high", value: "high", source: "default", required: false }),
    ]);

    requireSetting(repo);
    setConfig(repo, undefined);
    const unset = JSON.parse(inspect(repo, ["docs", "--json"]).raw);
    expect(unset.settings[0]).toMatchObject({ value: null, source: "unset", required: true });

    expect(JSON.parse(inspect(repo, ["code", "--json"]).raw).settings).toEqual([]);
  });

  it("refuses an owner value holding a hidden character", () => {
    const repo = project();
    setConfig(repo, { docs: { "docs-folder": "a‮b" } });
    const { text } = inspect(repo);
    expect(text).toContain("The value has a line break, tab or hidden character.");
    expect(text).not.toContain("a‮b");
  });
});

describe("AC: owner values do not change the pack's fingerprint", () => {
  it("gives the same hash whatever the owner's value", () => {
    const repo = project();
    const hash = () => JSON.parse(inspect(repo, ["docs", "--json"]).raw).pack.hash as string;
    const before = hash();
    setConfig(repo, { docs: { "docs-folder": "handbook" } });
    expect(hash()).toBe(before);
  });
});
