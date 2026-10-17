import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cleanGitEnv } from "../git-env.js";
import type { MockScript } from "../mock-script.js";
import {
  attempt,
  BANNER,
  closedAt,
  damageLog,
  failedCheck,
  fill,
  FOOTER,
  FORM,
  HOMEPAGE,
  ID,
  stoppedAt,
  writeRecord,
  type TaskRun,
} from "../report/report-fixtures.js";
import { ReportDocument } from "../report/document.js";
import { NO_TASK_LIST } from "../report/text.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, PACKAGE, RUN_TIMEOUT, scriptFile, writeParkedItem, writeSupervisedRun } from "./command-fixtures.js";
import { takeRepoLock } from "../repo-lock.js";
import { SAVED_DATA, SAVED_TEXT } from "./saved-report.js";
import { notifyFailed, SCHEMA_AND_REPORT } from "./report-command.js";
import { EXIT } from "./failures.js";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { planConfig, writePlan } from "../packs/plan.js";
import { fixTaskFor } from "../packs/fix-task.js";
import { exampleRepo, sampleFinding, writeReview, writeFixPhase, PACK_FORBIDDEN } from "../packs/review-fixtures.js";

const LIST = [FORM, FOOTER, HOMEPAGE, BANNER];

const formDone: TaskRun = { runId: ID.form, task: FORM, closerRef: { type: "merge-back" }, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") };
const footerFailed: TaskRun = {
  runId: ID.footer,
  task: FOOTER,
  closerRef: { type: "merge-back" },
  history: [...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "2 links still point nowhere"), ...failedCheck(2, "escalate")],
  outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (1/1)"),
};

async function project(prefix: string, tasks: string[] | undefined, runs: TaskRun[]): Promise<string> {
  const repo = initTempRepo(prefix, { "package.json": PACKAGE, ...(tasks ? { "delivery.config.json": JSON.stringify({ tasks }) } : {}) });
  for (const run of runs) await writeRecord(repo, run);
  return repo;
}

/** Everything git can see of the folder, tracked or not, and the run records themselves, which git ignores. */
const everything = (repo: string): string =>
  ["status --porcelain --ignored", "stash list", "branch --list", "rev-parse HEAD"]
    .map((args) => execFileSync("git", args.split(" "), { cwd: repo, env: cleanGitEnv(), encoding: "utf-8" }))
    .concat(execFileSync("sh", ["-c", "find .delivery -type f | sort | xargs cksum"], { cwd: repo, encoding: "utf-8" }))
    .join("\n");

describe("delivery run notify", () => {
  it("says in one line when the notify command fails, and the run's exit code stands", async () => {
    const task = "add a hello function that greets a name, with a test";
    const repo = initTempRepo("report-notify-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: [task], notify: "echo broke >&2; exit 1" }),
    });
    const env = { [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [{ effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }], json: { status: "completed", rationale: "added hello.js" } }] }) };

    const { exitCode, stdout } = await delivery(["run"], { cwd: repo, env });

    expect(exitCode).toBe(0);
    expect(stdout.split("\n")).toContain(notifyFailed("broke"));
  }, RUN_TIMEOUT * 2);
});

