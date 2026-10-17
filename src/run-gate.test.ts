import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { create, load, readRef, setBaseBranch, appendEntry } from "./case-file.js";
import { recordBaseline, runCheck, takeBaseline, GATE_GUARD, gateDigestOf } from "./run-gate.js";
import { ImmutabilityViolation, MissingBaseline } from "./errors.js";
import type { BudgetSet, GateRef } from "./schema.js";
import { withoutAt } from "./without-at.js";
import type { SurfaceLocation } from "./ports.js";
import { initTempRepo } from "./temp-repo.js";
import { cleanGitEnv } from "./git-env.js";
import { TESTS_GUARD, EDIT_GUARD } from "./guards.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

// The gate reads a TAP file from the worktree, so a test can change what the
// gate sees between baseline and check without changing the pinned command.
const TAP_GATE: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };

const GREEN = "1..2\nok 1 - alpha\nok 2 - beta\n";

let surfaceDir: string;
let worktree: string;
let location: SurfaceLocation;

async function newSurface(gateRef: GateRef = TAP_GATE): Promise<void> {
  surfaceDir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
  worktree = await mkdtemp(join(tmpdir(), "run-gate-tree-"));
  location = { repoPath: await mkdtemp(join(tmpdir(), "run-gate-repo-")), worktreePath: worktree };
  await create(surfaceDir, { surfaceId: "surface-1", taskDef: { intent: "fix bug" }, gateRef }, budgets);
}

async function tap(contents: string): Promise<void> {
  await writeFile(join(worktree, "report.tap"), contents);
}

// Written out in full rather than spread from TAP_GATE: TAP_GATE is annotated
// as the `GateRef` union, and spreading a union then assigning the result back
// to `GateRef` is an assignability risk `npm run lint` (tsc --noEmit over
// `src`, which includes `src/*.test.ts`) would have to catch for us.
async function newSurfaceWithFlag(): Promise<void> {
  await newSurface({
    type: "command",
    command: "cat report.tap",
    parseMode: "tap",
    failOnNewAssertions: true,
  });
}

describe("recordBaseline", () => {
  beforeEach(async () => {
    await newSurface();
    await tap(GREEN);
  });

  it("resolves the header's gate ref, runs baseline, and stores it in the case file", async () => {
    const report = await recordBaseline(surfaceDir, location);

    expect(report.status).toBe("PASS");
    expect(report.assertions.map((a) => a.id)).toEqual(["1 - alpha", "2 - beta"]);

    const loaded = await load(surfaceDir);
    expect(loaded.header.baseline).toEqual(report);
  });

  it("rejects a second baseline for the same surface", async () => {
    await recordBaseline(surfaceDir, location);

    await expect(recordBaseline(surfaceDir, location)).rejects.toThrow(ImmutabilityViolation);
  });

  it("returns an ERROR report without storing it when the gate cannot run", async () => {
    await rm(join(worktree, "report.tap"));

    const report = await recordBaseline(surfaceDir, location);

    expect(report.status).toBe("ERROR");
    const loaded = await load(surfaceDir);
    expect(loaded.header.baseline).toBeNull();
  });
});

describe("recordBaseline and runCheck with an explicit env", () => {
  const ENV_GATE: GateRef = { type: "command", command: 'test "$MARKER" = "scratch"', parseMode: "exitcode" };

  beforeEach(async () => {
    await newSurface(ENV_GATE);
  });

  it("runs the gate's command with the given env, not the process's own", async () => {
    const report = await recordBaseline(surfaceDir, location, { MARKER: "scratch" });
    expect(report.assertions[0]?.outcome).toBe("PASS");
  });

  it("fails when the given env lacks what the command needs", async () => {
    const report = await recordBaseline(surfaceDir, location, {});
    expect(report.assertions[0]?.outcome).toBe("FAIL");
  });

  it("threads env through runCheck as well as recordBaseline", async () => {
    await recordBaseline(surfaceDir, location, { MARKER: "scratch" });
    const { report } = await runCheck(surfaceDir, location, 1, { MARKER: "scratch" });
    expect(report.assertions[0]?.outcome).toBe("PASS");
  });
});

