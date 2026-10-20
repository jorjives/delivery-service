// Runs the tests many times in a row and passes only if every run passes, so a
// fix for a flaky test is judged on whether it stays fixed, not on one lucky run.
//
//   node scripts/repeat.mjs 30
import { spawnSync } from "node:child_process";

const times = Number(process.argv[2] ?? 30);
for (let run = 1; run <= times; run++) {
  const result = spawnSync("node", ["--test"], { encoding: "utf-8" });
  if (result.status !== 0) {
    console.error(`run ${run} of ${times} failed:\n${result.stdout}`);
    process.exit(1);
  }
}
console.log(`all ${times} runs passed`);
