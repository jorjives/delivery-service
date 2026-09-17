import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { CaseFileOutcome } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { ESCALATION, delivery, PACKAGE, writeRunRecord } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { runPlace, runsRoot } from "./run-location.js";
import { NOTHING_HERE, readRun } from "./runs.js";
import { ALL_AND_ONE, statusDocument, statusReport, type RunStatusDocument } from "./status-command.js";
import { initTempRepo } from "../temp-repo.js";
import { plainReporter } from "./report.js";

const AT = "2026-09-14T21:05:09.123Z";
const RUN_ID = "add-a-hello-function-20260914T210309Z";
const TASK = "add a function that says hello to a name, with a test";

/** A context with nobody in front of it: no colour, no answers, and its own state folder so the working copy's place is this test's. */
async function context(): Promise<CommandContext> {
  return {
    cwd: "/nowhere",
    env: { XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "status-state-")) },
    colour: false,
    json: false,
    stdin: Object.assign(Readable.from([]), { isTTY: undefined }),
    writeLine: () => undefined,
    report: plainReporter(() => undefined, false),
  };
}

/** A repository holding exactly one run's record, and the report that record makes. */
async function reportOn(
  record: { runId: string; task?: string; outcome?: CaseFileOutcome; packet?: EscalationPacket },
  ctx: CommandContext,
): Promise<{ repo: string; lines: string[] }> {
  const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
  await writeRunRecord(repo, record);
  return { repo, lines: await statusReport(await readRun(repo, record.runId), ctx) };
}

describe("what a run's record says about an unfinished run", () => {
  it("says it did not finish, what picking it up will do next, and how to pick it up", async () => {
    const { lines } = await reportOn({ runId: RUN_ID, task: TASK }, await context());
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      "This run hasn't finished. Picking it up will carry on with getting the agent going.",
      `To finish it: delivery resume ${RUN_ID}`,
    ]);
  });
});

describe("what a run's record says about a closed run", () => {
  it("says what was done, when it finished, and the branch the work is on", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, task: TASK, outcome: { kind: "closed", source: "closer", reason: "committed", at: AT } },
      await context(),
    );
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      `Done: the change for "${TASK}" passed \`npm test\` and is committed on branch surface/${RUN_ID}.`,
      "It finished 2026-09-14 21:05 UTC.",
      `main was not changed. To look at the work: git log surface/${RUN_ID}`,
    ]);
  });
});

describe("what a run's record says about an escalated run", () => {
  it("leads with the decision, then quotes the packet's own words, then says where to look", async () => {
    const ctx = await context();
    const { repo, lines } = await reportOn(
      {
        runId: RUN_ID,
        task: TASK,
        outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
        packet: ESCALATION,
      },
      ctx,
    );
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      `This needs your decision: ${ESCALATION.decision}`,
      "It stopped 2026-09-14 21:05 UTC.",
      "",
      "What the harness saw:",
      ESCALATION.evidence,
      "",
      "What had already been tried:",
      ESCALATION.dead_ends,
      "",
      "Why it stopped when it did:",
      ESCALATION.why_now,
      "",
      "The agent sessions behind this:",
      "  worker-1-0",
      "  triage-1-0",
      "",
      "Where to look:",
      `  The branch surface/${RUN_ID} was kept.`,
      "  The agent's working copy has been cleared away.",
      `  Everything this run recorded is in ${join(runsRoot(repo), RUN_ID)}.`,
    ]);
  });

  it("names the agent's working copy while it is still on disk", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, {
      runId: RUN_ID,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });
    const { location } = runPlace(repo, RUN_ID, ctx.env);
    await mkdir(location.worktreePath, { recursive: true });

    const lines = await statusReport(await readRun(repo, RUN_ID), ctx);
    expect(lines).toContain(`  The agent's working copy is still at ${location.worktreePath}.`);
    expect(lines).not.toContain("  The agent's working copy has been cleared away.");
  });

  it("falls back to the recorded reason when the run kept no packet", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT } },
      await context(),
    );
    expect(lines[1]).toBe("This needs your decision: authority limit");
    expect(lines).not.toContain("What had already been tried:");
    expect(lines).toContain("Where to look:");
  });
});

describe("what a run's record says about an aborted run", () => {
  it("says in plain language why it stopped, and where to look", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, task: TASK, outcome: { kind: "aborted", source: "triage", reason: "the task cannot be done", at: AT } },
      await context(),
    );
    expect(lines.slice(0, 3)).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      "The run stopped: the task cannot be done",
      "It stopped 2026-09-14 21:05 UTC.",
    ]);
    expect(lines).toContain(`  The branch surface/${RUN_ID} was kept.`);
  });
});

