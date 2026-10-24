import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FetchedPackage } from "../packs/install/pack-source.js";
import type { PackageRead } from "../packs/install/package-archive.js";
import { NOT_AN_ARCHIVE, NOT_PLAIN_ENTRY } from "../packs/install/package-archive.js";
import { NOT_IN_A_PACK } from "../packs/pack-folder.js";
import type { Clash } from "./pack-clash.js";
import { addedDifferently, addedLines, addQuestion, alreadyAdded, archiveRefusal, clashRefusal, foundLines, nobodyToAsk, notInPackLines, packRefusal } from "./packs-add-render.js";

/** The text of some lines with every run of white space made one space, so where a line wraps does not matter. */
const flat = (lines: readonly string[]): string => lines.join(" ").replace(/\s+/g, " ");

/** A package name of exactly 40 characters, scoped. */
const LONG = `@acme/${"x".repeat(34)}`;

const NAME = "@acme/delivery-pack-docs";

const fetched = (version: string): FetchedPackage => ({ name: LONG, version, integrity: "sha512-AAAA", tarball: new Uint8Array() });

const read = (fields: Partial<Extract<PackageRead, { ok: true }>>): Extract<PackageRead, { ok: true }> => ({
  ok: true,
  packPath: ".",
  packFiles: [],
  ignored: [],
  declares: [],
  ...fields,
});

const widest = (lines: readonly string[]): number => Math.max(...lines.map((line) => line.length));

describe("foundLines", () => {
  it("names the package and its version, and says that nothing is added or run", () => {
    const lines = foundLines(fetched("1.2.0"), { name: LONG, request: "latest", typed: false });
    expect(lines.slice(0, 2)).toEqual([`Found ${LONG} on npm.`, "  Version: 1.2.0"]);
    expect(flat(lines.slice(2))).toBe(
      "Nothing is added until you say yes. Nothing from the package is run: its install scripts and its own dependencies are never used.",
    );
  });

  it("says which request the version was found for when the owner typed one", () => {
    const lines = foundLines(fetched("1.2.0"), { name: LONG, request: "^1.0.0", typed: true });
    expect(lines[1]).toBe("  Version: 1.2.0 (found for ^1.0.0)");
  });

  it("does not repeat the request when it is the version itself", () => {
    const lines = foundLines(fetched("1.2.0"), { name: LONG, request: "1.2.0", typed: true });
    expect(lines[1]).toBe("  Version: 1.2.0");
  });

  it("keeps every line within 60 columns for a 40-character scoped name", () => {
    expect(widest(foundLines(fetched("1.2.0"), { name: LONG, request: "^1.0.0", typed: true }))).toBeLessThanOrEqual(60);
  });
});

describe("notInPackLines", () => {
  it("is empty when nothing is ignored and nothing is declared", () => {
    expect(notInPackLines(read({}))).toEqual([]);
  });

  it("names each file that is not kept, with its size", () => {
    expect(notInPackLines(read({ ignored: [{ path: "README.md", bytes: 1 }, { path: "index.js", bytes: 300 }] }))).toEqual([
      "In the package, not part of the pack",
      "  Not kept, and not read:",
      "  README.md, 1 byte",
      "  index.js, 300 bytes",
    ]);
  });

  it.each([
    [["scripts"], "scripts"],
    [["scripts", "bin"], "scripts and bin"],
    [["scripts", "bin", "dependencies"], "scripts, bin and dependencies"],
  ] as const)("says what the package declares when it declares %j", (declares, list) => {
    const text = flat(notInPackLines(read({ declares: [...declares] })));
    expect(text).toContain(`It declares ${list}; delivery-service does not run or install them.`);
  });

  it("keeps every line within 60 columns for a 40-character scoped name", () => {
    const lines = notInPackLines(read({ ignored: [{ path: `${LONG}.md`, bytes: 1 }], declares: ["scripts", "bin", "dependencies"] }));
    expect(widest(lines)).toBeLessThanOrEqual(60);
  });
});

