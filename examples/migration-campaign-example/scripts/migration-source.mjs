// A work source for `delivery run --sources`: one task per file that still
// imports lib/legacy-dates.js. Once a file is migrated it stops being listed,
// so `complete` has nothing to record.
//
//   node scripts/migration-source.mjs list
//   node scripts/migration-source.mjs complete <id>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [command] = process.argv.slice(2);
if (command === "list") {
  const files = readdirSync("src")
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => join("src", f))
    .filter((file) => readFileSync(file, "utf-8").includes("legacy-dates.js"));
  const tasks = files.map((file) => ({
    id: file,
    intent: `Move ${file} off lib/legacy-dates.js, as docs/MIGRATION.md describes`,
    file,
    workflow: "migrate-file",
  }));
  console.log(JSON.stringify(tasks));
} else if (command !== "complete") {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
