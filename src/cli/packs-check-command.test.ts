import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_PACKS } from "../packs/manifest.js";
import { FIXTURES } from "../packs/pack-fixtures.js";
import { delivery } from "./command-fixtures.js";
import { EXIT, Refusal } from "./failures.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import type { PackCheck } from "./pack-check.js";
import { packWorkflowClash } from "./pack-workflows.js";
import { checkingLine, NEEDS_CONFIRMATION, NOT_TRUSTED, packsCheckCommand, readyLine, SENT_NOTHING } from "./packs-check-command.js";

const CHECK_TIMEOUT = 120_000;

/**
 * A copy of the built-in code review as `my-pack` in a fresh folder, which is returned as the place to run from.
 * It is renamed `mine`, so its workflows do not clash with the built-in code review's.
 */
function myPack(edit?: (manifest: { scan: { checks: string[] } }) => void): string {
  const cwd = mkdtempSync(join(tmpdir(), "packs-check-"));
  cpSync(join(BUILT_IN_PACKS, "code-review"), join(cwd, "my-pack"), { recursive: true });
  const file = join(cwd, "my-pack", "pack.json");
  const manifest = JSON.parse(readFileSync(file, "utf-8"));
  manifest.name = "mine";
  edit?.(manifest);
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  const review = join(cwd, "my-pack", FIXTURES.review);
  writeFileSync(review, readFileSync(review, "utf-8").replaceAll("workflow: code:fix", "workflow: mine:fix"));
  return cwd;
}

describe("delivery packs check", () => {
  it("names a field the pack format does not have by file and field, and stops as validate does", async () => {
    const cwd = myPack((m) => (m.scan.checks = ["anchor-gone"]));
    const { exitCode, stdout } = await delivery(["packs", "check", "my-pack", "--yes"], { cwd });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toContain('my-pack/pack.json: "scan.checks" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check.');
    expect(stdout).not.toContain(SENT_NOTHING);
  });

  it("on a valid pack, says what the scripted review found, which fix passed, which cheat was refused, and that nothing reached a real agent", async () => {
    const { exitCode, stdout } = await delivery(["packs", "check", "my-pack", "--yes"], { cwd: myPack() });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")).toEqual(
      expect.arrayContaining([
        "Checking the review in my-pack…",
        "✓ pack.json: the mine review, version 2.0.0.",
        '✓ The scripted review found 2 problems, as fixtures/expect.json expects: "The total can go below zero", "A missing or broken settings file gives an unhelpful error".',
        '✓ The scripted fix for "The total can go below zero" passed its check.',
        '✓ The scripted cheat for "A missing or broken settings file gives an unhelpful error" was refused: it removed, changed or skipped tests.',
        SENT_NOTHING,
        "Ready to use: delivery review ./my-pack",
      ]),
    );
    expect(readyLine("./my-pack")).toBe("Ready to use: delivery review ./my-pack");
  }, CHECK_TIMEOUT);

  it("ends a problem whose reason is already a sentence with one full stop, not two", async () => {
    // Not renamed, so the copy's workflows clash with the built-in code review's.
    const cwd = mkdtempSync(join(tmpdir(), "packs-check-clash-"));
    cpSync(join(BUILT_IN_PACKS, "code-review"), join(cwd, "my-pack"), { recursive: true });
    const { exitCode, stdout } = await delivery(["packs", "check", "my-pack", "--yes"], { cwd });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout.split("\n")).toContain(`my-pack/fixtures/review.json: the scripted review could not be used: ${packWorkflowClash("code:scan")}`);
  }, CHECK_TIMEOUT);

  it("names a folder with no pack in it, and exits as validate does", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "packs-check-empty-"));
    const { exitCode, stdout } = await delivery(["packs", "check", "nothing-here", "--yes"], { cwd });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toContain("nothing-here/pack.json: is missing.");
  });

  it("gives the whole result as one document with --json, with the same exit codes", async () => {
    const good = await delivery(["packs", "check", "my-pack", "--json", "--yes"], { cwd: myPack() });
    expect(good.exitCode).toBe(EXIT.ok);
    expect(JSON.parse(good.stdout) as PackCheck).toMatchObject({ ready: true, sentToAgent: false, problems: [] });
    const bad = await delivery(["packs", "check", "my-pack", "--json", "--yes"], { cwd: myPack((m) => (m.scan.checks = ["nope"])) });
    expect(bad.exitCode).toBe(EXIT.configuration);
    expect((JSON.parse(bad.stdout) as PackCheck).problems.map((p) => p.field)).toEqual(["scan.checks"]);
  }, CHECK_TIMEOUT);

  describe("trusting the pack before its fixtures run", () => {
    it("refuses a non-interactive run with no --yes, and runs nothing", async () => {
      const { ctx, lines } = context(myPack(), { interactive: false });
      const { ask, asked } = scriptedAsk();

      const err = await packsCheckCommand("my-pack", {}, ctx, ask).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Refusal);
      expect((err as Refusal).message).toBe(NEEDS_CONFIRMATION);
      expect((err as Refusal).exitCode).toBe(EXIT.configuration);
      expect(asked).toEqual([]);
      expect(lines).toEqual([checkingLine("my-pack")]);
    });

    it("asks, in a terminal, before running the fixtures, and proceeds on yes", async () => {
      const { ctx, lines } = context(myPack());
      ctx.env = { ...process.env };
      const { ask, asked } = scriptedAsk({ confirm: true });

      const exitCode = await packsCheckCommand("my-pack", {}, ctx, ask);

      expect(exitCode).toBe(EXIT.ok);
      expect(asked).toHaveLength(1);
      expect(lines).toContain(SENT_NOTHING);
    }, CHECK_TIMEOUT);

    it("asks, in a terminal, and runs nothing on no", async () => {
      const { ctx, lines } = context(myPack());
      const { ask, asked } = scriptedAsk({ confirm: false });

      const exitCode = await packsCheckCommand("my-pack", {}, ctx, ask);

      expect(exitCode).toBe(EXIT.ok);
      expect(asked).toHaveLength(1);
      expect(lines).toEqual([checkingLine("my-pack"), NOT_TRUSTED("my-pack")]);
    });

    it("skips the question with --yes, even in a terminal", async () => {
      const { ctx, lines } = context(myPack());
      ctx.env = { ...process.env };
      const { ask, asked } = scriptedAsk();

      const exitCode = await packsCheckCommand("my-pack", { yes: true }, ctx, ask);

      expect(exitCode).toBe(EXIT.ok);
      expect(asked).toEqual([]);
      expect(lines).toContain(SENT_NOTHING);
    }, CHECK_TIMEOUT);
  });
});
