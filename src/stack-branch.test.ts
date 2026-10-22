import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { git } from "../tests/helpers.js";
import { commitOn } from "./delivery-fixtures.js";
import { readDelivery, readDeliveryEntries, recordDelivery } from "./delivery-ledger.js";
import { readStack } from "./delivery-stack.js";
import { createGhStandIn, type GhStandIn } from "./gh-stand-in.js";
import { landFollowUps } from "./follow-ups.js";
import { awaitsMerge, readItemLedger } from "./item-ledger.js";
import { closeDeliveryStack, reconcileStackBranch } from "./stack-branch.js";
import { addLocalOrigin, initTempRepo } from "./temp-repo.js";
import type { DeliveredLevel } from "./ports.js";
import type { GateRef } from "./schema.js";
import { chooseWork } from "./work-sources.js";

const D = "delivery/main";
const R1 = "delivery-stack/main/r1";
const R2 = "delivery-stack/main/r2";
const R3 = "delivery-stack/main/r3";
const URL1 = "https://github.com/example/project/pull/1";
const URL2 = "https://github.com/example/project/pull/2";
const URL3 = "https://github.com/example/project/pull/3";
const GATE: GateRef = { type: "command", command: "sh check.sh", parseMode: "tap" };
// The gate appends a line to $GATE_LOG when a test asks for one, so a test can count the checks it ran.
const CHECK = 'if [ -n "$GATE_LOG" ]; then echo ran >> "$GATE_LOG"; fi\necho "1..1"\necho "ok 1 - fine"\n';
const AT = "2026-10-22T09:00:00.000Z";
const project = () => initTempRepo("stack-branch-", { "seed.txt": "seed\n", "check.sh": CHECK });
const ledger = () => join(mkdtempSync(join(tmpdir(), "stack-branch-ledger-")), "delivery.jsonl");
const onMain = (repo: string, file: string, content: string) => {
  writeFileSync(join(repo, file), content);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", `main: ${file}`]);
};

interface Books {
  dir: string;
  delivery: string;
  items: string;
}
const books = (): Books => {
  const dir = mkdtempSync(join(tmpdir(), "stack-branch-books-"));
  return { dir, delivery: join(dir, "delivery.jsonl"), items: join(dir, "items.jsonl") };
};
const reconcile = (repo: string, book: Books, env: NodeJS.ProcessEnv = process.env) =>
  reconcileStackBranch(repo, book.delivery, { gateRef: GATE, itemLedger: book.items, env });
const rev = (repo: string, ref: string): string => git(repo, ["rev-parse", "--verify", ref]);
const entriesOf = async (book: Books) => readDeliveryEntries(book.delivery);
const linesOf = (path: string): number => readFileSync(path, "utf-8").split("\n").filter((line) => line !== "").length;

/** Append an entry to the item ledger, as the run that settled it would. */
const itemLine = (path: string, entry: object): void => appendFileSync(path, `${JSON.stringify(entry)}\n`);

/** Each run's item delivered at its commit on the delivery branch, as settleRun records it. */
function recordItems(path: string, runs: readonly [string, string][]): void {
  for (const [run, commit] of runs) {
    const key = `backlog:${run}.md`;
    itemLine(path, { t: "dispatched", key, runId: run, intent: `Add ${run}`, at: AT });
    itemLine(path, { t: "ended", key, runId: run, class: "delivered", branch: D, commit, at: AT });
  }
}

/** Drop the ledger lines a predicate picks out, as a crash between two writes would leave the file. */
function dropLines(path: string, drop: (entry: { t: string }) => boolean): void {
  const kept = readFileSync(path, "utf-8").split("\n").filter((line) => line !== "" && !drop(JSON.parse(line)));
  writeFileSync(path, kept.map((line) => `${line}\n`).join(""));
}

