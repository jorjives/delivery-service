import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { initTempRepo } from "../../temp-repo.js";
import type { LockEntry } from "./lock.js";
import type { PackageFile } from "./package-archive.js";
import { installedPacks } from "./installed.js";
import { installPack } from "./store.js";

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

const FILES: PackageFile[] = [
  {
    path: "pack.json",
    bytes: encode(
      JSON.stringify({
        schema: "delivery.pack/3",
        name: "moves",
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

const ENTRY: LockEntry = {
  source: "npm",
  package: "@acme/moves",
  request: "^1.2.0",
  version: "1.2.0",
  integrity: "sha512-abc",
  fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
  approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
};

describe("installedPacks", () => {
  it("loads each added pack from its folder with its npm origin, and none when nothing was added", async () => {
    const repo = initTempRepo("installed-", { "README.md": "x\n" });
    expect(await installedPacks(repo)).toEqual([]);
    await installPack(repo, "moves", FILES, ENTRY);
    const packs = await installedPacks(repo);
    expect(packs).toHaveLength(1);
    expect(packs[0]?.manifest.name).toBe("moves");
    expect(packs[0]?.origin).toEqual({
      kind: "installed",
      package: "@acme/moves",
      version: "1.2.0",
      request: "^1.2.0",
      integrity: "sha512-abc",
    });
  });

  it("reads only local files", async () => {
    const repo = initTempRepo("installed-local-", { "README.md": "x\n" });
    await installPack(repo, "moves", FILES, ENTRY);
    wiring.forbid = true;
    try {
      const packs = await installedPacks(repo);
      expect(packs.map(({ manifest }) => manifest.name)).toEqual(["moves"]);
    } finally {
      wiring.forbid = false;
    }
  });
});
