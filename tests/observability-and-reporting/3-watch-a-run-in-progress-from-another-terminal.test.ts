// Slice 3: Watch a Run in Progress From Another Terminal
// Source: docs/superpowers/specs/2026-10-01-observability-and-reporting-slices.md
// Recorded: 2026-10-02 against commit 030ff01
//
// Drives the compiled `delivery` command as a person would: a real `delivery run`
// subprocess in one "terminal" and a real `delivery status --watch` subprocess in
// another, in a copy of the shipped sample project, the agent routed to the
// vendored scripted agent (slowed by delayMs so the run is still going when the
// watch opens) through the contributor-only test seam: no network, no API key.
// Acceptance criteria needing a killed run, a pre-slice record, a half-written
// line, shared-environment repair or an unrecorded one-at-a-time run are recorded
// as skipped below, each with its reason.

import { describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { EXIT } from "../../src/cli/failures.js";
import { writeMockScript } from "../../src/mock-script.js";
import { DELIVERY_BIN, REPO_ROOT, git, runDelivery } from "../helpers.js";

const RUN_TIMEOUT = 90_000;

const TASKS = [
  "add a hello function that greets a name, with a test",
  "add a goodbye function that farewells a name, with a test",
  "add a wave function that waves at a name, with a test",
  "add a count function that counts to ten, with a test",
];

/** The example project with a list of four tasks, run `concurrency` at once (omitted: one at a time), and a slow scripted agent. */
async function project(concurrency?: number) {
  const repo = mkdtempSync(join(tmpdir(), "uat-watch-"));
  execFileSync("cp", ["-r", join(REPO_ROOT, "examples", "sample-project") + "/.", repo]);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ tasks: TASKS, concurrency }));
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "configure"]);
  const script = join(mkdtempSync(join(tmpdir(), "uat-watch-script-")), "mock.json");
  await writeMockScript(script, {
    delayMs: 3000,
    expectations: TASKS.map((task, i) => ({
      when: { promptContains: task },
      effects: [{ write: { path: `f${i}.js`, content: `export const f${i} = () => ${i};\n` } }],
      json: { status: "completed", rationale: `added f${i}` },
    })),
  });
  const env = { ...process.env, XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "uat-watch-state-")), [TEST_MOCK_SCRIPT]: script };
  return { repo, env };
}

interface Terminal {
  child: ChildProcess;
  out(): string;
  exited: Promise<number | null>;
}

