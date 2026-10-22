import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { appendEntry, create, load, setBaseBranch, setOutcome, writeRef } from "../case-file.js";
import type { CaseFileOutcome, CloserRef, PinnedWorkflow } from "../schema.js";
import type { EscalationPacket } from "../triage-role-config.js";
import { EXIT } from "./failures.js";
import { summariseOutcome } from "./outcome.js";

const RUN_ID = "add-a-hello-function-20260914T210309Z";
const AT = "2026-09-14T21:05:00.000Z";

const packet: EscalationPacket = {
  decision: "The worker stopped because it judged it lacked authority. Decide whether to grant that authority or take the action yourself.",
  evidence: "the task asks me to delete files outside what I was given",
  dead_ends: "No prior attempts were triaged.",
  why_now: "The worker reported that it lacks the authority to go on.",
  references: ["worker-1-0"],
};

/** A finished run's record, as the run loop leaves it: the closer it was started with, and what that closer reported. */
async function finishedRun(
  outcome: (dir: string) => Promise<CaseFileOutcome>,
  { closerRef = { type: "commit-to-branch" }, closeDetail, workflow }: { closerRef?: CloserRef; closeDetail?: string; workflow?: PinnedWorkflow } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "outcome-"));
  await create(
    dir,
    {
      surfaceId: RUN_ID,
      taskDef: { intent: "add a hello function" },
      gateRef: { type: "command", command: "npm test", parseMode: "exitcode" },
      closerRef,
      ...(workflow ? { workflow } : {}),
    },
    DEFAULT_BUDGETS,
  );
  await setBaseBranch(dir, "main");
  if (closeDetail !== undefined) {
    const detailRef = await writeRef(dir, "close-0", { status: "DONE", detail: closeDetail });
    await appendEntry(dir, { t: "close", status: "DONE", detailRef });
  }
  await setOutcome(dir, await outcome(dir));
  return { dir, caseFile: await load(dir) };
}

describe("summariseOutcome", () => {
  it("says what was done and the branch it is on for a closed run, exiting ok", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({ kind: "closed", source: "closer", reason: "committed", at: AT }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline: `Done: the change for "add a hello function" passed \`npm test\` and is committed on branch surface/${RUN_ID}.`,
      tone: "done",
      details: [`main was not changed. To look at the work: git log surface/${RUN_ID}`],
      exitCode: EXIT.ok,
    });
  });

  it("leads an escalated run with the decision asked of a person, then quotes the evidence, exiting escalated", async () => {
    const { dir, caseFile } = await finishedRun(async (d) => ({
      kind: "escalated",
      source: "worker",
      reason: "authority limit",
      at: AT,
      packetRef: await writeRef(d, "escalation", packet),
    }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline: `This needs your decision: ${packet.decision}`,
      tone: "attention",
      details: [
        "",
        "What the harness saw:",
        packet.evidence,
        "",
        "Nothing was changed on main.",
      ],
      exitCode: EXIT.escalated,
    });
  });

  it("falls back to the recorded reason for an escalation with no readable packet", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({ kind: "escalated", source: "worker", reason: "authority limit", at: AT }));
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe("This needs your decision: authority limit");
    expect(summary.exitCode).toBe(EXIT.escalated);
  });

  it("says in plain language why a run that could not set up stopped, keeping git's words as detail, exiting aborted", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({
      kind: "aborted",
      source: "provisioning",
      reason: "Command failed: git worktree add -b surface/x -- /s/x main\nfatal: invalid reference: main",
      at: AT,
    }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline:
        "The run stopped: I couldn't set up a working copy of the repository. Check it has at least one commit, and that you can write to it.",
      tone: "stopped",
      details: ["Details: Command failed: git worktree add -b surface/x -- /s/x main\nfatal: invalid reference: main"],
      exitCode: EXIT.aborted,
    });
  });

  it("says why any other aborted run stopped, exiting aborted", async () => {
    const { dir, caseFile } = await finishedRun(async () => ({ kind: "aborted", source: "triage", reason: "the task cannot be done", at: AT }));
    expect(await summariseOutcome(dir, caseFile)).toEqual({
      headline: "The run stopped: the task cannot be done",
      tone: "stopped",
      details: [],
      exitCode: EXIT.aborted,
    });
  });
});

