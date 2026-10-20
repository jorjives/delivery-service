// A work source for `delivery run --sources`: one task per dependency with a
// newer version, as `npm outdated` reports it. The id names the version, so a
// newer release later is a new task. Once a package is upgraded it stops being
// listed, so `complete` has nothing to record.
//
//   node scripts/outdated-source.mjs list
//   node scripts/outdated-source.mjs complete <id>
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [command] = process.argv.slice(2);
if (command === "list") {
  // npm outdated exits 1 when anything is out of date, so its output, not its exit code, is the answer.
  const outdated = spawnSync("npm", ["outdated", "--json"], { encoding: "utf-8" });
  if (outdated.stdout.trim() === "") {
    if (outdated.status !== 0) {
      console.error(outdated.stderr);
      process.exit(1);
    }
    console.log("[]");
    process.exit(0);
  }
  const lock = JSON.parse(readFileSync("package-lock.json", "utf-8"));
  const tasks = Object.entries(JSON.parse(outdated.stdout)).map(([name, { latest }]) => {
    const from = lock.packages[`node_modules/${name}`]?.version ?? "not installed";
    return { id: `${name}@${latest}`, intent: `Upgrade ${name} from ${from} to ${latest}`, package: name, from, to: latest, workflow: "upgrade" };
  });
  console.log(JSON.stringify(tasks));
} else if (command !== "complete") {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
