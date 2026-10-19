import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery } from "../src/cli/command-fixtures.js";
import { EXIT } from "../src/cli/failures.js";
import { loadRunFile } from "../src/run-file.js";
import { repoLocked } from "../src/repo-lock.js";
import { supervisedRoot } from "../src/run-location.js";
import { STOPPED_PART_WAY } from "../src/cli/queue.js";
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

  it("has no findings or fix command any more", async () => {
    for (const command of ["findings", "fix"]) expect((await delivery([command], { cwd: tmpdir() })).exitCode).toBe(EXIT.configuration);
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

  it("stops a run of several at once on Ctrl-C with the stopped code, saying how to carry on, and lets the repository's lock go", async () => {
    const repo = initTempRepo("delivery-command-interrupt-", {
      "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }),
      "delivery.config.json": JSON.stringify({ tasks: ["add a hello function", "add a goodbye function"], concurrency: 2 }),
    });
    const script = join(mkdtempSync(join(tmpdir(), "delivery-command-script-")), "mock.json");
    // Agents slow enough that both tasks are still going when the stop comes.
    await writeMockScript(script, { expectations: [{ json: { status: "completed", rationale: "done" } }], delayMs: 30_000 });

    // Its own process group, so the stop reaches the command and everything it started, as Ctrl-C in a terminal does.
    const child = spawn(process.execPath, [DELIVERY_BIN, "run"], {
      cwd: repo,
      env: { ...process.env, [TEST_MOCK_SCRIPT]: script, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "delivery-command-state-")) },
      detached: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));

    await vi.waitFor(
      async () => {
        const [runId] = readdirSync(supervisedRoot(repo));
        if (runId === undefined) throw new Error("no run of several tasks yet");
        const { history } = await loadRunFile(join(supervisedRoot(repo), runId));
        expect(history.filter((entry) => entry.t === "slot_fill")).toHaveLength(2);
      },
      { timeout: 30_000, interval: 100 },
    );
    if (child.pid === undefined) throw new Error("the command did not start");
    process.kill(-child.pid, "SIGINT");

    expect(await exited).toBe(EXIT.aborted);
    expect(stderr).toContain(STOPPED_PART_WAY);
    expect(await repoLocked(repo)).toBe(false);
  });
});
