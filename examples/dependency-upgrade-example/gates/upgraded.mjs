// The bump step's check: package-lock.json now installs the package the task
// names (its `package` field) at the version it names (its `to` field).
import { readFileSync } from "node:fs";
import { join } from "node:path";

async function measure({ worktreePath, taskDef }) {
  const { package: name, to } = taskDef;
  if (typeof name !== "string" || typeof to !== "string") return { status: "ERROR", assertions: [], detail: "the task names no package and version" };
  const lock = JSON.parse(readFileSync(join(worktreePath, "package-lock.json"), "utf-8"));
  const installed = lock.packages?.[`node_modules/${name}`]?.version;
  return {
    status: "PASS",
    assertions: [{ id: `package-lock.json installs ${name}@${to}`, outcome: installed === to ? "PASS" : "FAIL", detail: `it installs ${installed ?? "nothing"}` }],
  };
}

export default { baseline: measure, check: measure };
