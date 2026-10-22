import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseDir, git } from "../tests/helpers.js";
import { createStackPrCloser } from "./stack-pr-closer.js";
import { provisionWorktree } from "./provision.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import { createGhStandIn, type GhStandIn } from "./gh-stand-in.js";
import type { CloseContext, DeliveredLevel } from "./ports.js";

const accepted = { kind: "accepted" } as const;
const R1 = "delivery-stack/main/r1";
const R2 = "delivery-stack/main/r2";
const R3 = "delivery-stack/main/r3";
const URL1 = "https://github.com/example/project/pull/1";

describe("the stack publisher", () => {
  let repo: string;
  let origin: string;
  let ctx: CloseContext;
  let gh: GhStandIn;

  /** A commit on `parent` adding `file`, checked out detached so no branch of the test repository moves. */
  function commitOn(parent: string, file: string, text: string): string {
    git(repo, ["checkout", "-q", "--detach", parent]);
    writeFileSync(join(repo, file), text);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", `add ${file}`]);
    return git(repo, ["rev-parse", "HEAD"]);
  }

  /** A level whose ref is a local branch at `commit`, as closeDeliveryStack creates it before the close. */
  function levelAt(ref: string, commit: string, parent: string, over: Partial<DeliveredLevel> = {}): DeliveredLevel {
    git(repo, ["update-ref", `refs/heads/${ref}`, commit]);
    const run = ref.split("/").at(-1) ?? ref;
    return {
      intent: `Add ${run}`,
      item: `backlog:${run}`,
      run,
      at: "2026-10-22T09:00:00Z",
      text: `The work of ${run}.`,
      ref,
      commit,
      parent,
      ...over,
    };
  }

  /** Three levels, each one commit on the one below, bottom on main. */
  function threeLevels(): [DeliveredLevel, DeliveredLevel, DeliveredLevel] {
    const c1 = commitOn("main", "one.txt", "one\n");
    const c2 = commitOn(c1, "two.txt", "two\n");
    const c3 = commitOn(c2, "three.txt", "three\n");
    return [levelAt(R1, c1, "main"), levelAt(R2, c2, R1), levelAt(R3, c3, R2)];
  }

  const close = (stack: readonly DeliveredLevel[]) =>
    createStackPrCloser({ ghCommand: gh.command }).close({ ...ctx, delivery: { landed: [], stack } }, accepted);

  beforeEach(() => {
    repo = initTempRepo("stack-pr-repo-", { "seed.txt": "hello\n" });
    origin = addLocalOrigin(repo);
    git(repo, ["fetch", "-q", "origin"]);
    ctx = {
      dir: repo,
      repoPath: repo,
      worktreePath: join(repo, "no-worktree"),
      branch: "delivery/main",
      baseBranch: "main",
    };
    gh = createGhStandIn();
  });

  it("opens one pull request per level, bottom first, the bottom on the base and each other on the level below", async () => {
    const [l1, l2, l3] = threeLevels();

    const report = await close([l1, l2, l3]);

    expect(report.status).toBe("DONE");
    expect(gh.pullRequests().map(({ head, base }) => ({ head, base }))).toEqual([
      { head: R1, base: "main" },
      { head: R2, base: R1 },
      { head: R3, base: R2 },
    ]);
    expect(git(origin, ["rev-parse", `refs/heads/${R1}`])).toBe(l1.commit);
    expect(git(origin, ["rev-parse", `refs/heads/${R2}`])).toBe(l2.commit);
    expect(git(origin, ["rev-parse", `refs/heads/${R3}`])).toBe(l3.commit);
    expect(git(origin, ["for-each-ref", "refs/heads/delivery/"])).toBe("");
  });

  it("titles each with its intent and describes it with its task, what it closes, and what must merge first", async () => {
    const [l1, l2, l3] = threeLevels();

    await close([l1, { ...l2, closes: "#7" }, l3]);

    const prs = gh.pullRequests();
    expect(prs[1]?.title).toBe(l2.intent);
    expect(prs[1]?.body).toBe(`${l2.text}\n\nCloses #7\n\nThis builds on ${URL1}: merge that first, bottom first.`);
    expect(prs[0]?.body).toBe(l1.text);
  });

  it("cuts a title longer than GitHub allows to 256 characters, keeping the whole text in the body", async () => {
    const [l1] = threeLevels();
    const longIntent = "x".repeat(300);

    await close([{ ...l1, intent: longIntent }]);

    const [pr] = gh.pullRequests();
    expect(pr?.title).toBe(longIntent.slice(0, 256));
    expect(pr?.body).toBe(l1.text);
  });

  it("opens no duplicate when closed again immediately after the first close", async () => {
    const stack = threeLevels();

    await close(stack);
    await close(stack);

    expect(gh.pullRequests().map((pr) => pr.head)).toEqual([R1, R2, R3]);
  });

  it("changes nothing on a second close when everything is already right", async () => {
    const stack = threeLevels();
    const first = await close(stack);
    const before = gh.pullRequests();

    const second = await close(stack);

    expect(gh.pullRequests()).toEqual(before);
    expect(second.detail).toBe(first.detail);
  });

  it("repairs what is missing: opens a pull request a refused create left out, and retargets one on the wrong base", async () => {
    const [l1, l2, l3] = threeLevels();
    await close([l1]);
    gh.refuseCreate("pull request create failed: refused for the test");

    const refused = await close([l1, l2, l3]);

    expect(refused.status).toBe("FAIL");
    gh.refuseCreate(null);
    execFileSync(gh.command, ["pr", "edit", URL1, "--base=other"]);

    const repaired = await close([l1, l2, l3]);

    expect(repaired.status).toBe("DONE");
    expect(gh.pullRequests().map(({ head, base }) => ({ head, base }))).toEqual([
      { head: R1, base: "main" },
      { head: R2, base: R1 },
      { head: R3, base: R2 },
    ]);
  });

  it("leaves a level whose pull request merged or closed alone, opening no second one for it", async () => {
    const stack = threeLevels();
    await close(stack);
    gh.mergePullRequest(URL1, stack[0].commit);

    const report = await close(stack);

    expect(report.status).toBe("DONE");
    expect(gh.pullRequests()).toHaveLength(3);
    expect(gh.pullRequests()[0]?.state).toBe("MERGED");
    expect(report.detail).toContain(URL1);
  });

  it("publishes the rest of the stack when one level has no commits of its own, opening nothing for it", async () => {
    const c1 = commitOn("main", "one.txt", "one\n");
    const c3 = commitOn(c1, "three.txt", "three\n");
    const l1 = levelAt(R1, c1, "main");
    const l2 = levelAt(R2, c1, R1, { intent: "Tidy the readme" });
    const l3 = levelAt(R3, c3, R2);

    const report = await close([l1, l2, l3]);

    expect(report.status).toBe("DONE");
    expect(gh.pullRequests().map(({ head, base }) => ({ head, base }))).toEqual([
      { head: R1, base: "main" },
      { head: R3, base: R1 },
    ]);
    expect(git(origin, ["for-each-ref", "refs/heads/delivery-stack/main/r2"])).toBe("");
    expect(report.detail).toContain("Tidy the readme changed nothing of its own, so it has no pull request.");
    expect(gh.pullRequests()[1]?.body).toBe(`${l3.text}\n\nThis builds on ${URL1}: merge that first, bottom first.`);
  });

  it("needs no pull request when the only level has no commits of its own", async () => {
    const tip = git(repo, ["rev-parse", "main"]);

    const report = await close([levelAt(R1, tip, "main")]);

    expect(report.status).toBe("DONE");
    expect(report.detail).toContain("Nothing is stacked on main");
    expect(gh.calls()).toEqual([]);
  });

  it("publishes levels on a base whose name has a slash", async () => {
    git(repo, ["push", "-q", "origin", "main:refs/heads/release/1.0"]);
    git(repo, ["fetch", "-q", "origin"]);
    const r1 = "delivery-stack/release/1.0/r1";
    const r2 = "delivery-stack/release/1.0/r2";
    const c1 = commitOn("main", "one.txt", "one\n");
    const c2 = commitOn(c1, "two.txt", "two\n");

    const stack = [levelAt(r1, c1, "release/1.0"), levelAt(r2, c2, r1)];

    const published = await createStackPrCloser({ ghCommand: gh.command }).close(
      { ...ctx, baseBranch: "release/1.0", delivery: { landed: [], stack } },
      accepted,
    );

    expect(published.status).toBe("DONE");
    expect(gh.pullRequests().map(({ head, base }) => ({ head, base }))).toEqual([
      { head: r1, base: "release/1.0" },
      { head: r2, base: r1 },
    ]);
  });

  it("reports gh signed out as an ERROR naming the fix", async () => {
    gh.setMode("signed-out");

    const report = await close(threeLevels());

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("GitHub sign-in is needed");
  });

  it("acts as the rolling open-pr closer for a task with no stack", async () => {
    const dir = await caseDir("surface-71", { goal: "add the feature" });
    const tree = join(await mkdtemp(join(tmpdir(), "stack-pr-tree-")), "wt");
    const { baseBranch } = await provisionWorktree(dir, repo, tree, "surface-71");
    writeFileSync(join(tree, "feature.txt"), "the work\n");

    const report = await createStackPrCloser({ ghCommand: gh.command }).close(
      { dir, repoPath: repo, worktreePath: tree, branch: "surface/surface-71", baseBranch },
      accepted,
    );

    expect(report.status).toBe("DONE");
    expect(gh.pullRequests()).toEqual([expect.objectContaining({ head: "surface/surface-71", base: "main" })]);
  });
});
