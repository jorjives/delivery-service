/**
 * Demo for Observability and Reporting Slice 1: Come Back to Your Task
 * List and See What Happened and What to Do.
 *
 * 1. Sets up a scratch project with a list of four tasks, one of which asks
 *    for something the agent will not do without the owner's say-so.
 * 2. Runs `delivery run` until it stops, then prints `delivery report`.
 * 3. Follows the report's "To act" steps: rewords that task to give the
 *    permission, runs `delivery run` again, and prints `delivery report` again.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no agent, no sign-in, no network.
 *
 * Usage: npm run demo:report-slice-1
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery, PACKAGE, scriptFile } from "../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../src/git-env.js";
import type { MockScript } from "../src/mock-script.js";
import { initTempRepo } from "../src/temp-repo.js";

const FORM = "Add a contact form to the site";
const PRICES = "Update the prices page for October";
const PURGE = "Remove every page under the old news section";
const BANNER = "Show a cookie banner on first visit";
const PERMISSION = "The owner has confirmed the 14 published pages may be deleted.";

const writes = (path: string, said: string) => ({
  effects: [{ write: { path, content: `${said}\n` } }],
  json: { status: "completed", rationale: said },
});

/** The agent, scripted: it does each task, except that it will not delete published pages until the task says it may. */
const script: MockScript = {
  expectations: [
    { when: { promptContains: PERMISSION }, ...writes("news-removed.txt", "removed the 14 pages under the old news section") },
    {
      when: { promptContains: PURGE },
      json: { status: "escalate", category: "authority", rationale: "This would delete 14 published pages. I need the owner to confirm before I remove them." },
    },
    { when: { promptContains: FORM }, ...writes("contact.html", "added the contact form") },
    { when: { promptContains: PRICES }, ...writes("prices.html", "updated the prices page") },
    { when: { promptContains: BANNER }, ...writes("banner.html", "added the cookie banner") },
  ],
};

const configOf = (tasks: string[]): string => JSON.stringify({ closer: { type: "merge-back" }, tasks }, null, 2);

async function show(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd: repo, env });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

async function main(): Promise<void> {
  const repo = initTempRepo("report-demo-", { "package.json": PACKAGE, ".gitignore": ".delivery/\n", "delivery.config.json": configOf([FORM, PRICES, PURGE, BANNER]) });
  // One state folder for both runs, so the second finds the working copies the first made.
  const env = { [TEST_MOCK_SCRIPT]: await scriptFile(script), XDG_STATE_HOME: join(repo, "..", `${repo.split("/").at(-1)}-state`) };
  console.log(`Scratch project: ${repo}`);

  console.log("\n=== 1. Run the list until it stops, then come back and ask what happened ===");
  await show(repo, env, ["run"]);
  await show(repo, env, ["report"]);

  console.log("\n=== 2. Do what the report says: give the permission in the task's wording, and run again ===");
  writeFileSync(join(repo, "delivery.config.json"), configOf([FORM, PRICES, `${PURGE}. ${PERMISSION}`, BANNER]));
  execFileSync("git", ["commit", "-am", "give the permission to remove the old news pages"], { cwd: repo, env: cleanGitEnv(), stdio: "pipe" });
  await show(repo, env, ["run"]);
  await show(repo, env, ["report"]);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
