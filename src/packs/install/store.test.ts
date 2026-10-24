import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "../../git-env.js";
import { initTempRepo } from "../../temp-repo.js";
import { packsLockPath, readLock, serialiseLock, type LockEntry } from "./lock.js";
import type { PackageFile } from "./package-archive.js";
import { installedPackDir, installedPacksDir, installPack, restorePackFolder, uninstallPack } from "./store.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const FILES: PackageFile[] = [
  { path: "pack.json", bytes: encode('{"schema":"delivery.pack/3"}\n') },
  { path: "prompts/scan.md", bytes: encode("# Scan\n") },
];

const ENTRY: LockEntry = {
  source: "npm",
  package: "@acme/moves",
  request: "^1.2.0",
  version: "1.2.0",
  integrity: "sha512-abc",
  fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
  approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
  files: { "pack.json": "a".repeat(64) },
};

/** A pack whose bytes are sensitive to line endings: one file with CRLF lines, one with LF. */
const CRLF_SCAN = "# Scan\r\nLine\r\n";
const LF_CODE = "# Code\nLine\n";
const LINE_FILES: PackageFile[] = [
  { path: "pack.json", bytes: encode('{"schema":"delivery.pack/3"}\n') },
  { path: "scan.md", bytes: encode(CRLF_SCAN) },
  { path: "code.md", bytes: encode(LF_CODE) },
];

/** Run git in `cwd` with no hook, and return what it prints. */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, stdio: "pipe", encoding: "utf-8", env: cleanGitEnv() });
}

/** A fresh clone of `repo`, made with the git config flags `config` gives. */
function cloneOf(repo: string, config: string[]): string {
  const dest = join(mkdtempSync(join(tmpdir(), "store-clone-")), "clone");
  git(repo, [...config, "clone", repo, dest]);
  return dest;
}

/** Whether git would ignore `path` in `repo`: `check-ignore -q` exits 0 when it does and 1 when it does not. */
function ignored(repo: string, path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: repo, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

describe("installPack", () => {
  it("puts the pack in .delivery/packs/<name> and then its record entry", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, ENTRY);
    for (const file of FILES) {
      expect(readFileSync(join(installedPackDir(repo, "moves"), file.path))).toEqual(Buffer.from(file.bytes));
    }
    expect((await readLock(repo)).packs.moves).toEqual(ENTRY);
    expect(readdirSync(join(installedPacksDir(repo), ".staging"))).toEqual([]);
  });

  it("replaces a folder an interrupted add left behind", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    const stale = installedPackDir(repo, "moves");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "stray.txt"), "left behind\n");
    await installPack(repo, "moves", FILES, ENTRY);
    expect(existsSync(join(stale, "stray.txt"))).toBe(false);
    expect(readFileSync(join(stale, "pack.json"))).toEqual(Buffer.from(FILES[0]?.bytes ?? []));
  });

  it("rewrites an old .delivery ignore rule so the pack and its record are not ignored", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    mkdirSync(join(repo, ".delivery"), { recursive: true });
    writeFileSync(join(repo, ".delivery", ".gitignore"), "*\n!backlog/\n!backlog/**\n");
    await installPack(repo, "moves", FILES, ENTRY);
    expect(ignored(repo, ".delivery/packs/moves/pack.json")).toBe(false);
    expect(ignored(repo, ".delivery/packs.lock.json")).toBe(false);
  });

  it("keeps a pack's bytes as they are through a commit and a clone", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    await installPack(repo, "moves", LINE_FILES, ENTRY);
    git(repo, ["-c", "core.autocrlf=input", "add", "-A"]);
    git(repo, ["-c", "core.autocrlf=input", "commit", "-m", "add pack"]);
    const plain = cloneOf(repo, []);
    const checkedOut = cloneOf(repo, ["-c", "core.autocrlf=true"]);
    for (const clone of [plain, checkedOut]) {
      for (const file of LINE_FILES) {
        expect(readFileSync(join(clone, ".delivery", "packs", "moves", file.path))).toEqual(Buffer.from(file.bytes));
      }
    }
    expect(git(repo, ["check-attr", "text", "--", ".delivery/packs/moves/scan.md"]).trim()).toBe(".delivery/packs/moves/scan.md: text: unset");
  });

  it("removes what an interrupted add left in staging", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    const staging = join(installedPacksDir(repo), ".staging");
    mkdirSync(join(staging, "abc"), { recursive: true });
    writeFileSync(join(staging, "abc", "pack.json"), "{}\n");
    mkdirSync(join(staging, "abc-old"), { recursive: true });
    writeFileSync(join(staging, "abc-old", "x"), "x\n");
    await installPack(repo, "moves", FILES, ENTRY);
    expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
  });

  it("puts a pack's files back without writing its record", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    await installPack(repo, "moves", LINE_FILES, ENTRY);
    writeFileSync(packsLockPath(repo), "known\n");
    rmSync(join(installedPackDir(repo, "moves"), "scan.md"));
    await restorePackFolder(repo, "moves", LINE_FILES);
    expect(readFileSync(join(installedPackDir(repo, "moves"), "scan.md"))).toEqual(Buffer.from(encode(CRLF_SCAN)));
    expect(readFileSync(packsLockPath(repo), "utf-8")).toBe("known\n");
  });
});

describe("uninstallPack", () => {
  it("deletes the pack's folder and its record entry, keeping every other entry byte for byte", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, ENTRY);
    await installPack(repo, "other", FILES, { ...ENTRY, package: "@acme/other" });
    await uninstallPack(repo, "moves");
    expect(existsSync(installedPackDir(repo, "moves"))).toBe(false);
    expect(Object.keys((await readLock(repo)).packs)).toEqual(["other"]);
    expect(readFileSync(packsLockPath(repo), "utf-8")).toBe(serialiseLock({ schema: "delivery.packs-lock/1", packs: { other: { ...ENTRY, package: "@acme/other" } } }));
  });

  it("completes a remove whose folder is already gone", async () => {
    const repo = initTempRepo("store-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, ENTRY);
    rmSync(installedPackDir(repo, "moves"), { recursive: true });
    await uninstallPack(repo, "moves");
    expect((await readLock(repo)).packs).toEqual({});
  });
});