describe("a custom gate with a relative modulePath", () => {
  // A gate reporting where it was loaded from. The copy planted in the worktree
  // stands in for one the agent under judgement wrote or edited.
  const gateAt = (where: string): string =>
    `const report = async () => ({ status: "PASS", assertions: [{ id: "${where}", outcome: "PASS", detail: "" }] });
     export default { baseline: report, check: report };`;

  beforeEach(async () => {
    await newSurface({ type: "custom", modulePath: "./gate.mjs" });
    await writeFile(join(location.repoPath, "gate.mjs"), gateAt("repo"));
    await writeFile(join(worktree, "gate.mjs"), gateAt("worktree"));
  });

  it("resolves against the repo root, never the worktree the agent edits", async () => {
    const baseline = await recordBaseline(surfaceDir, location);
    const { report } = await runCheck(surfaceDir, location, 1);

    expect(baseline.assertions.map((a) => a.id)).toEqual(["repo"]);
    expect(report.assertions.map((a) => a.id)).toEqual(["repo"]);
  });
});

const REGRESSED = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";

describe("runCheck", () => {
  beforeEach(async () => {
    await newSurface();
    await tap(GREEN);
  });

  it("appends a PASS entry with no new failures when nothing regressed", async () => {
    await recordBaseline(surfaceDir, location);

    const { delta } = await runCheck(surfaceDir, location, 1);

    expect(delta.pass).toBe(true);
    const loaded = await load(surfaceDir);
    expect(withoutAt(loaded.history)).toEqual([
      { t: "baseline", status: "PASS" },
      { t: "gate", attempt: 1, status: "PASS", newFailures: [] },
    ]);
  });

  it("records the verdict, the new failures, and the failure class after a regression", async () => {
    await recordBaseline(surfaceDir, location);
    await tap(REGRESSED);

    const { delta } = await runCheck(surfaceDir, location, 1);

    expect(delta.pass).toBe(false);
    expect(delta.class).toBe("fail");

    const loaded = await load(surfaceDir);
    expect(withoutAt(loaded.history)[1]).toEqual({
      t: "gate",
      attempt: 1,
      status: "FAIL",
      class: "fail",
      newFailures: [{ id: "2 - beta", detailRef: "gate-1-0-0" }],
    });

    expect(await readRef(surfaceDir, "gate-1-0-0")).toEqual({
      id: "2 - beta",
      baselineOutcome: "PASS",
      checkOutcome: "FAIL",
      detail: "not ok 2 - beta",
    });
  });

  it("leaves the stored baseline untouched across the round trip", async () => {
    const baseline = await recordBaseline(surfaceDir, location);
    await tap(REGRESSED);
    await runCheck(surfaceDir, location, 1);

    const loaded = await load(surfaceDir);
    expect(loaded.header.baseline).toEqual(baseline);
  });

  it("records a gate-level error as an error-class entry with no new failures", async () => {
    await recordBaseline(surfaceDir, location);
    await rm(join(worktree, "report.tap"));

    const { report, delta } = await runCheck(surfaceDir, location, 2);

    expect(report.status).toBe("ERROR");
    expect(delta.class).toBe("error");
    // The returned delta agrees with what was persisted: the ABSENT artefacts
    // of a failed gate run are not reported as the worker's new failures.
    expect(delta.newFailures).toEqual([]);

    const loaded = await load(surfaceDir);
    expect(withoutAt(loaded.history)[1]).toEqual({
      t: "gate",
      attempt: 2,
      status: "ERROR",
      class: "error",
      newFailures: [],
    });
  });

  it("honours failOnNewAssertions pinned on the gate ref", async () => {
    await newSurfaceWithFlag();
    await tap("1..1\nok 1 - alpha\n");
    await recordBaseline(surfaceDir, location);
    await tap("1..2\nok 1 - alpha\nnot ok 2 - brandnew\n");

    const { delta } = await runCheck(surfaceDir, location, 1);

    expect(delta.pass).toBe(false);
    expect(delta.newFailures.map((f) => f.id)).toEqual(["2 - brandnew"]);
  });

  it("rejects a check run before any baseline was recorded", async () => {
    await expect(runCheck(surfaceDir, location, 1)).rejects.toThrow(MissingBaseline);
  });

  it("keys a re-check of the same attempt separately from the first check", async () => {
    await tap(GREEN);
    await recordBaseline(surfaceDir, location);

    await tap("1..2\nok 1 - alpha\nnot ok 2 - beta\n");
    await runCheck(surfaceDir, location, 1);

    await tap("1..2\nnot ok 1 - alpha\nok 2 - beta\n");
    await runCheck(surfaceDir, location, 1);

    const { history } = await load(surfaceDir);
    const gates = history.filter((e) => e.t === "gate") as Extract<typeof history[number], { t: "gate" }>[];
    expect(gates).toHaveLength(2);

    const first = gates[0];
    const second = gates[1];
    if (!first || !second) throw new Error("expected 2 gate entries");

    const firstFailure = first.newFailures[0];
    const secondFailure = second.newFailures[0];
    if (!firstFailure || !secondFailure) throw new Error("expected failures on gate entries");

    expect(firstFailure.detailRef).toBe("gate-1-0-0");
    expect(secondFailure.detailRef).toBe("gate-1-1-0");

    // The first check's detail must still be readable and still be its own.
    expect(await readRef(surfaceDir, firstFailure.detailRef))
      .toMatchObject({ id: "2 - beta" });
    expect(await readRef(surfaceDir, secondFailure.detailRef))
      .toMatchObject({ id: "1 - alpha" });
  });
});

