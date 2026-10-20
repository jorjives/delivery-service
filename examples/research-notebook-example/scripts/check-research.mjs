// Checks every folder under research/: it has a README with a question, an
// answer and a way to check it, and a run.mjs whose last line of output starts
// "ANSWER:" and appears in the README word for word. With --new, it also fails
// unless the work added a research folder since the step started.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const problems = [];
const folders = readdirSync("research").filter((name) => statSync(join("research", name)).isDirectory());

for (const name of folders) {
  const dir = join("research", name);
  const readme = existsSync(join(dir, "README.md")) ? readFileSync(join(dir, "README.md"), "utf-8") : "";
  for (const heading of ["## Question", "## Answer", "## How to check"]) {
    if (!readme.includes(heading)) problems.push(`${dir}/README.md has no "${heading}" section`);
  }
  if (!existsSync(join(dir, "run.mjs"))) {
    problems.push(`${dir} has no run.mjs`);
    continue;
  }
  const run = spawnSync(process.execPath, ["run.mjs"], { cwd: dir, encoding: "utf-8", timeout: 60_000 });
  const last = run.stdout.trim().split("\n").at(-1) ?? "";
  if (run.status !== 0) problems.push(`${dir}/run.mjs failed: ${run.stderr.trim()}`);
  else if (!last.startsWith("ANSWER:")) problems.push(`${dir}/run.mjs does not end with an ANSWER: line`);
  else if (!readme.includes(last)) problems.push(`${dir}/README.md does not contain run.mjs's answer: ${last}`);
  else console.log(`${dir}: ${last}`);
}

if (process.argv.includes("--new")) {
  const start = process.env.DELIVERY_STEP_START ?? "HEAD";
  const git = (...args) => execFileSync("git", args, { encoding: "utf-8" }).split("\n").filter(Boolean);
  const changed = [...git("diff", "--name-only", start), ...git("ls-files", "--others", "--exclude-standard")];
  if (!changed.some((file) => /^research\/[^/]+\/run\.mjs$/.test(file))) problems.push("no research folder with a run.mjs was added");
}

for (const problem of problems) console.error(problem);
process.exit(problems.length === 0 ? 0 : 1);
