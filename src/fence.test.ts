import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { buildSessionOptions } from "./agent-invoke.js";
import { resolveRuntime } from "./cli/agent-session.js";
import { bwrapOf, fenceArgs, fenceOf, fencePaths, fenceSession, probeFence, TEST_BWRAP, wrapperScript, writeWrapper } from "./fence.js";
import { workerRoleConfig } from "./role-config.js";
import { initTempRepo } from "./temp-repo.js";

const PATHS = { readOnly: "/home/o/project", writable: ["/home/o/project/.git"], devices: ["/dev/kvm"] };

describe("the fence's settings", () => {
  it("are preferred with no devices when the file says nothing, and take either form", () => {
    expect(fenceOf(undefined)).toEqual({ mode: "preferred", devices: [] });
    expect(fenceOf("required")).toEqual({ mode: "required", devices: [] });
    expect(fenceOf({ devices: ["/dev/kvm"] })).toEqual({ mode: "preferred", devices: ["/dev/kvm"] });
  });

  it("run the bwrap a contributor names, else the one on the PATH", () => {
    expect(bwrapOf({})).toBe("bwrap");
    expect(bwrapOf({ [TEST_BWRAP]: "/nowhere/bwrap" })).toBe("/nowhere/bwrap");
  });
});

describe("the fence's arguments", () => {
  it("bind everything as it is, then the main folder read-only, its git folder writable, and each device", () => {
    expect(fenceArgs(PATHS)).toEqual([
      "--dev-bind", "/", "/",
      "--ro-bind", "/home/o/project", "/home/o/project",
      "--bind", "/home/o/project/.git", "/home/o/project/.git",
      "--dev-bind", "/dev/kvm", "/dev/kvm",
    ]);
  });

  it("are found from the repository: the git folder the main folder shares with its working copies", async () => {
    const repo = initTempRepo("fence-paths-", { "a.txt": "a\n" });
    const paths = await fencePaths(repo, "/elsewhere/worktree", []);
    expect(paths).toEqual({ readOnly: repo, writable: [join(repo, ".git")], devices: [] });
  });

  it("keep a working copy writable when it sits inside the main folder", async () => {
    const repo = initTempRepo("fence-paths-", { "a.txt": "a\n" });
    expect((await fencePaths(repo, join(repo, "inner"), [])).writable).toEqual([join(repo, ".git"), join(repo, "inner")]);
  });

  it("make a wrapper that starts the runtime inside the fence with the session's own arguments", () => {
    const script = wrapperScript("/usr/bin/bwrap", PATHS, "/opt/claude's/claude");
    expect(script).toBe(
      "#!/bin/sh\nexec '/usr/bin/bwrap' '--dev-bind' '/' '/' '--ro-bind' '/home/o/project' '/home/o/project' '--bind' '/home/o/project/.git' '/home/o/project/.git' '--dev-bind' '/dev/kvm' '/dev/kvm' -- '/opt/claude'\\''s/claude' \"$@\"\n",
    );
  });

  it("write the wrapper once per content, readable and runnable by its owner alone", async () => {
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "fence-state-")) };
    const first = await writeWrapper(env, "#!/bin/sh\nexit 0\n");
    expect(await writeWrapper(env, "#!/bin/sh\nexit 0\n")).toBe(first);
    expect(first.startsWith(join(env.XDG_STATE_HOME, "delivery-service", "fence"))).toBe(true);
    expect(statSync(first).mode & 0o777).toBe(0o700);
  });
});

describe("a fence that cannot be had", () => {
  it("is absent, saying bubblewrap is not installed, when there is no bwrap to run", async () => {
    expect(await probeFence("/nowhere/bwrap", PATHS, process.env)).toEqual({ present: false, reason: "bubblewrap (bwrap) is not installed" });
  });
});

// Real bubblewrap, where this machine can run it; skipped where it cannot (CI without user namespaces, macOS).
const probeRepo = initTempRepo("fence-probe-", { "a.txt": "a\n" });
const usable = (await probeFence("bwrap", await fencePaths(probeRepo, undefined, []), process.env)).present;

describe.skipIf(!usable)("a session inside the fence", () => {
  it("is present when the probe passes", async () => {
    expect(await probeFence("bwrap", await fencePaths(probeRepo, undefined, []), process.env)).toEqual({ present: true });
  });

  it("cannot write to the main folder, even through a shell, and can write elsewhere and commit", async () => {
    const repo = initTempRepo("fence-session-", { "a.txt": "a\n" });
    const worktree = join(mkdtempSync(join(tmpdir(), "fence-wt-")), "wt");
    execFileSync("git", ["worktree", "add", "-q", "-b", "task", worktree], { cwd: repo });
    const runtime = join(mkdtempSync(join(tmpdir(), "fence-runtime-")), "runtime.sh");
    // A stand-in runtime: a shell running what it is given, as the agent's Bash tool would.
    writeFileSync(runtime, '#!/bin/sh\nexec sh -c "$1"\n', { mode: 0o755 });
    const env = { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "fence-state-")) };
    const session = await fenceSession({ pathToClaudeCodeExecutable: runtime }, { repoPath: repo, worktreePath: worktree, devices: [], env });
    const run = (command: string): number => {
      try {
        execFileSync(session.pathToClaudeCodeExecutable as string, [command], { cwd: worktree, stdio: "pipe" });
        return 0;
      } catch (err) {
        return (err as { status: number }).status;
      }
    };

    expect(run(`echo x > '${join(repo, "a.txt")}'`)).not.toBe(0);
    expect(readFileSync(join(repo, "a.txt"), "utf-8")).toBe("a\n");
    expect(run("echo y > b.txt && git add b.txt && git -c user.name=a -c user.email=a@a commit -qm b")).toBe(0);
    expect(existsSync(join(worktree, "b.txt"))).toBe(true);
  });

  it("passes a listed device through", async () => {
    const paths = await fencePaths(probeRepo, undefined, ["/dev/null"]);
    expect(fenceArgs(paths).slice(-3)).toEqual(["--dev-bind", "/dev/null", "/dev/null"]);
    expect(await probeFence("bwrap", paths, process.env)).toEqual({ present: true });
  });

  // Spec §8: one test runs the real Claude Code runtime through the wrapper, since claude-mock cannot show that the
  // runtime itself (and so its own file tools) starts inside the fence. As in `src/agent-invoke.test.ts`, only the
  // initialize handshake is awaited: no turn, no credentials, no network.
  it("starts the real Claude Code runtime inside it", async () => {
    const runtime = resolveRuntime();
    expect(runtime, "the runtime the harness ships is installed").toBeDefined();
    const repo = initTempRepo("fence-runtime-", { "a.txt": "a\n" });
    const worktree = join(mkdtempSync(join(tmpdir(), "fence-runtime-wt-")), "wt");
    execFileSync("git", ["worktree", "add", "-q", "-b", "task", worktree], { cwd: repo });
    const home = mkdtempSync(join(tmpdir(), "fence-runtime-home-"));
    const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: home, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "fence-state-")) };
    const fenced = await fenceSession({ pathToClaudeCodeExecutable: runtime, env }, { repoPath: repo, worktreePath: worktree, devices: [], env });
    const session = query({
      prompt: new PassThrough({ objectMode: true }),
      options: buildSessionOptions(workerRoleConfig, { worktreePath: worktree, dir: home, sessionKey: "fence-0" }, fenced),
    });
    try {
      await expect(session.initializationResult()).resolves.toBeDefined();
    } finally {
      session.close();
    }
  }, 30_000);
});
