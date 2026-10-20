// The "red" check: passes only when the step added or changed test files and
// nothing else, and the tests now fail. It is how a test-first step proves it
// wrote a test that fails before any code is written for it.
import { execFileSync, spawnSync } from "node:child_process";

const start = process.env.DELIVERY_STEP_START ?? "HEAD";
const git = (...args) => execFileSync("git", args, { encoding: "utf-8" }).split("\n").filter(Boolean);
const changed = [...git("diff", "--name-only", start), ...git("ls-files", "--others", "--exclude-standard")];
const isTest = (file) => /\.test\.[cm]?js$/.test(file);

if (changed.length === 0) fail("no test was written");
const notTests = changed.filter((file) => !isTest(file));
if (notTests.length > 0) fail(`only tests may change in this step, but these changed too: ${notTests.join(", ")}`);
const tests = spawnSync("npm", ["test"], { encoding: "utf-8" });
if (tests.status === 0) fail("the new test passes already, so it does not show the behaviour is missing");
console.log(`red: ${changed.join(", ")} written, and the tests fail`);

function fail(why) {
  console.error(why);
  process.exit(1);
}