describe("the question and the closing lines", () => {
  it("asks whether to add the pack, with no as the default", () => {
    expect(addQuestion("docs-drift", "1.2.0")).toEqual({ message: "Add docs-drift 1.2.0 to this project?", default: false });
  });

  it("names the two items to commit and how to read the pack again", () => {
    expect(addedLines("docs-drift", "1.2.0")).toEqual([
      "Added docs-drift 1.2.0.",
      "  Recorded: .delivery/packs.lock.json",
      "  Kept as:  .delivery/packs/docs-drift",
      "Commit both, so everyone gets this same pack.",
      "See its workflows:  delivery packs",
      "Read it again:      delivery packs inspect docs-drift",
    ]);
  });

  it("says nothing can ask, and that nothing was changed, within 60 columns", () => {
    const lines = nobodyToAsk("add");
    expect(flat(lines)).toBe("Not added: nothing here can ask you. Run the command in a terminal to read the account and answer. Nothing was changed.");
    expect(widest(lines)).toBeLessThanOrEqual(60);
  });

  it.each([
    ["archive", () => archiveRefusal("update", LONG, "1.3.0", { entry: "pack/link", message: NOT_PLAIN_ENTRY })],
    ["pack", () => packRefusal("update", LONG, "1.3.0", "pack", [{ file: join("/scratch", "pack", "install.sh"), field: null, message: NOT_IN_A_PACK }], join("/scratch", "pack"))],
    ["nobody", () => nobodyToAsk("update")],
  ])("leads the %s refusal of an update with Not updated, within 60 columns", (_, lines) => {
    expect(lines()[0]?.startsWith("Not updated:")).toBe(true);
    expect(widest(lines())).toBeLessThanOrEqual(60);
  });

  it("says an already-added pack is there, and that there is nothing to do", () => {
    expect(alreadyAdded("docs-drift", "1.2.0")).toBe("docs-drift is already added at 1.2.0. Nothing to do.");
  });
});

describe("refusals", () => {
  it("says a name is already taken by a pack with other contents, from which package", () => {
    const lines = addedDifferently("docs-drift", { source: "npm", package: LONG, request: "latest", version: "2.0.0", integrity: "sha512-AAAA", fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`, approved: `delivery.pack-hash/1:${"a".repeat(64)}`, files: { "pack.json": "a".repeat(64) } });
    expect(flat(lines)).toBe(`Not added: a pack named docs-drift is already added, from ${LONG} 2.0.0, with other contents. Nothing was changed.`);
    expect(widest(lines)).toBeLessThanOrEqual(60);
  });

  it("names the package and version, the problem in the package, and that nothing was changed", () => {
    const lines = archiveRefusal("add", "@acme/delivery-pack-docs", "1.2.0", { entry: "pack/link", message: NOT_PLAIN_ENTRY });
    expect(lines[0]).toBe("Not added: @acme/delivery-pack-docs 1.2.0");
    expect(flat(lines)).toContain(`pack/link ${NOT_PLAIN_ENTRY}. Nothing was changed.`);
  });

  it("says the whole package is not an archive when no entry is named", () => {
    expect(flat(archiveRefusal("add", "@acme/delivery-pack-docs", "1.2.0", { entry: null, message: NOT_AN_ARCHIVE }))).toContain(`The package ${NOT_AN_ARCHIVE}.`);
  });

  it("names a file of the pack as it sits in the package, with the advice", () => {
    const stagedDir = join("/scratch", "pack");
    const lines = packRefusal("add", LONG, "1.2.0", "pack", [{ file: join(stagedDir, "install.sh"), field: null, message: NOT_IN_A_PACK }], stagedDir);
    expect(flat(lines)).toContain(`Not added: ${LONG} 1.2.0 holds a pack that cannot be used.`);
    expect(flat(lines)).toContain(`pack/install.sh ${NOT_IN_A_PACK}`);
    expect(lines.at(-1)).toBe("  Nothing was changed.");
  });

  it("keeps every line within 60 columns for a 40-character scoped package name", () => {
    const stagedDir = join("/scratch", "pack");
    const problems = [{ file: join(stagedDir, "install.sh"), field: null, message: NOT_IN_A_PACK }];
    for (const lines of [
      archiveRefusal("add", LONG, "1.2.0", { entry: `pack/${"y".repeat(40)}`, message: NOT_PLAIN_ENTRY }),
      packRefusal("add", LONG, "1.2.0", "pack", problems, stagedDir),
      addedDifferently("docs-drift", { source: "npm", package: LONG, request: "latest", version: "1.2.0", integrity: "sha512-AAAA", fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`, approved: `delivery.pack-hash/1:${"a".repeat(64)}`, files: { "pack.json": "a".repeat(64) } }),
      foundLines(fetched("1.2.0"), { name: LONG, request: "latest", typed: false }),
    ]) {
      expect(widest(lines)).toBeLessThanOrEqual(60);
    }
  });

  it("names the new version as the second side of an update's clash", () => {
    const clash: Clash = { kind: "workflow", workflow: "docs-drift:audit", first: { kind: "installed", pack: "other", package: "@x/other", version: "1.0.0" }, second: { kind: "installed", pack: "docs-drift", package: NAME, version: "1.3.0" } };
    const text = flat(clashRefusal("update", clash, "/repo"));
    expect(text).toContain("Not updated: two things define the workflow");
    expect(text).toContain(`2. the new version, from ${NAME} 1.3.0`);
    expect(text).toContain("delivery packs remove other");
  });
});
