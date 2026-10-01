// This project's check. It lives in the repository, outside every task's copy,
// and relies on a shared helper beside it: shared/helper.json names the command
// that runs the tests. Every task's check reads the same helper, so if it goes
// missing, no task can check its work: the shared environment is broken.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHARED = join(dirname(fileURLToPath(import.meta.url)), "shared");
const HELPER = join(SHARED, "helper.json");

// A helper that comes and goes, to try out: while shared/outage.json exists,
// holding { "tasks": 2, "checks": 4 }, the helper does not answer the first
// two copies that check their work, four times each, and then answers again.
const OUTAGE = join(SHARED, "outage.json");
const refused = new Map();

function outOfReach(worktreePath) {
  if (!existsSync(OUTAGE)) return false;
  const { tasks, checks } = JSON.parse(readFileSync(OUTAGE, "utf-8"));
  const times = refused.get(worktreePath) ?? 0;
  if (times >= checks || (times === 0 && refused.size >= tasks)) return false;
  refused.set(worktreePath, times + 1);
  return true;
}

async function measure({ worktreePath }) {
  if (!existsSync(HELPER)) {
    return { status: "ERROR", assertions: [], detail: `the shared helper ${HELPER} is missing, so the check cannot run` };
  }
  const { command, args } = JSON.parse(readFileSync(HELPER, "utf-8"));
  const run = spawnSync(command, args, { cwd: worktreePath, encoding: "utf-8" });
  return {
    status: "PASS",
    assertions: [{ id: `${command} ${args.join(" ")}`, outcome: run.status === 0 ? "PASS" : "FAIL", detail: `${run.stdout}\n${run.stderr}`.trim() }],
  };
}

async function check(context) {
  if (outOfReach(context.worktreePath)) {
    return { status: "ERROR", assertions: [], detail: `the shared helper ${HELPER} did not answer, so the check cannot run` };
  }
  return measure(context);
}

export default { baseline: measure, check };
