import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "../src/cli/failures.js";
import { DELIVERY_BIN, REPO_ROOT, runDelivery } from "./helpers.js";

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as {
  version: string;
  bin?: Record<string, string>;
};

describe("the compiled delivery command", () => {
  it("prints the package version with --version", () => {
    expect(runDelivery(["--version"])).toEqual({ stdout: `${pkg.version}\n`, stderr: "", status: EXIT.ok });
  });

  it("describes itself with --help", () => {
    const { stdout, status } = runDelivery(["--help"]);
    expect(status).toBe(EXIT.ok);
    expect(stdout).toContain("Usage: delivery");
    expect(stdout).toContain("Hand an AI agent a task in plain English.");
    expect(stdout).toContain("-V, --version");
  });

  it("treats an unknown option as a configuration mistake, saying which", () => {
    const { stderr, status } = runDelivery(["--bogus"]);
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("unknown option '--bogus'");
    expect(stderr).not.toContain("    at ");
  });

  it("is installed as `delivery` and runs directly", () => {
    expect(pkg.bin).toEqual({ delivery: "./dist/cli/main.js" });
    expect(readFileSync(DELIVERY_BIN, "utf-8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(statSync(DELIVERY_BIN).mode & 0o111).not.toBe(0);
  });
});
