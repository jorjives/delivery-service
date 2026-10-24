import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initTempRepo } from "../../temp-repo.js";
import { readLock, type LockEntry } from "./lock.js";
import type { PackageFile } from "./package-archive.js";
import { installedPackDir, installedPacksDir, installPack } from "./store.js";

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
};

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
});
