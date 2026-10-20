// The compound step's check: the work added one lesson to docs/solutions/, with
// a problem, what worked and what to do next time, and linked it from the
// Lessons list in CLAUDE.md so the next agent reads it. Nothing else may change.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const start = process.env.DELIVERY_STEP_START ?? "HEAD";
const git = (...args) => execFileSync("git", args, { encoding: "utf-8" }).split("\n").filter(Boolean);
const changed = [...git("diff", "--name-only", start), ...git("ls-files", "--others", "--exclude-standard")];
const added = [...git("diff", "--name-only", "--diff-filter=A", start), ...git("ls-files", "--others", "--exclude-standard")];

const lessons = added.filter((file) => /^docs\/solutions\/[^/]+\.md$/.test(file));
const others = changed.filter((file) => file !== "CLAUDE.md" && !file.startsWith("docs/solutions/"));
const claude = readFileSync("CLAUDE.md", "utf-8");
const problems = [];

if (lessons.length === 0) problems.push("no new lesson in docs/solutions/");
for (const lesson of lessons) {
  const text = readFileSync(lesson, "utf-8");
  for (const heading of ["## Problem", "## What worked", "## Next time"]) {
    if (!text.includes(heading)) problems.push(`${lesson} has no "${heading}" section`);
  }
  if (!claude.includes(`](${lesson})`)) problems.push(`CLAUDE.md does not link to ${lesson}`);
}
if (others.length > 0) problems.push(`only docs/solutions/ and CLAUDE.md may change in this step, but these changed too: ${others.join(", ")}`);

for (const problem of problems) console.error(problem);
if (problems.length === 0) console.log(`recorded: ${lessons.join(", ")}`);
process.exit(problems.length === 0 ? 0 : 1);
