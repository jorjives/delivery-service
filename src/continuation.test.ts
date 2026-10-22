import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { DEFAULT_BUDGETS } from "./budgets.js";
import { appendEntry, create, setBaseBranch, setBaseline, setOutcome, updateCursor } from "./case-file.js";
import { readRun } from "./cli/runs.js";
import { prepareRunDir, runPlace, runsRoot } from "./run-location.js";
import { prepareContinuation } from "./continuation.js";
import type { GateReport } from "./schema.js";

const GATE = { type: "command", command: "npm test", parseMode: "exitcode" } as const;
const BASELINE = { status: "PASS", assertions: [] } as GateReport;
const RUN = "greet-20261016T090000Z";

async function stoppedRun(repo: string, runId: string) {
  const dir = join(runsRoot(repo), runId);
  await prepareRunDir(repo, dir);
  const start = git(repo, ["rev-parse", "HEAD"]);
  await create(dir, { surfaceId: runId, taskDef: { intent: "greet" }, gateRef: GATE, workflow: { name: "w", steps: [{ name: "plan", prompt: "p" }, { name: "build", prompt: "b" }] } }, DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main", start);
  await setBaseline(dir, BASELINE);
  await appendEntry(dir, { t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0", status: "escalate", category: "decision", question: "Formal?", rationale: "unsure", sessionId: "sess-1" });
  await setOutcome(dir, { kind: "escalated", source: "worker", reason: "unsure", at: "2026-10-16T09:00:00.000Z", cause: { kind: "decision", question: "Formal?" } });
  return { dir, start };
}

describe("prepareContinuation", () => {
  it("carries on in the run's own working copy, from its branch tip, its start, its baseline and its last session", async () => {
    const repo = initTempRepo("continue-", { "package.json": "{}" });
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "continue-state-")) };
    const { start } = await stoppedRun(repo, RUN);
    // What a built-in closer's teardown leaves: the unfinished work committed on the branch, the copy removed.
    git(repo, ["checkout", "-q", "-b", `surface/${RUN}`]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "Unfinished work"]);
    git(repo, ["checkout", "-q", "main"]);
    const tip = git(repo, ["rev-parse", `surface/${RUN}`]);

    const carried = await prepareContinuation(await readRun(repo, RUN), { kind: "answer", question: "Formal?", answer: "Yes." }, env);

    expect(carried?.continues).toEqual({
      runId: RUN, worktreePath: runPlace(repo, RUN, env).location.worktreePath, from: tip, startCommit: start, baseline: BASELINE, sessionId: "sess-1",
      turn: { kind: "answer", question: "Formal?", answer: "Yes." },
    });
    expect(carried?.workflow?.steps.map((s) => s.name)).toEqual(["plan", "build"]);
  });

  it("commits what the run left uncommitted in its working copy onto its branch, and carries on from there", async () => {
    const repo = initTempRepo("continue-left-", { "package.json": "{}" });
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "continue-state-")) };
    const { start } = await stoppedRun(repo, RUN);
    // What a closer that does not tear down (or a teardown that failed) leaves: the copy, its edits uncommitted.
    const copy = runPlace(repo, RUN, env).location.worktreePath;
    git(repo, ["worktree", "add", "-q", "-b", `surface/${RUN}`, "--", copy, start]);
    writeFileSync(join(copy, "partial.js"), "export const partial = true;\n");

    const carried = await prepareContinuation(await readRun(repo, RUN), { kind: "interrupted" }, env);

    expect(carried?.continues.from).toBe(git(repo, ["rev-parse", `surface/${RUN}`]));
    expect(git(repo, ["show", `${carried?.continues.from}:partial.js`])).toBe("export const partial = true;");
    expect(carried?.continues.worktreePath).toBe(copy);
  });

  it("carries on in the working copy the run itself carried on, so a chain keeps one path", async () => {
    const repo = initTempRepo("continue-chain-", { "package.json": "{}" });
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "continue-state-")) };
    const { dir } = await stoppedRun(repo, RUN);
    const first = join(mkdtempSync(join(tmpdir(), "continue-first-")), "wt");
    await updateCursor(dir, { worktreeRef: first });
    expect((await prepareContinuation(await readRun(repo, RUN), { kind: "interrupted" }, env))?.continues.worktreePath).toBe(first);
  });

  it("starts from the run's start when its branch is gone", async () => {
    const repo = initTempRepo("continue-gone-", { "package.json": "{}" });
    const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "continue-state-")) };
    const { start } = await stoppedRun(repo, RUN);
    expect((await prepareContinuation(await readRun(repo, RUN), { kind: "interrupted" }, env))?.continues.from).toBe(start);
  });

  describe("a signed-off turn", () => {
    const heldRun = async (name: string) => {
      const repo = initTempRepo(name, { "package.json": "{}" });
      const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "continue-state-")) };
      const { start } = await stoppedRun(repo, RUN);
      const copy = runPlace(repo, RUN, env).location.worktreePath;
      git(repo, ["worktree", "add", "-q", "-b", `surface/${RUN}`, "--", copy, start]);
      writeFileSync(join(copy, "fix.js"), "export const fix = true;\n");
      git(copy, ["add", "-A"]);
      git(copy, ["commit", "-q", "-m", "Accepted, waiting for sign-off"]);
      return { repo, env, copy, reviewed: git(repo, ["rev-parse", `surface/${RUN}`]) };
    };
    const SIGNED_OFF = { kind: "signed_off" } as const;

    it("stays signed off when the branch is at the reviewed commit and its copy is clean", async () => {
      const { repo, env, reviewed } = await heldRun("signed-off-same-");
      const carried = await prepareContinuation(await readRun(repo, RUN), SIGNED_OFF, env, reviewed);
      expect(carried?.continues.turn).toEqual(SIGNED_OFF);
      expect(carried?.continues.from).toBe(reviewed);
    });

    it("is no longer signed off when the branch has moved since the review", async () => {
      const { repo, env, copy, reviewed } = await heldRun("signed-off-moved-");
      writeFileSync(join(copy, "later.js"), "export const later = true;\n");
      git(copy, ["add", "-A"]);
      git(copy, ["commit", "-q", "-m", "Edited after review"]);
      const carried = await prepareContinuation(await readRun(repo, RUN), SIGNED_OFF, env, reviewed);
      expect(carried?.continues.turn).toEqual({ kind: "interrupted" });
    });

    it("is no longer signed off, and nothing unreviewed is committed under the sign-off, when the copy is dirty", async () => {
      const { repo, env, copy, reviewed } = await heldRun("signed-off-dirty-");
      writeFileSync(join(copy, "scribble.js"), "export const scribble = true;\n");
      const carried = await prepareContinuation(await readRun(repo, RUN), SIGNED_OFF, env, reviewed);
      expect(carried?.continues.turn).toEqual({ kind: "interrupted" });
    });

    it("is no longer signed off when the copy is clean but sits on a commit other than the reviewed one", async () => {
      const { repo, env, copy, reviewed } = await heldRun("signed-off-elsewhere-");
      // The branch still names the reviewed commit, but the copy has been detached onto its parent.
      git(copy, ["checkout", "-q", "--detach", `${reviewed}~1`]);
      const carried = await prepareContinuation(await readRun(repo, RUN), SIGNED_OFF, env, reviewed);
      expect(carried?.continues.turn).toEqual({ kind: "interrupted" });
    });

    it("is no longer signed off when no reviewed commit was recorded", async () => {
      const { repo, env } = await heldRun("signed-off-unrecorded-");
      const carried = await prepareContinuation(await readRun(repo, RUN), SIGNED_OFF, env, null);
      expect(carried?.continues.turn).toEqual({ kind: "interrupted" });
    });
  });
});