/** A `delivery` command running in its own "terminal": its output so far, and when it has exited and with what. */
function terminal(args: string[], repo: string, env: NodeJS.ProcessEnv): Terminal {
  const child = spawn(process.execPath, [DELIVERY_BIN, ...args], { cwd: repo, env });
  let text = "";
  child.stdout.on("data", (chunk: Buffer) => (text += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (text += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  return { child, out: () => text, exited };
}

async function until(what: string, ready: () => boolean, ms = 30_000): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("UAT: keep an eye on a run from a second terminal and see each task's progress as it happens", () => {
  it(
    "opens with what it watches, shows Right now, adds a line per change; Ctrl-C leaves the run going; a second watch follows it to the end",
    async () => {
      // Steps 1-2: a list of four tasks, two at once, running in one terminal; the watch in a second.
      const { repo, env } = await project(2);
      const run = terminal(["run"], repo, env);
      // Open the watch once task 1's agent is working, as `status` records it: the run's own "[2/4]" line comes while
      // task 1 may still be checking its starting point. The slow agent then holds that step for the picture to catch.
      await until("task 1's agent to be working", () =>
        /^ {2}\[1\/4\] .*: the agent is working/m.test(runDelivery(["status"], { cwd: repo, env }).stdout),
      );
      const first = terminal(["status", "--watch", "--interval", "0.5"], repo, env);

      // Step 3: it names what it watches and how to stop, then the "Right now" picture of every task.
      // The watch writes the picture a line at a time, so it can arrive in pieces: wait for the blank line that closes it.
      await until("the whole opening picture", () => /^Right now .*\n(?:.+\n)*\n/m.test(first.out()));
      const opening = first.out();
      expect(opening).toMatch(/^Watching run run-\S+: 4 tasks, up to 2 at once\. Ctrl-C stops watching; the run is not affected\.$/m);
      expect(opening).toMatch(/^Right now \(last activity [\d:]+ UTC\): 4 tasks: /m);
      for (const [i, task] of TASKS.entries()) expect(opening).toContain(`Task ${i + 1} of 4: "${task}": `);
      expect(opening).toMatch(/Task 1 of 4: .*: the agent is working \(attempt 1\)\. In this step since [\d:]+ UTC\./);
      expect(opening).toMatch(/Task 3 of 4: .*: waiting to start/);

      // Then one line per change as it is recorded, each starting with the time and the task's place in the list.
      await until("a change line", () => /^[\d:]{5} Task \d of 4: /m.test(first.out().slice(opening.length)));

      // Step 4: Ctrl-C part way through stops the watch only; the first terminal carries on.
      first.child.kill("SIGINT");
      await first.exited;
      expect(run.child.exitCode).toBeNull();
      expect(first.out()).not.toContain("Run finished");

      // ...then watch again, once the last task has started (so tasks 1 and 2 have landed whatever the machine's load):
      // the picture is of now, and the watch ends with the run, with its headline counts.
      await until("the last task to start", () => run.out().includes("[4/4]"));
      const second = terminal(["status", "--watch", "--interval", "0.5"], repo, env);
      expect(await second.exited).toBe(EXIT.ok);
      expect(await run.exited).toBe(EXIT.ok);
      const lines = second.out().split("\n");
      expect(lines.at(-2)).toMatch(/^[\d:]{5} Run finished: 4 of 4 tasks completed and committed to their own branches\. Run `delivery report` for what to do\.$/);

      // Every change line is appended as plain text: no cursor movement, no colour codes.
      expect(second.out()).not.toContain(String.fromCharCode(27));
      // The second watch opened on a picture of now (tasks 1 and 2 already committed), then added lines for the rest.
      for (const task of ["1", "2"]) expect(second.out()).toMatch(new RegExp(`Task ${task} of 4: .*: committed on branch surface/`));
      for (const task of ["3", "4"]) {
        expect(second.out()).toMatch(new RegExp(`^[\\d:]{5} Task ${task} of 4: done, committed on branch surface/`, "m"));
      }
    },
    RUN_TIMEOUT,
  );
});

describe("AC: watching a one-at-a-time list", () => {
  it(
    "ends when every task is done, without ending in the moment between two tasks, with the exit code `delivery run` ended with",
    async () => {
      const { repo, env } = await project();
      const run = terminal(["run"], repo, env);
      await until("the first task to start", () => run.out().includes("Starting run"));
      const watch = terminal(["status", "--watch", "--interval", "0.5"], repo, env);

      expect(await watch.exited).toBe(await run.exited);
      expect(watch.out()).toContain("Every task on your list is done");
      // All four tasks were seen through, so the gap between one finishing and the next starting did not end the watch.
      for (const n of [2, 3, 4]) expect(watch.out()).toMatch(new RegExp(`Task ${n} of 4: the agent is working`));
      expect(watch.out()).not.toContain("Run finished");
    },
    RUN_TIMEOUT * 2,
  );
});

describe("AC: --interval and --watch are refused where they cannot apply", () => {
  it("refuses --interval without --watch, and --watch with --all, exit 2, before printing anything", async () => {
    const { repo, env } = await project();
    const interval = runDelivery(["status", "--interval", "1"], { cwd: repo, env });
    expect(interval.status).toBe(EXIT.configuration);
    expect(interval.stdout).toBe("");
    expect(interval.stderr).toContain("Use it with `--watch`");

    const both = runDelivery(["status", "--watch", "--all"], { cwd: repo, env });
    expect(both.status).toBe(EXIT.configuration);
    expect(both.stderr).toContain("Use either `--watch` or `--all`, not both");

    const zero = runDelivery(["status", "--watch", "--interval", "0"], { cwd: repo, env });
    expect(zero.status).toBe(EXIT.configuration);
    expect(zero.stderr).toContain("An interval is a number of seconds above 0");
  });
});

describe("AC: recorded as skipped", () => {
  it.skip("AC: a run of several tasks that was killed is recognised, the watch says it stopped part way and exits 0 (needs a killed live run; covered by src/cli/watch-command.test.ts)", () => {});
  it.skip("AC: a one-at-a-time run says once that nothing records whether it is still going (needs a list whose process died part way; timing-dependent; covered by src/cli/watch.test.ts)", () => {});
  it.skip("AC: shared-environment trouble and its repair appear as plain lines (needs a broken shared environment; covered by src/cli/watch.test.ts)", () => {});
  it.skip("AC: a run recorded before this slice can be watched, with lines dropping the time (needs a pre-slice record fixture; covered by src/cli/watch.test.ts)", () => {});
  it.skip("AC: a line caught half-written is never shown as damage (needs a racing writer; covered by src/cli/watch.test.ts)", () => {});
  it.skip("AC: a task list that has stopped ends the watch with 'Your task list has stopped' (covered by src/cli/watch-command.test.ts; the stop wording is not driven live here)", () => {});
});
