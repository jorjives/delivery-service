import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { commitOn } from "./delivery-fixtures.js";
import { deliveryLedgerPath, foldDelivery, recordDelivery, type DeliveryEntry } from "./delivery-ledger.js";
import { levelRefOf, planStack, pullsFingerprint, readStack, stackOf, type ObservedPull, type StackLevel, type StackPlan } from "./delivery-stack.js";
import { settleRun } from "./item-ledger.js";
import { initTempRepo } from "./temp-repo.js";
import type { RunRecord } from "./run-records.js";

const DELIVERY = "delivery/main";
const at = "2026-10-22T09:00:00.000Z";
const scratchLedger = () => join(mkdtempSync(join(tmpdir(), "delivery-stack-")), "items.jsonl");

const open = (over: Record<string, unknown> = {}): DeliveryEntry =>
  ({ t: "opened", branch: DELIVERY, base: "main", from: "F", stack: true, at, ...over }) as DeliveryEntry;
const landed = (runId: string, commit: string, extra: Record<string, unknown> = {}): DeliveryEntry =>
  ({ t: "landed", branch: DELIVERY, runId, key: `backlog:${runId}.md`, intent: `intent ${runId}`, commit, at, ...extra }) as DeliveryEntry;
const stateOf = (...entries: DeliveryEntry[]) => foldDelivery([open(), ...entries], DELIVERY);

describe("stackOf", () => {
  it("is empty in rolling mode", () => {
    const state = foldDelivery([{ t: "opened", branch: DELIVERY, base: "main", from: "F", at }, landed("r1", "c1")], DELIVERY);
    expect(stackOf(state, ["c1"])).toEqual([]);
  });

  it("makes one level per landed item, bottom first, each targeting the one below and the bottom the base", () => {
    const levels = stackOf(stateOf(landed("r1", "c1"), landed("r2", "c2"), landed("r3", "c3")), ["c1", "c2", "c3"]);

    expect(levels.map((l) => [l.ref, l.parent, l.commit])).toEqual([
      ["delivery-stack/main/r1", "main", "c1"],
      ["delivery-stack/main/r2", "delivery-stack/main/r1", "c2"],
      ["delivery-stack/main/r3", "delivery-stack/main/r2", "c3"],
    ]);
  });

  it.each([["B settled before A while tasks ran concurrently"], ["A settled by the next run after a crash, after B"]])(
    "orders levels by where they landed, not when they were settled: %s",
    () => {
      const levels = stackOf(stateOf(landed("rB", "Y"), landed("rA", "X")), ["X", "Y"]);

      expect(levels.map((l) => [l.run, l.parent, l.commit])).toEqual([
        ["rA", "main", "X"],
        ["rB", levelRefOf("main", "rA"), "Y"],
      ]);
    },
  );

  it("puts a level whose commit is not on the branch after the rest, in ledger order", () => {
    const levels = stackOf(stateOf(landed("rZ", "gone"), landed("rA", "X"), landed("rB", "Y")), ["X", "Y"]);

    expect(levels.map((l) => l.run)).toEqual(["rA", "rB", "rZ"]);
  });

  it.each([["before"], ["after"]])("makes no level of an item that landed nothing, settled %s the item whose commit it started from", (when) => {
    const empty = landed("rE", "X", { empty: true });
    const entries = when === "before" ? [empty, landed("rA", "X"), landed("rB", "Y")] : [landed("rA", "X"), empty, landed("rB", "Y")];
    const levels = stackOf(stateOf(...entries), ["X", "Y"]);

    expect(levels.map((l) => [l.run, l.commit])).toEqual([["rA", "X"], ["rB", "Y"]]);
    expect(levels.map((l) => l.parent)).toEqual(["main", levelRefOf("main", "rA")]);
    expect(levels.map((l) => l.ref)).not.toContain(levelRefOf("main", "rE"));
  });

  it("makes no level of an item that landed nothing on a section with no landings before it", () => {
    const levels = stackOf(stateOf(landed("rE", "F", { empty: true }), landed("rA", "X")), ["X"]);

    expect(levels).toMatchObject([{ run: "rA", commit: "X", parent: "main" }]);
  });

  it("makes no level of an entry at the section's opening commit, or at a commit an earlier level holds, even without the empty mark", () => {
    expect(stackOf(stateOf(landed("r0", "F"), landed("rA", "X")), ["X"]).map((l) => l.run)).toEqual(["rA"]);
    expect(stackOf(stateOf(landed("rD", "X"), landed("rA", "X")), ["X"]).map((l) => [l.run, l.commit])).toEqual([["rD", "X"]]);
  });

  it("names refs under a base with a slash", () => {
    const state = foldDelivery([open({ base: "release/1.0" }), landed("r1", "c1")], DELIVERY);

    expect(stackOf(state, ["c1"])[0]?.ref).toBe("delivery-stack/release/1.0/r1");
    expect(levelRefOf("release/1.0", "r1")).toBe("delivery-stack/release/1.0/r1");
  });

  it("attaches the observed pull request to its level, null when none was seen", () => {
    const state = stateOf(
      { t: "observed", branch: DELIVERY, pullRequests: [{ ref: levelRefOf("main", "r1"), url: "https://example.invalid/pull/1", state: "OPEN" }], at } as DeliveryEntry,
      landed("r1", "c1"),
      landed("r2", "c2"),
    );

    const [first, second] = stackOf(state, ["c1", "c2"]);
    expect(first?.pr).toEqual({ url: "https://example.invalid/pull/1", state: "OPEN" });
    expect(second?.pr).toBeNull();
  });
});

