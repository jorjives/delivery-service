import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UnusableInstalledPack } from "../packs/install/installed.js";
import type { LockEntry } from "../packs/install/lock.js";
import { builtInPacks, newerFormat } from "../packs/manifest.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { notAddedLines, refusedLines, stateNote } from "./installed-render.js";

const REPO = "/work/project";

const entry: LockEntry = {
  source: "npm",
  package: "@acme/delivery-pack-docs",
  request: "latest",
  version: "1.2.0",
  integrity: `sha512-${"A".repeat(86)}==`,
  fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
  approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
  files: {},
};

/** One sample of each state a refusal can name; the unapproved sample needs a real pack for its type, and the text does not read it. */
async function samples(): Promise<UnusableInstalledPack[]> {
  const pack = (await builtInPacks())[0];
  if (pack === undefined) throw new Error("the harness ships at least one pack");
  return [
    { name: "moves", state: "missing", entry },
    { name: "moves", state: "invalid", entry, problems: [{ file: join(REPO, ".delivery", "packs", "moves", "code.md"), field: null, message: "is missing" }] },
    { name: "moves", state: "changed", entry, changed: ["scan.md"] },
    { name: "moves", state: "unapproved", entry: { ...entry, approved: `delivery.pack-hash/1:${"b".repeat(64)}` }, pack },
    { name: "stray", state: "unrecorded" },
  ];
}

/** The lines as one string, with each run of whitespace (including a line break) read as one space. */
const flat = (lines: readonly string[]): string => lines.join(" ").replace(/\s+/g, " ");

describe("refusedLines", () => {
  it.each([0, 1, 2, 3, 4])("shows sample %i within 60 columns, in plain words, with its command", async (index) => {
    const sample = (await samples())[index];
    if (sample === undefined) throw new Error("no sample");
    const lines = refusedLines(REPO, sample);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toMatch(REASSURING);
      expect(line).not.toMatch(FORBIDDEN);
    }
    const text = flat(lines);
    expect(text).toContain(sample.name);
    expect(text).toContain("Nothing was sent to an agent.");
    expect(text.split("delivery packs ").length - 1).toBe(1);
  });

  it("names each changed file relative to the repository", async () => {
    const changed = (await samples())[2];
    if (changed === undefined) throw new Error("no sample");
    expect(flat(refusedLines(REPO, changed))).toContain("Changed: .delivery/packs/moves/scan.md");
  });

  it("writes a name that holds an escape sequence visibly, never raw", () => {
    const lines = refusedLines(REPO, { name: "bad\u001b[31m", state: "unrecorded" });
    for (const line of lines) expect(line).not.toContain("\u001b");
    expect(flat(lines)).toContain("<U+001B>");
  });
});

describe("newer-format", () => {
  it("tells the owner to upgrade delivery-service for a newer-format pack, not to restore it", () => {
    const pack: UnusableInstalledPack = {
      name: "moves",
      state: "newer-format",
      entry,
      problems: [{ file: "/r/.delivery/packs/moves/pack.json", field: "schema", message: newerFormat("delivery.pack/4") }],
    };
    expect(stateNote(pack)).toBe("Kept in a newer pack format. Will not run. To fix: upgrade delivery-service");
    const text = flat(refusedLines("/r", pack));
    expect(text).toContain("upgrade delivery-service to read this pack");
    expect(text).toContain("To use it, upgrade delivery-service.");
    expect(text).not.toContain("restore");
  });
});

describe("notAddedLines", () => {
  it("says there are none added when nothing is", () => {
    expect(flat(notAddedLines("x", []))).toBe("x is not an added pack. Added: none.");
  });

  it("lists the added packs in name order", () => {
    expect(flat(notAddedLines("x", ["moves", "docs"]))).toBe("x is not an added pack. Added: docs, moves.");
  });
});

describe("stateNote", () => {
  it.each([0, 1, 2, 3])("gives sample %i one command, and no reassuring word", async (index) => {
    const sample = (await samples())[index];
    if (sample === undefined) throw new Error("no sample");
    const note = stateNote(sample);
    expect(note.split("delivery packs ").length - 1).toBe(1);
    expect(note).not.toMatch(REASSURING);
  });
});
