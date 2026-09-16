import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, runTsx, useScratch } from "./helpers.js";

const scratch = useScratch();

describe("the shared git test helper", () => {
  it("keeps an expected failure's stderr out of the test run's output", () => {
    const notARepo = scratch("helpers-not-a-repo-");
    const script = join(notARepo, "probe.mts");
    writeFileSync(
      script,
      [
        `import { git } from ${JSON.stringify(join(REPO_ROOT, "tests", "helpers.ts"))};`,
        `try { git(${JSON.stringify(notARepo)}, ["rev-parse", "HEAD"]); process.exit(2); } catch { process.exit(0); }`,
      ].join("\n"),
    );

    const { status, stderr } = runTsx([script]);

    expect(status).toBe(0);
    expect(stderr).toBe("");
  });
});
