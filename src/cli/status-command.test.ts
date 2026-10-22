import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { CaseFileOutcome, RunEntry, SlotOutcome } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { CommandContext } from "./context.js";
import { ESCALATION, delivery, PACKAGE, writeParkedItem, writeRunRecord, writeSupervisedRun } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { runPlace, runsRoot, supervisedPlace } from "../run-location.js";
import { writeRef } from "../case-file.js";
import { NOTHING_HERE, readRun } from "./runs.js";
import { ALL_AND_DECISIONS, ALL_AND_ONE, ALL_AND_REPAIRS, statusDocument, statusReport, type RunStatusDocument } from "./status-command.js";
import { RESUME_DOES_NOT_APPLY, UNCHANGED_NOT_RUN_AGAIN } from "../report/detail.js";
import { ReportDocument } from "../report/document.js";
import { attempt, BRIEF, CHANGES_TOUCHING_CHECK, closedAt, failedCheck, FORM, ID, ownRepair, PACKET, setupRepair, stoppedAt, timed, writeRecord } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { git } from "../../tests/helpers.js";
import { plainReporter } from "./report.js";
import { appendRunEntry, setRunOutcome } from "../run-file.js";
import { STOPPED_PART_WAY } from "./queue.js";
import { takeRepoLock } from "../repo-lock.js";
import { WAITING_FOR_A_SLOT } from "./status-command.js";
import { heldPath, recordHeld } from "../held-sequences.js";
import { ledgerPath } from "../item-ledger.js";
import { STEP_PHRASES } from "./output.js";
import { stackedDelivery } from "../delivery-fixtures.js";
import { deliveryLedgerPath } from "../delivery-ledger.js";

const AT = "2026-09-14T21:05:09.123Z";
const RUN_ID = "add-a-hello-function-20260914T210309Z";
const OTHER_ID = "add-a-hello-function-20260914T220309Z";
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

/** A repository holding exactly one run's record, the branch its stopped task kept (unless told it kept none), and the report that record makes. */
async function reportOn(
  record: { runId: string; task?: string; outcome?: CaseFileOutcome; packet?: EscalationPacket },
  ctx: CommandContext,
  { keptBranch = true }: { keptBranch?: boolean } = {},
): Promise<{ repo: string; lines: string[] }> {
  const repo = initTempRepo("status-repo-", { "seed.txt": "seed\n" });
  if (keptBranch) git(repo, ["branch", `surface/${record.runId}`]);
  await writeRunRecord(repo, record);
  return { repo, lines: await statusReport(await readRun(repo, record.runId), ctx) };
}

describe("what a run's record says about an unfinished run", () => {
  it("says it did not finish, what picking it up will do next, and how to pick it up", async () => {
    const { lines } = await reportOn({ runId: RUN_ID, task: TASK }, await context());
    expect(lines).toEqual([
      `Run ${RUN_ID}, started 2026-09-14 21:03 UTC: ${TASK}`,
      "This run hasn't finished. Picking it up will carry on with getting the agent going.",
      "Last recorded activity: not recorded.",
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

describe("what a run's record says about a stopped run whose agent changed nothing", () => {
  it("says no branch was kept, rather than naming one that is not there", async () => {
    const { lines } = await reportOn(
      { runId: RUN_ID, task: TASK, outcome: { kind: "aborted", source: "triage", reason: "the task cannot be done", at: AT } },
      await context(),
      { keptBranch: false },
    );
    expect(lines).toContain("  No branch was kept: the agent had changed nothing.");
    expect(lines.join("\n")).not.toContain(`surface/${RUN_ID}`);
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
  it("shows the stack in delivery status", async () => {
    const repo = initTempRepo("status-stack-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [FORM] }) });
    const env = { XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "status-state-")) };
    await writeRecord(repo, { runId: ID.form, task: FORM, history: attempt(1, "added the form"), outcome: closedAt("2026-10-01T02:19:10.000Z") });
    await stackedDelivery(repo, deliveryLedgerPath(ledgerPath(repo, env)), {
      stacked: true,
      landings: [
        { runId: ID.form, key: "backlog:form.md", intent: "Add a contact form." },
        { runId: ID.footer, key: "backlog:footer.md", intent: "Fix the footer." },
      ],
      pulls: [{ runId: ID.form, url: "https://example.invalid/pull/1", state: "OPEN" }],
    });

    const { exitCode, stdout } = await delivery(["status"], { cwd: repo, env });
    const lines = stdout.split("\n");
    const start = lines.indexOf("Stacked pull requests on main, bottom first:");

    expect(exitCode).toBe(EXIT.ok);
    expect(lines.slice(start, start + 3)).toEqual([
      "Stacked pull requests on main, bottom first:",
      "- 1. Add a contact form. (backlog:form.md): https://example.invalid/pull/1, open",
      "- 2. Fix the footer. (backlog:footer.md): no pull request yet",
    ]);
  });

  it("shows a backlog item's key without anything that could drive the terminal", async () => {
    const repo = initTempRepo("status-item-hostile-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED, item: { key: "backlog:b.md\u001B[2J", source: "backlog", id: "b.md" } });

    const { stdout } = await delivery(["status", RUN_ID], { cwd: repo, env: { XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "status-state-")) } });

    expect(stdout.split("\n")).toContain("Item: backlog:b.md");
  });

  it("names the backlog item the run works on, and lists the items parked on this machine", async () => {
    const repo = initTempRepo("status-item-", { "package.json": PACKAGE });
    const env = { XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "status-state-")) };
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED, item: { key: "backlog:b.md", source: "backlog", id: "b.md" } });
    await writeParkedItem(repo, env);

    const { stdout, exitCode } = await delivery(["status", RUN_ID], { cwd: repo, env });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")).toEqual(expect.arrayContaining([
      "Item: backlog:b.md",
      "",
      "Parked, skipped until you deal with them:",
      '- backlog:a.md (Greet people.): asked "Formal?". Answer with: delivery answer backlog:a.md "your answer"',
    ]));
  });

  it("names each held sequence, the item holding it, and why", async () => {
    const repo = initTempRepo("status-held-", { "package.json": PACKAGE });
    const env = { XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "status-state-")) };
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED, item: { key: "backlog:b.md", source: "backlog", id: "b.md" } });
    await writeParkedItem(repo, env);
    await recordHeld(heldPath(ledgerPath(repo, env)), [{ sequence: "spec-a", item: "backlog:a.md", source: "backlog", reason: "decision" }], ["backlog"]);

    const { stdout, exitCode } = await delivery(["status", RUN_ID], { cwd: repo, env });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")).toEqual(expect.arrayContaining([
      "Sequences waiting, nothing later in each is started until the item holding it moves on:",
      '- spec-a: held by backlog:a.md, which waits for your answer. Answer with: delivery answer backlog:a.md "your answer"',
    ]));
  });

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

