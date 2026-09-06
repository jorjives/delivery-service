import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadCustomGate } from "./custom-gate.js";
import { GateModuleLoadFailure, InvalidGateExport } from "./errors.js";
import type { GateContext } from "./command-gate.js";

// Each test writes a real .mjs module to a fresh temp dir and loads it by
// path — exactly how a user's gate module reaches the harness.
function writeGateModule(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-gate-test-"));
  const file = path.join(dir, "gate.mjs");
  fs.writeFileSync(file, source);
  return file;
}

function ctx(worktreePath = "/tmp/test-worktree"): GateContext {
  return {
    worktreePath,
    taskDef: {},
    gateRef: { type: "custom", modulePath: "./gate.mjs" },
  };
}

const WORKING_GATE = `
export default {
  baseline: async (ctx) => ({
    status: "PASS",
    assertions: [{ id: "baseline-check", outcome: "PASS", detail: ctx.worktreePath }],
  }),
  check: async (ctx) => ({
    status: "PASS",
    assertions: [{ id: "check-check", outcome: "FAIL", detail: ctx.worktreePath }],
  }),
};
`;

describe("loadCustomGate", () => {
  it("loads a default export and runs both methods against a worktree", async () => {
    const modulePath = writeGateModule(WORKING_GATE);

    const gate = await loadCustomGate(modulePath);
    const baseline = await gate.baseline(ctx("/worktrees/alpha"));
    const check = await gate.check(ctx("/worktrees/alpha"));

    expect(baseline).toEqual({
      status: "PASS",
      assertions: [
        { id: "baseline-check", outcome: "PASS", detail: "/worktrees/alpha" },
      ],
    });
    expect(check).toEqual({
      status: "PASS",
      assertions: [
        { id: "check-check", outcome: "FAIL", detail: "/worktrees/alpha" },
      ],
    });
  });

  it("loads a named export other than the default", async () => {
    const modulePath = writeGateModule(`
      export const myGate = {
        baseline: async () => ({ status: "PASS", assertions: [{ id: "named", outcome: "PASS", detail: "from myGate" }] }),
        check: async () => ({ status: "PASS", assertions: [] }),
      };
      export default {
        baseline: async () => ({ status: "PASS", assertions: [{ id: "wrong", outcome: "PASS", detail: "from default" }] }),
        check: async () => ({ status: "PASS", assertions: [] }),
      };
    `);

    const gate = await loadCustomGate(modulePath, "myGate");
    const report = await gate.baseline(ctx());

    expect(report.assertions[0]?.id).toBe("named");
  });

  it("resolves a relative module path against the supplied base directory", async () => {
    const modulePath = writeGateModule(WORKING_GATE);

    const gate = await loadCustomGate("./gate.mjs", "default", path.dirname(modulePath));
    const report = await gate.baseline(ctx());

    expect(report.status).toBe("PASS");
  });

  it("throws GateModuleLoadFailure naming the path when the module does not resolve", async () => {
    const missing = path.join(os.tmpdir(), "no-such-gate-module-xyz.mjs");

    await expect(loadCustomGate(missing)).rejects.toThrow(GateModuleLoadFailure);
    await expect(loadCustomGate(missing)).rejects.toThrow(missing);
  });

  it("throws InvalidGateExport naming the missing method, before either method runs", async () => {
    const modulePath = writeGateModule(`
      export default {
        baseline: async () => { throw new Error("baseline must never be called"); },
      };
    `);

    await expect(loadCustomGate(modulePath)).rejects.toThrow(InvalidGateExport);
    await expect(loadCustomGate(modulePath)).rejects.toThrow(/check/);
  });

  it("throws InvalidGateExport naming a missing baseline method", async () => {
    const modulePath = writeGateModule(`
      export default {
        check: async () => { throw new Error("check must never be called"); },
      };
    `);

    await expect(loadCustomGate(modulePath)).rejects.toThrow(InvalidGateExport);
    await expect(loadCustomGate(modulePath)).rejects.toThrow(/baseline/);
  });

  it("throws InvalidGateExport when the named export is absent", async () => {
    const modulePath = writeGateModule(WORKING_GATE);

    await expect(loadCustomGate(modulePath, "notThere")).rejects.toThrow(
      InvalidGateExport,
    );
    await expect(loadCustomGate(modulePath, "notThere")).rejects.toThrow(/notThere/);
  });

  it("turns an exception thrown by baseline into an ERROR report", async () => {
    const modulePath = writeGateModule(`
      export default {
        baseline: async () => { throw new Error("boom in baseline"); },
        check: async () => ({ status: "PASS", assertions: [] }),
      };
    `);

    const gate = await loadCustomGate(modulePath);
    const report = await gate.baseline(ctx());

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("boom in baseline");
  });

  it("turns an exception thrown synchronously by check into an ERROR report", async () => {
    const modulePath = writeGateModule(`
      export default {
        baseline: async () => ({ status: "PASS", assertions: [] }),
        check: () => { throw new Error("boom in check"); },
      };
    `);

    const gate = await loadCustomGate(modulePath);
    const report = await gate.check(ctx());

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("boom in check");
  });

  it("turns a return value that is not a GateReport into an ERROR report", async () => {
    const modulePath = writeGateModule(`
      export default {
        baseline: async () => undefined,
        check: async () => ({ status: "PASS", assertions: [] }),
      };
    `);

    const gate = await loadCustomGate(modulePath);
    const report = await gate.baseline(ctx());

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("did not return a valid GateReport");
  });

  it("turns duplicate assertion IDs into an ERROR report", async () => {
    const modulePath = writeGateModule(`
      const dupe = {
        status: "PASS",
        assertions: [
          { id: "same", outcome: "PASS", detail: "first" },
          { id: "same", outcome: "PASS", detail: "second" },
        ],
      };
      export default { baseline: async () => dupe, check: async () => dupe };
    `);

    const gate = await loadCustomGate(modulePath);
    const report = await gate.baseline(ctx());

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("same");
  });
});
