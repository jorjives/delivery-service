import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "../packs/manifest.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import type { PackCheck } from "./pack-check.js";
import { readyLine, SENT_NOTHING } from "./packs-check-command.js";

const CHECK_TIMEOUT = 120_000;

/** A copy of the built-in code review as `my-pack` in a fresh folder, which is returned as the place to run from. */
function myPack(edit?: (manifest: { scan: { checks: string[] } }) => void): string {
  const cwd = mkdtempSync(join(tmpdir(), "packs-check-"));
  cpSync(join(BUILT_IN_PACKS, "code-review"), join(cwd, "my-pack"), { recursive: true });
  if (edit !== undefined) {
    const file = join(cwd, "my-pack", "pack.json");
    const manifest = JSON.parse(readFileSync(file, "utf-8"));
    edit(manifest);
    writeFileSync(file, JSON.stringify(manifest, null, 2));
  }
  return cwd;
}

describe("delivery packs check", () => {
  it("names a made-up check kind by file and field, with the available ones, and stops as validate does", async () => {
    const cwd = myPack((m) => (m.scan.checks = ["anchor-gone", "page-contains"]));
    const { exitCode, stdout } = await delivery(["packs", "check", "my-pack"], { cwd });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toContain('my-pack/pack.json: "scan.checks.1" is "page-contains" but the available checks are: anchor-gone, pattern-absent, dependency-absent.');
    expect(stdout).not.toContain(SENT_NOTHING);
  });

  it("on a valid pack, says what the scripted review found, which fix passed, which cheat was refused, and that nothing reached a real agent", async () => {
    const { exitCode, stdout } = await delivery(["packs", "check", "my-pack"], { cwd: myPack() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")).toEqual(
      expect.arrayContaining([
        "Checking the review in my-pack…",
        "✓ pack.json: the code review, version 1.1.0.",
        '✓ The scripted review found 2 problems, as fixtures/expect.json expects: "The total can go below zero", "A missing or broken settings file gives an unhelpful error".',
        '✓ The scripted fix for "The total can go below zero" passed its check.',
        '✓ The scripted cheat for "A missing or broken settings file gives an unhelpful error" was refused: it removed, changed or skipped tests.',
        SENT_NOTHING,
        "Ready to use: delivery review ./my-pack",
      ]),
    );
    expect(readyLine("./my-pack")).toBe("Ready to use: delivery review ./my-pack");
  }, CHECK_TIMEOUT);

  it("names a folder with no pack in it, and exits as validate does", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "packs-check-empty-"));
    const { exitCode, stdout } = await delivery(["packs", "check", "nothing-here"], { cwd });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toContain("nothing-here/pack.json: is missing.");
  });

  it("gives the whole result as one document with --json, with the same exit codes", async () => {
    const good = await delivery(["packs", "check", "my-pack", "--json"], { cwd: myPack() });
    expect(good.exitCode).toBe(EXIT.ok);
    expect(JSON.parse(good.stdout) as PackCheck).toMatchObject({ ready: true, sentToAgent: false, problems: [] });
    const bad = await delivery(["packs", "check", "my-pack", "--json"], { cwd: myPack((m) => (m.scan.checks = ["nope"])) });
    expect(bad.exitCode).toBe(EXIT.configuration);
    expect((JSON.parse(bad.stdout) as PackCheck).problems.map((p) => p.field)).toEqual(["scan.checks.0"]);
  }, CHECK_TIMEOUT);
});
