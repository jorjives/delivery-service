import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { git } from "../../tests/helpers.js";
import { readStack } from "../delivery-stack.js";
import { deliveryLedgerPath, readDeliveryEntries } from "../delivery-ledger.js";
import { createGhStandIn, type GhStandIn } from "../gh-stand-in.js";
import { afterLedgerPath, readAfter } from "../after-ledger.js";
import { readItemLedger, ledgerPath } from "../item-ledger.js";
import type { MockScript } from "../mock-script.js";
import { addLocalOrigin, initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { completes, delivery, PACKAGE, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { allRuns } from "./runs.js";

const A = "20261016T090000Z-say-hello.md";
const B = "20261016T090100Z-say-goodbye.md";
const C = "20261016T090200Z-say-thanks.md";
const D4 = "20261016T090300Z-say-farewell.md";
const KEY_A = `backlog:${A}`;
const KEY_B = `backlog:${B}`;
const KEY_C = `backlog:${C}`;
// Passes while strict.txt is absent; once the owner adds it to the base, a level that adds thanks.js fails its check.
const STRICT_CHECK = 'echo "1..2"\necho "ok 1 - base"\nif [ -f strict.txt ] && [ -f thanks.js ]; then echo "not ok 2 - thanks"; else echo "ok 2 - thanks"; fi\n';
const brief = (priority: number, sentence: string) => `---\nstatus: open\npriority: ${priority}\n---\n${sentence}\n`;
const at = (file: string) => `.delivery/backlog/${file}`;
const STACK = { closer: { type: "open-pr", stack: true } };
const ROLLING = { closer: { type: "open-pr" } };

/** Each item's agent writes its own file, so each level's change is its own. */
const writes = (sentence: string, file: string) => ({
  when: { promptContains: sentence },
  effects: [{ write: { path: file, content: `export const ${file.split(".")[0]} = 1;\n` } }],
  json: { status: "completed", rationale: sentence },
});
const threeWays: MockScript = {
  expectations: [writes("says hello", "hello.js"), writes("says goodbye", "goodbye.js"), writes("says thanks", "thanks.js")],
};
const fourWays: MockScript = { expectations: [...threeWays.expectations, writes("says farewell", "farewell.js")] };

const stateDir = () => mkdtempSync(join(tmpdir(), "stack-state-"));
const envFor = async (script: MockScript, state: string = stateDir()) => ({ XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) });

/** A project with origin, the given config, the given backlog items, and any other files committed to main. */
function project(config: object, items: Record<string, string>, extra: Record<string, string> = {}): { repo: string; origin: string } {
  const files: Record<string, string> = { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config), ...extra };
  for (const [file, text] of Object.entries(items)) files[at(file)] = text;
  const repo = initTempRepo("sources-run-stack-", files);
  const origin = addLocalOrigin(repo);
  git(repo, ["remote", "set-head", "origin", "main"]);
  return { repo, origin };
}

/** The delivery branch's own commits since its base, in the order they landed on it. */
const landingOrder = (repo: string): string[] =>
  git(repo, ["rev-list", "--first-parent", "--reverse", "main..delivery/main"]).split("\n").filter((line) => line !== "");

/** The files a level changes against the level below, as its pull request shows them. */
const filesOf = (repo: string, parent: string, ref: string): string[] =>
  git(repo, ["diff", "--name-only", `${parent}..${ref}`]).split("\n").filter((line) => line !== "");

/** Drop the JSON lines of a ledger file that `drop` picks out, as a crash would leave the file. */
function dropLines(file: string, drop: (entry: { t?: string; key?: string }) => boolean): void {
  const kept = readFileSync(file, "utf-8").split("\n").filter((line) => line.trim() !== "").filter((line) => !drop(JSON.parse(line)));
  writeFileSync(file, kept.map((line) => `${line}\n`).join(""));
}

const countDispatched = (file: string): number => readFileSync(file, "utf-8").split("\n").filter((line) => line.includes('"t":"dispatched"')).length;

/** The id of the run that took the item with this key. */
const runIdOf = async (repo: string, key: string): Promise<string> => (await allRuns(repo)).find((r) => r.caseFile.header.item?.key === key)?.runId ?? "missing";

