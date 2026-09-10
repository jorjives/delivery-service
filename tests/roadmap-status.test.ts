import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers";

// The completion step marks a design spec complete but not its roadmap item,
// so roadmap readers (Spec View, autoloop discovery) see finished items as
// unstarted. This keeps the two in step.
const SPECS_DIR = "docs/superpowers/specs";
const ROADMAP = join(REPO_ROOT, SPECS_DIR, "2026-09-04-delivery-harness-roadmap.md");

function roadmapItemSection(item: number): string {
  const roadmap = readFileSync(ROADMAP, "utf-8");
  const start = roadmap.indexOf(`## Item ${item}:`);
  const end = roadmap.indexOf("\n## ", start + 1);
  return start < 0 ? "" : roadmap.slice(start, end < 0 ? undefined : end);
}

const completedSpecs = readdirSync(join(REPO_ROOT, SPECS_DIR))
  .map((name) => ({ path: `${SPECS_DIR}/${name}`, text: readFileSync(join(REPO_ROOT, SPECS_DIR, name), "utf-8") }))
  .filter((s) => /^> \*\*Status:\*\* ✅ Complete/m.test(s.text))
  .flatMap((s) => {
    const item = /^roadmap_item: (\d+)$/m.exec(s.text);
    return item ? [{ path: s.path, item: Number(item[1]) }] : [];
  });

describe("roadmap completion status", () => {
  it.each(completedSpecs)("roadmap Item $item is marked complete for $path", ({ path, item }) => {
    expect(roadmapItemSection(item)).toMatch(
      new RegExp(`^\\*\\*Status:\\*\\* ✅ Complete — \\d{4}-\\d{2}-\\d{2} — spec: \`${path}\`$`, "m"),
    );
  });
});
