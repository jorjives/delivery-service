// This project's check. It lives in the repository, outside every task's copy,
// and relies on a shared helper beside it: shared/helper.json names the command
// that runs the tests. Every task's check reads the same helper, so if it goes
// missing, no task can check its work: the shared environment is broken.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = join(dirname(fileURLToPath(import.meta.url)), "shared", "helper.json");

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

export default { baseline: measure, check: measure };
