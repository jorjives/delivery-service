import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { awaitsMerge, classOf, foldLedger, ledgerPath, parkedItems, readItemLedger, recordAnswer, recordDispatched, recordUnpark, settleRun } from "./item-ledger.js";
import { deliveryLedgerPath, readDelivery } from "./delivery-ledger.js";
import type { CaseFile, CaseFileOutcome } from "./schema.js";
import type { RunRecord } from "./run-records.js";
import { parkedNote } from "./cli/sources-run.js";

const KEY = "backlog:20261016T090000Z-greet.md";
const at = "2026-10-16T09:00:00.000Z";
const recordWith = (runId: string, outcome: CaseFileOutcome, repoPath = "repo"): RunRecord =>
  ({ runId, repoPath, dir: "dir", caseFile: { header: {}, cursor: {}, history: [], outcome } as unknown as CaseFile });
const escalated = (cause: CaseFileOutcome["cause"]): CaseFileOutcome => ({ kind: "escalated", source: "worker", reason: "r", at, ...(cause ? { cause } : {}) });
const scratch = () => join(mkdtempSync(join(tmpdir(), "ledger-")), "items.jsonl");

describe("classOf", () => {
  it.each([
    [{ kind: "closed", source: "closer", reason: "r", at } as CaseFileOutcome, "delivered"],
    [escalated({ kind: "budget", population: "terminus" }), "interrupted"],
    [escalated({ kind: "budget", population: "correction" }), "exhausted"],
    [escalated({ kind: "budget", population: "gateError" }), "exhausted"],
    [escalated({ kind: "budget", population: "close" }), "escalated"],
    [{ kind: "aborted", source: "triage", reason: "r", at, cause: { kind: "triage_abort" } } as CaseFileOutcome, "exhausted"],
    [escalated({ kind: "decision", question: "Which?" }), "decision"],
    [escalated({ kind: "authority", role: "worker" }), "escalated"],
    [escalated(undefined), "escalated"],
  ])("classes %j as %s", (outcome, expected) => {
    expect(classOf(recordWith("r1", outcome).caseFile)).toBe(expected);
  });
});

