// Checks docs/API.md against the code: every function src/ exports
// has a "### name(...)" section, every section names a function that exists, and
// every example line written `call // => value` gives that value when run.
// With --only-docs, it also fails if anything but docs/API.md (or a new
// follow-up item) changed since the step started.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const problems = [];
const modules = readdirSync("src").filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
const exports = {};
for (const file of modules) Object.assign(exports, await import(pathToFileURL(resolve("src", file)).href));

const api = readFileSync("docs/API.md", "utf-8");
const sections = [...api.matchAll(/^### (\w+)\(.*$([\s\S]*?)(?=^### |(?![\s\S]))/gm)].map(([, name, body]) => ({ name, body }));
const documented = new Set(sections.map((s) => s.name));

for (const name of Object.keys(exports)) if (!documented.has(name)) problems.push(`${name} is exported but docs/API.md does not document it`);
for (const { name, body } of sections) {
  if (!(name in exports)) {
    problems.push(`docs/API.md documents ${name}, which src/ does not export`);
    continue;
  }
  for (const [, call, expected] of body.matchAll(/^(.+?)\s*\/\/ => (.+)$/gm)) {
    let actual;
    try {
      actual = new Function(...Object.keys(exports), `return (${call});`)(...Object.values(exports));
    } catch (error) {
      problems.push(`the example ${call} throws: ${error.message}`);
      continue;
    }
    if (!isDeepStrictEqual(actual, JSON.parse(expected))) problems.push(`docs/API.md says ${call} gives ${expected}, but it gives ${JSON.stringify(actual)}`);
  }
}

if (process.argv.includes("--only-docs")) {
  const start = process.env.DELIVERY_STEP_START ?? "HEAD";
  const git = (...args) => execFileSync("git", args, { encoding: "utf-8" }).split("\n").filter(Boolean);
  const changed = [...git("diff", "--name-only", start), ...git("ls-files", "--others", "--exclude-standard")].filter((f) => f !== "docs/API.md" && !f.startsWith(".delivery/backlog/"));
  if (changed.length > 0) problems.push(`only docs/API.md may change, but these changed too: ${changed.join(", ")}`);
}

for (const problem of problems) console.error(problem);
if (problems.length === 0) console.log(`docs/API.md documents all ${documented.size} functions, and every example gives what it says`);
process.exit(problems.length === 0 ? 0 : 1);
