import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Pack } from "../manifest.js";
import { changedFiles, fileDigests, fingerprintedFiles } from "./digests.js";

const sha256hex = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("fileDigests", () => {
  it("gives the lowercase hex SHA-256 of each file's raw bytes, keyed by path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "digests-"));
    writeFileSync(join(dir, "pack.json"), "{}");
    writeFileSync(join(dir, "scan.md"), "# Scan\n");
    expect(await fileDigests(dir, ["pack.json", "scan.md"])).toEqual({
      "pack.json": sha256hex("{}"),
      "scan.md": sha256hex("# Scan\n"),
    });
  });
});

describe("changedFiles", () => {
  it("names the paths present on one side only or with differing digests, sorted", () => {
    expect(changedFiles({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" })).toEqual(["b", "c", "d"]);
  });

  it("names nothing when the maps are equal", () => {
    expect(changedFiles({ a: "1", b: "2" }, { b: "2", a: "1" })).toEqual([]);
  });
});

describe("fingerprintedFiles", () => {
  it("lists a prompt shared by two workflows once, with the manifest, sorted", () => {
    const pack = {
      manifest: {
        workflows: {
          scan: { kind: "find", prompt: "scan.md" },
          again: { kind: "act", prompt: "scan.md" },
        },
      },
    } as unknown as Pack;
    expect(fingerprintedFiles(pack)).toEqual(["pack.json", "scan.md"]);
  });
});