describe("readStack", () => {
  it("reads the stack in landing order when B, landed on top of A, settles first", async () => {
    const repo = initTempRepo("delivery-stack-order-", { "seed.txt": "seed\n" });
    git(repo, ["branch", DELIVERY]);
    const from = git(repo, ["rev-parse", "main"]);
    const ledger = scratchLedger();
    await recordDelivery(deliveryLedgerPath(ledger), { t: "opened", branch: DELIVERY, base: "main", from, stack: true });
    const x = await commitOn(repo, DELIVERY, "a.txt", "a\n");
    const y = await commitOn(repo, DELIVERY, "b.txt", "b\n");
    const record = (runId: string, commit: string): RunRecord =>
      ({
        runId, repoPath: repo, dir: "dir",
        caseFile: {
          header: { taskDef: { intent: `intent ${runId}` }, delivery: { branch: DELIVERY } }, cursor: {},
          history: [{ t: "close", status: "DONE", detailRef: "close-0", commit }],
          outcome: { kind: "closed", source: "closer", reason: "r", at },
        },
      }) as unknown as RunRecord;

    await settleRun(ledger, "backlog:b.md", record("rB", y), 3);
    await settleRun(ledger, "backlog:a.md", record("rA", x), 3);

    const levels = await readStack(repo, deliveryLedgerPath(ledger), DELIVERY);
    expect(levels.map((l) => [l.run, l.commit, l.parent])).toEqual([
      ["rA", x, "main"],
      ["rB", y, levelRefOf("main", "rA")],
    ]);
    expect(git(repo, ["diff", "--name-only", `main..${x}`])).toBe("a.txt");
    expect(git(repo, ["diff", "--name-only", `${x}..${y}`])).toBe("b.txt");
  });

  it("leaves out an item that changed nothing when it settles before the item it started from", async () => {
    const repo = initTempRepo("delivery-stack-empty-", { "seed.txt": "seed\n" });
    git(repo, ["branch", DELIVERY]);
    const from = git(repo, ["rev-parse", "main"]);
    const ledger = scratchLedger();
    await recordDelivery(deliveryLedgerPath(ledger), { t: "opened", branch: DELIVERY, base: "main", from, stack: true });
    const x = await commitOn(repo, DELIVERY, "a.txt", "a\n");
    const record = (runId: string, extra: { empty?: true } = {}): RunRecord =>
      ({
        runId, repoPath: repo, dir: "dir",
        caseFile: {
          header: { taskDef: { intent: `intent ${runId}` }, delivery: { branch: DELIVERY } }, cursor: {},
          history: [{ t: "close", status: "DONE", detailRef: "close-0", commit: x, ...extra }],
          outcome: { kind: "closed", source: "closer", reason: "r", at },
        },
      }) as unknown as RunRecord;

    await settleRun(ledger, "backlog:e.md", record("rE", { empty: true }), 3);
    await settleRun(ledger, "backlog:a.md", record("rA"), 3);

    const levels = await readStack(repo, deliveryLedgerPath(ledger), DELIVERY);
    expect(levels.map((l) => [l.run, l.commit, l.parent])).toEqual([["rA", x, "main"]]);
    expect(git(repo, ["diff", "--name-only", `main..${x}`])).toBe("a.txt");
  });

  it("keeps ledger order when the delivery branch is gone", async () => {
    const repo = initTempRepo("delivery-stack-gone-", { "seed.txt": "seed\n" });
    const from = git(repo, ["rev-parse", "main"]);
    const ledger = scratchLedger();
    const path = deliveryLedgerPath(ledger);
    await recordDelivery(path, { t: "opened", branch: DELIVERY, base: "main", from, stack: true });
    await recordDelivery(path, { t: "landed", branch: DELIVERY, runId: "r1", key: "backlog:r1.md", intent: "r1", commit: "c1" });
    await recordDelivery(path, { t: "landed", branch: DELIVERY, runId: "r2", key: "backlog:r2.md", intent: "r2", commit: "c2" });

    const levels = await readStack(repo, path, DELIVERY);
    expect(levels.map((l) => [l.run, l.parent])).toEqual([["r1", "main"], ["r2", levelRefOf("main", "r1")]]);
  });

  it("reads restacked levels on the new line, each knowing the commits it stood at before", () => {
    const levels = stackOf(foldDelivery([open(), landed("r1", "c1"), landed("r2", "c2"),
      { t: "restacked", branch: DELIVERY, onto: "B2", merged: ["r1"], levels: [{ runId: "r2", commit: "n2" }], at }], DELIVERY), ["n2"]);
    expect(levels.map((l) => [l.run, l.parent, l.commit, l.earlier])).toEqual([["r2", "main", "n2", ["c2"]]]);
  });
});

