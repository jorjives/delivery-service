// Passes when the work changed something under the given paths since the step
// started (DELIVERY_STEP_START, which the harness sets for every check).
// With --only, it also fails when anything outside those paths changed.
//
//   node scripts/changed.mjs plans/
//   node scripts/changed.mjs --only plans/
//   node scripts/changed.mjs .            (anything at all)
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const only = args[0] === "--only";
const paths = only ? args.slice(1) : args;
const start = process.env.DELIVERY_STEP_START ?? "HEAD";
const git = (...rest) => execFileSync("git", rest, { encoding: "utf-8" }).split("\n").filter(Boolean);

const changed = [...git("diff", "--name-only", start), ...git("ls-files", "--others", "--exclude-standard")];
const inside = (file) => paths.some((path) => path === "." || file === path || file.startsWith(path.endsWith("/") ? path : `${path}/`));

if (!changed.some(inside)) {
  console.error(`nothing under ${paths.join(", ")} changed since ${start}`);
  process.exit(1);
}
const outside = changed.filter((file) => !inside(file));
if (only && outside.length > 0) {
  console.error(`only ${paths.join(", ")} may change in this step, but these changed too: ${outside.join(", ")}`);
  process.exit(1);
}
console.log(`changed: ${changed.filter(inside).join(", ")}`);
