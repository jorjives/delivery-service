import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOVES_FILES } from "../cli/command-fixtures.js";
import { BUILT_IN_PACKS, DATA_ONLY, IS_A_FOLDER, loadPack } from "./manifest.js";
import {
  FOLDER_NOT_IN_A_PACK,
  IS_A_LINK,
  NOT_A_FOLDER,
  NOT_IN_A_PACK,
  NOT_PLAIN,
  NO_FOLDER,
  NO_MANIFEST,
  UNUSED_INSTRUCTIONS,
  readPackFolder,
} from "./pack-folder.js";

const movesManifest = JSON.parse(MOVES_FILES["moves-pack/pack.json"]);

/** A fresh pack folder holding `files`, whose names are relative to the folder itself (the `moves-pack/` prefix is dropped). */
function packFolder(files: Record<string, string> = MOVES_FILES): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-folder-"));
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name.replace(/^moves-pack\//, ""));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

describe("readPackFolder", () => {
  it("refuses a linked prompt, and never reads through it", async () => {
    const dir = packFolder();
    const outside = join(mkdtempSync(join(tmpdir(), "outside-")), "secret.md");
    writeFileSync(outside, "SECRET WORDS\n");
    rmSync(join(dir, "code.md"));
    symlinkSync(outside, join(dir, "code.md"));
    const read = await readPackFolder(dir);
    expect(read).toEqual({ ok: false, problems: [{ file: join(dir, "code.md"), field: null, message: IS_A_LINK }] });
    expect(JSON.stringify(read)).not.toContain("SECRET");
  });

  it("refuses a linked pack.json", async () => {
    const dir = packFolder();
    const outside = join(mkdtempSync(join(tmpdir(), "outside-")), "pack.json");
    writeFileSync(outside, readFileSync(join(dir, "pack.json"), "utf8"));
    rmSync(join(dir, "pack.json"));
    symlinkSync(outside, join(dir, "pack.json"));
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "pack.json"), field: null, message: IS_A_LINK }] });
  });

  it("refuses a linked folder once and lists nothing inside it", async () => {
    const dir = packFolder();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outside, "a.js"), "console.log('outside')\n");
    mkdirSync(join(dir, "fixtures", "project"), { recursive: true });
    symlinkSync(outside, join(dir, "fixtures", "project", "lib"), "dir");
    const read = await readPackFolder(dir);
    expect(read).toEqual({ ok: false, problems: [{ file: join(dir, "fixtures", "project", "lib"), field: null, message: IS_A_LINK }] });
    expect(JSON.stringify(read)).not.toContain("a.js");
  });

  it("ignores links inside the top-level .git folder, which is never walked", async () => {
    const dir = packFolder();
    const outside = join(mkdtempSync(join(tmpdir(), "outside-")), "hook");
    writeFileSync(outside, "#!/bin/sh\n");
    mkdirSync(join(dir, ".git"));
    symlinkSync(outside, join(dir, ".git", "hook"));
    expect(await readPackFolder(dir)).toEqual({
      ok: true,
      pack: expect.objectContaining({ dir }),
      files: [
        { path: ".git/", role: "housekeeping" },
        { path: "code.md", role: "prompt" },
        { path: "look.md", role: "prompt" },
        { path: "pack.json", role: "manifest" },
        { path: "tests.md", role: "prompt" },
      ],
    });
  });

  it.skipIf(process.platform === "win32")("refuses a named pipe without blocking", async () => {
    const dir = packFolder();
    const pipe = join(dir, "stream");
    expect(spawnSync("mkfifo", [pipe]).status).toBe(0);
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file: pipe, field: null, message: NOT_PLAIN }] });
  });

  it("says plainly when the folder is not there, is a file, or has no pack.json", async () => {
    expect(await readPackFolder(join(tmpdir(), "no-such-pack-xyz"))).toEqual({ ok: false, problems: [{ file: expect.any(String), field: null, message: NO_FOLDER }] });

    const file = join(mkdtempSync(join(tmpdir(), "pack-folder-")), "not-a-folder.md");
    writeFileSync(file, "# Not a pack\n");
    expect(await readPackFolder(file)).toEqual({ ok: false, problems: [{ file, field: null, message: NOT_A_FOLDER }] });

    const empty = packFolder({ "README.md": "# Readme\n", "install.sh": "#!/bin/sh\n" });
    expect(await readPackFolder(empty)).toEqual({ ok: false, problems: [{ file: join(empty, "pack.json"), field: null, message: NO_MANIFEST }] });
  });

  it("refuses a top-level link with only the folder problem, though the manifest has an unknown key", async () => {
    const dir = packFolder();
    const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    writeFileSync(join(dir, "pack.json"), JSON.stringify({ ...manifest, unknownKey: true }));
    const outside = join(mkdtempSync(join(tmpdir(), "outside-")), "code.md");
    writeFileSync(outside, "# Outside\n");
    rmSync(join(dir, "code.md"));
    symlinkSync(outside, join(dir, "code.md"));
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "code.md"), field: null, message: IS_A_LINK }] });
  });

  it.each([
    ["install.sh", NOT_IN_A_PACK],
    ["hooks/pre-run", FOLDER_NOT_IN_A_PACK],
    [".env", NOT_IN_A_PACK],
    ["extra.md", UNUSED_INSTRUCTIONS],
    ["README.sh", NOT_IN_A_PACK],
    ["fixtures/run.sh", NOT_IN_A_PACK],
  ])("refuses %s, naming it and why", async (path, message) => {
    const dir = packFolder({ ...MOVES_FILES, [path]: "x\n" });
    const file = join(dir, path.startsWith("hooks/") ? "hooks" : path);
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file, field: null, message }] });
  });

  it("accepts documentation and housekeeping, in any case, and lists every file with its role", async () => {
    const dir = packFolder({
      ...MOVES_FILES,
      "README.md": "r",
      "licence.txt": "l",
      CHANGELOG: "c",
      ".gitignore": "",
      ".gitattributes": "",
      ".DS_Store": "",
      "fixtures/.DS_Store": "",
      "fixtures/project/a.js": "x",
      "fixtures/expect.json": "{}",
    });
    mkdirSync(join(dir, ".git", "objects"), { recursive: true });
    const read = await readPackFolder(dir);
    expect(read.ok && read.files).toEqual([
      { path: ".DS_Store", role: "housekeeping" }, { path: ".git/", role: "housekeeping" }, { path: ".gitattributes", role: "housekeeping" },
      { path: ".gitignore", role: "housekeeping" }, { path: "CHANGELOG", role: "documentation" }, { path: "README.md", role: "documentation" },
      { path: "code.md", role: "prompt" }, { path: "fixtures/.DS_Store", role: "housekeeping" }, { path: "fixtures/expect.json", role: "fixture" },
      { path: "fixtures/project/a.js", role: "fixture" }, { path: "licence.txt", role: "documentation" }, { path: "look.md", role: "prompt" },
      { path: "pack.json", role: "manifest" }, { path: "tests.md", role: "prompt" },
    ]);
  });

  it("shows a manifest problem beside the folder problems, all at once, each by file", async () => {
    const dir = packFolder({ "install.sh": "x", "pack.json": JSON.stringify({ ...movesManifest, tools: [] }) });
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [
      { file: join(dir, "install.sh"), field: null, message: NOT_IN_A_PACK },
      { file: join(dir, "pack.json"), field: "tools", message: expect.stringContaining(DATA_ONLY) },
    ] });
  });

  it("judges no .md file when the manifest could not be read", async () => {
    const dir = packFolder({ "pack.json": "{", "extra.md": "x\n" });
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "pack.json"), field: null, message: "is not valid JSON" }] });
  });

  it("gives a folder named as a prompt one problem, the loader's", async () => {
    const dir = packFolder();
    rmSync(join(dir, "tests.md"));
    mkdirSync(join(dir, "tests.md"));
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "tests.md"), field: null, message: IS_A_FOLDER }] });
  });

  it("refuses a stray .sh in a delivery.pack/2 folder, though loadPack still reads it", async () => {
    const dir = packFolder({
      "pack.json": JSON.stringify({ schema: "delivery.pack/2", name: "mine", version: "1.0.0", title: "Mine", summary: "Mine.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } }),
      "scan.md": "# Scan\n",
      "fix.md": "# Fix\n",
      "run.sh": "#!/bin/sh\n",
    });
    expect(await readPackFolder(dir)).toEqual({ ok: false, problems: [{ file: join(dir, "run.sh"), field: null, message: NOT_IN_A_PACK }] });
    await expect(loadPack(dir)).resolves.toMatchObject({ dir });
  });

  it("finds every built-in pack folder holds only what a pack names", async () => {
    for (const folder of readdirSync(BUILT_IN_PACKS)) expect((await readPackFolder(join(BUILT_IN_PACKS, folder))).ok).toBe(true);
  });
});
