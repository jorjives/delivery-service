import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entryFor } from "../packs/install/install-fixtures.js";
import { packsLockPath, type LockEntry } from "../packs/install/lock.js";
import { readInstalledPacks } from "../packs/install/installed.js";
import type { PackageFile } from "../packs/install/package-archive.js";
import { installPack } from "../packs/install/store.js";
import { builtInPacks } from "../packs/manifest.js";
import { publishedKeys } from "../report/json-schema.js";
import { initTempRepo } from "../temp-repo.js";
import { PACKS_LISTING_SCHEMA, packsListing, packsListingSchema } from "./packs-listing.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The files of a delivery.pack/3 pack named `moves`, as `delivery packs add` would keep them. */
const movesFiles = (): PackageFile[] => [
  { path: "pack.json", bytes: encode(movesManifest) },
  { path: "scan.md", bytes: encode("# Scan\n") },
  { path: "code.md", bytes: encode("# Code\n") },
];

const movesManifest = JSON.stringify({
  schema: "delivery.pack/3",
  name: "moves",
  version: "1.0.0",
  title: "Moves",
  summary: "Moves calls off retired code.",
  workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
});

/** The entry the add of the moves pack records. */
const MOVES_ENTRY: LockEntry = await entryFor(movesFiles(), { package: "@acme/moves", request: "^1.2.0" });

/** A repository with the moves pack added and approved. */
async function repoWithMoves(): Promise<string> {
  const repo = initTempRepo("packs-listing-", { "a.js": "x\n" });
  await installPack(repo, "moves", movesFiles(), MOVES_ENTRY);
  return repo;
}

describe("the listing", () => {
  it("gives the built-in packs first, with no state", async () => {
    const listing = packsListing(await builtInPacks(), []);
    expect(listing.schema).toBe(PACKS_LISTING_SCHEMA);
    const expected = (await builtInPacks()).map(({ manifest }) => ({
      name: manifest.name,
      version: manifest.version,
      title: manifest.title,
      summary: manifest.summary,
      source: { kind: "built-in", package: null },
      state: null,
    }));
    expect(listing.packs).toEqual(expected);
    expect(listing.packs.slice(0, 3).map(({ name }) => name)).toEqual(["code", "deprecations", "security"]);
  });

  it("gives each added pack with its package, version and state, after the built-in packs", async () => {
    const repo = await repoWithMoves();
    const installed = await readInstalledPacks(repo);
    const listing = packsListing(await builtInPacks(), installed);
    expect(listing.packs.at(-1)).toEqual({
      name: "moves",
      version: "1.0.0",
      title: "Moves",
      summary: "Moves calls off retired code.",
      source: { kind: "installed", package: { name: "@acme/moves", version: "1.2.0" } },
      state: "ok",
    });
  });

  it("gives a changed added pack its package and state, with no manifest fields", async () => {
    const repo = await repoWithMoves();
    writeFileSync(join(repo, ".delivery", "packs", "moves", "scan.md"), "# Scan, changed\n");
    const listing = packsListing([], await readInstalledPacks(repo));
    expect(listing.packs).toEqual([
      { name: "moves", version: null, title: null, summary: null, source: { kind: "installed", package: { name: "@acme/moves", version: "1.2.0" } }, state: "changed" },
    ]);
  });

  it("gives an unapproved added pack its manifest fields, as it can be read", async () => {
    const repo = await repoWithMoves();
    const lock = JSON.parse(readFileSync(packsLockPath(repo), "utf-8"));
    lock.packs.moves.approved = `delivery.pack-hash/1:${"0".repeat(64)}`;
    writeFileSync(packsLockPath(repo), JSON.stringify(lock));
    const listing = packsListing([], await readInstalledPacks(repo));
    expect(listing.packs[0]).toMatchObject({ name: "moves", version: "1.0.0", title: "Moves", state: "unapproved" });
  });

  it("gives an unrecorded folder no package", async () => {
    const repo = initTempRepo("packs-listing-stray-", { "a.js": "x\n" });
    mkdirSync(join(repo, ".delivery", "packs", "stray"), { recursive: true });
    const listing = packsListing([], await readInstalledPacks(repo));
    expect(listing.packs).toEqual([{ name: "stray", version: null, title: null, summary: null, source: { kind: "installed", package: null }, state: "unrecorded" }]);
  });

  it("leaves no key optional", () => {
    expect(publishedKeys(packsListingSchema(), PACKS_LISTING_SCHEMA).filter((line) => line.endsWith("(optional)"))).toEqual([]);
  });

  describe("the listing's stability promise", () => {
    const promised = readFileSync(new URL("./packs-listing-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
    const current = publishedKeys(packsListingSchema(), PACKS_LISTING_SCHEMA);
    it("keeps every key and name ever published, each the kind of value it was", () => expect(promised.filter((l) => !current.includes(l))).toEqual([]));
    it("puts every key and name published now under the promise: add its line to packs-listing-published-keys.txt", () =>
      expect(current.filter((l) => !promised.includes(l))).toEqual([]));
  });
});
