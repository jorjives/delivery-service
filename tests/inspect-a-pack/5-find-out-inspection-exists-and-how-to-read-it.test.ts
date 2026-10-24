// Slice 5: Find out inspection exists, and how to read it
// Source: docs/superpowers/specs/2026-10-23-inspect-a-pack-slices.md
// Recorded: 2026-10-24 against commit 7640ac9
//
// Drives the compiled `delivery` command as a real subprocess (tests/helpers.ts's runDelivery), in a
// throwaway git repository, and reads the shipped documentation pages. Asserts on stable phrases and
// structure, not full-output equality.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REASSURING, FORBIDDEN } from "../../src/report/report-fixtures.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { flatten, REPO_ROOT, runDelivery } from "../helpers.js";

const PACK = {
  "moves-pack/pack.json": JSON.stringify({ schema: "delivery.pack/2", name: "moves", version: "1.0.0", title: "Moves", summary: "Moves things.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } }),
  "moves-pack/scan.md": "# Scan moves\n",
  "moves-pack/fix.md": "# Fix moves\n",
};
const project = initTempRepo("uat-inspect-5-", { "package.json": '{"name":"p"}\n', ...PACK });

const listing = runDelivery(["packs"], { cwd: project });
const refusal = runDelivery(["review", "./moves-pack"], { cwd: project });
const inspected = runDelivery(["packs", "inspect", "deprecations"], { cwd: project });
const packsPage = readFileSync(join(REPO_ROOT, "docs", "packs.md"), "utf-8");
const reference = readFileSync(join(REPO_ROOT, "docs", "cli-reference.md"), "utf-8");
const sectionOfPage = (from: string, to: string): string => packsPage.slice(packsPage.indexOf(from), packsPage.indexOf(to));
const inspectSection = sectionOfPage("## Inspect a pack before you use it", "## What inspection does not promise");
const promiseSection = sectionOfPage("## What inspection does not promise", "## Names the built-ins keep");

describe("UAT: discover inspection from the places you already look", () => {
  it("ends the pack listing with a line pointing at inspection", () => {
    expect(listing.status).toBe(0);
    expect(listing.stdout.trimEnd().split("\n").at(-1)).toBe("See exactly what a pack will do: delivery packs inspect <name>");
  });

  it("points the refusal for an unlisted pack at inspecting it first", () => {
    expect(refusal.status).not.toBe(0);
    expect(refusal.stderr).toContain("is not one your project uses yet. See exactly what it will do first with: delivery packs inspect ");
  });

  it("gives the packs page a worked reading of a built-in pack", () => {
    expect(inspectSection).toContain("delivery packs inspect deprecations");
    expect(inspectSection).toContain("Pack: Move off deprecated code");
  });

  it("says plainly that inspection is a reading aid, not a guarantee", () => {
    expect(promiseSection).toContain("Inspection is a reading aid, not a guarantee.");
  });
});

describe("AC: where inspection is described", () => {
  it("describes inspection in the command reference", () => {
    expect(reference).toMatch(/\| `delivery packs inspect <pack>` \|/);
    expect(reference).toContain("packs.md#inspect-a-pack-before-you-use-it");
  });

  it("says inspection does not analyse the instructions", () => {
    expect(flatten(promiseSection)).toContain("It does not analyse the instructions");
  });

  it("says what the folder rule allows and refuses, and the exit code", () => {
    const text = flatten(promiseSection);
    expect(text).toContain("It allows `pack.json`");
    expect(text).toContain("It refuses a link anywhere in the folder");
    expect(text).toContain("exits with code 2");
  });
});

describe("AC: the account itself", () => {
  it("includes the fixed block of questions to ask before using a pack", () => {
    const out = flatten(inspected.stdout);
    expect(out).toContain("Questions to ask before you use it");
    expect(out).toContain("Do you know who wrote it?");
    expect(out).toContain("Do the instructions below match the summary above?");
  });

  it("names the fixture files it did not read, with sizes", () => {
    expect(inspected.stdout).toMatch(/Not shown here:\s+fixtures\/expect\.json, \d+ bytes/);
  });
});

describe("AC: the owner vocabulary", () => {
  it("keeps to it on the listing, the refusal and the documentation sections", () => {
    for (const text of [listing.stdout, refusal.stderr, inspectSection, promiseSection]) {
      expect(text).not.toMatch(FORBIDDEN);
      expect(text).not.toMatch(REASSURING);
    }
  });
});
