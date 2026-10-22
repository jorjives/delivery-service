import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { git } from "../tests/helpers.js";
import { commitOn } from "./delivery-fixtures.js";
import { readDelivery, readDeliveryEntries, recordDelivery } from "./delivery-ledger.js";
import { createGhStandIn, type GhStandIn } from "./gh-stand-in.js";
import { landFollowUps } from "./follow-ups.js";
import { closeDeliveryStack, reconcileStackBranch } from "./stack-branch.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import type { DeliveredLevel } from "./ports.js";

const D = "delivery/main";
const R1 = "delivery-stack/main/r1";
const R2 = "delivery-stack/main/r2";
const R3 = "delivery-stack/main/r3";
const URL1 = "https://github.com/example/project/pull/1";
const URL2 = "https://github.com/example/project/pull/2";
const URL3 = "https://github.com/example/project/pull/3";
const project = () => initTempRepo("stack-branch-", { "seed.txt": "seed\n" });
const ledger = () => join(mkdtempSync(join(tmpdir(), "stack-branch-ledger-")), "delivery.jsonl");
const onMain = (repo: string, file: string, content: string) => {
  writeFileSync(join(repo, file), content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `main: ${file}`]);
};

describe("reconcileStackBranch", () => {
  it("opens the delivery branch at the base's tip as a stack section", async () => {
    const repo = project();
    const path = ledger();

    expect(await reconcileStackBranch(repo, path)).toEqual({ ready: true, branch: D, base: "main" });
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect(await readDeliveryEntries(path)).toMatchObject([{ t: "opened", branch: D, base: "main", from: git(repo, ["rev-parse", "main"]), stack: true }]);
    expect((await readDelivery(path, D)).stacked).toBe(true);
  });

  it("starts a rolling section's branch again from the base's tip, as a stack section, on the first stack run", async () => {
    const repo = project();
    const path = ledger();
    git(repo, ["branch", D, "main"]);
    await commitOn(repo, D, "rolling.txt", "rolling work\n");
    await recordDelivery(path, { t: "opened", branch: D, base: "main", from: git(repo, ["rev-parse", "main"]) });

    expect((await reconcileStackBranch(repo, path)).ready).toBe(true);
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect((await readDelivery(path, D)).stacked).toBe(true);
  });

  it("never brings the owner's new base commits into a stacked delivery branch", async () => {
    const repo = project();
    const path = ledger();
    await reconcileStackBranch(repo, path);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "after.txt", "later\n");

    expect((await reconcileStackBranch(repo, path)).ready).toBe(true);
    expect(git(repo, ["rev-parse", D])).toBe(tip);
    expect((await readDeliveryEntries(path)).some((e) => e.t === "base_merged")).toBe(false);
  });
});

describe("closeDeliveryStack", () => {
  let repo: string;
  let path: string;
  let gh: GhStandIn;

  /** A commit on `parent` with no change of its own, made without moving any branch. */
  const commitAbove = (parent: string, message: string): string => git(repo, ["commit-tree", `${parent}^{tree}`, "-p", parent, "-m", message]);

  /** A level at `commit`, as the delivery branch's landings describe it. */
  const levelAt = (ref: string, commit: string, parent: string): DeliveredLevel => {
    const run = ref.split("/").at(-1) ?? ref;
    return { intent: `Add ${run}`, item: `backlog:${run}.md`, run, at: "2026-10-22T09:00:00.000Z", text: `The work of ${run}.`, ref, commit, parent };
  };

  const target = () => ({ repoPath: repo, closerRef: { type: "open-pr" as const, stack: true }, ledger: path, branch: D, base: "main" });

  beforeEach(() => {
    gh = createGhStandIn();
    vi.stubEnv("PATH", `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`);
    repo = project();
    addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    path = ledger();
    git(repo, ["branch", D, "main"]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates each level ref at its own landed commit, leaving an existing one where it is", async () => {
    const x = commitAbove(git(repo, ["rev-parse", "main"]), "level one");
    const z = commitAbove(x, "level two");
    const elsewhere = commitAbove(git(repo, ["rev-parse", "main"]), "already held elsewhere");
    git(repo, ["update-ref", `refs/heads/${R1}`, elsewhere]);

    await closeDeliveryStack(target(), [levelAt(R1, x, "main"), levelAt(R2, z, R1)]);

    expect(git(repo, ["rev-parse", `refs/heads/${R1}`])).toBe(elsewhere);
    expect(git(repo, ["rev-parse", `refs/heads/${R2}`])).toBe(z);
  });

  it("records what GitHub shows for each level after a close, including every pull request that close has just opened, one that failed part way, and says when it could not ask", async () => {
    const x = commitAbove(git(repo, ["rev-parse", "main"]), "level one");
    const y = commitAbove(x, "level two");
    const w = commitAbove(y, "level three");
    const [l1, l2, l3] = [levelAt(R1, x, "main"), levelAt(R2, y, R1), levelAt(R3, w, R2)];

    // The first close opens the bottom level only.
    expect((await closeDeliveryStack(target(), [l1])).report.status).toBe("DONE");
    expect((await readDelivery(path, D)).pullRequests).toEqual(new Map([[R1, { url: URL1, state: "OPEN" }]]));

    // The second fails on its second level: the first stays open and is recorded; the second has no pull request to record.
    gh.refuseCreate("pull request create failed: refused for the test");
    expect((await closeDeliveryStack(target(), [l1, l2])).report.status).toBe("FAIL");
    expect((await readDelivery(path, D)).pullRequests).toEqual(new Map([[R1, { url: URL1, state: "OPEN" }]]));

    // The third opens both missing levels in one close, and every one is recorded.
    gh.refuseCreate(null);
    const full = await closeDeliveryStack(target(), [l1, l2, l3]);
    expect(full.report.status).toBe("DONE");
    expect(full.unobserved).toBeUndefined();
    expect((await readDelivery(path, D)).pullRequests).toEqual(
      new Map([
        [R1, { url: URL1, state: "OPEN" }],
        [R2, { url: URL2, state: "OPEN" }],
        [R3, { url: URL3, state: "OPEN" }],
      ]),
    );

    // When GitHub cannot be asked, the close is reported with gh's reason, and nothing new is recorded.
    const recorded = (await readDeliveryEntries(path)).filter((e) => e.t === "observed").length;
    gh.setMode("offline");
    const unasked = await closeDeliveryStack(target(), [l1, l2, l3]);
    expect(unasked.unobserved).toContain("error connecting to api.github.com");
    expect((await readDeliveryEntries(path)).filter((e) => e.t === "observed")).toHaveLength(recorded);
  });
});

describe("landFollowUps in stack mode", () => {
  it("opens the delivery branch as a stack section when follow-ups land in stack mode with no branch", async () => {
    const repo = project();
    const path = ledger();
    const file = "20261022T100000Z-say-goodbye.md";

    await landFollowUps({ repoPath: repo, ledger: path, branch: D, base: "main", runId: "after-1", stack: true }, [{ file, text: "Add a goodbye function.\n" }]);

    expect((await readDelivery(path, D)).stacked).toBe(true);
    expect(git(repo, ["show", `${D}:.delivery/backlog/${file}`])).toContain("Add a goodbye function.");
    expect((await readDelivery(path, D)).landed.map((e) => e.runId)).toEqual(["after-1"]);
  });
});
