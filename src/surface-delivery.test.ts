import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { create, load } from "./case-file.js";
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

