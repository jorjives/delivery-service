import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { commitOn } from "./delivery-fixtures.js";
import { deliveryLedgerPath, foldDelivery, recordDelivery, type DeliveryEntry } from "./delivery-ledger.js";
import { levelRefOf, readStack, stackOf } from "./delivery-stack.js";
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