describe("delivery report", () => {
  it("reports the project's task list: what landed, what needs the owner, and what was not started", async () => {
    const repo = await project("report-list-", LIST, [formDone, footerFailed]);

    const { exitCode, stdout, stderr } = await delivery(["report"], { cwd: repo });

    expect(stdout.split("\n")).toEqual([
      "Your task list: 1 of 4 tasks completed and merged; 1 failed after 2 attempts; 2 not started.",
      "Started 1 Oct 02:01 UTC; last activity 1 Oct 02:58 UTC.",
      "",
      "NEEDS YOU (1)",
      '  Task 2 of 4: "Fix the broken footer links"',
      "    Failed after 2 attempts. The agent tried 2 times and the check you set up still does not pass.",
      '    The agent said: "2 links still point nowhere"',
      "    Where the work is: this task's changes were not added to main.",
      "    To act: 1. Reword the task, or remove it from your list.",
      "            2. Run: delivery run",
      "    Full account: delivery status fix-the-broken-footer-links-20261001T022000Z",
      "",
      "DONE (1)",
      '  Task 1 of 4: "Add a contact form": merged into main at 02:19',
      "",
      "NOT STARTED (2)",
      '  Task 3 of 4: "Replace the old homepage"',
      '  Task 4 of 4: "Add a cookie banner"',
      "  These are waiting behind task 2. The harness does not skip a task that stopped, so it left these alone. Amend or remove task 2, then run `delivery run` to carry on with them.",
      "",
      "FOR WHOEVER TUNES THIS",
      "  Retries used across these tasks: agent corrections 1 of 6; check re-runs 0 of 6; check repairs 0 of 4; agent restarts 0 of 10; hand-off retries 0 of 6.",
      "  Time and cost were not recorded for this run.",
      "",
      "Next: delivery status --all (every run)",
      "",
    ]);
    expect(stderr).toBe("");
    // The report was made, so the command succeeded: a failed task is what the report says, not how the command went.
    expect(exitCode).toBe(0);
  });

  it("prints the same bytes every time for the same records", async () => {
    const repo = await project("report-same-", LIST, [formDone, footerFailed]);

    const first = await delivery(["report"], { cwd: repo });
    const second = await delivery(["report"], { cwd: repo });

    expect(first.stdout.split("\n")[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 failed after 2 attempts; 2 not started.");
    expect(second.stdout).toBe(first.stdout);
    expect(first.stdout).not.toContain("\u001B");
  });

  it("changes nothing: no file, no branch, no record", async () => {
    const repo = await project("report-read-only-", LIST, [formDone, footerFailed]);
    const before = everything(repo);

    const list = await delivery(["report"], { cwd: repo });
    const one = await delivery(["report", ID.footer], { cwd: repo });

    expect([list.exitCode, one.exitCode]).toEqual([0, 0]);
    expect(everything(repo)).toBe(before);
  });

  it("reports one task's run when given its id", async () => {
    const repo = await project("report-named-", LIST, [formDone, footerFailed]);

    const { exitCode, stdout } = await delivery(["report", ID.footer], { cwd: repo });
    const lines = stdout.split("\n");

    expect(lines[0]).toBe("This run: 0 of 1 task completed; 1 failed after 2 attempts.");
    expect(lines).toContain('  Task 2 of 4: "Fix the broken footer links"');
    expect(stdout).not.toContain("Add a contact form");
    expect(exitCode).toBe(0);
  });

  it("reports a run of several tasks at once when given its id, and says it is still going while it holds the folder", async () => {
    const repo = await project("report-run-", LIST, [formDone, { runId: ID.footer, task: FOOTER, history: attempt(1, "first go") }]);
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } }, [
      fill(1, ID.form, FORM),
      fill(2, ID.footer, FOOTER),
    ]);
    const release = await takeRepoLock(repo);

    const going = await delivery(["report", ID.run], { cwd: repo });
    await release?.();
    const stopped = await delivery(["report", ID.run], { cwd: repo });

    expect(going.stdout.split("\n")[0]).toBe(`This run is still going (4 tasks: 1 done, 1 working, 2 waiting to start). Follow it: delivery status --watch ${ID.run}`);
    expect(stopped.stdout.split("\n")[0]).toBe("This run stopped part way (4 tasks: 1 done, 1 not finished, 2 waiting to start). To carry on: delivery run");
    expect([going.exitCode, stopped.exitCode]).toEqual([0, 0]);
  });

  it("says so in one line, and reports the most recent run, when the project has no task list", async () => {
    const repo = await project("report-no-list-", undefined, [formDone, footerFailed]);

    const { exitCode, stdout } = await delivery(["report"], { cwd: repo });

    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "This project has no task list, so this is its most recent run.",
      "This run: 0 of 1 task completed; 1 failed after 2 attempts.",
    ]);
    expect(stdout).toContain('  Task: "Fix the broken footer links"');
    expect(stdout).toContain('    To act: Reword the task and run it again: delivery run --task "the reworded task"');
    expect(exitCode).toBe(0);
  });

  it("says there are no runs yet, and how to start one, in a folder that has never had one", async () => {
    const repo = await project("report-empty-", LIST, []);

    const { exitCode, stdout, stderr } = await delivery(["report"], { cwd: repo });

    expect(stdout).toBe("No runs yet in this folder. Start one with: delivery run\n\nNext: delivery run\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("names one damaged record with its file, says the report is incomplete, and still reports the rest", async () => {
    const repo = await project("report-damaged-", LIST, [formDone, footerFailed]);
    await damageLog(join(repo, ".delivery", "runs", ID.footer));

    const { exitCode, stdout, stderr } = await delivery(["report"], { cwd: repo });

    expect(stdout.split("\n").slice(0, 2)).toEqual([
      "Incomplete report: the record for task 2 is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/log.jsonl); the other 3 tasks are reported below.",
      "Your task list: 1 of 4 tasks completed and merged; 1 could not be read; 2 not started.",
    ]);
    expect(stdout).toContain('  Task 1 of 4: "Add a contact form": merged into main at 02:19');
    expect(stdout + stderr).not.toContain("    at ");
    expect(exitCode).toBe(0);
  });

  it("still reports when the damaged record is the very run asked about", async () => {
    const repo = await project("report-damaged-named-", LIST, [footerFailed]);
    await writeFile(join(repo, ".delivery", "runs", ID.footer, "case.json"), "{ truncated");

    const { exitCode, stdout } = await delivery(["report", ID.footer], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe(
      "Incomplete report: the record of run fix-the-broken-footer-links-20261001T022000Z is damaged (.delivery/runs/fix-the-broken-footer-links-20261001T022000Z/case.json); nothing else could be read.",
    );
    expect(exitCode).toBe(0);
  });

  it("fails, plainly, only when it could not answer: an id that names no run", async () => {
    const repo = await project("report-unknown-", LIST, [formDone]);

    const { exitCode, stdout, stderr } = await delivery(["report", "never-ran-20260101T000000Z"], { cwd: repo });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).not.toContain("    at ");
  });

  it("describes itself in the help, and is listed among the commands", async () => {
    const repo = await project("report-help-", LIST, []);

    const top = await delivery(["--help"], { cwd: repo });
    const own = await delivery(["report", "--help"], { cwd: repo });

    expect(top.stdout).toMatch(/^\s+report \[options\] \[run-id\]\s+say in plain words what happened/m);
    expect(own.stdout).toContain("--repo <path>");
    expect(own.stdout).toMatch(/--write\s+also save the report/);
  });

  it(
    "tells a real run of the list apart: the task that landed, and the one the agent stopped on for the owner's say-so",
    async () => {
      // Deliberately distinct in their first five words: a run id slugs only those.
      const hello = "add a hello function that greets a name, with a test";
      const purge = "delete every old page from the published site";
      const script: MockScript = {
        expectations: [
          { when: { promptContains: purge }, json: { status: "escalate", category: "authority", rationale: "this would delete 14 published pages" } },
          {
            when: { promptContains: hello },
            effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
            json: { status: "completed", rationale: "added hello.js" },
          },
        ],
      };
      const repo = await project("report-real-", [hello, purge, "a third task nobody reaches"], []);
      const env = { [TEST_MOCK_SCRIPT]: await scriptFile(script) };

      await delivery(["run"], { cwd: repo, env });
      const { exitCode, stdout } = await delivery(["report"], { cwd: repo, env });
      const lines = stdout.split("\n");

      expect(lines[0]).toBe("Your task list: 1 of 3 tasks completed and committed to its own branch; 1 needs your decision; 1 not started.");
      expect(lines).toContain("    Needs your decision. The agent stopped and said it could not go on without your say-so.");
      expect(lines).toContain('    The agent said: "this would delete 14 published pages"');
      expect(lines).toContain("    To act: 1. Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.");
      expect(lines).toContain('  Task 3 of 3: "a third task nobody reaches"');
      expect(exitCode).toBe(0);
    },
    RUN_TIMEOUT * 2,
  );

  it(
    "counts a real run's attempts when the check never passes",
    async () => {
      const task = "add a hello function that greets a name, with a test";
      const repo = initTempRepo("report-real-failing-", {
        "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "test ! -f broken.txt" } }),
        "delivery.config.json": JSON.stringify({ tasks: [task] }),
      });
      const env = { [TEST_MOCK_SCRIPT]: await scriptFile({ expectations: [{ effects: [{ write: { path: "broken.txt", content: "x\n" } }], json: { status: "completed", rationale: "I believe this is done" } }] }) };

      await delivery(["run"], { cwd: repo, env });
      const { exitCode, stdout } = await delivery(["report"], { cwd: repo, env });

      const lines = stdout.split("\n");

      expect(lines[0]).toBe("Your task list: 0 of 1 task completed; 1 failed after 4 attempts.");
      expect(lines).toContain("    Failed after 4 attempts. The agent tried 4 times and the check you set up still does not pass.");
      expect(lines).toContain('    The agent said: "I believe this is done"');
      expect(lines).toContain("  Retries used across this task: agent corrections 3 of 3; check re-runs 0 of 3; check repairs 0 of 2; agent restarts 0 of 5; hand-off retries 0 of 3.");
      expect(exitCode).toBe(0);
    },
    RUN_TIMEOUT * 2,
  );

  it("saves the report with --write, as text and as data, and says where: the saved text is what it printed", async () => {
    const repo = await project("report-write-", LIST, [formDone, footerFailed]);

    const { exitCode, stdout, stderr } = await delivery(["report", "--write"], { cwd: repo });

    expect(stdout.split("\n")).toContain("  Saved to: .delivery/last-report.txt and .delivery/last-report.json");
    expect(readFileSync(join(repo, SAVED_TEXT), "utf-8")).toBe(stdout);
    const data = JSON.parse(readFileSync(join(repo, SAVED_DATA), "utf-8")) as { schema: string; kind: string; counts: Record<string, number> };
    expect(data).toMatchObject({ schema: "delivery.report/1", kind: "list", counts: { closed: 1, escalated: 1, not_started: 2 } });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("saves the report on the run it is given with --write, replacing the pair saved before", async () => {
    const repo = await project("report-write-named-", LIST, [formDone, footerFailed]);
    await delivery(["report", "--write"], { cwd: repo });

    const { stdout } = await delivery(["report", ID.footer, "--write"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe("This run: 0 of 1 task completed; 1 failed after 2 attempts.");
    expect(readFileSync(join(repo, SAVED_TEXT), "utf-8")).toBe(stdout);
    expect(JSON.parse(readFileSync(join(repo, SAVED_DATA), "utf-8"))).toMatchObject({ kind: "task" });
  });

  it("names the saved copy without --write only while that copy is this very report", async () => {
    const repo = await project("report-saved-", LIST, [formDone, footerFailed]);
    const before = await delivery(["report"], { cwd: repo });
    const written = await delivery(["report", "--write"], { cwd: repo });

    const same = await delivery(["report"], { cwd: repo });
    const another = await delivery(["report", ID.footer], { cwd: repo });

    expect(before.stdout).not.toContain("Saved to");
    expect(same.stdout).toBe(written.stdout);
    expect(another.stdout).not.toContain("Saved to");
  });

  it("keeps the saved text free of colour, of patches and of the full text of any triage round, so it can be pasted into a message", async () => {
    const repo = await project("report-write-plain-", LIST, [formDone, footerFailed]);

    await delivery(["report", "--write"], { cwd: repo, isTTY: true });
    const text = readFileSync(join(repo, SAVED_TEXT), "utf-8");

    expect(text).not.toContain("\u001B");
    expect(text).not.toMatch(/^(diff --git|@@ |\+\+\+ |--- )/m);
    expect(text).not.toContain("gate_fail");
    expect(text.split("\n")[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 failed after 2 attempts; 2 not started.");
    expect(text.trimEnd().split("\n").at(-1)).toBe("Next: delivery status --all (every run)");
  });

  it("still prints the report, and says in one line that it was not saved and why, when the files cannot be written", async () => {
    const repo = await project("report-write-fails-", LIST, [formDone, footerFailed]);
    // A folder where the data file belongs: nothing can be written over it.
    mkdirSync(join(repo, SAVED_DATA), { recursive: true });

    const { exitCode, stdout, stderr } = await delivery(["report", "--write"], { cwd: repo });
    const lines = stdout.split("\n");

    expect(lines[0]).toBe("Your task list: 1 of 4 tasks completed and merged; 1 failed after 2 attempts; 2 not started.");
    expect(lines.filter((line) => line.includes("could not be saved"))).toHaveLength(1);
    expect(stdout).toMatch(/^ {2}This report could not be saved to \.delivery\/last-report\.txt and \.delivery\/last-report\.json\. The system said: "E[A-Z]+: /m);
    expect(stdout).not.toContain("Saved to");
    expect(existsSync(join(repo, SAVED_TEXT))).toBe(false);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("saves nothing with --write in a folder that has never had a run: there is no report to keep", async () => {
    const repo = await project("report-write-empty-", LIST, []);

    const { exitCode, stdout } = await delivery(["report", "--write"], { cwd: repo });

    expect(stdout).toBe("No runs yet in this folder. Start one with: delivery run\n\nNext: delivery run\n");
    expect(existsSync(join(repo, ".delivery"))).toBe(false);
    expect(exitCode).toBe(0);
  });

  describe("delivery report after a review's fix phase", () => {
    /** The report's own words: quoted record words, the command name, run ids and branches are data. */
    const ownWords = (text: string): string =>
      text
        .replace(/"[^"]*"/g, "")
        .replace(/delivery findings/g, "")
        .replace(/\b(surface\/\S+|\S+-\d{8}T\d{6}Z)/g, "");

    it("opens with which review it was and what came of it, then lists each problem under who must act", async () => {
      const repo = exampleRepo("report-review-");
      await writeFixPhase(repo);

      const { exitCode, stdout } = await delivery(["report"], { cwd: repo });
      const lines = stdout.split("\n");

      expect(lines[0]).toMatch(/^Security review of \S+: 6 problems found; you approved 5 and skipped 1\.$/);
      expect(lines[1]).toBe("2 are fixed and merged; 1 is waiting for your sign-off; 1 could not be fixed; 1 was stopped by a setup problem.");
      expect(lines).toEqual(
        expect.arrayContaining([
          "WAITING FOR YOUR SIGN-OFF (1)",
          '  Problem 1 of 6: "A password for the payments service is written in the code" (critical)',
          "    Say yes: delivery findings sign-off 1",
          "NEEDS YOU (1)",
          '  Problem 4 of 6: "The price shown at checkout can be negative" (low)',
          '    The agent said: "I could not find where the total is worked out."',
          "STOPPED, FOR YOUR ENGINEERS (1)",
          '  Problem 5 of 6: "Totals are rounded the wrong way" (low)',
          "DONE (2)",
          '  Problem 3 of 6: "Old payment code nothing uses" (medium): fixed and merged; tests only: no check of this specific problem',
          "SKIPPED BY YOU (1)",
        ]),
      );
      expect(stdout).not.toContain("  Task ");
      expect(ownWords(stdout)).not.toMatch(PACK_FORBIDDEN);
      expect(exitCode).toBe(0);
    });

    it("reads the same from another terminal during the fix phase as after an interruption", async () => {
      const repo = exampleRepo("report-review-live-");
      await writeFixPhase(repo, { interrupted: true });
      const release = await takeRepoLock(repo);
      let during: string;
      try {
        during = (await delivery(["report"], { cwd: repo })).stdout;
      } finally {
        await release?.();
      }
      const after = (await delivery(["report"], { cwd: repo })).stdout;

      expect(during.split("\n")[1]).toContain("1 is being fixed");
      expect(during).toBe(after);
    });

    it("says to carry on with delivery fix after an interruption", async () => {
      const repo = exampleRepo("report-review-stopped-");
      await writeFixPhase(repo, { interrupted: true });

      const lines = (await delivery(["report"], { cwd: repo })).stdout.split("\n");

      expect(lines[3]).toMatch(/nothing records whether it is still going\. If it is not, carry on with: delivery fix$/);
      expect(lines).toEqual(expect.arrayContaining(["BEING FIXED (1)"]));
    });

    it("tells what the review and its fixes cost in the tuning section", async () => {
      const repo = exampleRepo("report-review-cost-");
      await writeFixPhase(repo);

      const { stdout } = await delivery(["report"], { cwd: repo });
      const lines = stdout.split("\n");
      const tuning = lines.slice(lines.indexOf("FOR WHOEVER TUNES THIS") + 1);
      // Found by content, not offset: whether the retries and repairs lines precede it depends on what the fix phase recorded.
      const from = tuning.findIndex((line) => line.startsWith("  The review: "));

      expect(from).toBeGreaterThanOrEqual(0);
      expect(tuning[from + 1]).toMatch(/^ {2}The fixes(: |, recorded for )/);
      expect(stdout).not.toContain("for this run.");
    });

    it("tells a run of one fix by its id as a task, as before", async () => {
      const repo = exampleRepo("report-review-one-");
      await writeFixPhase(repo);

      const { stdout } = await delivery(["report", "fix-2-20261005T110100Z"], { cwd: repo });

      expect(stdout).toMatch(/^This run: /);
    });
  });
});

describe("delivery report --json", () => {
  /** Standard output read back as the document it is: output that is not one valid document fails here. */
  const documentIn = (stdout: string): ReportDocument => ReportDocument.parse(JSON.parse(stdout));

  it("lists the items parked on this machine, with the question each is waiting on", async () => {
    const repo = await project("report-parked-", LIST, [formDone]);
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "report-state-")) };
    await writeParkedItem(repo, env);

    const { exitCode, stdout } = await delivery(["report", "--json"], { cwd: repo, env });

    expect(exitCode).toBe(EXIT.ok);
    expect(documentIn(stdout).parked).toEqual([
      expect.objectContaining({ item: "backlog:a.md", intent: "Greet people.", reason: "decision", question: "Formal?", attempts: 1 }),
    ]);
  });

  it("prints the report as one document that names its format and version: the counts, and each task with why it stopped and who must act", async () => {
    const repo = await project("report-json-", LIST, [formDone, footerFailed]);

    const { exitCode, stdout, stderr } = await delivery(["report", "--json"], { cwd: repo });
    const doc = documentIn(stdout);

    expect(doc).toMatchObject({
      schema: "delivery.report/1",
      kind: "list",
      live: false,
      incomplete: [],
      run: null,
      trips: [],
      counts: { closed: 1, escalated: 1, aborted: 0, paused: 0, unfinished: 0, queued: 0, not_started: 2 },
    });
    expect(doc.surfaces.map((surface) => [surface.queue?.task, surface.task, surface.standing])).toEqual([
      [1, FORM, "closed"],
      [2, FOOTER, "escalated"],
      [3, HOMEPAGE, "not_started"],
      [4, BANNER, "not_started"],
    ]);
    expect(doc.surfaces[1]).toMatchObject({
      run: ID.footer,
      reason: "correction budget exhausted (1/1)",
      cause: { kind: "budget", population: "correction" },
      attempts: 2,
      escalation: null,
      plain: { group: "failed_after_attempts", audience: "owner", agentSaid: "2 links still point nowhere" },
    });
    expect(doc.surfaces[1]?.budgets).toContainEqual({ population: "correction", used: 1, max: 3 });
    expect(doc.surfaces[1]?.decisions.map((round) => [round.afterAttempt, round.verdict, round.rationale])).toEqual([
      [1, "reroute", "gate_fail: reroute"],
      [2, "escalate", "gate_fail: escalate"],
    ]);
    expect(doc.surfaces[1]?.states.map((visit) => visit.state)).toContain("TRIAGE");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("gives every task the same keys, with null where one does not apply, so a reader never probes for a key", async () => {
    const repo = await project("report-json-keys-", LIST, [formDone, footerFailed]);

    const { surfaces } = documentIn((await delivery(["report", "--json"], { cwd: repo })).stdout);

    for (const surface of surfaces) expect(Object.keys(surface).sort()).toEqual(Object.keys(surfaces[1] ?? {}).sort());
    expect(surfaces[3]).toMatchObject({ run: null, state: null, reason: null, cause: null, branch: null, plain: null, escalation: null, attempts: 0, decisions: [], states: [] });
  });

  it("covers one task's run and a run of several tasks, each named by its id", async () => {
    const repo = await project("report-json-named-", LIST, [formDone, { runId: ID.footer, task: FOOTER, history: attempt(1, "first go") }]);
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
    const release = await takeRepoLock(repo);

    const task = documentIn((await delivery(["report", ID.form, "--json"], { cwd: repo })).stdout);
    const going = documentIn((await delivery(["report", ID.run, "--json"], { cwd: repo })).stdout);
    await release?.();
    const stopped = documentIn((await delivery(["report", ID.run, "--json"], { cwd: repo })).stdout);

    expect(task).toMatchObject({ kind: "task", surfaces: [{ run: ID.form, standing: "closed" }] });
    expect(going).toMatchObject({ kind: "run", live: true, run: { runId: ID.run, concurrency: 2, tasks: 4, breaker: "HEALTHY", outcome: null }, counts: { closed: 1, unfinished: 1, queued: 2 } });
    expect(stopped.live).toBe(false);
  });

  it("says null for whether the work is still going where nothing records it", async () => {
    const repo = await project("report-json-unknown-", LIST, [formDone, { runId: ID.footer, task: FOOTER, history: attempt(1, "first go") }]);

    expect(documentIn((await delivery(["report", "--json"], { cwd: repo })).stdout).live).toBeNull();
  });

  it("marks a damaged task record as making the document incomplete, and still carries the other tasks", async () => {
    const repo = await project("report-json-damaged-", LIST, [formDone, footerFailed]);
    await damageLog(join(repo, ".delivery", "runs", ID.footer));

    const { exitCode, stdout } = await delivery(["report", "--json"], { cwd: repo });
    const doc = documentIn(stdout);

    expect(doc.incomplete).toEqual([{ run: ID.footer, file: `.delivery/runs/${ID.footer}/log.jsonl`, queue: { task: 2, of: 4 } }]);
    expect(doc.surfaces.map((surface) => surface.task)).toEqual([FORM, HOMEPAGE, BANNER]);
    expect(exitCode).toBe(0);
  });

  it("puts nothing on standard output but the document: no colour, and no sentence for a person even where the words would say one", async () => {
    const noList = await project("report-json-no-list-", undefined, [formDone, footerFailed]);
    const empty = await project("report-json-empty-", LIST, []);

    const recent = await delivery(["report", "--json"], { cwd: noList, isTTY: true });
    const nothing = await delivery(["report", "--json"], { cwd: empty, isTTY: true });

    expect(documentIn(recent.stdout)).toMatchObject({ kind: "task", surfaces: [{ run: ID.footer }] });
    expect(documentIn(nothing.stdout)).toMatchObject({ kind: "list", live: false, counts: { not_started: 4 } });
    expect(recent.stdout + nothing.stdout).not.toContain("\u001B");
    expect(recent.stdout).not.toContain(NO_TASK_LIST);
    expect(nothing.stdout).not.toContain("No runs yet");
    expect([recent.stderr, nothing.stderr]).toEqual(["", ""]);
  });

  it("prints with --write exactly the data it saves, beside the same text the report in words saves", async () => {
    const repo = await project("report-json-write-", LIST, [formDone, footerFailed]);
    const words = await delivery(["report", "--write"], { cwd: repo });

    const { stdout, stderr } = await delivery(["report", "--json", "--write"], { cwd: repo });

    expect(readFileSync(join(repo, SAVED_DATA), "utf-8")).toBe(stdout);
    expect(readFileSync(join(repo, SAVED_TEXT), "utf-8")).toBe(words.stdout);
    expect(stderr).toBe("");
  });

  it("says on standard error, never among the data, that the report could not be saved", async () => {
    const repo = await project("report-json-write-fails-", LIST, [formDone, footerFailed]);
    // A folder where the data file belongs: nothing can be written over it.
    mkdirSync(join(repo, SAVED_DATA), { recursive: true });

    const { exitCode, stdout, stderr } = await delivery(["report", "--json", "--write"], { cwd: repo });

    expect(documentIn(stdout).kind).toBe("list");
    expect(stderr).toMatch(/^This report could not be saved to \.delivery\/last-report\.txt and \.delivery\/last-report\.json\. The system said: "E[A-Z]+: /);
    expect(exitCode).toBe(0);
  });

  it("reports a fix's plan as the task list when the project has no configuration of its own, with each fix's tags", async () => {
    const repo = exampleRepo("report-plan-");
    const npm = { type: "command", command: "npm test", parseMode: "exitcode" } as const;
    const dir = await writeReview(repo, { findings: [sampleFinding()] });
    await writePlan(dir, planConfig([fixTaskFor("code", sampleFinding(), npm)], { gateRef: npm, closerRef: { type: "merge-back" }, budgets: DEFAULT_BUDGETS, concurrency: 1 }, {}, undefined));
    const { surfaces } = documentIn((await delivery(["report", "--json"], { cwd: repo })).stdout);
    expect(surfaces[0]).toMatchObject({
      task: "Fix: The price shown at checkout can be negative (checkout.js)",
      standing: "not_started",
      tags: { pack: "code", findingId: "0123456789ab", severity: "high", phase: "fix" },
    });
  });
});

describe("delivery report --schema", () => {
  it("prints the schema of both formats, anywhere: it needs no project and reads no record", async () => {
    const nowhere = mkdtempSync(join(tmpdir(), "report-schema-"));

    const { exitCode, stdout, stderr } = await delivery(["report", "--schema"], { cwd: nowhere, isTTY: true });
    const parsed = JSON.parse(stdout);

    expect(Object.keys(parsed)).toEqual(["delivery.report/1", "delivery.event/1"]);
    // Each schema has $schema and some structural content (properties or anyOf)
    for (const schema of Object.values(parsed) as Record<string, unknown>[]) {
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.properties || schema.anyOf).toBeTruthy();
    }
    expect(stdout).not.toContain("\u001B");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("describes every document and every event the commands print", async () => {
    const repo = await project("report-schema-valid-", LIST, [formDone, footerFailed]);
    await writeSupervisedRun(repo, { runId: ID.run, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, ID.form, FORM), fill(2, ID.footer, FOOTER)]);
    const printed = JSON.parse((await delivery(["report", "--schema"], { cwd: repo })).stdout);
    const [report, event] = [z.fromJSONSchema(printed["delivery.report/1"]), z.fromJSONSchema(printed["delivery.event/1"])];
    const out = async (...args: string[]): Promise<string> => (await delivery(args, { cwd: repo })).stdout;

    const documents = [
      JSON.parse(await out("report", "--json")),
      JSON.parse(await out("report", ID.footer, "--json")),
      JSON.parse(await out("report", ID.run, "--json")),
      JSON.parse(await out("status", ID.footer, "--json")).report,
      JSON.parse(await out("status", ID.run, "--json")).report,
    ];
    const events = (await out("--json", "status", "--watch", ID.run)).trimEnd().split("\n").map((line) => JSON.parse(line));

    for (const document of documents) expect(report.safeParse(document).error).toBeUndefined();
    expect(events.length).toBeGreaterThan(2);
    for (const line of events) expect(event.safeParse(line).error).toBeUndefined();
  });

  it("is described in the command's own help", async () => {
    const repo = await project("report-schema-help-", LIST, []);

    expect((await delivery(["report", "--help"], { cwd: repo })).stdout).toContain("--schema");
  });

  it("refuses --schema with a run id or --write", async () => {
    const repo = await project("report-schema-conflicts-", LIST, [formDone, footerFailed]);

    const withId = await delivery(["report", ID.footer, "--schema"], { cwd: repo });
    const withWrite = await delivery(["report", "--schema", "--write"], { cwd: repo });

    expect(withId.exitCode).toBe(2);
    expect(withId.stdout).toBe("");
    expect(withId.stderr).toContain(SCHEMA_AND_REPORT);

    expect(withWrite.exitCode).toBe(2);
    expect(withWrite.stdout).toBe("");
    expect(withWrite.stderr).toContain(SCHEMA_AND_REPORT);
  });
});