describe("delivery status, beneath its own account of one task", () => {
  const FORM = "Add a contact form";
  const FOOTER = "Fix the broken footer links";
  const FOOTER_RUN = "fix-the-broken-footer-links-20261001T022000Z";

  /** A project whose second task failed its check after every attempt: four attempts, four triage rounds, the corrections spent. */
  async function footerStopped(prefix: string): Promise<string> {
    const repo = initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [FORM, FOOTER] }) });
    await writeRecord(repo, {
      runId: FOOTER_RUN,
      task: FOOTER,
      history: [
        ...attempt(1, "first go"),
        ...failedCheck(1, "reroute"),
        ...attempt(2, "second go"),
        ...failedCheck(2, "reroute"),
        ...attempt(3, "third go"),
        ...failedCheck(3, "reroute"),
        ...attempt(4, "I fixed 4 of the 6 links."),
        ...failedCheck(4, "escalate"),
      ],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (3/3)"),
      refs: {
        "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute", artifact: BRIEF },
        "triage-1": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
        "triage-2": { trigger: "gate_fail", rationale: "gate_fail: reroute" },
        "triage-3": { trigger: "gate_fail", rationale: "gate_fail: escalate", artifact: PACKET },
      },
    });
    return repo;
  }

  it("keeps every line it printed before, then says how the task got here, the retries at stop and what to do", async () => {
    const repo = await footerStopped("status-detail-");

    const { stdout, exitCode } = await delivery(["status", FOOTER_RUN], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const before = await statusReport(await readRun(repo, FOOTER_RUN), await context(), { task: 2, of: 2 });
    expect(lines.slice(0, before.length)).toEqual(before);
    expect(lines.slice(before.length)).toEqual([
      "",
      "How it got here (triage rounds; --decisions for the full text):",
      "  After attempt 1: a gate failure; verdict: reroute",
      "  After attempt 2: a gate failure; verdict: reroute",
      "  After attempt 3: a gate failure; verdict: reroute",
      "  After attempt 4: a gate failure; verdict: escalate",
      "",
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Time and cost were not recorded for this task.",
      "",
      "Repairs: none ran for this task.",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
      "",
      `Next: delivery status ${FOOTER_RUN} --decisions (every triage round in full), delivery report (your task list)`,
    ]);
  });

  it("gives the advice `delivery report` gives for the same task", async () => {
    const repo = await footerStopped("status-detail-advice-");

    const status = await delivery(["status", FOOTER_RUN], { cwd: repo });
    const report = await delivery(["report", FOOTER_RUN], { cwd: repo });

    const advice = status.stdout.split("\n").filter((line) => /^(To act:| {8}\d\.)/.test(line));
    expect(advice).toHaveLength(2);
    for (const line of advice) expect(report.stdout.split("\n")).toContain(`    ${line}`);
  });

  it("prints every triage round in full with --decisions, in place of the one line each", async () => {
    const repo = await footerStopped("status-decisions-");

    const { stdout, exitCode } = await delivery(["status", FOOTER_RUN, "--decisions"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const at = lines.indexOf("How it got here (4 triage rounds, in full):");
    expect(lines.slice(at + 1, at + 11)).toEqual([
      "  Round 1, after attempt 1",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session:",
      `      Problem: ${BRIEF.problem}`,
      `      Dead ends: ${BRIEF.dead_ends}`,
      `      Scope: ${BRIEF.scope}`,
      "      References: worker-1-0",
      `      Diagnosis (a hypothesis to test, not an established fact): ${BRIEF.diagnosis}`,
    ]);
    expect(stdout).toContain(`      Decision: "${PACKET.decision}"`);
    expect(stdout).not.toContain("--decisions for the full text");
    expect(lines.at(-1)).toBe("Next: delivery report (your task list)");
    // The account above the rounds, and the retries and advice below them, are there as they are without the flag.
    const before = await statusReport(await readRun(repo, FOOTER_RUN), await context(), { task: 2, of: 2 });
    expect(lines.slice(0, before.length)).toEqual(before);
    expect(lines.slice(-13, -2)).toEqual([
      "Retry budgets at stop, after 4 attempts:",
      "  correction 3 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Time and cost were not recorded for this task.",
      "",
      "Repairs: none ran for this task.",
      "",
      "To act: 1. Reword the task, or remove it from your list.",
      "        2. Run: delivery run",
      UNCHANGED_NOT_RUN_AGAIN,
      RESUME_DOES_NOT_APPLY,
    ]);
  });

  it("says in one line each that a finished task had no triage rounds and did not stop", async () => {
    const repo = initTempRepo("status-detail-closed-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: CLOSED });

    const { stdout } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(stdout.trimEnd().split("\n").slice(4)).toEqual([
      "",
      "How it got here: no triage rounds.",
      "",
      "Retry budgets when it finished, after 0 attempts:",
      "  correction 0 of 3, gate recheck 0 of 3, gate repair 0 of 2, session retry 0 of 5, close retry 0 of 3",
      "",
      "Time and cost were not recorded for this task.",
      "",
      "Repairs: none ran for this task.",
      "",
      "No stop: this run finished.",
      "",
      "Next: delivery report (your task list)",
    ]);
  });

  it("says of a run that has not finished that it has not stopped, after saying how to carry it on", async () => {
    const repo = initTempRepo("status-detail-unfinished-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const lines = (await delivery(["status", RUN_ID], { cwd: repo })).stdout.trimEnd().split("\n");

    expect(lines[3]).toBe(`To finish it: delivery resume ${RUN_ID}`);
    expect(lines).toContain("Retry budgets so far, after 0 attempts:");
    expect(lines).toContain("No stop: this run has not finished.");
    expect(lines.at(-1)).toBe("Next: delivery report (your task list)");
  });

  it("states the last recorded activity of a run that has not finished as a time", async () => {
    const repo = initTempRepo("status-detail-last-activity-", { "package.json": PACKAGE });
    await writeRecord(repo, { runId: FOOTER_RUN, task: FOOTER, history: timed(attempt(1, "first go"), "2026-10-01T02:21:00.000Z") });

    const lines = (await delivery(["status", FOOTER_RUN], { cwd: repo })).stdout.trimEnd().split("\n");

    expect(lines.slice(1, 4)).toEqual([
      "This run hasn't finished. Picking it up will carry on with checking the agent's work.",
      "Last recorded activity: 2026-10-01 02:22 UTC.",
      `To finish it: delivery resume ${FOOTER_RUN}`,
    ]);
  });

  it("shows what an older record holds, and says not recorded for the advice it cannot back", async () => {
    const repo = initTempRepo("status-detail-old-", { "package.json": PACKAGE });
    await writeRecord(repo, {
      runId: FOOTER_RUN,
      task: FOOTER,
      history: [...attempt(1, "first go"), ...failedCheck(1, "escalate")],
      outcome: stoppedAt("2026-09-01T10:00:00.000Z", undefined, "correction budget exhausted (3/3)"),
    });

    const { stdout, exitCode } = await delivery(["status", FOOTER_RUN, "--decisions"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("This needs your decision: correction budget exhausted (3/3)");
    expect(stdout).toContain("    Packet for a person: not recorded.");
    expect(stdout).toContain("To act: not recorded; the record does not say what kind of stop this was.");
    expect(stdout).not.toContain(UNCHANGED_NOT_RUN_AGAIN);
    expect(stdout).toContain(RESUME_DOES_NOT_APPLY);
  });

  it("stops when --decisions is given with --all rather than quietly ignoring it", async () => {
    const repo = await footerStopped("status-decisions-conflict-");

    const withAll = await delivery(["status", "--all", "--decisions"], { cwd: repo });

    expect(withAll.exitCode).toBe(EXIT.configuration);
    expect(withAll.stderr).toContain(ALL_AND_DECISIONS);
  });

  it("prints with --json the document `status --json` prints: every round is in it in full, so there is nothing more to ask for", async () => {
    const repo = await footerStopped("status-decisions-json-");

    const withDecisions = await delivery(["status", FOOTER_RUN, "--decisions", "--json"], { cwd: repo });
    const without = await delivery(["status", FOOTER_RUN, "--json"], { cwd: repo });

    expect(withDecisions.stdout).toBe(without.stdout);
    expect(JSON.parse(withDecisions.stdout).report.surfaces[0].decisions.map((round: { verdict: string; brief: unknown; packet: unknown }) => [round.verdict, round.brief, round.packet])).toEqual([
      ["reroute", BRIEF, null],
      ["reroute", null, null],
      ["reroute", null, null],
      ["escalate", null, PACKET],
    ]);
    expect(withDecisions.exitCode).toBe(EXIT.ok);
  });

  it("describes --decisions in the command's own help", async () => {
    const repo = initTempRepo("status-decisions-help-", { "package.json": PACKAGE });

    expect((await delivery(["status", "--help"], { cwd: repo })).stdout).toContain("--decisions");
  });

  describe("what a repair changed, in status", () => {
    async function repairedTask(prefix: string): Promise<string> {
      const repo = initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [FORM, FOOTER] }) });
      await writeRecord(repo, {
        runId: FOOTER_RUN,
        task: FOOTER,
        history: [...ownRepair(1, "repair-gate-maintenance-1-0"), ...attempt(1, "first go")],
        refs: { "repair-gate-maintenance-1-0": CHANGES_TOUCHING_CHECK },
      });
      return repo;
    }

    it("shows one line per repair, and points at --repairs", async () => {
      const repo = await repairedTask("status-repairs-");

      const { stdout, exitCode } = await delivery(["status", FOOTER_RUN], { cwd: repo });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain("Repairs (--repairs for each patch):\n  Repair 1 (of the check, attempt 1 of 2) changed 3 files, +3 -1: check.mjs (the check runs this file), notes.txt, big.bin\n");
      expect(stdout.trimEnd().split("\n").at(-1)).toContain(`delivery status ${FOOTER_RUN} --repairs (each repair's patch)`);
      expect(stdout).not.toContain("+export default lenient;");
    });

    it("prints each repair's patch with --repairs, and stops pointing at it", async () => {
      const repo = await repairedTask("status-repairs-full-");

      const { stdout, exitCode } = await delivery(["status", FOOTER_RUN, "--repairs"], { cwd: repo });

      expect(exitCode).toBe(EXIT.ok);
      expect(stdout).toContain("      +export default lenient;");
      expect(stdout).toContain("    big.bin: added, +0 -0\n      patch too large to keep");
      expect(stdout).not.toContain("--repairs (each repair's patch)");
    });

    it("carries the same repairs in --json, patches and all", async () => {
      const repo = await repairedTask("status-repairs-json-");

      const { stdout } = await delivery(["status", FOOTER_RUN, "--repairs", "--json"], { cwd: repo });

      expect(JSON.parse(stdout).report.surfaces[0].repairs[0].files[0]).toMatchObject({ path: "check.mjs", touchesCheck: true, patch: expect.stringContaining("+export default lenient;") });
    });

    it("stops when --repairs is given with --all rather than quietly ignoring it", async () => {
      const repo = await repairedTask("status-repairs-all-");

      const withAll = await delivery(["status", "--all", "--repairs"], { cwd: repo });

      expect(withAll.exitCode).toBe(EXIT.configuration);
      expect(withAll.stderr).toContain(ALL_AND_REPAIRS);
    });

    it("describes --repairs in the command's own help", async () => {
      const repo = initTempRepo("status-repairs-help-", { "package.json": PACKAGE });
      expect((await delivery(["status", "--help"], { cwd: repo })).stdout).toContain("--repairs");
    });
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

/** What kind of value a key holds, as the stability promise counts kinds. */
const kindOf = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

/** Every key `delivery status --json` printed for one run before reports were data, and the kinds of value each may hold. None may go or change kind. */
const RUN_KEYS: Record<string, string[]> = {
  run: ["string"],
  task: ["string"],
  startedAt: ["string", "null"],
  outcome: ["string"],
  state: ["string"],
  finishedAt: ["string", "null"],
  reason: ["string", "null"],
  nextStep: ["string", "null"],
  summary: ["string", "null"],
  details: ["array"],
  branch: ["string"],
  base: ["string", "null"],
  dir: ["string"],
  worktree: ["string", "null"],
  escalation: ["object", "null"],
  queue: ["object", "null"],
};

/** The same for a run of several tasks. */
const SUPERVISED_KEYS: Record<string, string[]> = {
  runId: ["string"],
  startedAt: ["string", "null"],
  tasks: ["number"],
  concurrency: ["number"],
  live: ["boolean"],
  breaker: ["string"],
  outcome: ["string", "null"],
  finishedAt: ["string", "null"],
  surfaces: ["array"],
  queued: ["array"],
  reason: ["string", "null"],
  cause: ["string", "null"],
  runBudgets: ["object"],
  trips: ["array"],
};

/** `document` holds every key of `keys`, each a kind of value it always was, and beside them only the report. */
function expectKept(document: Record<string, unknown>, keys: Record<string, string[]>): void {
  expect(Object.keys(document).sort()).toEqual([...Object.keys(keys), "report"].sort());
  for (const [key, kinds] of Object.entries(keys)) expect(kinds, key).toContain(kindOf(document[key]));
}

describe("delivery status --json, now that reports are data", () => {
  it("keeps every key it printed for one run, the kind of value it was, whether the run finished, stopped or neither", async () => {
    const repo = initTempRepo("status-json-kept-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });
    const unfinished = JSON.parse((await delivery(["status", RUN_ID, "--json"], { cwd: repo })).stdout);
    await writeRunRecord(repo, { runId: OTHER_ID, task: TASK, outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT }, packet: ESCALATION });
    const escalated = JSON.parse((await delivery(["status", OTHER_ID, "--json"], { cwd: repo })).stdout);

    expectKept(unfinished, RUN_KEYS);
    expectKept(escalated, RUN_KEYS);
    expect(unfinished).toMatchObject({ run: RUN_ID, outcome: "unfinished", state: "PROVISIONING", nextStep: "start", escalation: null });
    expect(escalated).toMatchObject({ run: OTHER_ID, outcome: "escalated", reason: "authority limit", escalation: ESCALATION });
  });

  it("carries, under `report`, the very document `delivery report --json` prints for that run", async () => {
    const repo = initTempRepo("status-json-report-", { "package.json": PACKAGE });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK, outcome: { kind: "escalated", source: "worker", reason: "authority limit", at: AT }, packet: ESCALATION });

    const status = JSON.parse((await delivery(["status", RUN_ID, "--json"], { cwd: repo })).stdout);
    const report = JSON.parse((await delivery(["report", RUN_ID, "--json"], { cwd: repo })).stdout);

    expect(status.report).toEqual(report);
    expect(ReportDocument.parse(status.report)).toMatchObject({ schema: "delivery.report/1", kind: "task", surfaces: [{ run: RUN_ID, standing: "escalated", escalation: ESCALATION }] });
  });

  it("keeps every key it printed for a run of several tasks, and carries that run's report beside them", async () => {
    const repo = await finishedSupervisedRun("status-json-kept-run-");

    const status = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);
    const report = JSON.parse((await delivery(["report", SUPERVISED, "--json"], { cwd: repo })).stdout);

    expectKept(status, SUPERVISED_KEYS);
    // Each task it took is still the document a task's own run always printed, with no report of its own inside the run's.
    for (const surface of status.surfaces) expect(Object.keys(surface).sort()).toEqual(Object.keys(RUN_KEYS).sort());
    expect(status.report).toEqual(report);
    expect(ReportDocument.parse(status.report)).toMatchObject({ kind: "run", run: { runId: SUPERVISED, outcome: "drained", breaker: "HEALTHY" }, counts: { closed: 3, escalated: 1 } });
  });

  it("prints nothing but the document, without colour, on a terminal too", async () => {
    const repo = await finishedSupervisedRun("status-json-plain-");

    const { stdout, stderr } = await delivery(["status", SUPERVISED, "--json"], { cwd: repo, isTTY: true });

    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toContain("\u001B");
    expect(stderr).toBe("");
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

  it("still reports, with no queue line, against a config file that fails to load", async () => {
    const repo = initTempRepo("status-queue-broken-config-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ nonsenseKey: true }),
    });
    await writeRunRecord(repo, { runId: RUN_ID, task: TASK });

    const { exitCode, stdout } = await delivery(["status", RUN_ID], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).not.toContain("on your list");
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

  it("lists every run, newest first, with its task, how it ended, and the counts a report on it opens with", async () => {
    const repo = await threeRuns("status-all-");

    const { stdout, exitCode } = await delivery(["status", "--all"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n").filter((line) => line.startsWith("  "))).toEqual([
      "  add-a-goodbye-20260916T113000Z, started 2026-09-16 11:30 UTC: add a goodbye (hasn't finished yet): 1 task: 1 not finished",
      "  delete-the-greeting-20260915T090000Z, started 2026-09-15 09:00 UTC: delete the greeting (needs a decision from you): 0 of 1 task completed; 1 stopped, for your engineers",
      "  add-a-hello-20260914T210309Z, started 2026-09-14 21:03 UTC: add a hello (finished): 1 of 1 task completed and committed to its own branch",
    ]);
    expect(stdout.trimEnd().split("\n").slice(-3)).toEqual(["To read one in full: delivery status <run-id>", "", "Next: delivery report (your task list)"]);
  });

  it("tells a task that failed after its attempts from one waiting on a decision, on its line", async () => {
    const repo = initTempRepo("status-all-counts-", { "package.json": PACKAGE });
    await writeRecord(repo, {
      runId: "fix-the-broken-footer-links-20261001T022000Z",
      task: "Fix the broken footer links",
      history: [...attempt(1, "first go"), ...failedCheck(1, "reroute"), ...attempt(2, "second go"), ...failedCheck(2, "escalate")],
      outcome: stoppedAt("2026-10-01T02:58:00.000Z", { kind: "budget", population: "correction" }, "correction budget exhausted (1/1)"),
    });
    await writeRecord(repo, {
      runId: "replace-the-old-homepage-20261001T030000Z",
      task: "Replace the old homepage",
      history: attempt(1, "I need the owner to confirm.", "authority"),
      outcome: stoppedAt("2026-10-01T03:04:00.000Z", { kind: "authority", role: "worker" }, "worker escalated: authority"),
    });

    const { stdout } = await delivery(["status", "--all"], { cwd: repo });

    expect(stdout.split("\n").filter((line) => line.startsWith("  ")).map((line) => line.split("): ")[1])).toEqual([
      "0 of 1 task completed; 1 needs your decision",
      "0 of 1 task completed; 1 failed after 2 attempts",
    ]);
  });

  it("lists every run as JSON, newest first, with the four things a script sorts and filters on", async () => {
    const repo = await threeRuns("status-all-json-");

    const { stdout, exitCode } = await delivery(["status", "--all", "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toEqual([
      { run: "add-a-goodbye-20260916T113000Z", task: "add a goodbye", startedAt: "2026-09-16T11:30:00Z", outcome: "unfinished", tasks: null },
      { run: "delete-the-greeting-20260915T090000Z", task: "delete the greeting", startedAt: "2026-09-15T09:00:00Z", outcome: "escalated", tasks: null },
      { run: "add-a-hello-20260914T210309Z", task: "add a hello", startedAt: "2026-09-14T21:03:09Z", outcome: "closed", tasks: null },
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
    expect(plain.stdout.trimEnd().split("\n")).toEqual([NOTHING_HERE, "", 'Next: delivery run --task "..."']);
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

const SUPERVISED = "run-20260930T090000Z";
const ESCALATED = { kind: "escalated", source: "worker", reason: "authority limit", at: AT } as const;
const HELLO = "add a hello";
const GREETING = "delete the greeting";
const GOODBYE = "add a goodbye";
const SHOUT = "add a shout";
const IDS = {
  hello: "add-a-hello-20260930T090000Z",
  greeting: "delete-the-greeting-20260930T090000Z",
  goodbye: "add-a-goodbye-20260930T090100Z",
  shout: "add-a-shout-20260930T090200Z",
};
const fill = (slot: number, surfaceId: string, intent: string): RunEntry => ({ t: "slot_fill", slot, surfaceId, taskDef: { intent } });
const free = (slot: number, surfaceId: string, outcome: SlotOutcome): RunEntry => ({ t: "slot_free", slot, surfaceId, outcome });

/** Make a run of several at once's record look as though it was last written long ago. */
async function backdateRun(repo: string, runId: string): Promise<void> {
  const longAgo = new Date("2026-09-14T21:04:00.000Z");
  for (const name of ["run.json", "log.jsonl"]) await utimes(join(repo, ".delivery", "supervised", runId, name), longAgo, longAgo);
}

/** A project listing four tasks, and a run of two at once that took them all: three delivered, one waiting on a decision. */
async function finishedSupervisedRun(prefix: string): Promise<string> {
  const repo = initTempRepo(prefix, {
    "package.json": PACKAGE,
    "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING, GOODBYE, SHOUT] }),
  });
  await writeRunRecord(repo, { runId: IDS.hello, task: HELLO, outcome: CLOSED });
  await writeRunRecord(repo, { runId: IDS.greeting, task: GREETING, outcome: ESCALATED, packet: ESCALATION });
  await writeRunRecord(repo, { runId: IDS.goodbye, task: GOODBYE, outcome: CLOSED });
  await writeRunRecord(repo, { runId: IDS.shout, task: SHOUT, outcome: CLOSED });
  const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 4, runBudgetMax: { gateMaintenance: 2 } }, [
    fill(1, IDS.hello, HELLO),
    fill(2, IDS.greeting, GREETING),
    free(1, IDS.hello, "closed"),
    fill(1, IDS.goodbye, GOODBYE),
    free(2, IDS.greeting, "escalated"),
    fill(2, IDS.shout, SHOUT),
    free(1, IDS.goodbye, "closed"),
    free(2, IDS.shout, "closed"),
  ]);
  await setRunOutcome(dir, { kind: "drained", at: "2026-09-30T09:30:00.000Z" });
  return repo;
}

/** A project listing three tasks, and a run of two at once with both slots taken and the third task still to start. */
async function busySupervisedRun(prefix: string): Promise<string> {
  const repo = initTempRepo(prefix, {
    "package.json": PACKAGE,
    "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING, GOODBYE] }),
  });
  await writeRunRecord(repo, { runId: IDS.hello, task: HELLO });
  await writeRunRecord(repo, { runId: IDS.greeting, task: GREETING });
  await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
    fill(1, IDS.hello, HELLO),
    fill(2, IDS.greeting, GREETING),
  ]);
  return repo;
}

const taskLines = (stdout: string): string[] => stdout.split("\n").filter((line) => /^ {2}\[\d+\/\d+\] /.test(line));

describe("delivery status for a run of several tasks at once", () => {
  it("says the run, the environment and the counts, then one line per task", async () => {
    const repo = await finishedSupervisedRun("status-supervised-");

    const { stdout, exitCode } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n").slice(0, 3)).toEqual([
      `Run ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once`,
      "Environment: healthy",
      "3 done, 1 needs your decision",
    ]);
    // Every task with a record names its own run id, so any one can be read in full from this list.
    expect(taskLines(stdout)).toEqual([
      `  [1/4] ${HELLO} (${IDS.hello}): done`,
      `  [2/4] ${GREETING} (${IDS.greeting}): needs your decision (see below)`,
      `  [3/4] ${GOODBYE} (${IDS.goodbye}): done`,
      `  [4/4] ${SHOUT} (${IDS.shout}): done`,
    ]);
    expect(stdout.trimEnd().split("\n").slice(-9)).toEqual([
      "Retry budgets across the 4 tasks this run has taken:",
      "  correction 0 of 12, gate recheck 0 of 12, gate repair 0 of 8, session retry 0 of 20, close retry 0 of 12",
      "  shared repair limit for the run: 0 of 2 used",
      "",
      "Time and cost were not recorded for this run.",
      "",
      `To read one task in full: delivery status ${IDS.greeting}`,
      "",
      `Next: delivery report ${SUPERVISED} (this run in plain words)`,
    ]);
    expect(stdout).not.toMatch(/HEALTHY|ESCALATED|CLOSED|DRAINED|escalated|closed/);
  });

  it("follows a task that needs a decision with the account status gives of it on its own, unchanged", async () => {
    const repo = await finishedSupervisedRun("status-supervised-decision-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    const lines = stdout.split("\n");
    const own = (await statusReport(await readRun(repo, IDS.greeting), await context())).slice(1);
    const at = lines.indexOf(`  [2/4] ${GREETING} (${IDS.greeting}): needs your decision (see below)`);
    expect(at).toBeGreaterThan(-1);
    expect(own[0]).toBe(`This needs your decision: ${ESCALATION.decision}`);
    expect(lines.slice(at + 1, at + 1 + own.length)).toEqual(own);
  });

  it("shows a task waiting only because every slot is busy as queued, waiting for a free slot", async () => {
    const repo = await busySupervisedRun("status-supervised-busy-");
    const release = await takeRepoLock(repo);
    let stdout: string;
    try {
      ({ stdout } = await delivery(["status", SUPERVISED], { cwd: repo }));
    } finally {
      await release?.();
    }

    expect(stdout).toContain("2 not finished yet, 1 queued");
    expect(taskLines(stdout)).toEqual([
      `  [1/3] ${HELLO} (${IDS.hello}): setting up`,
      `  [2/3] ${GREETING} (${IDS.greeting}): setting up`,
      `  [3/3] ${GOODBYE}: ${WAITING_FOR_A_SLOT}`,
    ]);
    expect(stdout).not.toContain(STOPPED_PART_WAY);
  });

  it("says how to carry on a run that stopped part way, without claiming its queued tasks wait for a slot", async () => {
    const repo = await busySupervisedRun("status-supervised-stopped-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(stdout).toContain(STOPPED_PART_WAY);
    expect(taskLines(stdout)).toContain(`  [3/3] ${GOODBYE}: queued`);
    expect(stdout).not.toContain(WAITING_FOR_A_SLOT);
  });

  /** A run of two at once whose first task is on its second attempt and whose second is having its first checked. */
  async function workingSupervisedRun(prefix: string): Promise<string> {
    const repo = initTempRepo(prefix, {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING, GOODBYE] }),
    });
    await writeRecord(repo, {
      runId: IDS.hello,
      task: HELLO,
      history: [...attempt(1, "first go"), ...failedCheck(1, "reroute"), { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" }],
      state: "AGENT_ACTIVE",
      // What the rule-based router writes for a round: its trigger and reasoning, and no brief.
      refs: { "triage-0": { trigger: "gate_fail", rationale: "gate_fail: reroute" } },
    });
    await writeRecord(repo, { runId: IDS.greeting, task: GREETING, history: attempt(1, "done"), state: "GATING" });
    await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
      fill(1, IDS.hello, HELLO),
      fill(2, IDS.greeting, GREETING),
    ]);
    return repo;
  }

  it("says what each task under way is doing right now, and which attempt it is on, while the run is going", async () => {
    const repo = await workingSupervisedRun("status-supervised-in-flight-");
    const release = await takeRepoLock(repo);
    let stdout: string;
    try {
      ({ stdout } = await delivery(["status", SUPERVISED], { cwd: repo }));
    } finally {
      await release?.();
    }

    expect(taskLines(stdout)).toEqual([
      `  [1/3] ${HELLO} (${IDS.hello}): the agent is working, attempt 2`,
      `  [2/3] ${GREETING} (${IDS.greeting}): checking the agent's work, attempt 1`,
      `  [3/3] ${GOODBYE}: ${WAITING_FOR_A_SLOT}`,
    ]);
  });

  it("does not say a task is doing anything once the run has stopped part way", async () => {
    const repo = await workingSupervisedRun("status-supervised-not-in-flight-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(taskLines(stdout)).toEqual([
      `  [1/3] ${HELLO} (${IDS.hello}): not finished yet`,
      `  [2/3] ${GREETING} (${IDS.greeting}): not finished yet`,
      `  [3/3] ${GOODBYE}: queued`,
    ]);
  });

  it("says which workflow step a task under way is on, and that it is being checked", async () => {
    const repo = initTempRepo("status-supervised-workflow-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING] }),
    });
    const workflow = { name: "plan-then-build", steps: [{ name: "plan", prompt: "p" }, { name: "build", prompt: "b" }] };
    await writeRecord(repo, {
      runId: IDS.hello,
      task: HELLO,
      header: { workflow },
      history: [...attempt(1, "planned"), { t: "step", step: 2, startCommit: "c1" }, ...attempt(1, "built")],
      state: "GATING",
    });
    await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, IDS.hello, HELLO)]);
    const release = await takeRepoLock(repo);
    let stdout: string;
    try {
      ({ stdout } = await delivery(["status", SUPERVISED], { cwd: repo }));
    } finally {
      await release?.();
    }

    expect(taskLines(stdout)[0]).toBe(`  [1/2] ${HELLO} (${IDS.hello}): step 2 of 2 (build): ${STEP_PHRASES.GATING}, attempt 1`);
  });

  it("says since when a task under way has been in its step, and the run's last recorded activity, once steps carry a time", async () => {
    const repo = initTempRepo("status-supervised-since-", {
      "package.json": PACKAGE,
      "delivery.config.json": JSON.stringify({ concurrency: 2, tasks: [HELLO, GREETING] }),
    });
    await writeRecord(repo, { runId: IDS.hello, task: HELLO, history: timed(attempt(1, "done"), "2026-09-30T09:01:00.000Z") });
    await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 2, runBudgetMax: { gateMaintenance: 2 } }, [fill(1, IDS.hello, HELLO)]);
    const release = await takeRepoLock(repo);
    let stdout: string;
    try {
      ({ stdout } = await delivery(["status", SUPERVISED], { cwd: repo }));
    } finally {
      await release?.();
    }

    expect(taskLines(stdout)[0]).toBe(`  [1/2] ${HELLO} (${IDS.hello}): checking the agent's work, attempt 1, since 2026-09-30 09:02 UTC`);
    expect(stdout.split("\n")).toContain("Last recorded activity: 2026-09-30 09:02 UTC.");
  });

  it("adds the retries up across the tasks the run has taken, beside the run's shared repair limit, and points at the rounds", async () => {
    const repo = await workingSupervisedRun("status-supervised-roll-up-");

    const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(stdout.trimEnd().split("\n").slice(-9)).toEqual([
      "Retry budgets across the 2 tasks this run has taken:",
      "  correction 1 of 6, gate recheck 0 of 6, gate repair 0 of 4, session retry 0 of 10, close retry 0 of 6",
      "  shared repair limit for the run: 0 of 2 used",
      "",
      "Time and cost were not recorded for this run.",
      "",
      `To read one task in full: delivery status ${IDS.hello}`,
      "",
      `Next: delivery status ${SUPERVISED} --decisions (every triage round in full), delivery report ${SUPERVISED} (this run in plain words)`,
    ]);
  });

  it("prints every task's triage rounds in full with --decisions", async () => {
    const repo = await workingSupervisedRun("status-supervised-decisions-");

    const { stdout, exitCode } = await delivery(["status", SUPERVISED, "--decisions"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const at = lines.indexOf(`[1/3] ${HELLO} (${IDS.hello}):`);
    expect(lines.slice(at, at + 10)).toEqual([
      `[1/3] ${HELLO} (${IDS.hello}):`,
      "How it got here (1 triage round, in full):",
      "  Round 1, after attempt 1",
      "    Trigger: a gate failure (gate_fail)",
      "    Verdict: reroute",
      '    Rationale: "gate_fail: reroute"',
      "    Brief for the next session: none; this round wrote no brief.",
      "",
      `[2/3] ${GREETING} (${IDS.greeting}):`,
      "How it got here: no triage rounds.",
    ]);
    expect(lines.at(-1)).toBe(`Next: delivery report ${SUPERVISED} (this run in plain words)`);
  });

  it("lists the repairs of any task one ran in, one line each, and points at --repairs", async () => {
    const repo = await workingSupervisedRun("status-supervised-repairs-");
    for (const entry of setupRepair(1, IDS.hello, "repair-run-repair-1")) await appendRunEntry(supervisedPlace(repo, SUPERVISED), entry);
    await writeRef(supervisedPlace(repo, SUPERVISED), "repair-run-repair-1", CHANGES_TOUCHING_CHECK);

    const { stdout, exitCode } = await delivery(["status", SUPERVISED], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const lines = stdout.trimEnd().split("\n");
    const at = lines.indexOf(`[1/3] ${HELLO} (${IDS.hello}):`);
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("Repairs (--repairs for each patch):");
    expect(lines[at + 2]).toContain("  Repair 1 (of the setup, attempt 1 of 2) changed 3 files");
    expect(lines.at(-1)).toContain(`delivery status ${SUPERVISED} --repairs (each repair's patch)`);
  });

  it("reads one task of the run by its own id exactly as it reads any run", async () => {
    const repo = await finishedSupervisedRun("status-supervised-task-");

    const { stdout } = await delivery(["status", IDS.hello], { cwd: repo });

    const own = await statusReport(await readRun(repo, IDS.hello), await context(), { task: 1, of: 4 });
    expect(stdout.split("\n").slice(0, own.length)).toEqual(own);
  });

  it("gives the usual message when a run-style id names nothing", async () => {
    const repo = await finishedSupervisedRun("status-supervised-unknown-");

    const { stderr, exitCode } = await delivery(["status", "run-20200101T000000Z"], { cwd: repo });

    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("I couldn't find that run's record");
    expect(stderr).not.toContain("    at ");
  });

  it("gives one JSON document: the run's own fields, and each task's usual document nested as it is", async () => {
    const repo = await finishedSupervisedRun("status-supervised-json-");

    const { stdout, exitCode } = await delivery(["status", SUPERVISED, "--json"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    const document = JSON.parse(stdout);
    expect(Object.keys(document).sort()).toEqual(
      ["breaker", "cause", "concurrency", "finishedAt", "live", "outcome", "queued", "reason", "report", "runBudgets", "runId", "startedAt", "surfaces", "tasks", "trips"],
    );
    expect(document).toMatchObject({
      runId: SUPERVISED,
      startedAt: "2026-09-30T09:00:00Z",
      tasks: 4,
      concurrency: 2,
      live: false,
      breaker: "HEALTHY",
      outcome: "drained",
      finishedAt: "2026-09-30T09:30:00.000Z",
      queued: [],
      cause: null,
      reason: null,
      trips: [],
    });
    const ctx = await context();
    const own = await Promise.all(
      [IDS.hello, IDS.greeting, IDS.goodbye, IDS.shout].map(async (id, index) =>
        statusDocument(await readRun(repo, id), ctx, { task: index + 1, of: 4 }),
      ),
    );
    expect(document.surfaces).toEqual(JSON.parse(JSON.stringify(own)));
  });

  it("says null for what a run still going has not got yet, and lists the tasks it has yet to start", async () => {
    const repo = await busySupervisedRun("status-supervised-json-busy-");

    const { stdout } = await delivery(["status", SUPERVISED, "--json"], { cwd: repo });

    const document = JSON.parse(stdout);
    expect(document).toMatchObject({ outcome: null, finishedAt: null, live: false });
    expect(document.surfaces).toHaveLength(2);
    expect(document.queued).toEqual([{ task: GOODBYE, queue: { task: 3, of: 3 } }]);
  });

  it("reports a run of several at once when it is the one touched most recently", async () => {
    const repo = await finishedSupervisedRun("status-supervised-last-");
    for (const id of Object.values(IDS)) await backdate(join(runsRoot(repo), id));

    const plain = await delivery(["status"], { cwd: repo });
    const json = await delivery(["status", "--json"], { cwd: repo });

    expect(plain.stdout.split("\n")[0]).toBe(`Run ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once`);
    expect(JSON.parse(json.stdout).runId).toBe(SUPERVISED);
  });

  it("reports the run, not the task, when a task of it was the last thing touched", async () => {
    const repo = await busySupervisedRun("status-supervised-last-task-");
    await backdateRun(repo, SUPERVISED);

    const { stdout } = await delivery(["status"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe(`Run ${SUPERVISED}, started 2026-09-30 09:00 UTC: 3 tasks, up to 2 at once`);
  });

  it("reports a task of a finished run of several at once as that task, when it was touched after the run", async () => {
    const repo = await finishedSupervisedRun("status-supervised-last-finished-task-");
    await backdateRun(repo, SUPERVISED);
    for (const id of [IDS.greeting, IDS.goodbye, IDS.shout]) await backdate(join(runsRoot(repo), id));

    const { stdout } = await delivery(["status"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe(`Run ${IDS.hello}, started 2026-09-30 09:00 UTC: ${HELLO}`);
  });

  it("reports a single run touched after the run of several at once", async () => {
    const repo = await finishedSupervisedRun("status-supervised-last-single-");
    await backdateRun(repo, SUPERVISED);
    for (const id of Object.values(IDS)) await backdate(join(runsRoot(repo), id));
    await writeRunRecord(repo, { runId: "add-a-wave-20261001T100000Z", task: "add a wave", outcome: CLOSED });

    const { stdout } = await delivery(["status"], { cwd: repo });

    expect(stdout.split("\n")[0]).toBe("Run add-a-wave-20261001T100000Z, started 2026-10-01 10:00 UTC: add a wave");
  });

  it("lists a run of several at once as one summarising line among the single runs, with its tasks folded in", async () => {
    const repo = await finishedSupervisedRun("status-supervised-all-");
    await writeRunRecord(repo, { runId: "add-a-wave-20261001T100000Z", task: "add a wave", outcome: CLOSED });

    const { stdout, exitCode } = await delivery(["status", "--all"], { cwd: repo });

    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.trimEnd().split("\n")).toEqual([
      "2 runs in this repository, newest first:",
      "  add-a-wave-20261001T100000Z, started 2026-10-01 10:00 UTC: add a wave (finished): 1 of 1 task completed and committed to its own branch",
      `  ${SUPERVISED}, started 2026-09-30 09:00 UTC: 4 tasks, up to 2 at once (3 done, 1 needs your decision): 3 of 4 tasks completed and committed to their own branches; 1 stopped, for your engineers`,
      "To read one in full: delivery status <run-id>",
      "",
      "Next: delivery report (your task list)",
    ]);
  });

  it("lists a run of several at once as JSON with its tasks under it, and a null task of its own", async () => {
    const repo = await finishedSupervisedRun("status-supervised-all-json-");

    const { stdout } = await delivery(["status", "--all", "--json"], { cwd: repo });

    const summary = (run: string, task: string, outcome: string) => ({ run, task, startedAt: expect.any(String), outcome });
    expect(JSON.parse(stdout)).toEqual([
      {
        run: SUPERVISED,
        task: null,
        startedAt: "2026-09-30T09:00:00Z",
        outcome: "escalated",
        tasks: [
          summary(IDS.hello, HELLO, "closed"),
          summary(IDS.greeting, GREETING, "escalated"),
          summary(IDS.goodbye, GOODBYE, "closed"),
          summary(IDS.shout, SHOUT, "closed"),
        ],
      },
    ]);
  });

  describe("when the shared environment broke", () => {
    // HELLO and GOODBYE are this file's task words; these are the runs made for them.
    const HELLO_RUN = "add-a-hello-20260930T090000Z";
    const GOODBYE_RUN = "add-a-goodbye-20260930T090100Z";
    const gaveUp = async (prefix: string) => {
      const repo = initTempRepo(prefix, { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" } },
        { t: "repair_request", surfaceId: GOODBYE_RUN, key: null },
        { t: "held", surfaceId: HELLO_RUN },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "escalate", rationale: "the helper is outside my copy" },
        { t: "run_escalated", reason: "the repair could not fix the shared environment: the helper is outside my copy; no task caused this" },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "shared_environment", reason: "the repair could not fix the shared environment: the helper is outside my copy; no task caused this", at: "2026-09-30T10:00:00.000Z" });
      return repo;
    };

    it("leads with what broke, which task found it and which tasks it held, before the run line", async () => {
      const repo = await gaveUp("status-breaker-gave-up-");

      const { stdout, exitCode } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(exitCode).toBe(EXIT.ok);
      const lines = stdout.split("\n");
      expect(lines.slice(0, 4)).toEqual([
        "The shared environment could not be fixed after 1 attempt, so the run stopped; no task caused this.",
        "It was first noticed by [2/3] add a goodbye: the shared helper is missing.",
        "Held: [2/3] add a goodbye, [1/3] add a hello.",
        "Once it is fixed, `delivery run` carries the held tasks on.",
      ]);
      expect(stdout).toContain("Environment: something in the shared environment looks broken");
      expect(stdout).toContain("2 paused until the shared environment is fixed, 1 queued");
      expect(stdout).not.toMatch(/DEGRADED|REPAIRING|HEALTHY|ESCALATED|GATE_MAINTENANCE/);
    });

    it("leads with the repair under way while the run is going", async () => {
      const repo = initTempRepo("status-breaker-live-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: HELLO_RUN, reason: "the shared helper is missing" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: HELLO_RUN },
      ]);
      const release = await takeRepoLock(repo);
      try {
        const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });
        expect(stdout.split("\n")[0]).toBe("The shared environment is being repaired: any task about to check or hand off its work is held until it is fixed.");
      } finally {
        await release?.();
      }
    });

    it("leads with nothing for a trip the run repaired, and says beside the environment that it was repaired", async () => {
      const repo = initTempRepo("status-breaker-repaired-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO, outcome: CLOSED });
      await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 1, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: HELLO_RUN, reason: "the shared helper is missing" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: HELLO_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored it" },
        { t: "breaker_healthy" },
        { t: "slot_free", slot: 1, surfaceId: HELLO_RUN, outcome: "closed" },
      ]);
      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });
      expect(stdout.split("\n")[0]).toMatch(/^Run run-/);
      expect(stdout.split("\n")).toContain("Environment: healthy (repaired once during this run)");
    });

    it("counts every repair the run made when it gives up, not only those since the environment last broke", async () => {
      const repo = initTempRepo("status-breaker-two-trips-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const reason = "the shared environment could not be repaired after 2 attempts; no task caused this";
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" } },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "completed", rationale: "restored it" },
        { t: "breaker_healthy" },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: HELLO_RUN, reason: "the shared helper is missing again" } },
        { t: "repair_dispatch", attempt: 2, sessionKey: "run-repair-2", surfaceId: HELLO_RUN },
        { t: "repair_terminus", attempt: 2, sessionKey: "run-repair-2", status: "completed", rationale: "restored it again" },
        { t: "run_escalated", reason },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "shared_environment", reason, at: "2026-09-30T10:00:00.000Z" });

      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(stdout.split("\n")[0]).toBe("The shared environment could not be fixed after 2 attempts, so the run stopped; no task caused this.");
    });

    it("gives the trip, the run's repair limit and why it stopped in --json, for looking back", async () => {
      const repo = await gaveUp("status-breaker-json-");

      const document = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);

      expect(document).toMatchObject({
        breaker: "DEGRADED",
        outcome: "escalated",
        cause: "shared_environment",
        runBudgets: { gateMaintenance: { used: 1, max: 2 } },
      });
      expect(document.reason).toContain("no task caused this");
      expect(document.trips).toEqual([{
        cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" },
        held: [GOODBYE_RUN, HELLO_RUN],
        repairs: [{ attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN, status: "escalate", rationale: "the helper is outside my copy" }],
        ended: "gave_up",
        reason: "the repair could not fix the shared environment: the helper is outside my copy; no task caused this",
        limit: null,
      }]);
    });

    it("says the check could not run in two different tasks when that is what tripped it", async () => {
      const repo = initTempRepo("status-breaker-aggregate-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const reason = "the shared environment could not be repaired after 1 attempt; no task caused this";
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 1 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "gate_error_signal", surfaceId: HELLO_RUN },
        { t: "gate_error_signal", surfaceId: GOODBYE_RUN },
        { t: "breaker_degraded", cause: { kind: "gate_error_aggregate", surfaceId: GOODBYE_RUN, surfaceIds: [HELLO_RUN, GOODBYE_RUN] } },
        { t: "repair_request", surfaceId: GOODBYE_RUN, key: "triage-3" },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "incomplete", rationale: "ended without a result" },
        { t: "run_escalated", reason },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "shared_environment", reason, at: "2026-09-30T10:00:00.000Z" });

      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(stdout.split("\n").slice(0, 3)).toEqual([
        "The shared environment could not be fixed after 1 attempt, so the run stopped; no task caused this.",
        "The check could not run in 2 different tasks: [1/3] add a hello, [2/3] add a goodbye.",
        "Held: [2/3] add a goodbye.",
      ]);
      expect(stdout).not.toMatch(/gate_error|aggregate/);

      const document = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);
      expect(document.trips[0].cause).toEqual({ kind: "gate_error_aggregate", surfaceId: GOODBYE_RUN, surfaceIds: [HELLO_RUN, GOODBYE_RUN] });
    });

    it("leads with the usage limit, not the environment, when a limit stopped the repair", async () => {
      const repo = initTempRepo("status-breaker-limit-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ tasks: [HELLO, GOODBYE, "add a shout"], concurrency: 2 }) });
      await writeRunRecord(repo, { runId: HELLO_RUN, task: HELLO });
      await writeRunRecord(repo, { runId: GOODBYE_RUN, task: GOODBYE });
      const reason = "the repair could not run because the AI service is limiting requests; no task caused this";
      const dir = await writeSupervisedRun(repo, { runId: SUPERVISED, repoPath: repo, concurrency: 2, tasks: 3, runBudgetMax: { gateMaintenance: 2 } }, [
        { t: "slot_fill", slot: 1, surfaceId: HELLO_RUN, taskDef: { intent: HELLO } },
        { t: "slot_fill", slot: 2, surfaceId: GOODBYE_RUN, taskDef: { intent: GOODBYE } },
        { t: "breaker_degraded", cause: { kind: "gate_maintenance", surfaceId: GOODBYE_RUN, reason: "the shared helper is missing" } },
        { t: "repair_request", surfaceId: GOODBYE_RUN, key: null },
        { t: "held", surfaceId: HELLO_RUN },
        { t: "repair_dispatch", attempt: 1, sessionKey: "run-repair-1", surfaceId: GOODBYE_RUN },
        { t: "repair_terminus", attempt: 1, sessionKey: "run-repair-1", status: "incomplete", rationale: "gate-maintenance session did not complete: the AI service is limiting requests" },
        { t: "run_escalated", reason, limit: "rate" },
      ]);
      await setRunOutcome(dir, { kind: "escalated", cause: "usage_limit", reason, at: "2026-09-30T10:00:00.000Z" });

      const { stdout } = await delivery(["status", SUPERVISED], { cwd: repo });

      expect(stdout.split("\n").slice(0, 4)).toEqual([
        "The AI service is limiting requests, so the run stopped before it could repair the shared environment; no task caused this.",
        "It was first noticed by [2/3] add a goodbye: the shared helper is missing.",
        "Held: [2/3] add a goodbye, [1/3] add a hello.",
        "Once the limit no longer applies, `delivery run` carries the held tasks on.",
      ]);
      expect(stdout).not.toContain("could not be fixed");

      const document = JSON.parse((await delivery(["status", SUPERVISED, "--json"], { cwd: repo })).stdout);
      expect(document.cause).toBe("usage_limit");
      expect(document.trips[0].limit).toBe("rate");
    });
  });
});
