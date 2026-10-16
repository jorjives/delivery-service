import { describe, it, expect, vi, afterEach } from "vitest";
import { createCommandGate } from "./command-gate.js";
import type { GateContext } from "./command-gate.js";

// Stub context — the command gate only uses worktreePath as the cwd
function stubCtx(worktreePath = "/tmp/test-worktree"): GateContext {
  return {
    worktreePath,
    taskDef: {},
    gateRef: { type: "command", command: "test-cmd", parseMode: "tap" },
  };
}

// We mock child_process.execFile to avoid real shell execution in unit tests
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

type ExecFileCallback = (
  error: (Error & { code?: string | number; stdout?: string; stderr?: string }) | null,
  stdout: string,
  stderr: string,
) => void;

function mockExecFile(stdout: string, stderr = "", exitCode = 0): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      if (exitCode !== 0) {
        const err = Object.assign(new Error("Command failed"), {
          code: exitCode,
          stdout,
          stderr,
        });
        cb(err, stdout, stderr);
      } else {
        cb(null, stdout, stderr);
      }
    },
  );
}

function mockExecFileError(code: string): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      const err = Object.assign(new Error("spawn failed"), {
        code,
      });
      cb(err, "", "");
    },
  );
}

function mockExecFileKilled(): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      const err = Object.assign(new Error("Command timed out"), {
        killed: true,
        signal: "SIGTERM",
      });
      cb(err, "", "");
    },
  );
}

describe("createCommandGate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("TAP mode: produces one assertion per test line", async () => {
    const tap = "ok 1 - add\nnot ok 2 - sub\nok 3 - mul\n";
    mockExecFile(tap);

    const gate = createCommandGate("npm test", "tap");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("PASS");
    expect(report.assertions).toHaveLength(3);
    expect(report.assertions[0]).toEqual({
      id: "1 - add", outcome: "PASS", detail: "ok 1 - add",
    });
    expect(report.assertions[1]).toEqual({
      id: "2 - sub", outcome: "FAIL", detail: "not ok 2 - sub",
    });
  });

  it("JUnit mode: produces one assertion per testcase", async () => {
    const xml = `<testsuite>
  <testcase classname="Math" name="add"/>
  <testcase classname="Math" name="sub">
    <failure message="wrong"/>
  </testcase>
</testsuite>`;
    mockExecFile(xml);

    const gate = createCommandGate("mvn test", "junit");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("PASS");
    expect(report.assertions).toHaveLength(2);
    expect(report.assertions[0]?.id).toBe("Math::add");
    expect(report.assertions[1]?.outcome).toBe("FAIL");
  });

  it("exit-code mode: pass on exit 0", async () => {
    mockExecFile("", "", 0);

    const gate = createCommandGate("make check", "exitcode");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("PASS");
    expect(report.assertions).toHaveLength(1);
    expect(report.assertions[0]?.outcome).toBe("PASS");
    expect(report.assertions[0]?.id).toBe("exit:make check");
  });

  it("exit-code mode: fail on non-zero exit", async () => {
    mockExecFile("", "error output", 1);

    const gate = createCommandGate("make check", "exitcode");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("PASS");
    expect(report.assertions).toHaveLength(1);
    expect(report.assertions[0]?.outcome).toBe("FAIL");
  });

  it("passes ctx.env to the spawned command when set", async () => {
    mockExecFile("", "", 0);

    const gate = createCommandGate("make check", "exitcode");
    await gate.baseline({ ...stubCtx(), env: { PATH: "/usr/bin", HOME: "/scratch/home" } });

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.at(0);
    const opts = call?.[2] as { env?: NodeJS.ProcessEnv };
    expect(opts.env).toEqual({ PATH: "/usr/bin", HOME: "/scratch/home" });
  });

  it("passes no env option when ctx carries none, so the command inherits the process's own", async () => {
    mockExecFile("", "", 0);

    const gate = createCommandGate("make check", "exitcode");
    await gate.baseline(stubCtx());

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls.at(0);
    const opts = call?.[2] as { env?: NodeJS.ProcessEnv };
    expect(opts.env).toBeUndefined();
  });

  it("command not found produces an ERROR report, not a crash", async () => {
    mockExecFileError("ENOENT");

    const gate = createCommandGate("nonexistent-cmd", "tap");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("execution failed");
  });

  it("timed-out command produces an ERROR report, not a crash", async () => {
    mockExecFileKilled();

    const gate = createCommandGate("sleep 999", "tap");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("timed out");
  });

  it("unparseable TAP output produces an ERROR report", async () => {
    mockExecFile("this is not TAP output");

    const gate = createCommandGate("some-cmd", "tap");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("parse");
  });

  it("unparseable JUnit output produces an ERROR report", async () => {
    mockExecFile("not xml");

    const gate = createCommandGate("mvn test", "junit");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("parse");
  });

  it("duplicate assertion IDs produce an ERROR report", async () => {
    const tap = "ok 1 - same\nok 1 - same\n";
    mockExecFile(tap);

    const gate = createCommandGate("test", "tap");
    const report = await gate.baseline(stubCtx());

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("Duplicate");
  });

  it("baseline and check both call the same runner", async () => {
    const tap = "ok 1 - test\n";
    mockExecFile(tap);

    const gate = createCommandGate("npm test", "tap");
    const baseline = await gate.baseline(stubCtx());
    const check = await gate.check(stubCtx());

    expect(baseline).toEqual(check);
  });

  it("same TAP output on two runs produces identical assertion IDs", async () => {
    const tap = "ok 1 - alpha\nnot ok 2 - beta\n";
    mockExecFile(tap);

    const gate = createCommandGate("npm test", "tap");
    const run1 = await gate.baseline(stubCtx());

    // Reset mock for second call
    mockExecFile(tap);
    const run2 = await gate.check(stubCtx());

    const ids1 = run1.assertions.map((a) => a.id);
    const ids2 = run2.assertions.map((a) => a.id);
    expect(ids1).toEqual(ids2);
  });

  it("same JUnit output on two runs produces identical assertion IDs", async () => {
    const xml = `<testsuite>
  <testcase classname="X" name="a"/>
  <testcase classname="X" name="b"><failure message="f"/></testcase>
</testsuite>`;
    mockExecFile(xml);

    const gate = createCommandGate("mvn test", "junit");
    const run1 = await gate.baseline(stubCtx());

    mockExecFile(xml);
    const run2 = await gate.check(stubCtx());

    const ids1 = run1.assertions.map((a) => a.id);
    const ids2 = run2.assertions.map((a) => a.id);
    expect(ids1).toEqual(ids2);
  });
});

describe("a check-only command gate", () => {
  it("runs nothing at baseline and records no assertions", async () => {
    const gate = createCommandGate("test-cmd", "exitcode", undefined, { checkOnly: true });
    expect(await gate.baseline(stubCtx())).toEqual({ status: "PASS", assertions: [] });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("runs the command at check", async () => {
    mockExecFile("", "", 1);
    const gate = createCommandGate("test-cmd", "exitcode", undefined, { checkOnly: true });
    expect((await gate.check(stubCtx())).assertions.map((a) => a.outcome)).toEqual(["FAIL"]);
  });
});
