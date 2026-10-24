import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LockEntry } from "../packs/install/lock.js";
import { entryFor } from "../packs/install/install-fixtures.js";
import type { PackageFile } from "../packs/install/package-archive.js";
import { installPack } from "../packs/install/store.js";
import { builtInPacks } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { ADD_HINT, INSPECT_HINT } from "./packs-command.js";
import { packWorkflowClash } from "./pack-clash.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The files of a delivery.pack/3 pack named `moves`, as `delivery packs add` would keep them. */
const movesFiles = (): PackageFile[] => [
  { path: "pack.json", bytes: encode(v3Pack("moves")) },
  { path: "scan.md", bytes: encode("# Scan\n") },
  { path: "code.md", bytes: encode("# Code\n") },
];

/** The contents of a delivery.pack/3 manifest named `name`, with a find `scan` offering an act `code`. */
const v3Pack = (name: string, summary = "Moves calls off retired code."): string =>
  JSON.stringify({
    schema: "delivery.pack/3",
    name,
    version: "1.0.0",
    title: "Moves",
    summary,
    workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
  });

/** The entry the add of the moves pack records. */
const MOVES_ENTRY: LockEntry = await entryFor(movesFiles(), { package: "@acme/moves", request: "^1.2.0" });

/** The contents of a delivery.pack/2 manifest named `name`. */
const v2Pack = (name: string): string =>
  JSON.stringify({ schema: "delivery.pack/2", name, version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } });

