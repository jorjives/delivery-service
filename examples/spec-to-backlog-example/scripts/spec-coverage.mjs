// Passes when every requirement in docs/spec.md is either done (a test file
// mentions its id) or planned (an open item in .delivery/backlog/ mentions it).
// This is the planning step's check: a plan that forgets a requirement fails it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ids = [...readFileSync("docs/spec.md", "utf-8").matchAll(/\[(R\d+)\]/g)].map((m) => m[1]);
const read = (dir, keep) => readdirSync(dir, { recursive: true }).filter(keep).map((f) => readFileSync(join(dir, f), "utf-8"));

const tests = read(".", (f) => /\.test\.[cm]?js$/.test(f) && !f.startsWith("node_modules")).join("\n");
const open = read(".delivery/backlog", (f) => f.endsWith(".md")).filter((text) => /^status:\s*open\s*$/m.test(text)).join("\n");
const mentions = (text, id) => new RegExp(`\\b${id}\\b`).test(text);

const missing = ids.filter((id) => !mentions(tests, id) && !mentions(open, id));
for (const id of ids) console.log(`${id}: ${mentions(tests, id) ? "done" : mentions(open, id) ? "planned" : "MISSING"}`);
if (missing.length > 0) {
  console.error(`neither done nor planned: ${missing.join(", ")}`);
  process.exit(1);
}
