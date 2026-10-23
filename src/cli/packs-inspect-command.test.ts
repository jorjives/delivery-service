import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectionOf } from "../packs/inspection.js";
import { BUILT_IN_PACKS, packNamed } from "../packs/manifest.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { renderInspection } from "./packs-inspect-render.js";

// Inspecting a built-in pack reads its folder and nothing else: no process starts, no agent runs, nothing is asked.
const wiring = vi.hoisted(() => ({ forbid: false, calls: [] as string[] }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const spied = (name: string, original: unknown) => (...args: unknown[]) => {
    if (!wiring.forbid) return (original as (...rest: unknown[]) => unknown)(...args);
    wiring.calls.push(name);
    throw new Error(`${name} must not run`);
  };
  return {
    ...real,
    spawn: spied("spawn", real.spawn),
    spawnSync: spied("spawnSync", real.spawnSync),
    exec: spied("exec", real.exec),
    execFile: spied("execFile", real.execFile),
    execFileSync: spied("execFileSync", real.execFileSync),
    fork: spied("fork", real.fork),
  };
});

vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: () => {
    throw new Error("no agent may be started");
  },
}));

/** Every path under `dir`, `.git/` included, with its size, mode and modification time, sorted. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((rel) => {
      const stat = statSync(join(dir, rel));
      return `${rel} ${stat.size} ${stat.mode} ${stat.mtimeMs}`;
    });
}

beforeEach(() => {
  wiring.forbid = false;
  wiring.calls.length = 0;
});

describe("delivery packs inspect", () => {
  it("prints the account of a built-in pack by name, and starts, writes and asks nothing", async () => {
    const cwd = initTempRepo("inspect-", { "a.js": "x\n" });
    const before = [snapshot(cwd), snapshot(BUILT_IN_PACKS)];
    wiring.forbid = true;
    const { exitCode, stdout, stderr } = await delivery(["packs", "inspect", "deprecations"], { cwd });
    wiring.forbid = false;
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${renderInspection(inspectionOf(await packNamed("deprecations"))).join("\n")}\n`);
    expect(stderr).toBe("");
    expect(wiring.calls).toEqual([]);
    expect([snapshot(cwd), snapshot(BUILT_IN_PACKS)]).toEqual(before);
  });

  it("reads a built-in pack outside any project", async () => {
    const { exitCode, stdout } = await delivery(["packs", "inspect", "code"], { cwd: mkdtempSync(join(tmpdir(), "no-project-")) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe("Pack: Code review");
  });

  it.each(["Deprecations", "./packs/deprecations", "nope"])("refuses %s, naming the packs there are, and prints no account", async (name) => {
    const { exitCode, stdout, stderr } = await delivery(["packs", "inspect", name], { cwd: mkdtempSync(join(tmpdir(), "inspect-")) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toBe("");
    expect(stderr).toContain(`There is no pack called "${name}". The packs available are: code, deprecations, security.`);
  });
});