describe("the ledger", () => {
  it("lives beside the worktrees, keyed by repository", () => {
    expect(ledgerPath("/srv/app", { XDG_STATE_HOME: "/state" })).toBe(join("/state", "delivery-service", "ledger", "srv-app", "items.jsonl"));
  });

  it("is empty when nothing was ever recorded", async () => {
    expect((await readItemLedger(scratch())).size).toBe(0);
  });

  it("counts consecutive unsuccessful runs and parks after parkAfter of them", async () => {
    const path = scratch();
    for (const runId of ["r1", "r2"]) {
      await recordDispatched(path, KEY, runId, "Greet people.");
      expect((await settleRun(path, KEY, recordWith(runId, escalated({ kind: "budget", population: "correction" })), 3)).parked).toBeNull();
    }
    await recordDispatched(path, KEY, "r3", "Greet people.");
    const state = await settleRun(path, KEY, recordWith("r3", escalated({ kind: "budget", population: "correction" })), 3);
    expect(state).toMatchObject({ attempts: 3, lastClass: "exhausted", parked: "attempts", settled: true });
  });

  it("parks a decision at once, with its question, and an answer unparks it", async () => {
    const path = scratch();
    await recordDispatched(path, KEY, "r1", "Greet people.");
    expect(await settleRun(path, KEY, recordWith("r1", escalated({ kind: "decision", question: "Formal?" })), 3)).toMatchObject({ parked: "decision", question: "Formal?" });
    await recordAnswer(path, KEY, "Formal, please.");
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, answer: "Formal, please.", question: "Formal?", lastClass: "decision", attempts: 0 });
  });

  it("parks any other escalation at once", async () => {
    const path = scratch();
    await recordDispatched(path, KEY, "r1", "Greet people.");
    expect((await settleRun(path, KEY, recordWith("r1", escalated({ kind: "authority", role: "worker" })), 3)).parked).toBe("escalated");
  });

  it("resets on delivery and remembers when it last closed, the branch it landed on and that branch's tip", async () => {
    const repo = initTempRepo("ledger-", { "package.json": "{}" });
    const path = scratch();
    await recordDispatched(path, KEY, "r1", "Greet people.");
    await settleRun(path, KEY, recordWith("r1", escalated({ kind: "budget", population: "correction" })), 3);
    git(repo, ["checkout", "-q", "-b", "surface/greet-20261016T090000Z"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "work"]);
    const tip = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["checkout", "-q", "main"]);
    await recordDispatched(path, KEY, "greet-20261016T090000Z", "Greet people.");
    const state = await settleRun(path, KEY, recordWith("greet-20261016T090000Z", { kind: "closed", source: "closer", reason: "r", at }, repo), 3);
    expect(state).toMatchObject({ attempts: 0, lastClass: "delivered", branch: "surface/greet-20261016T090000Z", commit: tip, parked: null });
    expect(state.lastClosedAt).not.toBeNull();
  });

  it("records the base tip as the delivered commit when a closer already merged the work and deleted the branch", async () => {
    const repo = initTempRepo("ledger-", { "package.json": "{}" });
    const path = scratch();
    await recordDispatched(path, KEY, "gone", "Greet people.");
    const state = await settleRun(path, KEY, recordWith("gone", { kind: "closed", source: "closer", reason: "r", at }, repo), 3);
    expect(state.commit).toBe(git(repo, ["rev-parse", "main"]));
  });

  it("drops an unparked item's state back to fresh", async () => {
    const path = scratch();
    await recordDispatched(path, KEY, "r1", "Greet people.");
    await settleRun(path, KEY, recordWith("r1", escalated({ kind: "authority", role: "worker" })), 3);
    await recordUnpark(path, KEY);
    expect((await readItemLedger(path)).get(KEY)).toMatchObject({ parked: null, attempts: 0, lastClass: null, question: null, answer: null });
  });

  it("marks a dispatched run unsettled, and consumes a recorded answer", () => {
    const state = foldLedger([
      { t: "answered", key: KEY, answer: "Yes.", at },
      { t: "dispatched", key: KEY, runId: "r2", intent: "Greet people.", at },
    ]).get(KEY);
    expect(state).toMatchObject({ lastRunId: "r2", settled: false, answer: null });
  });

  it("records a delivered item's landing on its delivery branch, with that branch and its tip", async () => {
    const repo = initTempRepo("ledger-delivery-", { "seed.txt": "seed\n" });
    git(repo, ["branch", "delivery/main"]);
    const tip = git(repo, ["rev-parse", "delivery/main"]);
    const path = scratch();
    const record = {
      runId: "greet-20261016T090000Z", repoPath: repo, dir: "dir",
      caseFile: { header: { taskDef: { intent: "greet people" }, delivery: { branch: "delivery/main" } }, cursor: {}, history: [], outcome: { kind: "closed", source: "closer", reason: "r", at } },
    } as unknown as RunRecord;

    const state = await settleRun(path, KEY, record, 3);

    expect(state).toMatchObject({ lastClass: "delivered", branch: "delivery/main", commit: tip });
    const delivery = await readDelivery(deliveryLedgerPath(path), "delivery/main");
    expect(delivery.landed).toMatchObject([{ runId: "greet-20261016T090000Z", key: KEY, intent: "greet people", commit: tip }]);
  });

  it("records the commit the close landed at, not the delivery branch's later tip", async () => {
    const repo = initTempRepo("ledger-later-", { "seed.txt": "seed\n" });
    git(repo, ["checkout", "-q", "-b", "delivery/main"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "landed"]);
    const landedAt = git(repo, ["rev-parse", "HEAD"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "a later landing"]);
    git(repo, ["checkout", "-q", "main"]);
    const path = scratch();
    const record = {
      runId: "greet-20261016T090000Z", repoPath: repo, dir: "dir",
      caseFile: {
        header: { taskDef: { intent: "greet people" }, delivery: { branch: "delivery/main" } }, cursor: {},
        history: [{ t: "close", status: "DONE", detailRef: "close-0", commit: landedAt }],
        outcome: { kind: "closed", source: "closer", reason: "r", at },
      },
    } as unknown as RunRecord;

    const state = await settleRun(path, KEY, record, 3);

    expect(state).toMatchObject({ lastClass: "delivered", commit: landedAt });
    const delivery = await readDelivery(deliveryLedgerPath(path), "delivery/main");
    expect(delivery.landed).toMatchObject([{ key: KEY, commit: landedAt }]);
  });

  it("marks the landing empty when the close landed nothing, still settling the item as delivered", async () => {
    const repo = initTempRepo("ledger-empty-", { "seed.txt": "seed\n" });
    git(repo, ["branch", "delivery/main"]);
    const landedAt = git(repo, ["rev-parse", "delivery/main"]);
    const path = scratch();
    const record = {
      runId: "greet-20261016T090000Z", repoPath: repo, dir: "dir",
      caseFile: {
        header: { taskDef: { intent: "greet people" }, delivery: { branch: "delivery/main" } }, cursor: {},
        history: [{ t: "close", status: "DONE", detailRef: "close-0", commit: landedAt, empty: true }],
        outcome: { kind: "closed", source: "closer", reason: "r", at },
      },
    } as unknown as RunRecord;

    const state = await settleRun(path, KEY, record, 3);

    expect(state).toMatchObject({ lastClass: "delivered", commit: landedAt });
    const delivery = await readDelivery(deliveryLedgerPath(path), "delivery/main");
    expect(delivery.landed).toMatchObject([{ key: KEY, commit: landedAt, empty: true }]);
    expect(delivery.pending).toMatchObject([{ key: KEY, commit: landedAt, empty: true }]);
  });

  describe("awaitsMerge", () => {
    const delivered = (over: { branch: string | null; commit: string | null }) => ({ key: KEY, lastClass: "delivered" as const, ...over }) as never;

    it("is true while the delivered commit is on its branch", async () => {
      const repo = initTempRepo("awaits-", { "seed.txt": "seed\n" });
      git(repo, ["checkout", "-q", "-b", "delivery/main"]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", "landed"]);
      const commit = git(repo, ["rev-parse", "HEAD"]);
      git(repo, ["checkout", "-q", "main"]);
      expect(await awaitsMerge(repo, delivered({ branch: "delivery/main", commit }))).toBe(true);
    });

    it("is false once the branch no longer holds the delivered commit and the base never got it", async () => {
      const repo = initTempRepo("awaits-", { "seed.txt": "seed\n" });
      git(repo, ["checkout", "-q", "-b", "delivery/main"]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", "landed"]);
      const commit = git(repo, ["rev-parse", "HEAD"]);
      git(repo, ["checkout", "-q", "main"]);
      git(repo, ["branch", "-f", "delivery/main", "main"]);
      expect(await awaitsMerge(repo, delivered({ branch: "delivery/main", commit }))).toBe(false);
    });

    it("is true once the branch is gone but its commit is on the local base branch (merged, not yet pushed)", async () => {
      const repo = initTempRepo("await-", { "package.json": "{}" });
      expect(await awaitsMerge(repo, delivered({ branch: "surface/merged", commit: git(repo, ["rev-parse", "main"]) }))).toBe(true);
    });

    it("is false when the branch was deleted without the work reaching the base", async () => {
      const repo = initTempRepo("await-", { "package.json": "{}" });
      git(repo, ["checkout", "-q", "-b", "stray"]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", "stray work"]);
      const stray = git(repo, ["rev-parse", "HEAD"]);
      git(repo, ["checkout", "-q", "main"]);
      git(repo, ["branch", "-D", "stray"]);
      expect(await awaitsMerge(repo, delivered({ branch: "surface/stray", commit: stray }))).toBe(false);
    });

    it("is false for an item that was never delivered", async () => {
      const repo = initTempRepo("await-", { "package.json": "{}" });
      expect(await awaitsMerge(repo, undefined)).toBe(false);
    });
  });

  it("parks a held run's item as held, and says so", async () => {
    const path = scratch();
    const state = await settleRun(path, "backlog:x.md", recordWith("r1", { kind: "escalated", source: "harness", reason: "held", at, cause: { kind: "held" } }), 3);
    expect(state).toMatchObject({ lastClass: "held", parked: "held" });
    expect(parkedNote(state)).toBe("Holding backlog:x.md: its fix is finished and checked, and waits for your sign-off because the problem is serious. Read it, then: delivery sign-off backlog:x.md, or set it aside: delivery reject backlog:x.md");
  });

  it("records the branch tip a held run was reviewed at, so a sign-off can be bound to it", async () => {
    const repo = initTempRepo("held-tip-", { "package.json": "{}" });
    git(repo, ["branch", "surface/r1"]);
    const tip = git(repo, ["rev-parse", "surface/r1"]);
    const state = await settleRun(scratch(), "backlog:x.md", recordWith("r1", { kind: "escalated", source: "harness", reason: "held", at, cause: { kind: "held" } }, repo), 3);
    expect(state.heldCommit).toBe(tip);
    expect(state.commit).toBeNull();
  });

  it("unparks a signed-off item, and forgets the sign-off once it is dispatched again", () => {
    const at = "2026-10-19T12:00:00Z";
    const states = foldLedger([
      { t: "dispatched", key: "k", runId: "r1", intent: "x", at },
      { t: "ended", key: "k", runId: "r1", class: "held", at },
      { t: "parked", key: "k", reason: "held", at },
      { t: "signed_off", key: "k", at },
    ]);
    expect(states.get("k")).toMatchObject({ parked: null, signedOff: true, lastClass: "held" });
    expect(foldLedger([{ t: "signed_off", key: "k", at }, { t: "dispatched", key: "k", runId: "r2", intent: "x", at }]).get("k")?.signedOff).toBe(false);
  });

  it("lists what is parked", async () => {
    const path = scratch();
    await recordDispatched(path, KEY, "r1", "Greet people.");
    await settleRun(path, KEY, recordWith("r1", escalated({ kind: "authority", role: "worker" })), 3);
    expect(parkedItems(await readItemLedger(path)).map((s) => s.key)).toEqual([KEY]);
  });
});
