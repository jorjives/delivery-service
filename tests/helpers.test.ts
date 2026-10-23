import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { firstParagraph, REPO_ROOT, runTsx, useScratch } from "./helpers.js";

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

describe("firstParagraph", () => {
  it("skips YAML front matter", () => {
    expect(firstParagraph("---\nhide:\n  - navigation\n---\n\n# Title\n\nThe opening.\n")).toBe("The opening.");
  });

  it("ignores text before the # heading", () => {
    expect(firstParagraph("Text before the heading.\n\n# Title\n\nThe opening.\n")).toBe("The opening.");
  });

  it("stops at the first blank line", () => {
    expect(firstParagraph("# Title\n\nFirst.\n\nSecond.\n")).toBe("First.");
  });

  it("flattens a paragraph wrapped over several lines to one line", () => {
    expect(firstParagraph("# Title\n\nA pack is a\n  repeatable job.\n")).toBe("A pack is a repeatable job.");
  });
});
