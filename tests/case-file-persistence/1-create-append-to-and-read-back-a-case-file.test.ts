// Slice 1: Create, Append To, and Read Back a Case File
// Source: docs/superpowers/specs/2026-09-04-case-file-persistence-slices.md
// Recorded: 2026-09-04 against commit 43802a233e87e710c053efabf9363c9e6f354a8e
//
// Drives the slice's own UAT demo script (npx tsx demos/slice-1-round-trip.ts)
// and asserts on its printed output, plus two acceptance criteria that the
// demo script's happy path doesn't exercise (missing / corrupt case file).

import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT, runTsx } from "./helpers.js";

describe("UAT: create, append to, and read back a case file", () => {
  it("demo script writes a case file, appends history, and reads it back from disk", () => {
    const { stdout, status } = runTsx(["demos/slice-1-round-trip.ts"]);

    expect(status).toBe(0);

    // Header exactly as created
    expect(stdout).toContain("Surface ID: demo-surface-1");
    expect(stdout).toContain("State:      PROVISIONING");
    expect(stdout).toContain("Baseline:   null");

    // Both history entries, in the order they were recorded
    expect(stdout).toContain("History:    2 entries");
    const dispatchIndex = stdout.indexOf("- dispatch");
    const terminusIndex = stdout.indexOf("- terminus");
    expect(dispatchIndex).toBeGreaterThan(-1);
    expect(terminusIndex).toBeGreaterThan(dispatchIndex);

    // Proves the read came from disk, not memory
    expect(stdout).toContain(
      "Round trip verified: disk state matches what was written.",
    );
  });
});

describe("AC: reading a case file that does not exist", () => {
  it("fails with a named FileNotFound error rather than a crash", async () => {
    const missingDir = await mkdtemp(join(tmpdir(), "case-file-uat-missing-"));
    const { stdout, status } = runTsx([
      "-e",
      `
      (async () => {
        const { load } = await import(${JSON.stringify(join(REPO_ROOT, "src/index.js"))});
        try {
          await load(${JSON.stringify(missingDir)});
          console.log("NO_ERROR_THROWN");
          process.exit(1);
        } catch (err) {
          console.log("ERROR_NAME:" + err.name);
          process.exit(err.name === "FileNotFound" ? 0 : 2);
        }
      })();
      `,
    ]);

    expect(stdout).toContain("ERROR_NAME:FileNotFound");
    expect(status).toBe(0);
  });
});

describe("AC: reading a case file whose contents don't match the expected structure", () => {
  it("fails with a named CorruptCaseFile error rather than a crash", async () => {
    const badDir = await mkdtemp(join(tmpdir(), "case-file-uat-corrupt-"));
    await writeFile(join(badDir, "case.json"), '{"not":"a case file"}');
    await writeFile(join(badDir, "log.jsonl"), "");

    const { stdout, status } = runTsx([
      "-e",
      `
      (async () => {
        const { load } = await import(${JSON.stringify(join(REPO_ROOT, "src/index.js"))});
        try {
          await load(${JSON.stringify(badDir)});
          console.log("NO_ERROR_THROWN");
          process.exit(1);
        } catch (err) {
          console.log("ERROR_NAME:" + err.name);
          process.exit(err.name === "CorruptCaseFile" ? 0 : 2);
        }
      })();
      `,
    ]);

    expect(stdout).toContain("ERROR_NAME:CorruptCaseFile");
    expect(status).toBe(0);
  });
});

describe("AC: the project's automated test suite runs on every push and pull request", () => {
  it("CI workflow triggers on push and pull_request and runs npm test", async () => {
    const { readFile } = await import("node:fs/promises");
    const workflow = await readFile(
      join(REPO_ROOT, ".github/workflows/ci.yml"),
      "utf-8",
    );

    expect(workflow).toMatch(/^\s*push:/m);
    expect(workflow).toMatch(/^\s*pull_request:/m);
    expect(workflow).toContain("npm test");
  });
});
