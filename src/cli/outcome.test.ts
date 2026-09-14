import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { create, load, setBaseBranch, setOutcome, writeRef } from "../case-file.js";
import type { CaseFileOutcome } from "../schema.js";
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

/** A finished run's record, as the run loop leaves it. */
async function finishedRun(outcome: (dir: string) => Promise<CaseFileOutcome>) {
  const dir = await mkdtemp(join(tmpdir(), "outcome-"));
  await create(
    dir,
    {
      surfaceId: RUN_ID,
      taskDef: { intent: "add a hello function" },
      gateRef: { type: "command", command: "npm test", parseMode: "exitcode" },
      closerRef: { type: "commit-to-branch" },
    },
    DEFAULT_BUDGETS,
  );
  await setBaseBranch(dir, "main");
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
