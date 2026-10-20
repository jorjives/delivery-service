// The convert step's check, for the one file the task names (its `file` field):
// that file no longer imports lib/legacy-dates.js, and no other file has
// started to.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function legacyUsers(worktreePath) {
  return readdirSync(join(worktreePath, "src"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join("src", f))
    .filter((file) => readFileSync(join(worktreePath, file), "utf-8").includes("legacy-dates.js"));
}

// What each working copy imported at its baseline. Several tasks run at once in
// one process, so this is kept per working copy, never in one variable.
const before = new Map();

async function measure({ worktreePath, taskDef }) {
  const file = taskDef.file;
  if (typeof file !== "string") return { status: "ERROR", assertions: [], detail: "the task names no file to migrate" };
  const users = legacyUsers(worktreePath);
  const was = before.get(worktreePath) ?? new Set(users);
  const added = users.filter((user) => !was.has(user));
  return {
    status: "PASS",
    assertions: [
      { id: `${file} no longer imports lib/legacy-dates.js`, outcome: users.includes(file) ? "FAIL" : "PASS", detail: users.includes(file) ? `${file} still imports it` : "" },
      { id: "no file has started to import lib/legacy-dates.js", outcome: added.length === 0 ? "PASS" : "FAIL", detail: added.join(", ") },
    ],
  };
}

export default {
  baseline: async (ctx) => {
    before.set(ctx.worktreePath, new Set(legacyUsers(ctx.worktreePath)));
    return measure(ctx);
  },
  check: measure,
};
