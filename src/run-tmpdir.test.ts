import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_DIR_PREFIX, sweepStaleRunDirs } from "../vitest.global-setup.js";

describe("the test run's private temp folder", () => {
  it("is where this worker's os.tmpdir() points", () => {
    expect(tmpdir()).toContain(RUN_DIR_PREFIX);
  });

  it("is where a child process's temp folder points too", () => {
    const out = spawnSync(process.execPath, ["-e", "process.stdout.write(require('os').tmpdir())"], {
      encoding: "utf8",
    });
    expect(out.stdout).toBe(tmpdir());
  });
});

describe("sweepStaleRunDirs", () => {
  it("removes folders of dead runs and keeps those of live ones", () => {
    const root = mkdtempSync(join(tmpdir(), "sweep-"));
    try {
      const dead = join(root, `${RUN_DIR_PREFIX}2147483646-abc123`);
      const live = join(root, `${RUN_DIR_PREFIX}${process.pid}-abc123`);
      const other = join(root, "unrelated");
      for (const d of [dead, live, other]) mkdirSync(d);
      sweepStaleRunDirs(root);
      expect(existsSync(dead)).toBe(false);
      expect(existsSync(live)).toBe(true);
      expect(existsSync(other)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
