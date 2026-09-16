import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initTempRepo } from "../src/temp-repo.js";
import { REPO_ROOT, useScratch } from "./helpers.js";

const scratch = useScratch();

describe("the shared git test helper", () => {
  it("keeps an expected failure's stderr out of the test run's output", () => {
    const repo = initTempRepo("helpers-git-", { "seed.txt": "hello\n" });
    const script = join(scratch("helpers-probe-"), "probe.mts");
    writeFileSync(
      script,
      [
        `import { git } from ${JSON.stringify(join(REPO_ROOT, "tests", "helpers.ts"))};`,
        `try { git(${JSON.stringify(repo)}, ["show", "main:missing.txt"]); process.exit(2); } catch { process.exit(0); }`,
      ].join("\n"),
    );

    const { status, stderr } = spawnSync("npx", ["tsx", script], { cwd: REPO_ROOT, encoding: "utf-8" });

    expect(status).toBe(0);
    expect(stderr).toBe("");
  });
});
