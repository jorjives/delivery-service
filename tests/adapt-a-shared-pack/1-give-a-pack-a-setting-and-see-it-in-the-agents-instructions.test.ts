// Slice 1: Give a pack a setting and see it in the agent's instructions
// Source: docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-slices.md
// Recorded: 2026-10-25 against commit cb1dd23
//
// Drives the compiled `delivery preview` command as a subprocess against a copy
// of the shipped docs example pack inside a scratch project.
//
// SKIPPED AC: built-in, listed and installed packs take packSettings alike
//   (needs an installed pack and a built-in with settings; covered by unit tests).
// SKIPPED AC: a resumed run keeps its original step text after the configuration
//   changes (needs a scripted interrupted run; not drivable through preview).
// SKIPPED AC: packs without settings behave exactly as before (covered by the
//   existing suite, which the project gate runs).

import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, git, runDelivery } from "../helpers.js";

/** A git-initialised scratch project holding a copy of the docs example pack, configured with `extra`. */
function project(extra: object = {}): string {
  const repo = mkdtempSync(join(tmpdir(), "uat-adapt-slice-1-"));
  cpSync(join(REPO_ROOT, "examples", "sample-project"), repo, { recursive: true });
  cpSync(join(REPO_ROOT, "examples", "docs-pack"), join(repo, "docs-pack"), { recursive: true });
  const config = { domain: "A tiny maths library.", tasks: ["do a thing"], gate: { type: "command", command: "npm test", parseMode: "exitcode" }, packs: ["docs-pack"], ...extra };
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(config));
  git(repo, ["init", "-q"]);
  return repo;
}

const preview = (repo: string) => runDelivery(["preview", "--workflow", "docs:look"], { cwd: repo });

describe("UAT: change what a shared pack tells the agent by editing one line of configuration", () => {
  it("shows the default folder, then the owner's folder, each with its source", () => {
    const repo = project();
    const before = preview(repo);
    expect(before.status).toBe(0);
    expect(before.stdout).toContain("Read the pages in `docs`");
    expect(before.stdout).toContain("Settings used: docs-folder = docs (default).");

    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ ...JSON.parse(readFileSync(join(repo, "delivery.config.json"), "utf-8")), packSettings: { docs: { "docs-folder": "handbook" } } }));
    const after = preview(repo);
    expect(after.status).toBe(0);
    expect(after.stdout).toContain("Read the pages in `handbook`");
    expect(after.stdout).not.toContain("Read the pages in `docs`");
    expect(after.stdout).toContain("Settings used: docs-folder = handbook (your configuration).");
  });
});

describe("AC: values are refused or inert when unsafe", () => {
  it.each([
    ["{{x}}", "The value holds {{ or }}."],
    ["a\nb", "The value has a line break, tab or hidden character."],
  ])("refuses the value %j", (value, reason) => {
    const { status, stdout, stderr } = preview(project({ packSettings: { docs: { "docs-folder": value } } }));
    expect(status).not.toBe(0);
    expect((stdout + stderr).replace(/\s+/g, " ")).toContain(reason);
  });

  it("never runs shell characters in a value", () => {
    const repo = project({ packSettings: { docs: { "docs-folder": "$(touch pwned)" } } });
    const { status, stdout } = preview(repo);
    expect(status).toBe(0);
    expect(stdout).toContain("docs-folder = $(touch pwned) (your configuration)");
    expect(existsSync(join(repo, "pwned"))).toBe(false);
  });
});
