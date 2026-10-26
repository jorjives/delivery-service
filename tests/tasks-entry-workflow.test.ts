// A `tasks` entry that names a workflow is done in that workflow, and
// `delivery validate` refuses one that names a workflow the project lacks.
// Drives the compiled `delivery` command; `preview` and `validate` start no agent.

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../src/cli/failures.js";
import { git, runDelivery } from "./helpers.js";

function config(workflow: string): unknown {
  return {
    tasks: [{ intent: "a", workflow }],
    workflows: { w: { steps: [{ name: "s", prompt: "step prompt here" }] } },
    gate: { type: "command-succeeds", command: "true" },
  };
}

function freshRepo(cfg: unknown): string {
  const repo = mkdtempSync(join(tmpdir(), "tasks-entry-workflow-"));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "sample-project", version: "1.0.0" }));
  writeFileSync(join(repo, "delivery.config.json"), JSON.stringify(cfg, null, 2));
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "harness@example.invalid"]);
  git(repo, ["config", "user.name", "Harness"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "seed"]);
  return repo;
}

describe("a tasks entry's workflow", () => {
  it("is used by delivery preview", () => {
    const result = runDelivery(["preview"], { cwd: freshRepo(config("w")) });
    expect(result.status).toBe(EXIT.ok);
    expect(result.stdout).toContain("step prompt here");
  });

  it("is refused by delivery validate when the project does not define it", () => {
    const result = runDelivery(["validate"], { cwd: freshRepo(config("nope")) });
    expect(result.status).not.toBe(EXIT.ok);
    expect(result.stdout + result.stderr).toContain("nope");
  });
});