describe("what a gate is told", () => {
  it("includes the branch the run started from, which a gate may use or ignore", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "run-gate-repo-"));
    await writeFile(
      join(repoPath, "branch-gate.mjs"),
      "const report = (ctx) => ({ status: 'PASS', assertions: [{ id: 'base', outcome: 'PASS', detail: String(ctx.baseBranch) }] });\n" +
        "export default { baseline: async (ctx) => report(ctx), check: async (ctx) => report(ctx) };\n",
    );
    const dir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "fix bug" }, gateRef: { type: "custom", modulePath: "./branch-gate.mjs" } }, budgets);
    await setBaseBranch(dir, "main");

    const report = await recordBaseline(dir, { repoPath, worktreePath: await mkdtemp(join(tmpdir(), "run-gate-tree-")) });

    expect(report.assertions[0]?.detail).toBe("main");
  });
});

describe("a workflow step's baseline", () => {
  it("refuses a second baseline for the same workflow step", async () => {
    const repo = initTempRepo("run-gate-step-", { "a.txt": "a\n" });
    const startCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env: cleanGitEnv() }).toString().trim();
    const dir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
    const gateRef: GateRef = { type: "command", command: "true", parseMode: "exitcode", checkOnly: true };
    const workflow = { name: "w", steps: [{ name: "one", prompt: "x" }, { name: "two", prompt: "y" }] };
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef, startCommit, workflow }, budgets);
    await appendEntry(dir, { t: "step", step: 2, startCommit });
    await appendEntry(dir, { t: "baseline", status: "PASS", report: { status: "PASS", assertions: [] } });
    await expect(recordBaseline(dir, { repoPath: repo, worktreePath: repo })).rejects.toBeInstanceOf(ImmutabilityViolation);
  });
});

describe("DELIVERY_STEP_START", () => {
  it("is set on every gate command to the commit the work started from", async () => {
    const repo = initTempRepo("run-gate-start-", { "a.txt": "a\n" });
    const startCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env: cleanGitEnv() }).toString().trim();
    surfaceDir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
    location = { repoPath: repo, worktreePath: repo };
    const gateRef: GateRef = { type: "command", command: `printf '1..1\\nok 1 - %s\\n' "$DELIVERY_STEP_START"`, parseMode: "tap" };
    await create(surfaceDir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef, startCommit }, budgets);
    const report = await recordBaseline(surfaceDir, location);
    expect(report.assertions.map((a) => a.id)).toContain(`1 - ${startCommit}`);
  });
});

