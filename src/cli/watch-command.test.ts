import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { setOutcome } from "../case-file.js";
import { appendLine } from "../journal.js";
import { attempt, closedAt, fill, FOOTER, FORM, ID, timed, writeRecord, type TaskRun } from "../report/report-fixtures.js";
import { ReportEvent } from "../report/events.js";
import { NO_RUNS_YET, NO_TASK_LIST } from "../report/text.js";
import { setRunOutcome } from "../run-file.js";
import { runsRoot, supervisedPlace } from "../run-location.js";
import type { HistoryEntry } from "../schema.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, writeSupervisedRun } from "./command-fixtures.js";
import type { CommandContext } from "./context.js";
import { EXIT } from "./failures.js";
import { plainReporter } from "./report.js";
import { takeRepoLock } from "../repo-lock.js";
import type { StatusOptions } from "./status-command.js";
import { INTERVAL_NEEDS_WATCH, INTERVAL_SECONDS, signatureOf, WATCH_AND_ALL, WATCH_AND_DECISIONS, watchCommand } from "./watch-command.js";

const MERGE = { type: "merge-back" } as const;
const LIST = [FORM, FOOTER];
const formDone: TaskRun = { runId: ID.form, task: FORM, closerRef: MERGE, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") };

/** The footer task's log, a minute apart from 02:20: set up, set to work, answered, checked, handed over. */
const STEPS: HistoryEntry[] = timed(
  [{ t: "baseline", status: "PASS" }, ...attempt(1, "fixed the links"), { t: "gate", attempt: 1, status: "PASS", newFailures: [] }, { t: "close", status: "DONE", detailRef: "close-1" }],
  "2026-10-01T02:20:00.000Z",
);
const footerAt = (steps: number): TaskRun => ({ runId: ID.footer, task: FOOTER, closerRef: MERGE, history: STEPS.slice(0, steps) });

async function project(prefix: string, tasks: string[] | undefined, runs: TaskRun[]): Promise<string> {
  const repo = initTempRepo(prefix, { "package.json": PACKAGE, ...(tasks ? { "delivery.config.json": JSON.stringify({ tasks }) } : {}) });
  for (const run of runs) await writeRecord(repo, run);
  return repo;
}

/**
 * Watch `repo` in process. Each wait between looks runs the next of `between`
 * instead of passing time, so a test changes the record exactly where a run
 * would; a watch still waiting when they run out is a failure. `json` is the
 * invocation having asked for data.
 */
async function watch(repo: string, between: (() => Promise<unknown>)[], options: StatusOptions = {}, runId?: string, json = false) {
  const lines: string[] = [];
  const waits: number[] = [];
  const ctx: CommandContext = {
    cwd: repo,
    env: process.env,
    colour: false,
    json,
    stdin: Object.assign(Readable.from([]), { isTTY: undefined }),
    writeLine: (line) => void lines.push(line),
    report: plainReporter(() => undefined, false),
  };
  const steps = [...between];
  const exitCode = await watchCommand(runId, { watch: true, ...options }, ctx, async (ms) => {
    waits.push(ms);
    const step = steps.shift();
    if (step === undefined) throw new Error(`the watch was still waiting after every change:\n${lines.join("\n")}`);
    await step();
  });
  return { exitCode, lines, waits };
}

const footerDir = (repo: string): string => join(runsRoot(repo), ID.footer);
/** Record the footer task's step `index`, as the run would: one more line on its log. */
const record = (repo: string, index: number): Promise<void> => appendLine(join(footerDir(repo), "log.jsonl"), STEPS[index]);

describe("delivery status --watch", () => {
  it("follows the task list by default: the picture, then each change as it is recorded, until the list is done", async () => {
    const repo = await project("watch-list-", LIST, [formDone, footerAt(3)]);

    const { exitCode, lines } = await watch(repo, [
      () => record(repo, 3),
      async () => {
        await record(repo, 4);
        await setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z"));
      },
    ]);

    expect(lines).toEqual([
      "Watching your task list: 2 tasks. Ctrl-C stops watching; the run is not affected.",
      "",
      "Right now (last activity 02:22 UTC): 2 tasks: 1 done, 1 not finished.",
      '  Task 1 of 2: "Add a contact form": merged into main at 02:19',
      '  Task 2 of 2: "Fix the broken footer links": checking the agent\'s work (attempt 1). In this step since 02:22 UTC.',
      "",
      "Nothing records whether your task list is still being worked on. Last recorded activity: 02:22 UTC. Still watching.",
      "02:23 Task 2 of 2: wrapping up.",
      "02:24 Task 2 of 2: done, merged into main.",
      "02:24 Every task on your list is done: 2 of 2 tasks completed and merged. Run `delivery report` for what to do.",
    ]);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("looks every two seconds unless told how often", async () => {
    const repo = await project("watch-interval-", LIST, [formDone, footerAt(5)]);
    const finish = () => setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z"));

    expect((await watch(repo, [finish])).waits).toEqual([2000]);

    const again = await project("watch-interval-set-", LIST, [formDone, footerAt(5)]);
    expect((await watch(again, [() => setOutcome(footerDir(again), closedAt("2026-10-01T02:24:30.000Z"))], { interval: 0.5 })).waits).toEqual([500]);
  });

  it("never shows a line caught half-written as damage: it shows the step before, and catches up at the next look", async () => {
    const repo = await project("watch-torn-", LIST, [formDone, footerAt(3)]);
    const [head, tail] = [JSON.stringify(STEPS[3]).slice(0, 20), JSON.stringify(STEPS[3]).slice(20)];

    const { lines } = await watch(repo, [
      () => appendFile(join(footerDir(repo), "log.jsonl"), head),
      () => appendFile(join(footerDir(repo), "log.jsonl"), `${tail}\n`),
      () => setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z")),
    ]);

    expect(lines.join("\n")).not.toMatch(/damaged|Incomplete/);
    expect(lines.filter((line) => line === "02:23 Task 2 of 2: wrapping up.")).toHaveLength(1);
  });

  it("follows the one run named, a task's own or a run of several tasks", async () => {
    const repo = await project("watch-named-", LIST, [formDone, footerAt(3)]);
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
    const release = await takeRepoLock(repo);

    const task = await watch(repo, [() => setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z"))], {}, ID.footer);
    const run = await watch(
      repo,
      [
        async () => {
          await setRunOutcome(supervisedPlace(repo, ID.run), { kind: "drained", at: "2026-10-01T02:25:00.000Z" });
          await release?.();
        },
      ],
      {},
      ID.run,
    );

    expect(task.lines.at(0)).toBe(`Watching run ${ID.footer}: "Fix the broken footer links". Ctrl-C stops watching; the run is not affected.`);
    expect(run.lines.at(0)).toBe(`Watching run ${ID.run}: 2 tasks, up to 2 at once. Ctrl-C stops watching; the run is not affected.`);
    expect(run.lines.at(-1)).toBe(`02:25 Run finished: 2 of 2 tasks completed and merged. Run \`delivery report ${ID.run}\` for what to do.`);
    expect([task.exitCode, run.exitCode]).toEqual([EXIT.ok, EXIT.ok]);
  });

  it("recognises a run of several tasks that was stopped part way, says how to carry on, and ends ok", async () => {
    const repo = await project("watch-killed-", LIST, [formDone, footerAt(3)]);
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);

    const { exitCode, stdout } = await delivery(["status", "--watch"], { cwd: repo });

    expect(stdout.trimEnd().split("\n").at(-1)).toBe("Work on your task list stopped part way (2 tasks: 1 done, 1 not finished). To carry on: delivery run");
    expect(exitCode).toBe(EXIT.ok);
  });

  it("ends at once, with the code `delivery run` ends with, on a list that has already stopped", async () => {
    const repo = await project("watch-stopped-", LIST, [
      formDone,
      { ...footerAt(3), outcome: { kind: "escalated", source: "worker", reason: "worker escalated: authority", at: "2026-10-01T02:58:00.000Z", cause: { kind: "authority", role: "worker" } } },
    ]);

    const { exitCode, stdout } = await delivery(["status", "--watch"], { cwd: repo });

    expect(stdout.trimEnd().split("\n").at(-1)).toBe("02:58 Your task list has stopped: 1 of 2 tasks completed and merged; 1 needs your decision. Run `delivery report` for what to do.");
    expect(exitCode).toBe(EXIT.escalated);
  });

  it("follows the most recent run, and says so, when the project has no task list", async () => {
    const repo = await project("watch-no-list-", undefined, [formDone]);

    const { exitCode, stdout } = await delivery(["status", "--watch"], { cwd: repo });

    expect(stdout.split("\n").slice(0, 2)).toEqual([NO_TASK_LIST, `Watching run ${ID.form}: "Add a contact form". Ctrl-C stops watching; the run is not affected.`]);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("says there are no runs yet, and ends ok, in a folder that has never had one", async () => {
    const repo = await project("watch-empty-", LIST, []);

    const { exitCode, stdout } = await delivery(["status", "--watch"], { cwd: repo });

    expect(stdout.trimEnd().split("\n")).toEqual([NO_RUNS_YET, "", "Next: delivery run"]);
    expect(exitCode).toBe(EXIT.ok);
  });

  it("waits, rather than saying there are no runs, while a run of several tasks holds the folder and has recorded nothing yet", async () => {
    const repo = await project("watch-starting-", LIST, []);
    const release = await takeRepoLock(repo);

    const { exitCode, lines } = await watch(repo, [
      async () => {
        await writeRecord(repo, formDone);
        await writeRecord(repo, { ...footerAt(5), outcome: closedAt("2026-10-01T02:24:30.000Z") });
        await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
        await setRunOutcome(supervisedPlace(repo, ID.run), { kind: "drained", at: "2026-10-01T02:25:00.000Z" });
        await release?.();
      },
    ]);

    expect(lines).not.toContain(NO_RUNS_YET);
    expect(lines.at(0)).toBe("Watching your task list: 2 tasks. Ctrl-C stops watching; the run is not affected.");
    expect(lines.at(-1)).toBe("02:25 Run finished: 2 of 2 tasks completed and merged. Run `delivery report` for what to do.");
    expect(exitCode).toBe(EXIT.ok);
  });

  it("fails, plainly, for an id that names no run", async () => {
    const repo = await project("watch-unknown-", LIST, [formDone]);

    const { exitCode, stderr } = await delivery(["status", "--watch", "no-such-run"], { cwd: repo });

    expect(stderr).toContain("I couldn't find that run's record");
    expect(exitCode).not.toBe(EXIT.ok);
  });
});

describe("delivery status --watch --json", () => {
  /** Every line of standard output read back as the event it is: a line that is not one event fails here. */
  const eventsIn = (stdout: string): ReportEvent[] => stdout.trimEnd().split("\n").map((line) => ReportEvent.parse(JSON.parse(line)));

  it("prints one event to a line as it is recorded, from a line announcing the stream to a line saying how it ended", async () => {
    const repo = await project("watch-json-", LIST, [formDone, footerAt(3)]);

    const { exitCode, lines } = await watch(
      repo,
      [
        () => record(repo, 3),
        async () => {
          await record(repo, 4);
          await setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z"));
        },
      ],
      {},
      undefined,
      true,
    );
    const events = eventsIn(lines.join("\n"));

    expect(events[0]).toEqual({ schema: "delivery.event/1", run: null, surface: null, seq: 0, at: null, type: "stream_started", subject: "list" });
    expect(events.filter((event) => event.surface === ID.footer).map((event) => [event.seq, event.type])).toEqual([
      [0, "surface_state"],
      [1, "surface_state"],
      [2, "surface_state"],
      [3, "surface_state"],
      [4, "surface_state"],
      [5, "surface_outcome"],
    ]);
    expect(events.at(-1)).toMatchObject({ type: "stream_ended", ending: "ended", surfaceOutcome: null, counts: { closed: 2 } });
    expect(exitCode).toBe(EXIT.ok);
  });

  it("gives, replaying the finished list, exactly the lines following it live gave", async () => {
    const repo = await project("watch-json-replay-", LIST, [formDone, footerAt(3)]);
    const live = await watch(repo, [() => record(repo, 3), () => record(repo, 4), () => setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z"))], {}, undefined, true);

    const replay = await delivery(["--json", "status", "--watch"], { cwd: repo });

    expect(replay.stdout).toBe(`${live.lines.join("\n")}\n`);
    expect(replay.exitCode).toBe(live.exitCode);
  });

  it("puts nothing on standard output but events: no colour, no sentence for a person, even where the words would say one", async () => {
    const noList = await project("watch-json-no-list-", undefined, [formDone]);
    const empty = await project("watch-json-empty-", LIST, []);

    const recent = await delivery(["--json", "status", "--watch"], { cwd: noList, isTTY: true });
    const nothing = await delivery(["--json", "status", "--watch"], { cwd: empty, isTTY: true });

    expect(eventsIn(recent.stdout)[0]).toMatchObject({ type: "stream_started", subject: "task", surface: ID.form });
    expect(eventsIn(nothing.stdout).map((event) => [event.type, "ending" in event ? event.ending : null])).toEqual([
      ["stream_started", null],
      ["stream_ended", "nothing_recorded"],
    ]);
    expect(recent.stdout + nothing.stdout).not.toContain("\u001B");
    expect([recent.stderr, nothing.stderr, recent.exitCode, nothing.exitCode]).toEqual(["", "", EXIT.ok, EXIT.ok]);
  });

  it("ends with the code the watch in words ends with", async () => {
    const repo = await project("watch-json-stopped-", LIST, [
      formDone,
      { ...footerAt(3), outcome: { kind: "escalated", source: "worker", reason: "worker escalated: authority", at: "2026-10-01T02:58:00.000Z", cause: { kind: "authority", role: "worker" } } },
    ]);

    const { exitCode, stdout } = await delivery(["--json", "status", "--watch"], { cwd: repo });

    expect(eventsIn(stdout).at(-1)).toMatchObject({ type: "stream_ended", ending: "ended", surfaceOutcome: "escalated" });
    expect(exitCode).toBe(EXIT.escalated);
  });

  it("says on standard error, once, that liveness is unknown when nothing records whether the work is going", async () => {
    const repo = await project("watch-json-unknown-", LIST, [formDone, footerAt(2)]);
    const release = await takeRepoLock(repo);

    const stderr: string[] = [];
    const lines: string[] = [];
    const waits: number[] = [];
    const ctx: CommandContext = {
      cwd: repo,
      env: process.env,
      colour: false,
      json: true,
      stdin: Object.assign(Readable.from([]), { isTTY: undefined }),
      writeLine: (line) => void lines.push(line),
      report: plainReporter((line) => void stderr.push(line), false),
    };
    const steps = [
      async () => {
        await release?.();
      },
      async () => {
        await record(repo, 3);
      },
      async () => {
        await setOutcome(footerDir(repo), closedAt("2026-10-01T02:24:30.000Z"));
      },
    ];
    await watchCommand(undefined, { watch: true }, ctx, async (ms) => {
      waits.push(ms);
      const step = steps.shift();
      if (step === undefined) throw new Error(`the watch was still waiting after every change:\n${lines.join("\n")}`);
      await step();
    });

    const events = eventsIn(lines.join("\n"));
    expect(events[0]).toMatchObject({ type: "stream_started" });
    expect(stderr.filter((line) => line.includes("Nothing records whether your task list is still being worked on"))).toHaveLength(1);
  });
});

describe("delivery status --watch, asked for something it does not do", () => {
  it.each([
    [["status", "--interval", "5"], INTERVAL_NEEDS_WATCH],
    [["status", "--watch", "--all"], WATCH_AND_ALL],
    [["status", "--watch", "--decisions"], WATCH_AND_DECISIONS],
    [["status", "--watch", "--interval", "0"], INTERVAL_SECONDS],
    [["status", "--watch", "--interval", "soon"], INTERVAL_SECONDS],
  ])("refuses %j, saying what to do instead", async (args, message) => {
    const repo = await project("watch-refused-", LIST, [formDone]);

    const { exitCode, stderr, stdout } = await delivery(args, { cwd: repo });

    expect(stderr).toContain(message);
    expect(stdout).toBe("");
    expect(exitCode).toBe(EXIT.configuration);
  });

  it("describes --watch and --interval in the command's own help", async () => {
    const repo = await project("watch-help-", LIST, []);

    const { stdout } = await delivery(["status", "--help"], { cwd: repo });

    expect(stdout).toContain("--watch");
    expect(stdout).toContain("--interval <seconds>");
  });
});

describe("what tells a watch that the record has changed", () => {
  it("is the same while nothing is written, and different once a log grows", async () => {
    const repo = await project("watch-signature-", LIST, [formDone, footerAt(3)]);

    const before = await signatureOf(repo);
    const unchanged = await signatureOf(repo);
    await record(repo, 3);

    expect(unchanged).toBe(before);
    expect(await signatureOf(repo)).not.toBe(before);
  });
});
