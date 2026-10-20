// A small lint: every name a file imports must be used in that file.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const problems = [];
for (const dir of ["src", "lib"]) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const text = readFileSync(join(dir, file), "utf-8");
    for (const [statement, names] of text.matchAll(/^import \{([^}]+)\} from .*$/gm)) {
      const rest = text.replace(statement, "");
      for (const name of names.split(",").map((n) => n.trim()).filter(Boolean)) {
        if (!new RegExp(`\\b${name}\\b`).test(rest)) problems.push(`${dir}/${file} imports ${name} but never uses it`);
      }
    }
  }
}
for (const problem of problems) console.error(problem);
process.exit(problems.length === 0 ? 0 : 1);