/** Run `act` on a clone of origin, then remove the clone: how the owner, or GitHub, changes origin from outside. */
function onOrigin(origin: string, act: (clone: string) => void): void {
  const clone = mkdtempSync(join(tmpdir(), "stack-branch-clone-"));
  try {
    git(tmpdir(), ["clone", "-q", origin, clone]);
    git(clone, ["config", "user.name", "Owner"]);
    git(clone, ["config", "user.email", "owner@example.invalid"]);
    act(clone);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

/** The owner commits `file` to origin's main, as they would on GitHub. */
const pushToMain = (origin: string, file: string, text: string): void =>
  onOrigin(origin, (clone) => {
    writeFileSync(join(clone, file), text);
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", `owner: ${file}`]);
    git(clone, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  });

/** The run's fetch of the base into origin/main. */
const fetchMain = (repo: string): void => {
  git(repo, ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
};

/** A pull request from `head` into `base`, opened through the stand-in as `gh pr create` would. */
const openPull = (gh: GhStandIn, repo: string, head: string, base: string, title: string): string =>
  execFileSync(gh.command, ["pr", "create", "--head", head, "--base", base, "--title", title, "--body", "body"], { cwd: repo, encoding: "utf-8" }).trim();

interface Stack {
  repo: string;
  origin: string;
  gh: GhStandIn;
  book: Books;
  c1: string;
  c2: string;
  c3: string;
}

/**
 * Three levels, each one commit on the one below, bottom on main, pushed to origin with a stand-in pull request each,
 * R2 on R1 and R3 on R2. The delivery branch stands on R3 and its ledger and item ledger say so.
 */
async function stacked(): Promise<Stack> {
  const gh = createGhStandIn();
  vi.stubEnv("PATH", `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`);
  const repo = project();
  const origin = addLocalOrigin(repo);
  git(repo, ["remote", "set-head", "origin", "main"]);
  const book = books();
  const from = git(repo, ["rev-parse", "main"]);
  git(repo, ["branch", R1, "main"]);
  const c1 = await commitOn(repo, R1, "one.txt", "one\n");
  git(repo, ["branch", R2, R1]);
  const c2 = await commitOn(repo, R2, "two.txt", "two\n");
  git(repo, ["branch", R3, R2]);
  const c3 = await commitOn(repo, R3, "three.txt", "three\n");
  git(repo, ["branch", D, R3]);
  git(repo, ["push", "-q", "origin", R1, R2, R3]);
  openPull(gh, repo, R1, "main", "Add r1");
  openPull(gh, repo, R2, R1, "Add r2");
  openPull(gh, repo, R3, R2, "Add r3");

  await recordDelivery(book.delivery, { t: "opened", branch: D, base: "main", from, stack: true });
  for (const [run, commit] of [["r1", c1], ["r2", c2], ["r3", c3]] as const) {
    await recordDelivery(book.delivery, { t: "landed", branch: D, runId: run, key: `backlog:${run}.md`, intent: `Add ${run}`, commit });
  }
  recordItems(book.items, [["r1", c1], ["r2", c2], ["r3", c3]]);
  return { repo, origin, gh, book, c1, c2, c3 };
}

const graphqlCalls = (gh: GhStandIn): number => gh.calls().filter((argv) => argv[0] === "api" && argv[1] === "graphql").length;

describe("reconcileStackBranch", () => {
  it("opens the delivery branch at the base's tip as a stack section", async () => {
    const repo = project();
    const book = books();

    expect(await reconcile(repo, book)).toEqual({ ready: true, branch: D, base: "main", reported: new Map() });
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect(await entriesOf(book)).toMatchObject([{ t: "opened", branch: D, base: "main", from: git(repo, ["rev-parse", "main"]), stack: true }]);
    expect((await readDelivery(book.delivery, D)).stacked).toBe(true);
  });

  it("starts a rolling section's branch again from the base's tip, as a stack section, on the first stack run", async () => {
    const repo = project();
    const book = books();
    git(repo, ["branch", D, "main"]);
    await commitOn(repo, D, "rolling.txt", "rolling work\n");
    await recordDelivery(book.delivery, { t: "opened", branch: D, base: "main", from: git(repo, ["rev-parse", "main"]) });

    expect((await reconcile(repo, book)).ready).toBe(true);
    expect(git(repo, ["rev-parse", D])).toBe(git(repo, ["rev-parse", "main"]));
    expect((await readDelivery(book.delivery, D)).stacked).toBe(true);
  });

  it("never brings the owner's new base commits into a stacked delivery branch", async () => {
    const repo = project();
    const book = books();
    await reconcile(repo, book);
    const tip = await commitOn(repo, D, "feature.txt", "work\n");
    onMain(repo, "after.txt", "later\n");

    expect((await reconcile(repo, book)).ready).toBe(true);
    expect(git(repo, ["rev-parse", D])).toBe(tip);
    expect((await entriesOf(book)).some((e) => e.t === "base_merged")).toBe(false);
  });
});

describe("reconcileStackBranch on a stack of three pull requests", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("asks GitHub once for every level, and changes nothing while all are open", async () => {
    const { repo, gh, book, c1, c2, c3 } = await stacked();
    const delivery = readFileSync(book.delivery, "utf-8");

    const result = await reconcile(repo, book);

    expect(graphqlCalls(gh)).toBe(1);
    expect(gh.calls().find((argv) => argv[1] === "graphql")).toEqual(expect.arrayContaining([`h0=${R1}`, `h1=${R2}`, `h2=${R3}`]));
    expect(result).toEqual({ ready: true, branch: D, base: "main", reported: new Map([[R1, c1], [R2, c2], [R3, c3]]) });
    expect([rev(repo, R1), rev(repo, R2), rev(repo, R3), rev(repo, D)]).toEqual([c1, c2, c3, c3]);
    expect(readFileSync(book.delivery, "utf-8")).toBe(delivery);
  });

  it("leaves the stack alone when the base has new commits but nothing merged", async () => {
    const { repo, origin, book, c1, c2, c3 } = await stacked();
    pushToMain(origin, "later.txt", "later\n");
    fetchMain(repo);

    const result = await reconcile(repo, book);

    expect(result).toMatchObject({ ready: true });
    expect((await entriesOf(book)).some((e) => e.t === "restacked")).toBe(false);
    expect([rev(repo, R1), rev(repo, R2), rev(repo, R3)]).toEqual([c1, c2, c3]);
  });

  it.each(["squash", "rebase"] as const)("moves the rest onto the base after a %s merge of the bottom, records it, and updates the items", async (method) => {
    const { repo, origin, gh, book, c2 } = await stacked();
    const base = gh.merge(URL1, method, origin);
    fetchMain(repo);

    expect(await reconcile(repo, book)).toMatchObject({ ready: true, branch: D });
    expect(rev(repo, "refs/remotes/origin/main")).toBe(base);
    expect(rev(repo, `${R2}^`)).toBe(base);
    expect(rev(repo, `${R3}^`)).toBe(rev(repo, R2));
    expect(rev(repo, D)).toBe(rev(repo, R3));
    expect(rev(repo, R2)).not.toBe(c2);
    expect(await entriesOf(book)).toMatchObject([{ t: "opened" }, { t: "landed" }, { t: "landed" }, { t: "landed" }, { t: "restacked", merged: ["r1"] }]);
    expect((await readStack(repo, book.delivery, D)).map((level) => [level.run, level.parent])).toEqual([
      ["r2", "main"],
      ["r3", R2],
    ]);
    const items = await readItemLedger(book.items);
    expect(items.get("backlog:r2.md")?.commit).toBe(rev(repo, R2));
    expect(items.get("backlog:r3.md")?.commit).toBe(rev(repo, R3));
    expect(await awaitsMerge(repo, items.get("backlog:r2.md"))).toBe(true);
    expect(await awaitsMerge(repo, items.get("backlog:r3.md"))).toBe(true);
    expect(await awaitsMerge(repo, items.get("backlog:r1.md"))).toBe(false);
  });

  it("only retargets after a merge-commit merge of the bottom: nothing is rewritten", async () => {
    const { repo, origin, gh, book, c2, c3 } = await stacked();
    gh.merge(URL1, "merge", origin);
    fetchMain(repo);

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect([rev(repo, R2), rev(repo, R3), rev(repo, D)]).toEqual([c2, c3, c3]);
    expect((await entriesOf(book)).at(-1)).toMatchObject({
      t: "restacked",
      onto: rev(repo, "refs/remotes/origin/main"),
      merged: ["r1"],
      levels: [
        { runId: "r2", commit: c2 },
        { runId: "r3", commit: c3 },
      ],
    });
    expect((await readStack(repo, book.delivery, D)).map((level) => level.parent)).toEqual(["main", R2]);
  });

  it("empties the stack when every level merged, so the next item starts from the base", async () => {
    const { repo, origin, gh, book, c1, c2, c3 } = await stacked();
    // The base takes the whole stack, and GitHub marks each pull request merged at its own commit.
    git(repo, ["push", "-q", origin, `${R3}:refs/heads/main`]);
    gh.mergePullRequest(URL1, c1, c1);
    gh.mergePullRequest(URL2, c2, c2);
    gh.mergePullRequest(URL3, c3, c3);
    fetchMain(repo);
    const base = rev(repo, "refs/remotes/origin/main");

    expect(await reconcile(repo, book)).toMatchObject({ ready: true, branch: D, base: "main", reported: new Map() });
    expect(rev(repo, D)).toBe(base);
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "opened", branch: D, base: "main", from: base, stack: true });
    expect(await readStack(repo, book.delivery, D)).toEqual([]);
  });

  it("blocks, names the level, pull request and files, and moves nothing when a level conflicts", async () => {
    const { repo, origin, gh, book, c2, c3 } = await stacked();
    // The owner has written two.txt on main, where level 2 also adds it: moving level 2 onto main conflicts.
    pushToMain(origin, "two.txt", "owner\n");
    gh.merge(URL1, "squash", origin);
    fetchMain(repo);

    const result = await reconcile(repo, book);

    expect(result).toMatchObject({ ready: false, branch: D, base: "main", repeated: false });
    expect(result.ready === false && result.reason).toContain(URL2);
    expect(result.ready === false && result.reason).toContain("two.txt");
    expect([rev(repo, R2), rev(repo, R3), rev(repo, D)]).toEqual([c2, c3, c3]);
    expect(gh.pullRequests().map((pr) => pr.base)).toEqual(["main", R1, R2]);
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "blocked", reason: result.ready === false ? result.reason : "" });
  });

  it("does not try the same blocked restack again until something changes", async () => {
    const { repo, origin, gh, book } = await stacked();
    const log = join(book.dir, "gate.log");
    writeFileSync(log, "");
    const env = { ...process.env, GATE_LOG: log };
    pushToMain(origin, "two.txt", "owner\n");
    gh.merge(URL1, "squash", origin);
    fetchMain(repo);

    const first = await reconcile(repo, book, env);
    const ran = linesOf(log);
    expect(first).toMatchObject({ ready: false, repeated: false });
    expect(ran).toBeGreaterThan(0);

    const second = await reconcile(repo, book, env);
    expect(second).toMatchObject({ ready: false, repeated: true, reason: first.ready === false ? first.reason : "" });
    expect(linesOf(log)).toBe(ran);

    pushToMain(origin, "later.txt", "later\n");
    fetchMain(repo);
    expect(await reconcile(repo, book, env)).toMatchObject({ ready: false, repeated: false });
    expect(linesOf(log)).toBeGreaterThan(ran);
  });

  it.each(["squash", "merge"] as const)("reports a merge into a pull request still open below it as blocked, then resolves without help once that merges (%s)", async (method) => {
    const { repo, origin, gh, book, c3 } = await stacked();
    gh.merge(URL2, "merge", origin);
    fetchMain(repo);

    const blocked = await reconcile(repo, book);
    expect(blocked).toMatchObject({ ready: false, repeated: false });
    expect(blocked.ready === false && blocked.reason).toContain(URL2);
    expect(blocked.ready === false && blocked.reason).toContain(URL1);

    gh.merge(URL1, method, origin);
    fetchMain(repo);

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "restacked", merged: ["r1", "r2"] });
    expect((await readStack(repo, book.delivery, D)).map((level) => [level.run, level.parent])).toEqual([["r3", "main"]]);
    if (method === "squash") {
      expect(rev(repo, `${R3}^`)).toBe(rev(repo, "refs/remotes/origin/main"));
      expect(git(repo, ["diff", "--name-only", "refs/remotes/origin/main", R3])).toBe("three.txt");
    } else {
      expect(rev(repo, R3)).toBe(c3);
    }
    const items = await readItemLedger(book.items);
    expect(await awaitsMerge(repo, items.get("backlog:r3.md"))).toBe(true);
    if (method === "squash") {
      expect(await awaitsMerge(repo, items.get("backlog:r1.md"))).toBe(false);
      expect(await awaitsMerge(repo, items.get("backlog:r2.md"))).toBe(false);
    } else {
      // The delivery branch still holds c1 and c2, so they await merge; the backlog read from the fetched base resolves
      // them, so the source no longer lists them and a following chooseWork claims neither (nor r3, which awaits merge).
      const entry = (status: string) => `---\nstatus: ${status}\nworkflow: build\n---\nDo the thing.\n`;
      onOrigin(origin, (clone) => {
        mkdirSync(join(clone, ".delivery/backlog"), { recursive: true });
        for (const [run, status] of [["r1", "resolved"], ["r2", "resolved"], ["r3", "open"]] as const) writeFileSync(join(clone, `.delivery/backlog/${run}.md`), entry(status));
        git(clone, ["add", "-A"]);
        git(clone, ["commit", "-q", "-m", "owner: resolve r1 and r2 in the backlog"]);
        git(clone, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
      });
      fetchMain(repo);
      const chosen = await chooseWork([{ type: "backlog" }], {
        repoPath: repo, config: {}, env: process.env, ledger: items, records: [], now: new Date(AT), max: 5, taken: new Set<string>(),
      });
      expect(chosen.items.map((i) => i.key)).toEqual([]);
    }
  });

  describe("when the owner closes a pull request without merging it", () => {
    const remoteBranches = (origin: string): string[] => git(origin, ["for-each-ref", "--format=%(refname:short)", "refs/heads/delivery-stack"]).split("\n").filter((ref) => ref !== "");
    const closeCalls = (gh: GhStandIn): string[][] => gh.calls().filter((argv) => argv[0] === "pr" && argv[1] === "close");

    it("drops that level and the ones above it, closing their pull requests with a comment and removing their branches", async () => {
      const { repo, origin, gh, book, c1 } = await stacked();
      gh.closePullRequest(URL2);

      expect(await reconcile(repo, book)).toMatchObject({ ready: true, branch: D, base: "main" });

      expect(closeCalls(gh)).toEqual([["pr", "close", URL3, "--comment", expect.stringContaining(URL2)]]);
      expect(gh.pullRequests().map((pr) => pr.state)).toEqual(["OPEN", "CLOSED", "CLOSED"]);
      expect(gh.pullRequests()[2]?.comments?.[0]).toMatch(/delivered again/);
      expect(rev(repo, R1)).toBe(c1);
      expect(rev(repo, D)).toBe(c1);
      expect(git(repo, ["branch", "--list", R2, R3])).toBe("");
      expect(remoteBranches(origin)).toEqual([R1]);
      expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "dropped", runs: ["r2", "r3"] });
      expect((await readStack(repo, book.delivery, D)).map((level) => level.run)).toEqual(["r1"]);
    });

    it("counts the closed item as a rejected attempt and releases the ones above it, so none awaits merge", async () => {
      const { repo, gh, book } = await stacked();
      gh.closePullRequest(URL2);

      await reconcile(repo, book);

      const items = await readItemLedger(book.items);
      expect(items.get("backlog:r2.md")).toMatchObject({ rejections: 1, attempts: 0, parked: null });
      expect(items.get("backlog:r3.md")).toMatchObject({ rejections: 0, attempts: 0 });
      expect(await awaitsMerge(repo, items.get("backlog:r1.md"))).toBe(true);
      expect(await awaitsMerge(repo, items.get("backlog:r2.md"))).toBe(false);
      expect(await awaitsMerge(repo, items.get("backlog:r3.md"))).toBe(false);
    });

    it("parks an item whose pull request has now been closed parkAfter times", async () => {
      const { repo, gh, book } = await stacked();
      gh.closePullRequest(URL2);

      await reconcileStackBranch(repo, book.delivery, { gateRef: GATE, itemLedger: book.items, parkAfter: 1 });

      expect((await readItemLedger(book.items)).get("backlog:r2.md")).toMatchObject({ parked: "attempts" });
      expect((await readItemLedger(book.items)).get("backlog:r3.md")?.parked).toBeNull();
    });

    it("starts again from the base when the bottom was closed", async () => {
      const { repo, origin, gh, book } = await stacked();
      gh.closePullRequest(URL1);

      expect(await reconcile(repo, book)).toMatchObject({ ready: true, reported: new Map() });

      expect(rev(repo, D)).toBe(rev(repo, "main"));
      expect(await readStack(repo, book.delivery, D)).toEqual([]);
      expect(remoteBranches(origin)).toEqual([]);
      expect(gh.pullRequests().map((pr) => pr.state)).toEqual(["CLOSED", "CLOSED", "CLOSED"]);
      expect(closeCalls(gh).map((argv) => argv[2])).toEqual([URL2, URL3]);
    });

    it("makes the closed item deliverable again, first in its sequence, with the items above it waiting", async () => {
      const { repo, gh, book } = await stacked();
      const tasks = JSON.stringify(["r1", "r2", "r3", "r4"].map((run) => ({ id: `${run}.md`, sequence: "spec" })));
      writeFileSync(join(repo, "tasks.sh"), `echo '${tasks}'\n`);
      const choose = async () =>
        chooseWork([{ type: "command", command: "sh tasks.sh", name: "backlog" }], {
          repoPath: repo, config: {}, env: process.env, ledger: await readItemLedger(book.items), records: [], now: new Date(AT), max: 5, taken: new Set<string>(),
        });
      expect((await choose()).items.map((item) => item.key)).toEqual(["backlog:r4.md"]);
      gh.closePullRequest(URL2);

      await reconcile(repo, book);

      expect((await choose()).items.map((item) => item.key)).toEqual(["backlog:r2.md"]);
    });

    it("moves what remains onto the base when a merged level lies below the close, dropping first", async () => {
      const { repo, origin, gh, book } = await stacked();
      gh.merge(URL1, "squash", origin);
      gh.closePullRequest(URL3);
      fetchMain(repo);
      const base = rev(repo, "refs/remotes/origin/main");

      expect(await reconcile(repo, book)).toMatchObject({ ready: true });

      expect(closeCalls(gh)).toEqual([]);
      expect(rev(repo, `${R2}^`)).toBe(base);
      expect(rev(repo, D)).toBe(rev(repo, R2));
      expect(git(repo, ["branch", "--list", R3])).toBe("");
      expect((await entriesOf(book)).map((e) => e.t).slice(-2)).toEqual(["dropped", "restacked"]);
      expect((await readStack(repo, book.delivery, D)).map((level) => [level.run, level.parent])).toEqual([["r2", "main"]]);
    });

    it("does nothing more when run again", async () => {
      const { repo, gh, book } = await stacked();
      gh.closePullRequest(URL2);
      await reconcile(repo, book);
      const delivery = readFileSync(book.delivery, "utf-8");
      const items = readFileSync(book.items, "utf-8");

      expect(await reconcile(repo, book)).toMatchObject({ ready: true });

      expect(closeCalls(gh)).toHaveLength(1);
      expect(readFileSync(book.delivery, "utf-8")).toBe(delivery);
      expect(readFileSync(book.items, "utf-8")).toBe(items);
    });

    it("changes nothing and starts no task when a pull request above cannot be closed", async () => {
      const { repo, origin, gh, book, c1, c2, c3 } = await stacked();
      gh.closePullRequest(URL2);
      gh.refuseClose("pull request close failed: GraphQL: operator does not have the correct permissions to execute 'ClosePullRequest'");
      const delivery = readFileSync(book.delivery, "utf-8");

      const result = await reconcile(repo, book);

      expect(result).toMatchObject({ ready: false, repeated: false });
      expect(result.ready === false && result.reason).toContain(URL3);
      expect([rev(repo, R1), rev(repo, R2), rev(repo, R3), rev(repo, D)]).toEqual([c1, c2, c3, c3]);
      expect(remoteBranches(origin)).toEqual([R1, R2, R3]);
      expect(readFileSync(book.delivery, "utf-8")).toBe(delivery);
    });
  });

  it("leaves the stack alone and starts nothing when GitHub cannot be asked", async () => {
    const { repo, gh, book, c1, c2, c3 } = await stacked();
    const before = (await entriesOf(book)).length;
    gh.setMode("signed-out");

    const result = await reconcile(repo, book);

    expect(result).toMatchObject({ ready: false, branch: D, repeated: false });
    expect(result.ready === false && result.reason).toContain("gh auth login");
    expect(await entriesOf(book)).toHaveLength(before);
    expect([rev(repo, R1), rev(repo, R2), rev(repo, R3)]).toEqual([c1, c2, c3]);
  });

  it("does it again when a restack moved the refs but was not recorded", async () => {
    const { repo, origin, gh, book } = await stacked();
    gh.merge(URL1, "squash", origin);
    fetchMain(repo);
    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    const trees = [rev(repo, `${R2}^{tree}`), rev(repo, `${R3}^{tree}`)];
    dropLines(book.delivery, (entry) => entry.t === "restacked");

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "restacked", merged: ["r1"] });
    expect([rev(repo, `${R2}^{tree}`), rev(repo, `${R3}^{tree}`)]).toEqual(trees);
    expect(rev(repo, D)).toBe(rev(repo, R3));
  });

  it("is not blocked by heads GitHub still reports at the pre-restack commits", async () => {
    const { repo, origin, gh, book, c2, c3 } = await stacked();
    gh.merge(URL1, "squash", origin);
    fetchMain(repo);
    expect(await reconcile(repo, book)).toMatchObject({ ready: true });

    // GitHub still shows the pre-restack heads, since nothing was closed; the stack must not read them as foreign.
    const again = await reconcile(repo, book);
    expect(again).toMatchObject({ ready: true });
    expect(again.ready && [...again.reported.values()]).toEqual([c2, c3]);
  });

  it("leaves the stack alone when GitHub reports a merge this machine's base does not hold yet", async () => {
    const { repo, origin, gh, book, c1, c2, c3 } = await stacked();
    gh.merge(URL1, "squash", origin);
    const before = (await entriesOf(book)).length;

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect(await entriesOf(book)).toHaveLength(before);
    expect([rev(repo, R1), rev(repo, R2), rev(repo, R3)]).toEqual([c1, c2, c3]);

    fetchMain(repo);
    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "restacked", merged: ["r1"] });
  });

  it("still waits when the base had moved for other reasons before the merge landed", async () => {
    const { repo, origin, gh, book, c1, c2, c3 } = await stacked();
    pushToMain(origin, "later.txt", "later\n");
    fetchMain(repo);
    gh.merge(URL1, "squash", origin);
    const before = (await entriesOf(book)).length;

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect(await entriesOf(book)).toHaveLength(before);
    expect([rev(repo, R1), rev(repo, R2), rev(repo, R3)]).toEqual([c1, c2, c3]);
  });

  it("blocks, naming the recovery, when the second level was merged into the first level's branch after the first had merged, and stays blocked until the recovery lands", async () => {
    const { repo, origin, gh, book, c2, c3 } = await stacked();
    gh.merge(URL1, "squash", origin);
    const m2 = gh.merge(URL2, "merge", origin);
    fetchMain(repo);

    const blocked = await reconcile(repo, book);
    expect(blocked).toMatchObject({ ready: false, repeated: false });
    for (const part of [URL2, URL1, "after", m2.slice(0, 7)]) expect(blocked.ready === false && blocked.reason).toContain(part);
    expect([rev(repo, R2), rev(repo, R3), rev(repo, D)]).toEqual([c2, c3, c3]);
    expect(gh.pullRequests().map((pr) => pr.base)).toEqual(["main", R1, R2]);

    // Nothing changed: the same block is reported again, and nothing is recorded.
    const entries = (await entriesOf(book)).length;
    expect(await reconcile(repo, book)).toMatchObject({ ready: false, repeated: true });
    expect(await entriesOf(book)).toHaveLength(entries);

    // A squash of m2 into main does not recognise it: the base moved, so the block is worked out again and stands.
    onOrigin(origin, (clone) => {
      git(clone, ["merge", "-q", "--squash", m2]);
      git(clone, ["commit", "-q", "-m", "squash the second level"]);
      git(clone, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    });
    fetchMain(repo);
    expect(await reconcile(repo, book)).toMatchObject({ ready: false, repeated: false });

    // The recovery: m2 on a branch of its own, merged into main with a merge commit.
    onOrigin(origin, (clone) => {
      git(clone, ["push", "-q", "origin", `${m2}:refs/heads/recover`]);
      git(clone, ["checkout", "-q", "main"]);
      git(clone, ["merge", "-q", "--no-ff", "-m", "Merge recover", m2]);
      git(clone, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
    });
    fetchMain(repo);

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "restacked", merged: ["r1", "r2"] });
    expect((await readStack(repo, book.delivery, D)).map((level) => [level.run, level.parent])).toEqual([["r3", "main"]]);
  });

  it("waits, recording nothing, when the merged head of the level below cannot be fetched", async () => {
    const { repo, origin, gh, book, c1, c2, c3 } = await stacked();
    gh.merge(URL2, "merge", origin);
    gh.merge(URL1, "squash", origin);
    fetchMain(repo);
    const head1 = rev(origin, "refs/pull/1/head");
    git(origin, ["update-ref", "-d", "refs/pull/1/head"]);
    const before = (await entriesOf(book)).length;

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect(await entriesOf(book)).toHaveLength(before);
    expect([rev(repo, R1), rev(repo, R2), rev(repo, R3)]).toEqual([c1, c2, c3]);

    git(origin, ["update-ref", "refs/pull/1/head", head1]);
    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    expect((await entriesOf(book)).at(-1)).toMatchObject({ t: "restacked", merged: ["r1", "r2"] });
  });

  it("repairs the item ledger after a restack recorded without its moved lines", async () => {
    const { repo, origin, gh, book } = await stacked();
    gh.merge(URL1, "squash", origin);
    fetchMain(repo);
    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    dropLines(book.items, (entry) => entry.t === "moved");

    expect(await reconcile(repo, book)).toMatchObject({ ready: true });
    const items = await readItemLedger(book.items);
    expect(items.get("backlog:r2.md")?.commit).toBe(rev(repo, R2));
    expect(items.get("backlog:r3.md")?.commit).toBe(rev(repo, R3));
    expect(await awaitsMerge(repo, items.get("backlog:r2.md"))).toBe(true);
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