describe("the guards on every run", () => {
  const TEST = "import { test } from 'node:test';\ntest('adds', () => {});\n";

  async function gitSurface(taskDef: Record<string, unknown> = { intent: "fix bug" }): Promise<string> {
    const repo = initTempRepo("run-gate-guards-", { "report.tap": GREEN, "sum.test.js": TEST, "vitest.config.js": "export default {};\n" });
    const startCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, env: cleanGitEnv() }).toString().trim();
    surfaceDir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
    location = { repoPath: repo, worktreePath: repo };
    await create(surfaceDir, { surfaceId: "surface-1", taskDef, gateRef: TAP_GATE, startCommit }, budgets);
    await recordBaseline(surfaceDir, location);
    return repo;
  }

  it("refuses a deleted test, naming it, though the project's check still passes", async () => {
    const repo = await gitSurface();
    rmSync(join(repo, "sum.test.js"));
    const { delta } = await runCheck(surfaceDir, location, 1);
    expect(delta.pass).toBe(false);
    expect(delta.newFailures.map((failure) => failure.id)).toEqual([TESTS_GUARD]);
    expect(delta.newFailures[0]?.detail).toContain("sum.test.js deleted");
  });

  it("accepts an edit to an existing test by default", async () => {
    const repo = await gitSurface();
    writeFileSync(join(repo, "sum.test.js"), TEST.replace("adds", "adds two numbers"));
    expect((await runCheck(surfaceDir, location, 1)).delta.pass).toBe(true);
  });

  it("refuses that edit when the task adds the guard, and allows a deletion when the task turns its guard off", async () => {
    const strict = await gitSurface({ intent: "fix bug", guards: { add: ["tests-unchanged"] } });
    writeFileSync(join(strict, "sum.test.js"), TEST.replace("adds", "adds two numbers"));
    expect((await runCheck(surfaceDir, location, 1)).delta.newFailures.map((failure) => failure.id)).toEqual([EDIT_GUARD]);

    const relaxed = await gitSurface({ intent: "drop the old tests", guards: { off: ["tests-untouched"] } });
    rmSync(join(relaxed, "sum.test.js"));
    expect((await runCheck(surfaceDir, location, 1)).delta.pass).toBe(true);
  });

  it("does not fail a round for a setting a gate repair was accepted as changing", async () => {
    const repo = await gitSurface();
    writeFileSync(join(repo, "vitest.config.js"), "export default { test: { pool: 'forks' } };\n");
    const print = execFileSync("git", ["hash-object", "vitest.config.js"], { cwd: repo, env: cleanGitEnv() }).toString().trim();
    await appendEntry(surfaceDir, { t: "repair_accepted", sessionKey: "gate-maintenance-1-0", settings: { "vitest.config.js": print } });
    expect((await runCheck(surfaceDir, location, 1)).delta.pass).toBe(true);
  });

  it("fails the round once that setting is edited again", async () => {
    const repo = await gitSurface();
    writeFileSync(join(repo, "vitest.config.js"), "a\n");
    await appendEntry(surfaceDir, { t: "repair_accepted", sessionKey: "gate-maintenance-1-0", settings: { "vitest.config.js": "not-this-one" } });
    expect((await runCheck(surfaceDir, location, 1)).delta.newFailures.map((failure) => failure.id)).toEqual(["guard:check-untouched"]);
  });

  it("judges a run whose record pins no start commit by its gate alone", async () => {
    await newSurface();
    await tap(GREEN);
    await recordBaseline(surfaceDir, location);
    expect((await runCheck(surfaceDir, location, 1)).delta.pass).toBe(true);
  });
});

describe("the gate's own module", () => {
  async function customSurface(): Promise<string> {
    surfaceDir = await mkdtemp(join(tmpdir(), "run-gate-case-"));
    worktree = await mkdtemp(join(tmpdir(), "run-gate-tree-"));
    const repoPath = await mkdtemp(join(tmpdir(), "run-gate-repo-"));
    location = { repoPath, worktreePath: worktree };
    await writeFile(join(repoPath, "gate.mjs"), "export default { baseline: async () => ({ status: 'PASS', assertions: [] }), check: async () => ({ status: 'PASS', assertions: [] }) };\n");
    const gateRef: GateRef = { type: "custom", modulePath: "./gate.mjs" };
    const gateDigest = await gateDigestOf(gateRef, repoPath);
    await create(surfaceDir, { surfaceId: "surface-1", taskDef: { intent: "fix bug" }, gateRef, gateDigest }, budgets);
    await recordBaseline(surfaceDir, location);
    return repoPath;
  }

  it("passes while the module is as it was when the run started", async () => {
    await customSurface();
    expect((await runCheck(surfaceDir, location, 1)).delta.pass).toBe(true);
  });

  it("fails, naming the module, once it has changed", async () => {
    const repoPath = await customSurface();
    await writeFile(join(repoPath, "gate.mjs"), "export default { baseline: async () => ({ status: 'PASS', assertions: [] }), check: async () => ({ status: 'PASS', assertions: [] }) }; // lenient\n");
    const { delta } = await runCheck(surfaceDir, location, 1);
    expect(delta.newFailures.map((failure) => failure.id)).toEqual([GATE_GUARD]);
    expect(delta.newFailures[0]?.detail).toContain("./gate.mjs");
  });

  it("is not looked for on a command gate, whose command the guards already compare", async () => {
    expect(await gateDigestOf(TAP_GATE, "/unused")).toBeUndefined();
  });
});

describe("takeBaseline", () => {
  beforeEach(async () => {
    await newSurface();
    await tap(GREEN);
  });

  it("runs the gate's baseline and records nothing", async () => {
    const report = await takeBaseline(await load(surfaceDir), location);

    expect(report.status).toBe("PASS");
    expect(report.assertions.map((a) => a.id)).toEqual(["1 - alpha", "2 - beta"]);
    expect((await load(surfaceDir)).header.baseline).toBeNull();
  });
});
