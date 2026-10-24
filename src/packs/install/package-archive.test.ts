import { describe, expect, it } from "vitest";
import { ARCHIVE_CAPS, BAD_PACK_FIELD, BAD_PATH, FILE_AND_FOLDER, GIT_FOLDER, NO_PACK_FIELD, NOT_AN_ARCHIVE, NOT_PLAIN_ENTRY, SAME_NAME, TOO_MANY, noPackThere, over, readPackage } from "./package-archive.js";
import { packageTarball, tarballOf, type TarEntry } from "./tarball.js";

/** A minimal delivery.pack/3 pack's manifest, as the pack.json text a package carries. */
const v3 = {
  manifest: JSON.stringify({
    schema: "delivery.pack/3",
    name: "mine",
    version: "1.0.0",
    title: "Mine",
    summary: "Mine.",
    workflows: {
      scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] },
      code: { kind: "act", summary: "Code that calls it.", prompt: "code.md" },
    },
  }),
};

const packageJson = { name: "x", version: "1.0.0", "delivery-pack": "pack" };
const packageJsonEntry = (fields: Record<string, unknown> = packageJson) => ({ path: "package/package.json", body: JSON.stringify(fields) });

describe("readPackage", () => {
  it("keeps the pack folder named by delivery-pack, relative to it, and lists the rest as not kept", async () => {
    const read = await readPackage(packageTarball({ "pack/pack.json": v3.manifest, "pack/scan.md": "# Scan\n", "pack/code.md": "# Code\n", "README.md": "hi\n", "index.js": "x" }, { name: "@acme/docs", version: "1.0.0", "delivery-pack": "pack", scripts: { postinstall: "node x" } }));
    expect(read).toMatchObject({ ok: true, packPath: "pack", declares: ["scripts"] });
    if (!read.ok) throw new Error("not read");
    expect(read.packFiles.map((f) => f.path)).toEqual(["code.md", "pack.json", "scan.md"]);
    expect(read.ignored.map((f) => f.path)).toEqual(["README.md", "index.js", "package.json"]);
  });

  it.each(["./pack", "pack/", "./pack/"])("reads a delivery-pack field written %s as the folder pack", async (field) => {
    const read = await readPackage(packageTarball({ "pack/pack.json": v3.manifest, "pack/scan.md": "# Scan\n", "pack/code.md": "# Code\n" }, { name: "x", version: "1.0.0", "delivery-pack": field }));
    expect(read).toMatchObject({ ok: true, packPath: "pack" });
    if (!read.ok) throw new Error("not read");
    expect(read.packFiles.map((f) => f.path)).toEqual(["code.md", "pack.json", "scan.md"]);
  });

  it('reads delivery-pack "." as the package root, without keeping package.json', async () => {
    const read = await readPackage(packageTarball({ "pack.json": v3.manifest, "scan.md": "# Scan\n", "code.md": "# Code\n" }, { name: "x", version: "1.0.0", "delivery-pack": "." }));
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("not read");
    expect(read.packFiles.map((f) => f.path)).toEqual(["code.md", "pack.json", "scan.md"]);
    expect(read.ignored.map((f) => f.path)).toEqual(["package.json"]);
  });

  it("refuses a package with no delivery-pack field", async () => expect(await readPackage(packageTarball({ "pack.json": "{}" }, { name: "x", version: "1.0.0" }))).toEqual({ ok: false, problem: { entry: null, message: NO_PACK_FIELD } }));

  it("refuses a delivery-pack folder with no pack.json in it", async () => {
    expect(await readPackage(packageTarball({ "README.md": "hi\n" }, { name: "x", version: "1.0.0", "delivery-pack": "pack" }))).toEqual({ ok: false, problem: { entry: null, message: noPackThere("pack") } });
  });

  it.each(["../up", "/abs", "a\\b"])("refuses delivery-pack %s", async (field) => {
    expect(await readPackage(packageTarball({ "pack.json": v3.manifest }, { name: "x", version: "1.0.0", "delivery-pack": field }))).toEqual({ ok: false, problem: { entry: null, message: BAD_PACK_FIELD } });
  });

  it.each([
    [{ path: "package/link", type: "SymbolicLink", linkpath: "/etc/passwd" }, "link", NOT_PLAIN_ENTRY],
    [{ path: "package/hard", type: "Link", linkpath: "package/pack.json" }, "hard", NOT_PLAIN_ENTRY],
    [{ path: "package/fifo", type: "FIFO" }, "fifo", NOT_PLAIN_ENTRY],
    [{ path: "package/../evil" }, "../evil", BAD_PATH],
    [{ path: "/etc/evil" }, "/etc/evil", BAD_PATH],
    [{ path: "package/a\\b" }, "a\\b", BAD_PATH],
    [{ path: "package/./a" }, "./a", BAD_PATH],
    [{ path: "other/a" }, "other/a", BAD_PATH],
  ])("refuses the whole package for the entry %o, naming it", async (bad, entry, message) => {
    const read = await readPackage(tarballOf([packageJsonEntry(), bad as TarEntry]));
    expect(read).toEqual({ ok: false, problem: { entry, message } });
  });

  it("refuses two files whose names differ only in case", async () => {
    const read = await readPackage(tarballOf([packageJsonEntry(), { path: "package/pack/A.md", body: "# A\n" }, { path: "package/pack/a.md", body: "# a\n" }]));
    expect(read).toEqual({ ok: false, problem: { entry: "pack/a.md", message: SAME_NAME } });
  });

  it.each(["package/pack/.git/config", "package/pack/fixtures/project/.GIT/hooks/pre-commit"])("refuses %s as a repository inside the package", async (path) => {
    const read = await readPackage(tarballOf([packageJsonEntry(), { path, body: "x" }]));
    expect(read).toEqual({ ok: false, problem: { entry: path.slice("package/".length), message: GIT_FOLDER } });
  });

  it("refuses a path that is both a file and a folder", async () => {
    const read = await readPackage(tarballOf([packageJsonEntry(), { path: "package/pack/a", body: "x" }, { path: "package/pack/a/b", body: "y" }]));
    expect(read).toEqual({ ok: false, problem: { entry: "pack/a/b", message: FILE_AND_FOLDER } });
  });

  it("does not keep a .gitignore or .gitattributes, at any level, and lists it as not kept", async () => {
    const read = await readPackage(packageTarball({ "pack/pack.json": v3.manifest, "pack/scan.md": "# Scan\n", "pack/.gitignore": "*.log\n", "pack/fixtures/project/.gitattributes": "* text=auto\n" }, packageJson));
    if (!read.ok) throw new Error("not read");
    expect(read.packFiles.map((f) => f.path)).toEqual(["pack.json", "scan.md"]);
    expect(read.ignored.map((f) => f.path)).toEqual(expect.arrayContaining(["pack/.gitignore", "pack/fixtures/project/.gitattributes"]));
  });

  it("refuses at each cap and accepts at it", async () => {
    const pack = { "pack/pack.json": v3.manifest };
    const many = (count: number) => Object.fromEntries(Array.from({ length: count - 2 }, (_, i) => [`pack/f${i}.md`, "x"]));

    // package.json and pack.json are two of the entries, so `many(n)` (n - 2 prompt files) makes n entries in all.
    const atCap = await readPackage(packageTarball({ ...pack, ...many(ARCHIVE_CAPS.entries) }, packageJson));
    expect(atCap.ok).toBe(true);
    const overCap = await readPackage(packageTarball({ ...pack, ...many(ARCHIVE_CAPS.entries + 1) }, packageJson));
    expect(overCap).toEqual({ ok: false, problem: { entry: null, message: TOO_MANY } });

    const pjAt = JSON.stringify({ ...packageJson, description: "a".repeat(ARCHIVE_CAPS.packageJson - JSON.stringify({ ...packageJson, description: "" }).length) });
    expect(pjAt.length).toBe(ARCHIVE_CAPS.packageJson);
    expect((await readPackage(tarballOf([{ path: "package/package.json", body: pjAt }, { path: "package/pack/pack.json", body: v3.manifest }]))).ok).toBe(true);
    const pjOver = pjAt.replace(/"description":"a/, '"description":"aa');
    expect(await readPackage(tarballOf([{ path: "package/package.json", body: pjOver }, { path: "package/pack/pack.json", body: v3.manifest }]))).toEqual({ ok: false, problem: { entry: "package.json", message: over("package.json", ARCHIVE_CAPS.packageJson) } });

    const fileAt = await readPackage(tarballOf([packageJsonEntry(), { path: "package/pack/pack.json", body: v3.manifest }, { path: "package/pack/big.md", body: "a".repeat(ARCHIVE_CAPS.keptFile) }]));
    expect(fileAt.ok).toBe(true);
    const fileOver = await readPackage(tarballOf([packageJsonEntry(), { path: "package/pack/pack.json", body: v3.manifest }, { path: "package/pack/big.md", body: "a".repeat(ARCHIVE_CAPS.keptFile + 1) }]));
    expect(fileOver).toEqual({ ok: false, problem: { entry: "pack/big.md", message: over("one file", ARCHIVE_CAPS.keptFile) } });
  });

  it("stops a compression bomb before it is expanded", async () => {
    const bomb = tarballOf([packageJsonEntry(), { path: "package/pack/zeros.bin", body: new Uint8Array(21 * 2 ** 20) }]);
    expect(await readPackage(bomb)).toEqual({ ok: false, problem: { entry: null, message: over("a package once expanded", ARCHIVE_CAPS.expanded) } });
  });

  it("refuses bytes that are not a gzip tarball", async () => expect(await readPackage(new TextEncoder().encode("not a tarball"))).toEqual({ ok: false, problem: { entry: null, message: NOT_AN_ARCHIVE } }));
});
