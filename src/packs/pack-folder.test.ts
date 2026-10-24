import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOVES_FILES } from "../cli/command-fixtures.js";
import { IS_A_LINK, NOT_A_FOLDER, NOT_PLAIN, NO_FOLDER, NO_MANIFEST, readPackFolder } from "./pack-folder.js";

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
    expect(await readPackFolder(dir)).toEqual({ ok: true, pack: expect.objectContaining({ dir }), files: [] });
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
});