const CLOSED = { kind: "closed", source: "closer", reason: "committed", at: AT } as const;

/** Push a record's write times into the past, so "most recently touched" is settled by the test rather than by how fast the disk was. */
async function backdate(dir: string): Promise<void> {
  const longAgo = new Date("2026-09-14T21:04:00.000Z");
  for (const name of ["case.json", "log.jsonl"]) await utimes(join(dir, name), longAgo, longAgo);
}

describe("delivery status", () => {
  it("reports on the run whose id it is given", async () => {
    const repo = initTempRepo("status-named-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260914T220000Z", task: "add a goodbye" });

    const { stdout, exitCode } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(`Run ${RUN_ID}`);
    expect(stdout).toContain("It finished 2026-09-14 21:05 UTC.");
    expect(stdout).not.toContain("add a goodbye");
  });

  it("reports on the run touched most recently, whether it is asked with --last or with nothing at all", async () => {
    const repo = initTempRepo("status-last-", { "package.json": PACKAGE });
    await backdate(await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED }));
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260914T220000Z", task: "add a goodbye" });

    const withFlag = await delivery(["status", "--last"], { cwd: repo });
    const bare = await delivery(["status"], { cwd: repo });

    expect(withFlag.stdout).toBe(bare.stdout);
    expect(bare.exitCode).toBe(EXIT.ok);
    expect(bare.stdout).toContain("Run add-a-goodbye-20260914T220000Z");
  });

  it("exits ok after reporting an escalated run: reading it is not the run's own outcome", async () => {
    const repo = initTempRepo("status-escalated-", { "package.json": PACKAGE });
    await writeRunRecord(repo, {
      runId: RUN_ID,
      task: TASK,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });

    const { stdout, exitCode } = await delivery(["status", "--last"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const decision = stdout.indexOf(`This needs your decision: ${ESCALATION.decision}`);
    expect(decision).toBeGreaterThan(-1);
    expect(stdout.indexOf(ESCALATION.evidence)).toBeGreaterThan(decision);
    expect(stdout.indexOf(ESCALATION.dead_ends)).toBeGreaterThan(stdout.indexOf(ESCALATION.evidence));
    expect(stdout.indexOf(ESCALATION.why_now)).toBeGreaterThan(stdout.indexOf(ESCALATION.dead_ends));
    expect(stdout.indexOf("Where to look:")).toBeGreaterThan(stdout.indexOf(ESCALATION.why_now));
  });

  it("leaves the run's record exactly as it found it", async () => {
    const repo = initTempRepo("status-read-only-", { "package.json": PACKAGE });
    const dir = await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    const before = ["case.json", "log.jsonl"].map((name) => ({
      text: readFileSync(join(dir, name), "utf-8"),
      touched: statSync(join(dir, name)).mtimeMs,
    }));

    await delivery(["status", "--last"], { cwd: repo });

    expect(
      ["case.json", "log.jsonl"].map((name) => ({
        text: readFileSync(join(dir, name), "utf-8"),
        touched: statSync(join(dir, name)).mtimeMs,
      })),
    ).toEqual(before);
  });

  it("says how to start a run when this repository has never had one, and stops", async () => {
    const repo = initTempRepo("status-empty-", { "package.json": PACKAGE });

    const { stderr, exitCode } = await delivery(["status"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(NOTHING_HERE);
    expect(stderr).not.toContain("    at ");
  });

  it("says how to start a run when the id names nothing, and stops", async () => {
    const repo = initTempRepo("status-unknown-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });

    const { stderr, exitCode } = await delivery(["status", "never-ran-20260101T000000Z"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).toContain('delivery run --task "..."');
    expect(stderr).not.toContain("    at ");
  });

  it("describes itself in the help, and is listed among the commands", async () => {
    const repo = initTempRepo("status-help-", { "package.json": PACKAGE });

    const top = await delivery(["--help"], { cwd: repo });
    const own = await delivery(["status", "--help"], { cwd: repo });

    expect(top.stdout).toContain("status [options] [run-id]");
    expect(own.stdout).toContain("Usage: delivery status");
    expect(own.stdout).toContain("--last");
    expect(own.stdout).toContain("--repo");
  });
});

describe("delivery status --json", () => {
  it("prints one JSON document instead of the plain-language lines, for a run that hasn't finished", async () => {
    const repo = initTempRepo("status-json-unfinished-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const { stdout, exitCode } = await delivery(["status", "--json", "--last"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const document = JSON.parse(stdout) as RunStatusDocument;
    expect(document).toMatchObject({
      run: RUN_ID,
      task: TASK,
      startedAt: "2026-09-14T21:03:09Z",
      outcome: "unfinished",
      nextStep: "start",
    });
    expect(stdout).not.toContain("This run hasn't finished");
  });

  it("reports a closed run as a document naming the outcome, not the plain-language sentence", async () => {
    const repo = initTempRepo("status-json-closed-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });

    const { stdout } = await delivery(["status", "--json", "--last"], { cwd: repo });

    const document = JSON.parse(stdout.trim()) as RunStatusDocument;
    expect(document).toMatchObject({
      run: RUN_ID,
      task: TASK,
      startedAt: "2026-09-14T21:03:09Z",
      outcome: "closed",
      finishedAt: AT,
      reason: "committed",
      nextStep: null,
    });
    expect(document.summary).toContain(`Done: the change for "${TASK}"`);
  });

  it("carries the escalation packet and where the work was kept, unparaphrased, for an escalated run", async () => {
    const repo = initTempRepo("status-json-escalated-", { "package.json": PACKAGE });
    await writeRunRecord(repo, {
      runId: RUN_ID,
      task: TASK,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });

    const { stdout } = await delivery(["status", "--json", "--last"], { cwd: repo });

    const document = JSON.parse(stdout.trim()) as RunStatusDocument;
    expect(document.outcome).toBe("escalated");
    expect(document.escalation).toEqual(ESCALATION);
    expect(document.branch).toBe(`surface/${RUN_ID}`);
    expect(document.worktree).toBeNull();
    expect(document.dir).toBe(join(runsRoot(repo), RUN_ID));
  });

  it("says plainly on standard error, not as JSON, when the id names nothing", async () => {
    const repo = initTempRepo("status-json-unknown-", { "package.json": PACKAGE });

    const { stdout, stderr, exitCode } = await delivery(["status", "never-ran-20260101T000000Z", "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toBe("");
    expect(stderr).toContain("I couldn't find that run's record");
  });
});

describe("one run's status as one JSON document", () => {
  it("says the run, the task, when it started and that it hasn't finished, with what picking it up would do first", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const document = await statusDocument(await readRun(repo, RUN_ID), ctx);

    expect(document).toMatchObject({
      run: RUN_ID,
      task: TASK,
      startedAt: "2026-09-14T21:03:09Z",
      outcome: "unfinished",
      nextStep: "start",
      finishedAt: null,
      reason: null,
      summary: null,
      details: [],
      escalation: null,
      branch: `surface/${RUN_ID}`,
      base: "main",
      dir: join(runsRoot(repo), RUN_ID),
    });
  });

  it("says how a closed run ended, in the same sentence the plain-language report leads with", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    const record = await readRun(repo, RUN_ID);

    const document = await statusDocument(record, ctx);
    const lines = await statusReport(record, ctx);

    expect(document).toMatchObject({
      outcome: "closed",
      finishedAt: AT,
      reason: "committed",
      nextStep: null,
      escalation: null,
    });
    expect(document.summary).toBe(lines[1]);
    // The lines the report prints under that sentence, which a closer such as
    // open-pr fills with something no other field carries.
    expect(document.details).toEqual(lines.slice(3));
  });

  it("carries every field of the packet a run escalated with", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, {
      runId: RUN_ID,
      task: TASK,
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });

    const document = await statusDocument(await readRun(repo, RUN_ID), ctx);

    expect(document.outcome).toBe("escalated");
    expect(document.escalation).toEqual(ESCALATION);
  });

  it("names the agent's working copy while it is on disk, and says null once it is gone", async () => {
    const repo = await mkdtemp(join(tmpdir(), "status-repo-"));
    const ctx = await context();
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });
    expect((await statusDocument(await readRun(repo, RUN_ID), ctx)).worktree).toBeNull();

    const { location } = runPlace(repo, RUN_ID, ctx.env);
    await mkdir(location.worktreePath, { recursive: true });
    expect((await statusDocument(await readRun(repo, RUN_ID), ctx)).worktree).toBe(location.worktreePath);
  });
});

describe("a run that answers for a task on the project's list", () => {
  it("says which task of how many it is", async () => {
    const ctx = await context();
    const repo = await mkdtemp(join(tmpdir(), "status-queue-"));
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const lines = await statusReport(await readRun(repo, RUN_ID), ctx, { task: 2, of: 3 });

    expect(lines[1]).toBe("It is task 2 of 3 on your list.");
  });

  it("says nothing of the kind about a run the list doesn't ask for", async () => {
    const ctx = await context();
    const repo = await mkdtemp(join(tmpdir(), "status-queue-none-"));
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const lines = await statusReport(await readRun(repo, RUN_ID), ctx);

    expect(lines.join("\n")).not.toContain("on your list");
  });

  it("carries the same position in the machine-readable document, and a null when there is none", async () => {
    const ctx = await context();
    const repo = await mkdtemp(join(tmpdir(), "status-queue-json-"));
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const record = await readRun(repo, RUN_ID);

    expect((await statusDocument(record, ctx, { task: 2, of: 3 })).queue).toEqual({ task: 2, of: 3 });
    expect((await statusDocument(record, ctx)).queue).toBeNull();
  });

  it("works the position out from the project's file as it is written now", async () => {
    const repo = initTempRepo("status-queue-command-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ tasks: ["something else entirely", TASK] }),
    });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const { exitCode, stdout } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("It is task 2 of 2 on your list.");
  });
});

describe("delivery status --all", () => {
  /** Three runs in one repository: one finished, one that needed a person, one still going. */
  async function threeRuns(prefix: string): Promise<string> {
    const repo = initTempRepo(prefix, { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: "add-a-hello-20260914T210309Z", task: "add a hello", outcome: CLOSED });
    await writeRunRecord(repo, {
      runId: "delete-the-greeting-20260915T090000Z",
      task: "delete the greeting",
      outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT },
      packet: ESCALATION,
    });
    await writeRunRecord(repo, { runId: "add-a-goodbye-20260916T113000Z", task: "add a goodbye" });
    return repo;
  }

  it("lists every run, newest first, with its task and how it ended", async () => {
    const repo = await threeRuns("status-all-");

    const { stdout, exitCode } = await delivery(["status", "--all"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n").filter((line) => line.startsWith("  "))).toEqual([
      "  add-a-goodbye-20260916T113000Z, started 2026-09-16 11:30 UTC: add a goodbye (hasn't finished yet)",
      "  delete-the-greeting-20260915T090000Z, started 2026-09-15 09:00 UTC: delete the greeting (needs a decision from you)",
      "  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished)",
    ]);
  });

  it("lists every run as JSON, newest first, with the four things a script sorts and filters on", async () => {
    const repo = await threeRuns("status-all-json-");

    const { stdout, exitCode } = await delivery(["status", "--all", "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toEqual([
      { run: "add-a-goodbye-20260916T113000Z", task: "add a goodbye", startedAt: "2026-09-16T11:30:00Z", outcome: "unfinished" },
      { run: "delete-the-greeting-20260915T090000Z", task: "delete the greeting", startedAt: "2026-09-15T09:00:00Z", outcome: "escalated" },
      { run: "add-a-hello-20260914T210309Z", task: "add a hello", startedAt: "2026-09-14T21:03:09Z", outcome: "closed" },
    ]);
  });

  it("orders by when each run started, not by which record was written last", async () => {
    const repo = await threeRuns("status-all-order-");
    // The newest run's record is now the least recently written, which is what
    // resuming an older run leaves behind. It is still the newest run.
    await backdate(join(runsRoot(repo), "add-a-goodbye-20260916T113000Z"));

    const { stdout } = await delivery(["status", "--all"], { cwd: repo });

    expect(stdout).toContain("  add-a-goodbye-20260916T113000Z");
    expect(stdout.indexOf("add-a-goodbye")).toBeLessThan(stdout.indexOf("add-a-hello"));
  });

  it("says there is nothing here yet, and exits ok: an empty list is an answer", async () => {
    const repo = initTempRepo("status-all-empty-", { "package.json": PACKAGE });

    const plain = await delivery(["status", "--all"], { cwd: repo });
    const json = await delivery(["status", "--all", "--json"], { cwd: repo });

    expect(plain.exitCode).toBe(EXIT.ok);
    expect(plain.stdout).toContain(NOTHING_HERE);
    expect(json.exitCode).toBe(EXIT.ok);
    expect(JSON.parse(json.stdout)).toEqual([]);
  });

  it("stops when it is given both --all and a run id, rather than quietly ignoring one", async () => {
    const repo = await threeRuns("status-all-conflict-");

    const { stderr, exitCode } = await delivery(["status", "--all", "add-a-hello-20260914T210309Z"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(ALL_AND_ONE);
    expect(stderr).not.toContain("    at ");
  });

  it("describes --all in the command's own help", async () => {
    const repo = initTempRepo("status-all-help-", { "package.json": PACKAGE });

    const { stdout } = await delivery(["status", "--help"], { cwd: repo });

    expect(stdout).toContain("--all");
  });
});
