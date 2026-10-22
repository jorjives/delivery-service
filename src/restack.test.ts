import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { moveRefs, restackLevels, type RestackLevel } from "./restack.js";
import type { GateRef } from "./schema.js";

const D = "delivery/main";
const URL2 = "https://github.test/owner/repo/pull/2";
const URL3 = "https://github.test/owner/repo/pull/3";
const passes: GateRef = { type: "command", command: "sh check.sh", parseMode: "tap" };
const CHECK = 'echo "1..1"\nif [ -f thanks.txt ]; then echo "not ok 1 - no thanks file"; else echo "ok 1 - no thanks file"; fi\n';
const target = (repo: string) => ({ repoPath: repo, gateRef: passes, base: "main" });
const SHA = /^[0-9a-f]{40}$/;

/** Commit `contents` to `file` on the checked-out branch and return the new commit. */
function commit(repo: string, file: string, contents: string, message: string): string {
  writeFileSync(join(repo, file), contents);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

/**
 * A repository with `delivery/main` carrying three levels, each on its own branch `level-<n>`: level 1 adds a line
 * to shared.txt, level 2 edits that line, level 3 adds `top`. Left with `main` checked out.
 */
function stack(top = "third.txt") {
  const repo = initTempRepo("restack-", { "check.sh": CHECK, "shared.txt": "one\ntwo\nthree\n" });
  git(repo, ["checkout", "-q", "-b", D]);
  const c1 = commit(repo, "shared.txt", "one\ntwo\nthree\nfour\n", "level 1");
  const c2 = commit(repo, "shared.txt", "one\ntwo\nthree\nFOUR\n", "level 2");
  const c3 = commit(repo, top, "top\n", "level 3");
  git(repo, ["branch", "level-1", c1]);
  git(repo, ["branch", "level-2", c2]);
  git(repo, ["branch", "level-3", c3]);
  git(repo, ["checkout", "-q", "main"]);
  return { repo, c1, c2, c3 };
}

/** Put level 1 on main by a squash, rebase or merge, as GitHub would, and return main's new tip. */
function mergeIntoMain(repo: string, method: "squash" | "rebase" | "merge"): string {
  git(repo, ["checkout", "-q", "main"]);
  if (method === "squash") {
    git(repo, ["merge", "--squash", "-q", "level-1"]);
    git(repo, ["commit", "-q", "-m", "Squash level 1"]);
  } else if (method === "rebase") {
    git(repo, ["cherry-pick", "level-1"]);
  } else {
    git(repo, ["merge", "--no-ff", "-q", "-m", "Merge level 1", "level-1"]);
  }
  return git(repo, ["rev-parse", "main"]);
}

const level2: RestackLevel = { ref: "level-2", commit: "", intent: "tidy the new line", position: 2, pull: URL2 };
const level3: RestackLevel = { ref: "level-3", commit: "", intent: "add the top change", position: 3, pull: URL3 };
const withCommit = (level: RestackLevel, commit: string): RestackLevel => ({ ...level, commit });

/** The added and removed lines of a diff, without its headers. */
const changedLines = (diff: string): string[] => diff.split("\n").filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"));

describe("restackLevels", () => {
  it("moves a level that edits lines a squash-merged level below it added, onto the base, cleanly", async () => {
    const { repo, c1, c2, c3 } = stack();
    const onto = mergeIntoMain(repo, "squash");

    const result = await restackLevels(target(repo), { onto, upstream: c1, levels: [withCommit(level2, c2), withCommit(level3, c3)] });

    expect(result).toMatchObject({ commits: [expect.stringMatching(SHA), expect.stringMatching(SHA)] });
    const [n2, n3] = (result as { commits: string[] }).commits as [string, string];
    expect(git(repo, ["rev-parse", `${n2}^`])).toBe(onto);
    expect(changedLines(git(repo, ["diff", onto, n2]))).toEqual(["-four", "+FOUR"]);
    expect(git(repo, ["rev-parse", `${n3}^`])).toBe(n2);
    // Nothing has moved yet: the levels and the delivery branch stand where they were.
    expect(git(repo, ["rev-parse", "level-2"])).toBe(c2);
    expect(git(repo, ["rev-parse", D])).toBe(c3);

    await moveRefs(repo, [{ ref: "refs/heads/level-2", to: n2 }, { ref: "refs/heads/level-3", to: n3 }]);
    expect(git(repo, ["rev-parse", "level-2"])).toBe(n2);
    expect(git(repo, ["rev-parse", "level-3"])).toBe(n3);
  });

  it("moves the rest after a rebase-merge of the bottom", async () => {
    const { repo, c1, c2, c3 } = stack();
    const onto = mergeIntoMain(repo, "rebase");

    const result = await restackLevels(target(repo), { onto, upstream: c1, levels: [withCommit(level2, c2), withCommit(level3, c3)] });

    expect(result).toMatchObject({ commits: [expect.stringMatching(SHA), expect.stringMatching(SHA)] });
    const [n2] = (result as { commits: string[] }).commits as [string];
    expect(git(repo, ["rev-parse", `${n2}^`])).toBe(onto);
  });

  it("names the level, its pull request and the files when level 2 of 3 conflicts, and moves nothing", async () => {
    const { repo, c1, c2, c3 } = stack();
    mergeIntoMain(repo, "squash");
    // main edits the line level 2 edits, differently, so level 2 cannot be replayed onto it.
    const onto = commit(repo, "shared.txt", "one\ntwo\nthree\nfive\n", "main's own edit");

    const result = await restackLevels(target(repo), { onto, upstream: c1, levels: [withCommit(level2, c2), withCommit(level3, c3)] });

    expect(result).toHaveProperty("reason");
    const { reason } = result as { reason: string };
    expect(reason).toContain("level 2");
    expect(reason).toContain(URL2);
    expect(reason).toContain("shared.txt");
    expect(git(repo, ["rev-parse", "level-2"])).toBe(c2);
    expect(git(repo, ["rev-parse", "level-3"])).toBe(c3);
    expect(git(repo, ["rev-parse", D])).toBe(c3);
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
  });

  it("names the failing assertion when the top level fails its check, and moves nothing", async () => {
    const { repo, c1, c2, c3 } = stack("thanks.txt");
    const onto = mergeIntoMain(repo, "squash");

    const result = await restackLevels(target(repo), { onto, upstream: c1, levels: [withCommit(level2, c2), withCommit(level3, c3)] });

    expect(result).toHaveProperty("reason");
    const { reason } = result as { reason: string };
    expect(reason).toContain("level 3");
    expect(reason).toContain("1 - no thanks file");
    expect(git(repo, ["rev-parse", "level-3"])).toBe(c3);
    expect(git(repo, ["rev-parse", D])).toBe(c3);
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
  });

  it("gives a level whose change the base already holds its parent's commit", async () => {
    const { repo, c1, c2, c3 } = stack();
    // main catches up to level 2 by a commit of its own, so level 2's change is already there.
    const tree = git(repo, ["rev-parse", `${c2}^{tree}`]);
    const onto = git(repo, ["commit-tree", tree, "-p", "main", "-m", "main already has level 2"]);
    git(repo, ["reset", "-q", "--hard", onto]);

    const result = await restackLevels(target(repo), { onto, upstream: c1, levels: [withCommit(level2, c2), withCommit(level3, c3)] });

    expect(result).toMatchObject({ commits: [onto, expect.stringMatching(SHA)] });
    const [, n3] = (result as { commits: string[] }).commits as [string, string];
    expect(git(repo, ["rev-parse", `${n3}^`])).toBe(onto);
  });
});

describe("moveRefs", () => {
  it("moves every ref in one transaction, creating a missing one", async () => {
    const { repo, c1, c3 } = stack();

    await moveRefs(repo, [{ ref: "refs/heads/level-2", to: c1 }, { ref: "refs/heads/fresh", to: c3 }]);

    expect(git(repo, ["rev-parse", "level-2"])).toBe(c1);
    expect(git(repo, ["rev-parse", "fresh"])).toBe(c3);
  });

  it("moves no ref when any one move in the transaction is refused", async () => {
    const { repo, c1, c2, c3 } = stack();

    await expect(moveRefs(repo, [{ ref: "refs/heads/level-2", to: c1 }, { ref: "refs/heads/bad..name", to: c3 }])).rejects.toThrow();

    expect(git(repo, ["rev-parse", "level-2"])).toBe(c2);
  });
});
