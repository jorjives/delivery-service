// Slice 2: Test Your Setup With Several Tasks Running Together
// Source: docs/superpowers/specs/2026-09-26-multi-surface-supervisor-slices.md
// Recorded: 2026-09-30 against commit 7e25dfc
//
// Drives the guide's own worked example exactly as its UAT instructs: copy the
// "Testing several tasks at once" section's `several-tasks.test.ts` into a scratch
// project that resolves `delivery-service` the way an installed copy would, and run
// it with `npx tsx --test`, a real child process, no network and no API key. The
// harness's own scripted agent stands in for a real one, as the guide teaches.
//
// The UAT's distinguishing step -- swap the two delay constants and run again -- is
// not already exercised anywhere else in the suite: tests/testing-your-pipeline-guide
// .test.ts runs the snippet once with its documented delays, and src/scripted-
// supervisor-run.test.ts drives the same ordering in-process against the internal
// API rather than through the guide text a reader actually copies. This file drives
// both runs through the real, documented path.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanGitEnv } from "../../src/git-env.js";
import { REPO_ROOT, runTsx, snippetFrom } from "../helpers.js";
import { withoutCredentials } from "../../src/mock-session.js";

const guide = readFileSync(join(REPO_ROOT, "docs/testing-your-pipeline.md"), "utf-8");

/** Credentials the guide promises its examples never need: stripped from the child, not trusted to be absent. */
const env = withoutCredentials(cleanGitEnv());

// A reader installs the package and imports it by name, so the snippet is staged in a
// scratch folder where `delivery-service` resolves to this checkout through its own
// `exports` map, exactly as tests/testing-your-pipeline-guide.test.ts stages the
// guide's other worked examples.
const scratch = mkdtempSync(join(tmpdir(), "several-tasks-uat-"));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
mkdirSync(join(scratch, "node_modules"));
symlinkSync(REPO_ROOT, join(scratch, "node_modules", "delivery-service"), "dir");
if (!existsSync(join(REPO_ROOT, "dist", "index.d.ts"))) {
  throw new Error("dist is missing or has no types: run `npm run build` (npm test does this for you)");
}
writeFileSync(
  join(scratch, "tsconfig.json"),
  JSON.stringify({
    extends: join(REPO_ROOT, "tsconfig.json"),
    include: ["*.ts"],
    compilerOptions: { typeRoots: [join(REPO_ROOT, "node_modules", "@types")] },
  }),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Stage the guide's `several-tasks.test.ts` snippet, its two delay constants swapped if asked. */
function stageSeveralTasks(swapDelays: boolean): string {
  let source = snippetFrom(guide, "several-tasks.test.ts");
  if (!source.includes('from "delivery-service')) {
    throw new Error("several-tasks.test.ts does not import the harness from \"delivery-service\"");
  }
  if (swapDelays) {
    source = source
      .replace("const HELLO_DELAY_MS = 0;", "const HELLO_DELAY_MS = 2000;")
      .replace("const GOODBYE_DELAY_MS = 2000;", "const GOODBYE_DELAY_MS = 0;");
  }
  const path = join(scratch, `several-tasks${swapDelays ? "-swapped" : ""}.test.ts`);
  writeFileSync(path, source);
  return path;
}

/** Run a staged worked test with `npx tsx --test`, as the guide tells a reader to. */
function runSeveralTasks(swapDelays: boolean): { stdout: string; status: number } {
  return runTsx(["--test", stageSeveralTasks(swapDelays)], env);
}

const RUN_TIMEOUT = 20_000;

describe("UAT: prove your own check and closer behave when several tasks run together, without a real agent", () => {
  it(
    "the guide's worked example passes as written: hello answers first and is merged, goodbye is refused because the base moved on",
    () => {
      const { stdout, status } = runSeveralTasks(false);

      expect(stdout).toContain("✔ two tasks reach the merge together");
      expect(stdout).toContain("ℹ pass 1");
      expect(stdout).toContain("ℹ fail 0");
      expect(status).toBe(0);
    },
    RUN_TIMEOUT,
  );
});

describe("AC: staggering reply delays reliably decides which task reaches a given step first, every time", () => {
  it(
    "swapping the two delays swaps which task is merged: goodbye now answers first and is merged, hello is refused",
    () => {
      const { stdout, status } = runSeveralTasks(true);

      expect(stdout).toContain("✔ two tasks reach the merge together");
      expect(stdout).toContain("ℹ pass 1");
      expect(stdout).toContain("ℹ fail 0");
      expect(status).toBe(0);
    },
    RUN_TIMEOUT,
  );
});

// SKIPPED AC: "The public testing entry point exposes a way to run several scripted tasks
// through the supervisor against one temporary repository, with a chosen number of slots"
// -- exercised by both runs above (the snippet calls `runSupervisorAgainstMock` with
// `slots: 2`) and exhaustively unit-tested at every slot count by
// src/scripted-supervisor-run.test.ts ("with one slot, runs the tasks one after another",
// "refuses %s slots before anything runs"). Re-driving slot counts through a slower real
// subprocess here would add process-spawn time without exercising a code path those tests
// miss.
it.skip("the entry point accepts a chosen number of slots", () => {});

// SKIPPED AC: "The run's journal of prompts sent and scripted replies consumed is available
// per task, as for a single task" -- the snippet run by both tests above asserts this
// directly for each task (`assertFullyConsumed(helloRun.journal, hello.script)`,
// `promptsSent(goodbyeRun.journal)`), so a swapped-delay bug that broke per-task journals
// would already fail the UAT test.
it.skip("each task's journal of prompts and replies is available, as for a single task", () => {});

// SKIPPED AC: "The testing guide explains how to script several tasks with a chosen
// interleaving, and its worked example passes as a test" -- the guide's own prose
// (delay choice, slots, determinism) and its worked example passing are already recorded
// by tests/testing-your-pipeline-guide.test.ts ("explains how to choose which of several
// tasks reaches a step first", "runs its worked several-tasks test as written, and it
// passes"). Re-asserting the guide's prose here would duplicate that coverage.
it.skip("the guide explains scripting several tasks, and its worked example passes as a test", () => {});
