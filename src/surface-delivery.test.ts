import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { create, load, updateCursor } from "./case-file.js";
import { DELIVERY, commitOn, deliveryRepo } from "./delivery-fixtures.js";
import { advance, run, type AdvanceResult } from "./surface.js";
import { deterministicRouter } from "./router.js";
import { createMergeBackCloser } from "./merge-back-closer.js";
import { fakeAgentPort } from "./testing.js";
import type { AgentContext, SurfaceLocation, SurfacePorts, Terminus } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const BRANCH = "surface/surface-7";
// Fails only when both pieces of work are present together: each passes on its own.
const CHECK = 'echo "1..1"\nif [ -f feature.txt ] && [ -f other.txt ]; then echo "not ok 1 - together"; else echo "ok 1 - together"; fi\n';
const gateRef: GateRef = { type: "command", command: "sh check.sh", parseMode: "tap" };

const writes = (file: string, content: string) => (ctx: AgentContext): Promise<Terminus> => {
  writeFileSync(join(ctx.worktreePath, file), content);
  return Promise.resolve({ status: "completed", rationale: `wrote ${file}` });
};

async function toClosing(ports: SurfacePorts, repo: string, gate: GateRef = gateRef): Promise<{ dir: string; location: SurfaceLocation }> {
  const dir = await mkdtemp(join(tmpdir(), "surface-delivery-case-"));
  const location = { repoPath: repo, worktreePath: join(await mkdtemp(join(tmpdir(), "surface-delivery-tree-")), "wt") };
  await create(dir, { surfaceId: "surface-7", taskDef: { intent: "add the feature" }, gateRef: gate, delivery: { branch: DELIVERY } }, budgets);
  let result: AdvanceResult;
  do {
    result = await advance(dir, location, ports);
  } while (result.state !== "CLOSING" && !result.done);
  expect(result.state).toBe("CLOSING");
  return { dir, location };
}

const portsWith = (worker: (ctx: AgentContext) => Promise<Terminus>): SurfacePorts => ({
  agent: fakeAgentPort({ worker }),
  triage: deterministicRouter,
  closer: createMergeBackCloser(),
});

describe("a task pinned to a delivery branch", () => {
  it("starts from the delivery branch's tip and lands there, leaving the base branch alone", async () => {
    const repo = deliveryRepo();
    const landedBefore = await commitOn(repo, DELIVERY, "earlier.txt", "an earlier task's work\n");
    const main = git(repo, ["rev-parse", "main"]);
    const ports = portsWith(writes("feature.txt", "the feature\n"));
    const { dir, location } = await toClosing(ports, repo);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    const { header } = await load(dir);
    expect(header.startCommit).toBe(landedBefore);
    expect(header.baseBranch).toBe("main");
    expect(git(repo, ["show", `${DELIVERY}:feature.txt`])).toBe("the feature");
    expect(git(repo, ["show", `${DELIVERY}:earlier.txt`])).toBe("an earlier task's work");
    expect(git(repo, ["rev-parse", "main"])).toBe(main);
    expect(git(repo, ["branch", "--list", BRANCH])).toBe("");
  });
});


describe("landing on a delivery branch that has moved", () => {
  it("lands with nothing re-checked when the tip is still where the task started", async () => {
    const repo = deliveryRepo();
    const ports = portsWith(writes("feature.txt", "the feature\n"));
    const { dir, location } = await toClosing(ports, repo);

    await run(dir, location, ports);

    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "gate")).toHaveLength(1);
    expect(history.filter((e) => e.t === "landing")).toHaveLength(0);
  });

  it("rebuilds the task on the new tip, re-checks it against the tip's baseline, and lands it when that passes", async () => {
    const repo = deliveryRepo();
    const ports = portsWith(writes("feature.txt", "the feature\n"));
    const { dir, location } = await toClosing(ports, repo);
    const moved = await commitOn(repo, DELIVERY, "earlier.txt", "another task's work\n");

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    const { history } = await load(dir);
    const landings = history.filter((e) => e.t === "landing");
    expect(landings).toMatchObject([{ onto: moved, baseline: { status: "PASS" } }]);
    expect(history.filter((e) => e.t === "gate").map((e) => e.t === "gate" && e.status)).toEqual(["PASS", "PASS"]);
    expect(git(repo, ["rev-parse", `${DELIVERY}^`])).toBe(moved);
    expect(git(repo, ["show", `${DELIVERY}:feature.txt`])).toBe("the feature");
  });

  it("never lands a rebuild that fails its re-check: the next attempt works on it, on the correction budget", async () => {
    const repo = deliveryRepo({ "check.sh": CHECK });
    let attempt = 0;
    const ports = portsWith((ctx) => {
      attempt++;
      if (attempt === 1) return writes("feature.txt", "the feature\n")(ctx);
      // Corrected: the feature no longer clashes with the other task's work.
      git(ctx.worktreePath, ["rm", "-q", "feature.txt"]);
      return writes("feature-fixed.txt", "the feature, fixed\n")(ctx);
    });
    const { dir, location } = await toClosing(ports, repo);
    await commitOn(repo, DELIVERY, "other.txt", "another task's work\n");
    const tips: string[] = [];
    const watch = setInterval(() => tips.push(git(repo, ["rev-parse", DELIVERY])), 5);

    const result = await run(dir, location, ports);
    clearInterval(watch);

    expect(result.state).toBe("CLOSED");
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "triage").map((e) => e.t === "triage" && e.verdict)).toEqual(["reroute"]);
    expect(git(repo, ["show", `${DELIVERY}:feature-fixed.txt`])).toBe("the feature, fixed");
    expect(() => git(repo, ["show", `${DELIVERY}:feature.txt`])).toThrow();
    for (const tip of new Set(tips)) expect(() => git(repo, ["show", `${tip}:feature.txt`])).toThrow();
  });
});