describe("planStack", () => {
  const urlOf = (run: string) => `https://example.invalid/pull/${run.slice(1)}`;
  const [r1, r2, r3] = stackOf(stateOf(landed("r1", "c1"), landed("r2", "c2"), landed("r3", "c3")), ["c1", "c2", "c3"]) as [StackLevel, StackLevel, StackLevel];
  const R1 = levelRefOf("main", "r1");
  const R2 = levelRefOf("main", "r2");
  const R3 = levelRefOf("main", "r3");
  const three = [r1, r2, r3];

  type Seen = Partial<Omit<ObservedPull, "state" | "head">> & Pick<ObservedPull, "state" | "head">;
  const pull = (state: ObservedPull["state"], head: string, extra: Partial<Omit<ObservedPull, "state" | "head">> = {}): Seen => ({ state, head, ...extra });
  const observe = (seen: Record<string, Seen | undefined>): Map<string, ObservedPull> => {
    const observed = new Map<string, ObservedPull>();
    for (const [run, s] of Object.entries(seen)) {
      if (s) observed.set(levelRefOf("main", run), { url: urlOf(run), base: "main", mergeCommit: null, ...s });
    }
    return observed;
  };
  const ctx = (over: { held?: string[]; carried?: Record<string, boolean> } = {}) => ({
    base: "main",
    held: new Set(over.held ?? []),
    carried: new Map(Object.entries(over.carried ?? {})),
  });
  const reasonOf = (plan: StackPlan): string => {
    expect(plan.kind).toBe("blocked");
    return plan.kind === "blocked" ? plan.reason : "";
  };

  it("does nothing when every level is open at the commit the ledger expects", () => {
    expect(planStack(three, observe({ r1: pull("OPEN", "c1"), r2: pull("OPEN", "c2"), r3: pull("OPEN", "c3") }), ctx())).toEqual({ kind: "none" });
  });

  it("does nothing for a level with no pull request yet", () => {
    expect(planStack(three, observe({ r1: pull("OPEN", "c1"), r2: pull("OPEN", "c2") }), ctx())).toEqual({ kind: "none" });
  });

  it.each(["c1", "n1-squash"])("restacks the rest when the bottom merged, whatever head GitHub reports (%s)", (head) => {
    const observed = observe({ r1: pull("MERGED", head, { mergeCommit: "m1" }), r2: pull("OPEN", "c2"), r3: pull("OPEN", "c3") });
    expect(planStack(three, observed, ctx({ held: ["m1"] }))).toMatchObject({ kind: "restack", merged: [{ run: "r1" }], remaining: [{ run: "r2" }, { run: "r3" }] });
  });

  it("restacks a level that has no pull request yet above a merged bottom", () => {
    const observed = observe({ r1: pull("MERGED", "c1", { mergeCommit: "m1" }), r3: pull("OPEN", "c3") });
    expect(planStack(three, observed, ctx({ held: ["m1"] }))).toMatchObject({ kind: "restack", merged: [{ run: "r1" }], remaining: [{ run: "r2" }, { run: "r3" }] });
  });

  it("empties the stack when every level merged", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }),
      r3: pull("MERGED", "c3", { base: R2, mergeCommit: "m3" }),
    });
    expect(planStack(three, observed, ctx({ held: ["m1"], carried: { [R2]: true, [R3]: true } }))).toMatchObject({ kind: "restack", merged: [{ run: "r1" }, { run: "r2" }, { run: "r3" }], remaining: [] });
  });

  it("blocks a merge into a pull request that is still open below it, naming both, and promises it carries on", () => {
    const observed = observe({ r1: pull("OPEN", "c1"), r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }) });
    const reason = reasonOf(planStack(three, observed, ctx()));
    expect(reason).toContain(urlOf("r2"));
    expect(reason).toContain(urlOf("r1"));
    expect(reason).toContain("Once that is merged, the next run carries on");
  });

  it("restacks once the level below merges at a head that carried the merge into it", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }),
      r3: pull("OPEN", "c3"),
    });
    expect(planStack(three, observed, ctx({ held: ["m1"], carried: { [R2]: true } }))).toMatchObject({ kind: "restack", merged: [{ run: "r1" }, { run: "r2" }], remaining: [{ run: "r3" }] });
  });

  it("waits while the level below's merged head could not be fetched", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }),
      r3: pull("OPEN", "c3"),
    });
    expect(planStack(three, observed, ctx({ held: ["m1"] }))).toEqual({ kind: "none" });
  });

  it("blocks a level merged into the level below after that level had merged, naming the recovery", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }),
      r3: pull("OPEN", "c3"),
    });
    const reason = reasonOf(planStack(three, observed, ctx({ held: ["m1"], carried: { [R2]: false } })));
    expect(reason).toContain(urlOf("r2"));
    expect(reason).toContain(urlOf("r1"));
    expect(reason).toContain("after");
    expect(reason).toContain("commit " + "m2".slice(0, 7));
    expect(reason).toContain("new branch");
    expect(reason).toContain("merge commit");
    expect(reason).not.toContain("run again");
  });

  it("lifts that block once the stranded merge commit is held by the base", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }),
      r3: pull("OPEN", "c3"),
    });
    expect(planStack(three, observed, ctx({ held: ["m1", "m2"], carried: { [R2]: false } }))).toMatchObject({ kind: "restack", merged: [{ run: "r1" }, { run: "r2" }], remaining: [{ run: "r3" }] });
  });

  it("blocks a level merged into a branch outside the stack, whether or not the level below is merged", () => {
    const outside = pull("MERGED", "c2", { base: "feature-x", mergeCommit: "m2" });
    expect(reasonOf(planStack(three, observe({ r1: pull("OPEN", "c1"), r2: outside }), ctx()))).toContain("neither main nor");
    const belowMerged = observe({ r1: pull("MERGED", "c1", { mergeCommit: "m1" }), r2: outside });
    expect(reasonOf(planStack(three, belowMerged, ctx({ held: ["m1"] })))).toContain("neither main nor");
  });

  it("blocks on a level closed without merging", () => {
    const observed = observe({ r1: pull("OPEN", "c1"), r2: pull("CLOSED", "c2") });
    expect(reasonOf(planStack(three, observed, ctx()))).toContain("closed without being merged");
  });

  it("does nothing while a merged level's merge commit is not yet on this machine's base", () => {
    expect(planStack(three, observe({ r1: pull("MERGED", "c1", { mergeCommit: "m1" }), r2: pull("OPEN", "c2"), r3: pull("OPEN", "c3") }), ctx())).toEqual({ kind: "none" });
    expect(planStack(three, observe({ r1: pull("MERGED", "c1", { mergeCommit: "m1" }), r2: pull("OPEN", "c2"), r3: pull("OPEN", "c3") }), ctx({ held: ["m1"] }))).toMatchObject({ kind: "restack", merged: [{ run: "r1" }] });
    expect(planStack(three, observe({ r1: pull("MERGED", "c1"), r2: pull("OPEN", "c2"), r3: pull("OPEN", "c3") }), ctx({ held: ["m1"] }))).toEqual({ kind: "none" });
  });

  it("needs every level of a merged prefix to have reached the base, not just the first", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { mergeCommit: "m2" }),
      r3: pull("OPEN", "c3"),
    });
    expect(planStack(three, observed, ctx({ held: ["m1"] }))).toEqual({ kind: "none" });
  });

  it("prefers a block above to a wait below", () => {
    const observed = observe({
      r1: pull("MERGED", "c1", { mergeCommit: "m1" }),
      r2: pull("MERGED", "c2", { base: R1, mergeCommit: "m2" }),
      r3: pull("OPEN", "c3"),
    });
    expect(reasonOf(planStack(three, observed, ctx({ carried: { [R2]: false } })))).toContain(urlOf("r2"));
  });

  it("blocks on an open level whose head this machine did not make, but not on a commit it stood at before", () => {
    expect(reasonOf(planStack(three, observe({ r1: pull("OPEN", "x"), r2: pull("OPEN", "c2") }), ctx()))).toContain(urlOf("r1"));
    const formerly = [{ ...r1, earlier: ["old"] }, r2, r3];
    expect(planStack(formerly, observe({ r1: pull("OPEN", "old"), r2: pull("OPEN", "c2"), r3: pull("OPEN", "c3") }), ctx())).toEqual({ kind: "none" });
  });

  it("fingerprints observations independently of insertion order", () => {
    const forward = observe({ r1: pull("OPEN", "c1"), r2: pull("MERGED", "c2") });
    const backward = new Map([...forward].reverse());
    expect(pullsFingerprint(forward)).toBe(pullsFingerprint(backward));
    expect(pullsFingerprint(forward)).toBe(`${R1} OPEN c1\n${R2} MERGED c2`);
  });
});