/** The owner commits `file` to origin's main, as they would on GitHub. */
function ownerPushes(origin: string, file: string, text: string): void {
  const clone = mkdtempSync(join(tmpdir(), "stack-run-owner-"));
  try {
    git(tmpdir(), ["clone", "-q", origin, clone]);
    git(clone, ["config", "user.name", "Owner"]);
    git(clone, ["config", "user.email", "owner@example.invalid"]);
    writeFileSync(join(clone, file), text);
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "-q", "-m", `owner: ${file}`]);
    git(clone, ["push", "-q", "origin", "HEAD:refs/heads/main"]);
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

describe("delivery run --sources with the stacked open-pr closer", () => {
  let gh: GhStandIn;

  beforeEach(() => {
    gh = createGhStandIn();
    vi.stubEnv("PATH", `${gh.binDir}${delimiter}${process.env.PATH ?? ""}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lands three items in one run and opens three stacked pull requests, each with only its own item's changes", async () => {
    const { repo, origin } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks.") });

    const { exitCode } = await delivery(["run", "--sources", "--max", "3"], { cwd: repo, env: await envFor(threeWays) });

    expect(exitCode).toBe(EXIT.ok);
    const order = landingOrder(repo);
    const prs = gh.pullRequests();
    expect(prs).toHaveLength(3);
    const parents = prs.map((_, i) => (i === 0 ? "main" : (prs[i - 1]?.head ?? "main")));
    expect(prs.map((pr) => pr.base)).toEqual(parents);
    // Each item lands two commits, its own work and then its backlog file marked resolved: a level sits on the last of them.
    const levelCommits = prs.map((pr) => git(origin, ["rev-parse", `refs/heads/${pr.head}`]));
    const positions = levelCommits.map((commit) => order.indexOf(commit));
    expect(positions.every((position, i) => position >= 0 && (i === 0 || position > (positions[i - 1] ?? -1)))).toBe(true);
    expect(levelCommits.at(-1)).toBe(git(repo, ["rev-parse", "delivery/main"]));
    for (const [i, pr] of prs.entries()) {
      const files = filesOf(repo, parents[i] ?? "main", pr.head);
      expect(files).toHaveLength(2);
      expect(files.filter((file) => file.startsWith(".delivery/backlog/"))).toHaveLength(1);
    }
    const changed = prs.flatMap((pr, i) => filesOf(repo, parents[i] ?? "main", pr.head).filter((file) => !file.startsWith(".delivery/")));
    expect(changed.sort()).toEqual(["goodbye.js", "hello.js", "thanks.js"]);
    expect(git(origin, ["for-each-ref", "refs/heads/delivery/"])).toBe("");
  }, RUN_TIMEOUT * 2);

  it("stacks a run settled by the next run after a crash in the order it landed", async () => {
    const { repo } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye.") });
    const state = stateDir();
    const env = await envFor(threeWays, state);
    expect((await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const runA = (await allRuns(repo)).find((r) => r.caseFile.header.item?.key === KEY_A)?.runId ?? "missing";
    const runB = (await allRuns(repo)).find((r) => r.caseFile.header.item?.key === KEY_B)?.runId ?? "missing";
    // A crashed after its landing: its ended entry and its landing are gone, so the next run settles it from its record.
    const items = ledgerPath(repo, { XDG_STATE_HOME: state });
    const deliveries = deliveryLedgerPath(items);
    dropLines(items, (e) => e.t === "ended" && e.key === KEY_A);
    dropLines(deliveries, (e) => e.t === "landed" && e.key === KEY_A);

    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);

    expect((await readDeliveryEntries(deliveries)).flatMap((e) => (e.t === "landed" ? [e.key] : []))).toEqual([KEY_B, KEY_A]);
    expect(gh.pullRequests().map((pr) => [pr.head, pr.base])).toEqual([
      [`delivery-stack/main/${runA}`, "main"],
      [`delivery-stack/main/${runB}`, `delivery-stack/main/${runA}`],
    ]);
    const [bottom, top] = gh.pullRequests();
    expect(filesOf(repo, "main", bottom?.head ?? "").filter((f) => !f.startsWith(".delivery/"))).toEqual(["hello.js"]);
    expect(filesOf(repo, bottom?.head ?? "", top?.head ?? "").filter((f) => !f.startsWith(".delivery/"))).toEqual(["goodbye.js"]);
  }, RUN_TIMEOUT * 2);

  it("delivers an issue whose agent changes nothing without giving it a level, and stacks the rest", async () => {
    gh.openIssue({ title: "Add a function that says hi", body: "It is already in place.", labels: ["delivery"] });
    const config = { closer: { type: "open-pr", stack: true }, sources: [{ type: "backlog" }, { type: "github" }] };
    const { repo, origin } = project(config, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye.") });
    const script: MockScript = {
      expectations: [...threeWays.expectations.slice(0, 2), { when: { promptContains: "says hi" }, json: { status: "completed", rationale: "already in place" } }],
    };
    const state = stateDir();
    const env = await envFor(script, state);

    const { exitCode } = await delivery(["run", "--sources", "--max", "3"], { cwd: repo, env });

    expect(exitCode).toBe(EXIT.ok);
    const prs = gh.pullRequests();
    expect(prs).toHaveLength(2);
    expect(prs[1]?.base).toBe(prs[0]?.head);
    expect(prs[0]?.base).toBe("main");
    const changed = prs.flatMap((pr, i) => filesOf(repo, i === 0 ? "main" : (prs[0]?.head ?? "main"), pr.head));
    expect(changed.filter((f) => !f.startsWith(".delivery/")).sort()).toEqual(["goodbye.js", "hello.js"]);
    expect(filesOf(repo, "main", prs[0]?.head ?? "")).toHaveLength(2);
    expect(filesOf(repo, prs[0]?.head ?? "", prs[1]?.head ?? "")).toHaveLength(2);

    const issueRun = (await allRuns(repo)).find((r) => r.caseFile.header.item?.source === "github")?.runId ?? "missing";
    expect(git(repo, ["for-each-ref", `refs/heads/delivery-stack/main/${issueRun}`])).toBe("");
    expect(git(origin, ["for-each-ref", `refs/heads/delivery-stack/main/${issueRun}`])).toBe("");
    expect((await readItemLedger(ledgerPath(repo, { XDG_STATE_HOME: state }))).get("github:1")?.lastClass).toBe("delivered");
    const tip = git(repo, ["rev-parse", "delivery/main"]);
    expect(gh.issues()[0]).toMatchObject({ state: "CLOSED", comments: [`Delivered by the delivery harness in ${tip}, on delivery/main.`] });
    const deliveries = deliveryLedgerPath(ledgerPath(repo, { XDG_STATE_HOME: state }));
    expect((await readDeliveryEntries(deliveries)).find((e) => e.t === "landed" && e.key === "github:1")).toMatchObject({ empty: true });
    expect(await readStack(repo, deliveries, "delivery/main")).toHaveLength(2);

    const again = await delivery(["run", "--sources"], { cwd: repo, env });
    expect(again.exitCode).toBe(EXIT.ok);
    expect(gh.pullRequests()).toEqual(prs);
  }, RUN_TIMEOUT * 3);

  it("opens a fourth on top on a later run, leaving the first three untouched", async () => {
    const { repo } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks."), [D4]: brief(4, "Add a function that says farewell.") });
    const env = await envFor(fourWays);
    expect((await delivery(["run", "--sources", "--max", "3"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const before = gh.pullRequests();
    expect(before).toHaveLength(3);

    expect((await delivery(["run", "--sources", "--max", "1"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);

    const prs = gh.pullRequests();
    expect(prs).toHaveLength(4);
    expect(prs.slice(0, 3)).toEqual(before);
    expect(prs[3]?.base).toBe(prs[2]?.head);
  }, RUN_TIMEOUT * 2);

  it("refuses to start when a rolling pull request is open, naming it, and starts no task", async () => {
    const { repo } = project(ROLLING, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye.") });
    const state = stateDir();
    const env = await envFor(threeWays, state);
    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const [rolling] = gh.pullRequests();
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(STACK));
    const items = ledgerPath(repo, { XDG_STATE_HOME: state });
    const dispatched = countDispatched(items);

    const refused = await delivery(["run", "--sources"], { cwd: repo, env });

    expect(refused.exitCode).toBe(EXIT.configuration);
    expect(refused.stderr).toContain(rolling?.url ?? "no pull request");
    expect(countDispatched(items)).toBe(dispatched);
    expect(gh.pullRequests()).toHaveLength(1);
  }, RUN_TIMEOUT * 2);

  it("keeps rolling mode exactly as it was", async () => {
    const { repo, origin } = project(ROLLING, { [A]: brief(1, "Add a function that says hello to a name.") });

    expect((await delivery(["run", "--sources"], { cwd: repo, env: await envFor(completes) })).exitCode).toBe(EXIT.ok);

    expect(gh.pullRequests().map((pr) => [pr.head, pr.base, pr.state])).toEqual([["delivery/main", "main", "OPEN"]]);
    expect(git(repo, ["for-each-ref", "refs/heads/delivery-stack"])).toBe("");
    expect(git(origin, ["for-each-ref", "refs/heads/delivery-stack"])).toBe("");
  }, RUN_TIMEOUT);

  it("after the bottom is squash-merged, moves the rest onto the base, retargets it, and stacks a fourth on top", async () => {
    const { repo, origin } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks."), [D4]: brief(4, "Add a function that says farewell.") });
    const env = await envFor(fourWays);
    expect((await delivery(["run", "--sources", "--max", "3"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const [first] = gh.pullRequests();
    gh.merge(first?.url ?? "", "squash", origin);

    expect((await delivery(["run", "--sources", "--max", "1"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);

    const [, pr2, pr3, pr4] = gh.pullRequests();
    expect(pr2?.base).toBe("main");
    expect(pr3?.base).toBe(pr2?.head);
    expect(pr4?.base).toBe(pr3?.head);
    expect(filesOf(origin, "main", pr2?.head ?? "").filter((f) => !f.startsWith(".delivery/"))).toEqual(["goodbye.js"]);
    const status = await delivery(["status"], { cwd: repo, env });
    const levels = status.stdout.split("\n").filter((line) => /- \d+\. /.test(line));
    expect(levels.map((line) => /goodbye|thanks|farewell/.exec(line)?.[0])).toEqual(["goodbye", "thanks", "farewell"]);
    expect(status.stdout).not.toContain("Blocked");
  }, RUN_TIMEOUT * 3);

  it("acts on a merge on a run with nothing to claim, asking GitHub once at the start", async () => {
    const { repo, origin } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks.") });
    const state = stateDir();
    const env = await envFor(threeWays, state);
    expect((await delivery(["run", "--sources", "--max", "3"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const [pr1, pr2, pr3] = gh.pullRequests();
    gh.merge(pr1?.url ?? "", "squash", origin);
    const before = gh.calls().length;

    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);

    // The first call is the start-of-run lookup of all three levels; the closer then lists after its push, and once more after the close.
    const during = gh.calls().slice(before);
    expect(during[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(during[0]).toEqual(expect.arrayContaining([`h0=${pr1?.head}`, `h1=${pr2?.head}`, `h2=${pr3?.head}`]));
    expect(during.filter((argv) => argv[1] === "graphql")).toHaveLength(3);
    expect(gh.pullRequests().slice(1).map((pr) => pr.base)).toEqual(["main", pr2?.head]);
    // A restack-only close lands nothing, so no after batch is recorded and no after step fires.
    expect(await readAfter(afterLedgerPath(ledgerPath(repo, { XDG_STATE_HOME: state })))).toEqual([]);
  }, RUN_TIMEOUT * 2);

  it("starts no task and shows the block in status and the report when a level fails its check after a merge", async () => {
    const config = { ...STACK, gate: { type: "command", command: "sh check.sh", parseMode: "tap" } };
    const { repo, origin } = project(config, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks.") }, { "check.sh": STRICT_CHECK });
    const state = stateDir();
    const env = await envFor(threeWays, state);
    expect((await delivery(["run", "--sources", "--max", "3"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const [pr1] = gh.pullRequests();
    gh.merge(pr1?.url ?? "", "squash", origin);
    ownerPushes(origin, "strict.txt", "strict\n");
    const items = ledgerPath(repo, { XDG_STATE_HOME: state });
    const dispatched = countDispatched(items);
    const bases = gh.pullRequests().map((pr) => pr.base);
    const refs = git(origin, ["for-each-ref", "refs/heads/"]);

    const run = await delivery(["run", "--sources"], { cwd: repo, env });

    expect(run.exitCode).toBe(EXIT.escalated);
    expect(countDispatched(items)).toBe(dispatched);
    expect(gh.pullRequests().map((pr) => pr.base)).toEqual(bases);
    expect(git(origin, ["for-each-ref", "refs/heads/"])).toBe(refs);
    const status = await delivery(["status"], { cwd: repo, env });
    expect(status.stdout).toMatch(/Blocked, .*: Moved onto main at .*level 3/);
    const report = await delivery(["report", "--json"], { cwd: repo, env });
    expect(JSON.parse(report.stdout).delivery.blocked.reason).toContain("level 3");
  }, RUN_TIMEOUT * 3);

  it("recovers a level pushed but never given a pull request after a restack, on the next run", async () => {
    const { repo, origin } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks.") });
    const env = await envFor(threeWays);
    expect((await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const [pr1] = gh.pullRequests();
    gh.refuseCreate("boom");

    expect((await delivery(["run", "--sources", "--max", "1"], { cwd: repo, env })).exitCode).toBe(EXIT.escalated);

    const ref2 = `delivery-stack/main/${await runIdOf(repo, KEY_B)}`;
    const ref3 = `delivery-stack/main/${await runIdOf(repo, KEY_C)}`;
    const c3 = git(repo, ["rev-parse", ref3]);
    expect(git(origin, ["rev-parse", `refs/heads/${ref3}`])).toBe(c3);
    expect(gh.pullRequests().map((pr) => pr.head)).not.toContain(ref3);

    gh.refuseCreate(null);
    gh.merge(pr1?.url ?? "", "squash", origin);
    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);

    const restacked3 = git(repo, ["rev-parse", ref3]);
    expect(restacked3).not.toBe(c3);
    expect(git(origin, ["rev-parse", `refs/heads/${ref3}`])).toBe(restacked3);
    expect(gh.pullRequests().find((pr) => pr.head === ref3)?.base).toBe(ref2);
    expect(gh.pullRequests().find((pr) => pr.head === ref2)?.base).toBe("main");
  }, RUN_TIMEOUT * 3);

  it("starts no task and leaves the stack when GitHub cannot be asked", async () => {
    const { repo } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye."), [C]: brief(3, "Add a function that says thanks.") });
    const state = stateDir();
    const env = await envFor(threeWays, state);
    expect((await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const items = ledgerPath(repo, { XDG_STATE_HOME: state });
    const dispatched = countDispatched(items);
    const branches = git(repo, ["for-each-ref", "refs/heads/"]);
    const prs = gh.pullRequests();
    gh.setMode("offline");

    const run = await delivery(["run", "--sources"], { cwd: repo, env });

    expect(run.exitCode).toBe(EXIT.escalated);
    expect(`${run.stdout}${run.stderr}`).toContain("gh could not reach GitHub");
    expect(countDispatched(items)).toBe(dispatched);
    expect(git(repo, ["for-each-ref", "refs/heads/"])).toBe(branches);
    expect(gh.pullRequests()).toEqual(prs);
  }, RUN_TIMEOUT * 2);

  it("does not run again an item a restack moved when the moved lines were lost in a crash, and claims nothing for it", async () => {
    const { repo, origin } = project(STACK, { [A]: brief(1, "Add a function that says hello to a name."), [B]: brief(2, "Add a function that says goodbye.") });
    const state = stateDir();
    const env = await envFor(threeWays, state);
    expect((await delivery(["run", "--sources", "--max", "2"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const [pr1] = gh.pullRequests();
    gh.merge(pr1?.url ?? "", "squash", origin);
    // The restack lands on a run with nothing to claim; a crash then loses the lines that record the items' moves.
    expect((await delivery(["run", "--sources"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const items = ledgerPath(repo, { XDG_STATE_HOME: state });
    dropLines(items, (e) => e.t === "moved");
    const dispatched = countDispatched(items);

    expect((await delivery(["run", "--sources", "--max", "1"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);

    expect(countDispatched(items)).toBe(dispatched);
  }, RUN_TIMEOUT * 3);
});
