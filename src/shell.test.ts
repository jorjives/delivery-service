// src/shell.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "./shell.js";

const cwd = mkdtempSync(join(tmpdir(), "shell-"));

describe("runShell", () => {
  it("passes arguments as positional parameters, never as shell text", async () => {
    const result = await runShell("printf '%s|'", ["complete", "a; rm -rf x"], { cwd, timeoutMs: 5_000 });
    expect(result).toEqual({ stdout: "complete|a; rm -rf x|", stderr: "", exitCode: 0 });
  });

  it("feeds input to the command's standard input", async () => {
    const result = await runShell("cat", [], { cwd, timeoutMs: 5_000, input: '{"schema":"x"}' });
    expect(result.stdout).toBe('{"schema":"x"}');
  });

  it("reports a non-zero exit as a result, not a rejection", async () => {
    const result = await runShell("echo nope >&2; exit 3", [], { cwd, timeoutMs: 5_000 });
    expect(result).toEqual({ stdout: "", stderr: "nope\n", exitCode: 3 });
  });

  it("rejects a command that runs past its time", async () => {
    await expect(runShell("sleep 5", [], { cwd, timeoutMs: 100 })).rejects.toThrow("Command timed out");
  });
});
