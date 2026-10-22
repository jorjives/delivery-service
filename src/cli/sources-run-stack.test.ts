import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { git } from "../../tests/helpers.js";
import { readStack } from "../delivery-stack.js";
import { deliveryLedgerPath, readDeliveryEntries } from "../delivery-ledger.js";
import { createGhStandIn, type GhStandIn } from "../gh-stand-in.js";
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

/** A project with origin, the given config, and the given backlog items. */
function project(config: object, items: Record<string, string>): { repo: string; origin: string } {
  const files: Record<string, string> = { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config) };
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
});
