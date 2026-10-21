import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import { readDelivery, readDeliveryEntries } from "./delivery-ledger.js";
import { baseTip, closeDeliveryBranch, deliveryMerged, fetchBase, reconcileDeliveryBranch } from "./delivery-branch.js";
import { commitOn } from "./delivery-fixtures.js";
import type { GateRef } from "./schema.js";

const D = "delivery/main";
const passes: GateRef = { type: "command", command: "sh check.sh", parseMode: "tap" };
const CHECK = 'echo "1..1"\nif [ -f feature.txt ] && [ -f hotfix.txt ]; then echo "not ok 1 - together"; else echo "ok 1 - together"; fi\n';
const project = () => initTempRepo("delivery-branch-", { "check.sh": 'echo "1..1"\necho "ok 1 - fine"\n', "shared.txt": "one\n" });
const ledger = () => join(mkdtempSync(join(tmpdir(), "delivery-branch-ledger-")), "delivery.jsonl");
const onMain = (repo: string, file: string, content: string) => {
  writeFileSync(join(repo, file), content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `main: ${file}`]);
};

describe("reconcileDeliveryBranch", () => {
  it("opens the delivery branch at the base's tip when none is open", async () => {
    const repo = project();
    const path = ledger();

    expect(await reconcileDeliveryBranch(repo, passes, path)).toEqual({ ready: true, branch: D, base: "main" });
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect(await readDeliveryEntries(path)).toMatchObject([{ t: "opened", branch: D, base: "main", from: git(repo, ["rev-parse", "main"]) }]);
  });

  it("leaves an open branch as it is when the base has not moved", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");

    expect((await reconcileDeliveryBranch(repo, passes, path)).ready).toBe(true);
    expect(git(repo, ["rev-parse", D])).toBe(tip);
    expect(await readDeliveryEntries(path)).toHaveLength(1);
  });

  it("opens afresh at the base's tip once the base has everything the branch had", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    git(repo, ["merge", "-q", "--ff-only", tip]);
    onMain(repo, "after.txt", "later\n");

    expect((await reconcileDeliveryBranch(repo, passes, path)).ready).toBe(true);
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect((await readDeliveryEntries(path)).map((e) => e.t)).toEqual(["opened", "opened"]);
  });

  it("brings the operator's own base commits in when that is clean and the checks still pass", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "hotfix.txt", "the operator's fix\n");

    expect((await reconcileDeliveryBranch(repo, passes, path)).ready).toBe(true);
    expect(git(repo, ["show", `${D}:hotfix.txt`])).toBe("the operator's fix");
    expect(git(repo, ["rev-parse", `${D}^1`])).toBe(tip);
    expect(git(repo, ["log", "-1", "--format=%s", D])).toBe(`Bring main into ${D}`);
    expect((await readDeliveryEntries(path)).map((e) => e.t)).toEqual(["opened", "base_merged"]);
  });

  it("is blocked, changing nothing, when bringing the base in conflicts, and says which files", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    const tip = await commitOn(repo, D, "shared.txt", "delivered\n");
    onMain(repo, "shared.txt", "the operator's\n");

    const result = await reconcileDeliveryBranch(repo, passes, path);

    expect(result).toMatchObject({ ready: false, repeated: false });
    expect(result.ready === false && result.reason).toContain("shared.txt");
    expect(git(repo, ["rev-parse", D])).toBe(tip);
  });

  it("is blocked when the checks fail on the merged result", async () => {
    const repo = initTempRepo("delivery-branch-", { "check.sh": CHECK });
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "hotfix.txt", "fix\n");

    const result = await reconcileDeliveryBranch(repo, passes, path);

    expect(result).toMatchObject({ ready: false, repeated: false });
    expect(result.ready === false && result.reason).toContain("together");
    expect(git(repo, ["rev-parse", D])).toBe(tip);
  });

  it("does not try the same blocked merge again until the base or the branch moves", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    await commitOn(repo, D, "shared.txt", "delivered\n");
    onMain(repo, "shared.txt", "the operator's\n");
    const first = await reconcileDeliveryBranch(repo, passes, path);

    const again = await reconcileDeliveryBranch(repo, passes, path);
    expect(again).toEqual({ ...first, repeated: true });
    expect((await readDeliveryEntries(path)).filter((e) => e.t === "blocked")).toHaveLength(1);

    onMain(repo, "unrelated.txt", "more\n");
    expect(await reconcileDeliveryBranch(repo, passes, path)).toMatchObject({ ready: false, repeated: false });
    expect((await readDeliveryEntries(path)).filter((e) => e.t === "blocked")).toHaveLength(2);
  });

  it("opens afresh at the base's tip when GitHub says the pull request for the branch's tip merged by squash, even after the base changed the same paths", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    await commitOn(repo, D, "feature.txt", "work\n");
    const tip = await commitOn(repo, D, "feature2.txt", "more\n");
    git(repo, ["merge", "-q", "--squash", D]);
    git(repo, ["commit", "-q", "-m", "Delivered work (#1)"]);
    onMain(repo, "feature.txt", "the owner's later edit\n");

    expect(await reconcileDeliveryBranch(repo, passes, path, undefined, new Set([tip]))).toEqual({ ready: true, branch: D, base: "main" });
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect((await readDeliveryEntries(path)).map((e) => e.t)).toEqual(["opened", "opened"]);
  });

  it("brings the base in, rather than starting again, when GitHub has not said the branch's tip merged, even though the base holds the same change", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "feature.txt", "work\n");

    expect((await reconcileDeliveryBranch(repo, passes, path, undefined, new Set(["some-other-commit"]))).ready).toBe(true);
    expect(git(repo, ["merge-base", "--is-ancestor", tip, D])).toBe("");
    expect((await readDeliveryEntries(path)).map((e) => e.t)).toEqual(["opened", "base_merged"]);
  });
});

