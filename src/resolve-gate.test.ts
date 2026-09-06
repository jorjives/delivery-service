import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveGate } from "./resolve-gate.js";
import type { GateContext } from "./command-gate.js";
import type { GateRef } from "./schema.js";

function ctx(gateRef: GateRef, worktreePath = process.cwd()): GateContext {
  return { worktreePath, taskDef: {}, gateRef };
}

// The TAP parser (src/parsers.ts) requires the `N - description` form.
const TAP_COMMAND = "printf '1..2\\nok 1 - alpha\\nnot ok 2 - beta\\n'";

describe("resolveGate", () => {
  it("resolves a command ref into a gate that runs the command in its parse mode", async () => {
    const ref: GateRef = { type: "command", command: TAP_COMMAND, parseMode: "tap" };

    const report = await resolveGate(ref).baseline(ctx(ref));

    expect(report.status).toBe("PASS");
    expect(report.assertions.map((a) => a.outcome)).toEqual(["PASS", "FAIL"]);
  });

  it("resolves a custom ref into a gate loaded from its module path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-gate-test-"));
    const modulePath = path.join(dir, "gate.mjs");
    fs.writeFileSync(
      modulePath,
      `const report = async () => ({
         status: "PASS",
         assertions: [{ id: "custom:one", outcome: "PASS", detail: "ran" }],
       });
       export default { baseline: report, check: report };`,
    );
    const ref: GateRef = { type: "custom", modulePath };

    const report = await resolveGate(ref).baseline(ctx(ref));

    expect(report.status).toBe("PASS");
    expect(report.assertions[0]?.id).toBe("custom:one");
  });

  it("resolves a custom ref's module path relative to the given base directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-gate-test-"));
    fs.writeFileSync(
      path.join(dir, "gate.mjs"),
      `const report = async () => ({
         status: "PASS",
         assertions: [{ id: "custom:relative", outcome: "PASS", detail: "ran" }],
       });
       export default { baseline: report, check: report };`,
    );
    const ref: GateRef = { type: "custom", modulePath: "./gate.mjs" };

    const report = await resolveGate(ref, dir).baseline(ctx(ref));

    expect(report.assertions[0]?.id).toBe("custom:relative");
  });

  it("reports an unsupported parse mode as an ERROR report, not a throw", async () => {
    const ref = {
      type: "command",
      command: "true",
      parseMode: "xunit",
    } as unknown as GateRef;

    const gate = resolveGate(ref);
    const baseline = await gate.baseline(ctx(ref));
    const check = await gate.check(ctx(ref));

    expect(baseline.status).toBe("ERROR");
    expect(baseline.assertions).toEqual([]);
    expect(baseline.detail).toMatch(/parseMode/);
    expect(check).toEqual(baseline);
  });

  it("reports an unknown gate type as an ERROR report", async () => {
    const ref = { type: "webhook", url: "http://example.test" } as unknown as GateRef;

    const report = await resolveGate(ref).baseline(ctx(ref));

    expect(report.status).toBe("ERROR");
    expect(report.detail).toBeTruthy();
  });

  it("reports a bad module path in the same shape a running gate would", async () => {
    const ref: GateRef = { type: "custom", modulePath: "/nowhere/missing-gate.mjs" };

    const report = await resolveGate(ref).baseline(ctx(ref));

    expect(report.status).toBe("ERROR");
    expect(report.assertions).toEqual([]);
    expect(report.detail).toContain("missing-gate.mjs");
  });
});