describe("a rebuild that conflicts", () => {
  it("is never landed: the next attempt starts afresh at the tip, can read the kept work, and lands", async () => {
    const repo = deliveryRepo();
    let attempt = 0;
    let seen: { head: string; shared: string; kept: string } | undefined;
    const ports = portsWith((ctx) => {
      attempt++;
      if (attempt === 1) return writes("shared.txt", "mine\n")(ctx);
      seen = {
        head: git(ctx.worktreePath, ["rev-parse", "HEAD"]),
        shared: git(ctx.worktreePath, ["show", "HEAD:shared.txt"]),
        kept: git(repo, ["show", `${BRANCH}-conflict-1:shared.txt`]),
      };
      return writes("shared.txt", "theirs\nmine\n")(ctx);
    });
    const { dir, location } = await toClosing(ports, repo);
    const tipThen = await commitOn(repo, DELIVERY, "shared.txt", "theirs\n");

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    expect(seen).toEqual({ head: tipThen, shared: "theirs", kept: "mine" });
    const { history } = await load(dir);
    expect(history.find((e) => e.t === "landing")).toMatchObject({ onto: tipThen, conflict: { files: ["shared.txt"], kept: `${BRANCH}-conflict-1` } });
    expect(history.filter((e) => e.t === "triage").map((e) => e.t === "triage" && e.verdict)).toEqual(["reroute"]);
    expect(git(repo, ["show", `${DELIVERY}:shared.txt`])).toBe("theirs\nmine");
    // Kept only until the task lands.
    expect(git(repo, ["branch", "--list", `${BRANCH}-conflict-*`])).toBe("");
  });
});

describe("the commit a close records", () => {
  /**
   * The crash window between the closer and the close entry: the last close entry is lost, with the outcome that is set after it,
   * and the cursor is back before the close.
   */
  async function loseLastClose(dir: string): Promise<void> {
    const log = join(dir, "log.jsonl");
    const lines = readFileSync(log, "utf-8").split("\n").filter(Boolean);
    expect(JSON.parse(lines.at(-1) ?? "").t).toBe("close");
    writeFileSync(log, lines.slice(0, -1).map((line) => `${line}\n`).join(""));
    const caseJsonPath = join(dir, "case.json");
    const { outcome: _lost, ...caseJson } = JSON.parse(readFileSync(caseJsonPath, "utf-8"));
    writeFileSync(caseJsonPath, JSON.stringify(caseJson));
    await updateCursor(dir, { state: "CLOSING" });
  }

  const lastClose = async (dir: string) => (await load(dir)).history.findLast((e) => e.t === "close");

  it("records on its close the delivery-branch commit it landed at", async () => {
    const repo = deliveryRepo();
    const ports = portsWith(writes("feature.txt", "the feature\n"));
    const { dir, location } = await toClosing(ports, repo);

    await run(dir, location, ports);

    expect(await lastClose(dir)).toMatchObject({ status: "DONE", commit: git(repo, ["rev-parse", DELIVERY]) });
  });

  it("records the landed commit on a close replayed after merge-back already landed and deleted the branch", async () => {
    const repo = deliveryRepo();
    const ports = portsWith(writes("feature.txt", "the feature\n"));
    const { dir, location } = await toClosing(ports, repo);
    await run(dir, location, ports);
    const landedAt = git(repo, ["rev-parse", DELIVERY]);
    await loseLastClose(dir);
    await commitOn(repo, DELIVERY, "other.txt", "another task's work\n");

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    expect(await lastClose(dir)).toMatchObject({ status: "DONE", commit: landedAt });
    expect(git(repo, ["rev-parse", DELIVERY])).not.toBe(landedAt);
  });

  it("records a close that landed nothing of its own as empty, and one that landed as not", async () => {
    const repo = deliveryRepo();
    const landing = portsWith(writes("feature.txt", "the feature\n"));
    const first = await toClosing(landing, repo);
    await run(first.dir, first.location, landing);
    const landedAt = git(repo, ["rev-parse", DELIVERY]);
    const idle = portsWith(() => Promise.resolve({ status: "completed", rationale: "found nothing to change" }));
    const second = await toClosing(idle, repo);

    const result = await run(second.dir, second.location, idle);

    expect(result.state).toBe("CLOSED");
    const firstClose = (await load(first.dir)).history.findLast((e) => e.t === "close");
    expect(firstClose).toMatchObject({ status: "DONE", commit: landedAt });
    expect(firstClose).not.toHaveProperty("empty");
    expect(await lastClose(second.dir)).toMatchObject({ status: "DONE", commit: landedAt, empty: true });
  });

  it("keeps a real landing non-empty on a close replayed after the landing, while the task branch still exists", async () => {
    const repo = deliveryRepo();
    const ports = portsWith(writes("feature.txt", "the feature\n"));
    const { dir, location } = await toClosing(ports, repo);
    await run(dir, location, ports);
    const landedAt = git(repo, ["rev-parse", DELIVERY]);
    // Stands for a crash after the fast-forward and before merge-back deleted the task branch.
    git(repo, ["branch", BRANCH, landedAt]);
    await loseLastClose(dir);

    const result = await run(dir, location, ports);

    expect(result.state).toBe("CLOSED");
    const replayed = await lastClose(dir);
    expect(replayed).toMatchObject({ status: "DONE", commit: landedAt });
    expect(replayed).not.toHaveProperty("empty");
  });
});