describe("baseTip", () => {
  it("is the local base branch, unless its remote-tracking branch is strictly ahead", async () => {
    const repo = project();
    expect(await baseTip(repo)).toEqual({ base: "main", commit: git(repo, ["rev-parse", "main"]) });
  });
});

describe("deliveryMerged", () => {
  it("is false with no delivery branch, and while the branch sits at the base's tip", async () => {
    const repo = project();
    expect(await deliveryMerged(repo, new Set())).toBe(false);
    await reconcileDeliveryBranch(repo, passes, ledger());
    expect(await deliveryMerged(repo, new Set())).toBe(false);
  });

  it("is false while the branch has work GitHub has not reported merged, though the base holds the same change", async () => {
    const repo = project();
    await reconcileDeliveryBranch(repo, passes, ledger());
    await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "feature.txt", "work\n");
    expect(await deliveryMerged(repo, new Set())).toBe(false);
  });

  it("is true once the branch's tip is a head GitHub reported merged, and when the base reaches the tip by a merge commit", async () => {
    const repo = project();
    await reconcileDeliveryBranch(repo, passes, ledger());
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "unrelated.txt", "other\n");
    expect(await deliveryMerged(repo, new Set([tip]))).toBe(true);

    git(repo, ["merge", "-q", "--no-ff", "-m", "merge", D]);
    expect(await deliveryMerged(repo, new Set())).toBe(true);
  });
});

describe("closeDeliveryBranch", () => {
  it("runs the project's closer once on the delivery branch, records what it did, and removes its scratch copy", async () => {
    const repo = project();
    const path = ledger();
    await reconcileDeliveryBranch(repo, passes, path);
    await commitOn(repo, D, "feature.txt", "work\n");

    const report = await closeDeliveryBranch({ repoPath: repo, closerRef: { type: "merge-back" }, ledger: path, branch: D, base: "main" }, []);

    expect(report.status).toBe("DONE");
    expect(git(repo, ["show", "main:feature.txt"])).toBe("work");
    expect(git(repo, ["branch", "--list", D])).toBe("");
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
    expect((await readDelivery(path, D)).closer).toMatchObject({ status: "DONE" });
  });
});

describe("fetchBase", () => {
  /** A commit pushed to origin's main from elsewhere, as merging a pull request on GitHub would. */
  const pushToOrigin = (origin: string, file: string): string => {
    const clone = join(mkdtempSync(join(tmpdir(), "fetch-base-clone-")), "clone");
    git(tmpdir(), ["clone", "-q", origin, clone]);
    git(clone, ["config", "user.email", "owner@example.invalid"]);
    git(clone, ["config", "user.name", "Owner"]);
    writeFileSync(join(clone, file), "on GitHub\n");
    git(clone, ["add", file]);
    git(clone, ["commit", "-q", "-m", `GitHub: ${file}`]);
    git(clone, ["push", "-q", "origin", "main"]);
    return git(clone, ["rev-parse", "HEAD"]);
  };

  it("moves origin's tracking branch for the base to what origin has, and no local branch", async () => {
    const repo = project();
    const origin = addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    const local = git(repo, ["rev-parse", "main"]);
    const merged = pushToOrigin(origin, "merged.txt");

    expect(await fetchBase(repo)).toBeUndefined();
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(merged);
    expect(git(repo, ["rev-parse", "main"])).toBe(local);
  });

  it("has nothing to fetch when the base is not taken from origin", async () => {
    const repo = project();
    expect(await fetchBase(repo)).toBeUndefined();
  });

  it("returns git's reason, and leaves the tracking branch as it was, when origin cannot be reached", async () => {
    const repo = project();
    addLocalOrigin(repo);
    git(repo, ["remote", "set-head", "origin", "main"]);
    const before = git(repo, ["rev-parse", "origin/main"]);
    git(repo, ["remote", "set-url", "origin", join(tmpdir(), "no-such-origin-for-fetch")]);

    expect(await fetchBase(repo)).toEqual({ base: "main", reason: expect.stringContaining("does not appear to be a git repository") });
    expect(git(repo, ["rev-parse", "origin/main"])).toBe(before);
  });
});