describe("delivery packs", () => {
  it("lists every pack with its plain sentence and the command that starts it", async () => {
    const { exitCode, stdout } = await delivery(["packs"], { cwd: initTempRepo("packs-", { "a.js": "x\n" }) });
    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("Packs you can use:");
    const [code, deprecations, security] = await builtInPacks();
    expect(lines.slice(1, 4)).toEqual([
      `  code          ${code?.manifest.summary} Start it with: delivery review code`,
      `  deprecations  ${deprecations?.manifest.summary} Start it with: delivery review deprecations`,
      `  security      ${security?.manifest.summary} Start it with: delivery review security`,
    ]);
    expect(lines.at(-3)).toBe("To use a pack folder of your own, list it under packs in delivery.config.json.");
    expect(lines.at(-1)).toBe("See exactly what a pack will do: delivery packs inspect <name>");
    expect(stdout).not.toMatch(/reviews? (are|is) available/i);
  });

  it("ends with how to see what a pack will do outside any repository too, and keeps it out of --json", async () => {
    const outside = await delivery(["packs"], { cwd: mkdtempSync(join(tmpdir(), "no-repo-hint-")) });
    expect(outside.stdout.trimEnd().split("\n").at(-1)).toBe(INSPECT_HINT);
    const json = await delivery(["packs", "--json"], { cwd: initTempRepo("packs-hint-json-", { "a.js": "x\n" }) });
    expect(json.stdout).not.toContain("packs inspect");
  });

  it("prints the pack format's JSON Schema with --schema, wherever it is asked", async () => {
    const { exitCode, stdout } = await delivery(["packs", "--schema"], { cwd: tmpdir() });
    expect(exitCode).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toEqual(packSchema());
  });

  it("lists the reviews as data with --json", async () => {
    const { exitCode, stdout } = await delivery(["packs", "--json"], { cwd: initTempRepo("packs-json-", { "a.js": "x\n" }) });
    expect(exitCode).toBe(EXIT.ok);
    const packs = await builtInPacks();
    expect(JSON.parse(stdout)).toEqual({ packs: packs.map(({ manifest }) => ({ name: manifest.name, version: manifest.version, title: manifest.title, summary: manifest.summary })) });
  });

  it("lists a pack the project lists beside the built-in ones, aligned, with its start command", async () => {
    const repo = initTempRepo("packs-listed-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": v3Pack("mymoves"),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stdout } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const [code, deprecations, security] = await builtInPacks();
    const lines = stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("Packs you can use:");
    expect(lines.slice(1, 5)).toEqual([
      `  code          ${code?.manifest.summary} Start it with: delivery review code`,
      `  deprecations  ${deprecations?.manifest.summary} Start it with: delivery review deprecations`,
      `  security      ${security?.manifest.summary} Start it with: delivery review security`,
      "  mymoves       Moves calls off retired code. Start it with: delivery review mymoves",
    ]);
  });

  it("ends a summary with a full stop before the start command when it has none", async () => {
    const repo = initTempRepo("packs-stop-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": v3Pack("mymoves", "Moves calls off retired code"),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stdout } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("  mymoves       Moves calls off retired code. Start it with: delivery review mymoves");
  });

  it("lists a listed pack with --json too", async () => {
    const repo = initTempRepo("packs-listed-json-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": v3Pack("mymoves"),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stdout } = await delivery(["packs", "--json"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const packs = JSON.parse(stdout).packs;
    expect(packs[packs.length - 1]).toEqual({ name: "mymoves", version: "1.0.0", title: "Moves", summary: "Moves calls off retired code." });
  });

  it("refuses a listed pack with a mistake, naming its file and field", async () => {
    const repo = initTempRepo("packs-mistake-", {
      "delivery.config.json": JSON.stringify({ packs: ["my-pack"] }),
      "my-pack/pack.json": JSON.stringify({
        schema: "delivery.pack/3",
        name: "mymoves",
        version: "1.0.0",
        title: "Moves",
        summary: "Moves calls off retired code.",
        workflows: { scan: { kind: "find", prompt: "scan.md" }, code: { kind: "act", prompt: "code.md" } },
      }),
      "my-pack/scan.md": "# Scan\n",
      "my-pack/code.md": "# Code\n",
    });
    const { exitCode, stderr } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(`${join(repo, "my-pack", "pack.json")}: "workflows.scan.ideasFor" is missing`);
  });

  it("refuses a project whose packs clash, by the existing sentence", async () => {
    const repo = initTempRepo("packs-clash-", {
      "delivery.config.json": JSON.stringify({ packs: ["a", "b"] }),
      "a/pack.json": v2Pack("mine"),
      "a/scan.md": "# Scan\n",
      "a/fix.md": "# Fix\n",
      "b/pack.json": v3Pack("mine"),
      "b/scan.md": "# Scan\n",
      "b/code.md": "# Code\n",
    });
    const { exitCode, stderr } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(
      packWorkflowClash("mine:scan", { kind: "folder", pack: "mine", manifestFile: join(repo, "a", "pack.json") }, { kind: "folder", pack: "mine", manifestFile: join(repo, "b", "pack.json") }),
    );
  });

  it("lists an added pack with its source and version, and says how to add one", async () => {
    const repo = initTempRepo("packs-added-", { "a.js": "x\n" });
    await installPack(repo, "moves", movesFiles(), MOVES_ENTRY);
    const { exitCode, stdout } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const width = Math.max(...(await builtInPacks()).map(({ manifest }) => manifest.name.length));
    const lines = stdout.trimEnd().split("\n");
    expect(lines).toContain(`  ${"moves".padEnd(width)}  Moves calls off retired code. From npm: @acme/moves 1.2.0. As approved. Start it with: delivery review moves`);
    expect(lines.at(-2)).toBe(ADD_HINT);
    expect(lines.at(-1)).toBe(INSPECT_HINT);
  });

  it("lists a changed added pack with its state and the command that fixes it, and exits 0", async () => {
    const repo = initTempRepo("packs-changed-", { "a.js": "x\n" });
    await installPack(repo, "moves", movesFiles(), MOVES_ENTRY);
    writeFileSync(join(repo, ".delivery", "packs", "moves", "scan.md"), "# Scan, changed\n");
    const { exitCode, stdout } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const width = Math.max(...(await builtInPacks()).map(({ manifest }) => manifest.name.length));
    expect(stdout.trimEnd().split("\n")).toContain(`  ${"moves".padEnd(width)}  From npm: @acme/moves 1.2.0. Changed since approved. Will not run. To fix: delivery packs restore moves`);
  });

  it("lists an unrecorded folder with the line that says so, and exits 0", async () => {
    const repo = initTempRepo("packs-unrecorded-", { "a.js": "x\n" });
    mkdirSync(join(repo, ".delivery", "packs", "stray"), { recursive: true });
    const { exitCode, stdout } = await delivery(["packs"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    const width = Math.max(...(await builtInPacks()).map(({ manifest }) => manifest.name.length));
    expect(stdout.trimEnd().split("\n")).toContain(`  ${"stray".padEnd(width)}  Not in the record. Will not run. Add it again, or remove .delivery/packs/stray`);
  });

  it("keeps --json strict: a changed added pack refuses with the configuration exit", async () => {
    const repo = initTempRepo("packs-changed-json-", { "a.js": "x\n" });
    await installPack(repo, "moves", movesFiles(), MOVES_ENTRY);
    writeFileSync(join(repo, ".delivery", "packs", "moves", "scan.md"), "# Scan, changed\n");
    const { exitCode } = await delivery(["packs", "--json"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("lists the built-in packs outside any repository", async () => {
    const { exitCode, stdout } = await delivery(["packs"], { cwd: mkdtempSync(join(tmpdir(), "no-repo-")) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Start it with: delivery review code");
  });
});
