import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { EXIT } from "../src/cli/failures.js";
import { writeMockScript } from "../src/mock-script.js";
import { initTempRepo } from "../src/temp-repo.js";
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

  it("runs a task end to end from the compiled build, with the agent routed through the contributor test seam", async () => {
    const repo = initTempRepo("delivery-command-run-", {
      "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }),
    });
    const script = join(mkdtempSync(join(tmpdir(), "delivery-command-script-")), "mock.json");
    await writeMockScript(script, {
      expectations: [
        {
          effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
          json: { status: "completed", rationale: "added hello.js" },
        },
      ],
    });

    const { stdout, stderr, status } = runDelivery(["run", "--task", "add a hello function"], {
      cwd: repo,
      env: { ...process.env, [TEST_MOCK_SCRIPT]: script, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "delivery-command-state-")) },
    });

    expect(status, `${stdout}\n${stderr}`).toBe(EXIT.ok);
    expect(stdout).toMatch(/committed on branch surface\/add-a-hello-function-\d{8}T\d{6}Z\./);
  }, 60_000);
});