const closed = async (): Promise<CaseFileOutcome> => ({ kind: "closed", source: "closer", reason: "committed", at: AT });

describe("where a closed run says its work went", () => {
  it("names the branch, and says the base branch is untouched, for a run committed to a branch", async () => {
    const { dir, caseFile } = await finishedRun(closed, { closerRef: { type: "commit-to-branch" } });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe(
      `Done: the change for "add a hello function" passed \`npm test\` and is committed on branch surface/${RUN_ID}.`,
    );
    expect(summary.details).toEqual([`main was not changed. To look at the work: git log surface/${RUN_ID}`]);
  });

  it("says the work is on the base branch for a run that merged back", async () => {
    const { dir, caseFile } = await finishedRun(closed, { closerRef: { type: "merge-back" } });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe('Done: the change for "add a hello function" passed `npm test` and is merged into main.');
    expect(summary.details).toEqual(["To look at the work: git log main"]);
    expect(summary.exitCode).toBe(EXIT.ok);
  });

  it("gives the pull request's address for a run that opened one", async () => {
    const { dir, caseFile } = await finishedRun(closed, {
      closerRef: { type: "open-pr" },
      closeDetail: "https://github.com/me/project/pull/7",
    });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe(
      `Done: the change for "add a hello function" passed \`npm test\` and is on branch surface/${RUN_ID}, with a pull request open.`,
    );
    expect(summary.details).toEqual(["The pull request: https://github.com/me/project/pull/7"]);
  });

  it("repeats a custom closer's own report, because only it knows what it did", async () => {
    const { dir, caseFile } = await finishedRun(closed, {
      closerRef: { type: "custom", modulePath: "./closers/notify.mjs" },
      closeDetail: "Told the release channel and tagged v2.",
    });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).toBe('Done: the change for "add a hello function" passed `npm test` and your own closer finished it.');
    expect(summary.details).toEqual(["Your closer says: Told the release channel and tagged v2."]);
  });

  it("still says something useful when a closer left no readable report", async () => {
    const { dir, caseFile } = await finishedRun(closed, { closerRef: { type: "open-pr" } });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.details).toEqual([`main was not changed. To look at the work: git log surface/${RUN_ID}`]);
  });

  it("speaks as if the work were committed to a branch for a run that pinned no closer at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "outcome-no-closer-"));
    await create(
      dir,
      { surfaceId: RUN_ID, taskDef: { intent: "add a hello function" }, gateRef: { type: "command", command: "npm test", parseMode: "exitcode" } },
      DEFAULT_BUDGETS,
    );
    await setBaseBranch(dir, "main");
    await setOutcome(dir, await closed());
    const summary = await summariseOutcome(dir, await load(dir));
    expect(summary.headline).toContain(`is committed on branch surface/${RUN_ID}.`);
  });
});

describe("the check a closed run says it passed", () => {
  it("does not name the project's check when every step of its workflow ran its own", async () => {
    const workflow: PinnedWorkflow = {
      name: "scout",
      steps: [
        { name: "attempt", prompt: "...", gateRef: { type: "command", command: "node scripts/changed.mjs .", parseMode: "exitcode" } },
        {
          name: "notes",
          prompt: "...",
          continue: true,
          gateRef: { type: "command", command: "node scripts/changed.mjs --only plans/", parseMode: "exitcode" },
        },
      ],
    };
    const { dir, caseFile } = await finishedRun(closed, { workflow });
    const summary = await summariseOutcome(dir, caseFile);
    expect(summary.headline).not.toContain("npm test");
  });
});
