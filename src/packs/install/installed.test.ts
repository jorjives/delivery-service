import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InstalledPackRefused } from "../../errors.js";
import { initTempRepo } from "../../temp-repo.js";
import { NOT_IN_A_PACK } from "../pack-folder.js";
import { entryFor } from "./install-fixtures.js";
import type { PackageFile } from "./package-archive.js";
import { checkInstalledPack, installedPacks, readInstalledPacks } from "./installed.js";
import { newerFormat } from "../manifest.js";
import { installPack, installedPackDir } from "./store.js";

// Loading added packs reads local files only: while `forbid` is set, starting a process is an error.
const wiring = vi.hoisted(() => ({ forbid: false }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const spied = (name: string, original: unknown) => (...args: unknown[]) => {
    if (!wiring.forbid) return (original as (...rest: unknown[]) => unknown)(...args);
    throw new Error(`${name}: spawned`);
  };
  // `git-exec.ts` promisifies execFile, so the stand-in keeps the promisified form and still refuses while forbidden.
  const execFile = spied("execFile", real.execFile) as ((...args: unknown[]) => unknown) & Record<symbol, unknown>;
  Object.defineProperty(execFile, promisify.custom, {
    value: (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        execFile(...args, (err: Error | null, stdout: string, stderr: string) => (err ? reject(err) : resolve({ stdout, stderr })));
      }),
  });
  return {
    ...real,
    spawn: spied("spawn", real.spawn),
    spawnSync: spied("spawnSync", real.spawnSync),
    exec: spied("exec", real.exec),
    execFile,
    execFileSync: spied("execFileSync", real.execFileSync),
    fork: spied("fork", real.fork),
  };
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A valid pack's files, with its manifest named `name`. */
const filesNamed = (name: string): PackageFile[] => [
  {
    path: "pack.json",
    bytes: encode(
      JSON.stringify({
        schema: "delivery.pack/3",
        name,
        version: "1.2.0",
        title: "Moves",
        summary: "Moves calls off retired code.",
        workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
      }),
    ),
  },
  { path: "scan.md", bytes: encode("# Scan\n") },
  { path: "code.md", bytes: encode("# Code\n") },
];

const FILES = filesNamed("moves");

describe("readInstalledPacks", () => {
  it("is ok when the folder matches the record", async () => {
    const repo = initTempRepo("installed-ok-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, await entryFor(FILES));
    const installed = await readInstalledPacks(repo);
    expect(installed.map(({ name, state }) => ({ name, state }))).toEqual([{ name: "moves", state: "ok" }]);
    const [only] = installed;
    expect(only?.state === "ok" && only.pack.manifest.name).toBe("moves");
    expect(only?.state === "ok" && only.pack.origin).toEqual({
      kind: "installed",
      package: "@acme/delivery-pack-docs",
      version: "1.2.0",
      request: "latest",
      integrity: expect.stringMatching(/^sha512-/),
    });
  });

  it("is changed when one character of an instruction changes, naming the file", async () => {
    const repo = initTempRepo("installed-changed-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, await entryFor(FILES));
    await writeFile(join(installedPackDir(repo, "moves"), "scan.md"), "# Scat\n");
    expect(await readInstalledPacks(repo)).toEqual([expect.objectContaining({ name: "moves", state: "changed", changed: ["scan.md"] })]);
  });

  it("is invalid when an instruction file is deleted, naming it", async () => {
    const repo = initTempRepo("installed-deleted-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, await entryFor(FILES));
    await rm(join(installedPackDir(repo, "moves"), "code.md"));
    const [only] = await readInstalledPacks(repo);
    expect(only?.state).toBe("invalid");
    const problems = only?.state === "invalid" ? only.problems : [];
    expect(problems).toContainEqual(expect.objectContaining({ file: expect.stringMatching(/\/moves\/code\.md$/), message: "is missing" }));
  });

  it("is invalid when a stray file is added, naming it", async () => {
    const repo = initTempRepo("installed-stray-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, await entryFor(FILES));
    await writeFile(join(installedPackDir(repo, "moves"), "install.sh"), "echo hi\n");
    const [only] = await readInstalledPacks(repo);
    expect(only?.state).toBe("invalid");
    const problems = only?.state === "invalid" ? only.problems : [];
    expect(problems).toContainEqual(expect.objectContaining({ file: expect.stringMatching(/\/moves\/install\.sh$/), message: NOT_IN_A_PACK }));
  });

  it("is missing when the record names it and the folder is gone", async () => {
    const repo = initTempRepo("installed-missing-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, await entryFor(FILES));
    await rm(installedPackDir(repo, "moves"), { recursive: true, force: true });
    expect(await readInstalledPacks(repo)).toEqual([expect.objectContaining({ name: "moves", state: "missing" })]);
  });

  it("is unapproved when the record's approval differs from its fingerprint", async () => {
    const repo = initTempRepo("installed-unapproved-", { "README.md": "x\n" });
    const entry = { ...(await entryFor(FILES)), approved: `delivery.pack-hash/1:${"b".repeat(64)}` };
    await installPack(repo, "moves", FILES, entry);
    expect(await readInstalledPacks(repo)).toEqual([expect.objectContaining({ name: "moves", state: "unapproved" })]);
  });

  it("is invalid when the record key is not the pack's name", async () => {
    const repo = initTempRepo("installed-key-", { "README.md": "x\n" });
    await installPack(repo, "other", FILES, await entryFor(FILES));
    const [only] = await readInstalledPacks(repo);
    expect(only).toEqual({
      name: "other",
      state: "invalid",
      entry: expect.objectContaining({ package: "@acme/delivery-pack-docs" }),
      problems: [
        {
          file: join(installedPackDir(repo, "other"), "pack.json"),
          field: "name",
          message: '"name" is "moves", but the record keeps this pack as other',
        },
      ],
    });
  });

  it("names a kept pack whose manifest declares a newer format as newer-format, not invalid", async () => {
    const repo = initTempRepo("installed-newer-", { "README.md": "x\n" });
    const entry = await entryFor(FILES);
    await installPack(repo, "moves", FILES, entry);
    const manifestFile = join(installedPackDir(repo, "moves"), "pack.json");
    await writeFile(manifestFile, (await readFile(manifestFile, "utf-8")).replace("delivery.pack/3", "delivery.pack/4"));
    const state = await checkInstalledPack(repo, "moves", entry);
    expect(state.state).toBe("newer-format");
    expect(state).toMatchObject({ problems: [{ field: "schema", message: newerFormat("delivery.pack/4") }] });
  });

  it("is unrecorded for a kept folder with no record entry, and ignores staging", async () => {
    const repo = initTempRepo("installed-unrecorded-", { "README.md": "x\n" });
    await mkdir(join(repo, ".delivery", "packs", "stray"), { recursive: true });
    await mkdir(join(repo, ".delivery", "packs", ".staging", "abc"), { recursive: true });
    expect(await readInstalledPacks(repo)).toEqual([{ name: "stray", state: "unrecorded" }]);
  });

  it("reads only local files, over one pack in each state", async () => {
    const repo = initTempRepo("installed-local-", { "README.md": "x\n" });
    for (const name of ["moves", "bent", "gone", "broken", "waiting"]) await installPack(repo, name, filesNamed(name), await entryFor(filesNamed(name)));
    await writeFile(join(installedPackDir(repo, "bent"), "scan.md"), "# Scat\n");
    await rm(installedPackDir(repo, "gone"), { recursive: true, force: true });
    await rm(join(installedPackDir(repo, "broken"), "code.md"));
    await installPack(repo, "waiting", filesNamed("waiting"), { ...(await entryFor(filesNamed("waiting"))), approved: `delivery.pack-hash/1:${"b".repeat(64)}` });
    await mkdir(join(repo, ".delivery", "packs", "stray"), { recursive: true });
    wiring.forbid = true;
    try {
      const installed = await readInstalledPacks(repo);
      expect(installed.map(({ name, state }) => [name, state])).toEqual([
        ["bent", "changed"],
        ["broken", "invalid"],
        ["gone", "missing"],
        ["moves", "ok"],
        ["stray", "unrecorded"],
        ["waiting", "unapproved"],
      ]);
    } finally {
      wiring.forbid = false;
    }
  });

  it("finds nothing in a project that added nothing", async () => {
    const repo = initTempRepo("installed-none-", { "README.md": "x\n" });
    expect(await readInstalledPacks(repo)).toEqual([]);
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
  });
});

describe("refuseUnusable through installedPacks", () => {
  it("refuses every unusable pack at once, in name order", async () => {
    const repo = initTempRepo("installed-refuse-", { "README.md": "x\n" });
    for (const name of ["b", "a"]) await installPack(repo, name, filesNamed(name), await entryFor(filesNamed(name)));
    for (const name of ["a", "b"]) await writeFile(join(installedPackDir(repo, name), "scan.md"), "# Scat\n");
    const error: unknown = await installedPacks(repo).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(InstalledPackRefused);
    expect((error as InstalledPackRefused).refused.map((pack) => pack.name)).toEqual(["a", "b"]);
  });

  it("returns the usable packs with their npm origin", async () => {
    const repo = initTempRepo("installed-usable-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, await entryFor(FILES));
    const packs = await installedPacks(repo);
    expect(packs.map(({ manifest }) => manifest.name)).toEqual(["moves"]);
    expect(packs[0]?.origin.kind).toBe("installed");
  });
});
