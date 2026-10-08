/**
 * Demo for Task Packs Slice 6: Review a Project That Has No Tests, Safely.
 *
 * 1. Copies examples/no-tests-example into a scratch git repository and gives it a code review
 *    with a scripted agent: the review warns the project has no tests, and the problem with no
 *    specific check reads "needs your decision".
 * 2. Approves the two problems that have a specific check (approving the third by number is
 *    refused), then approves the third anyway with --allow-unchecked.
 * 3. Runs `delivery fix`: every fix is checked by its own check and waits for sign-off; nothing
 *    is merged. Signs off the first and lists where each stands.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by npm install: no
 * agent, no sign-in, no network.
 *
 * Usage: npm run demo:packs-slice-6
 */
import { execFileSync } from "node:child_process";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery, scriptFile } from "../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../src/git-env.js";
import { exampleRepo, NO_TESTS_DIR, NO_TESTS_FIXES, NO_TESTS_SCAN, scanScript } from "../src/packs/review-fixtures.js";

async function show(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd: repo, env });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

const repo = exampleRepo("packs-no-tests-demo-", NO_TESTS_DIR);
console.log(`The no-tests example, as a fresh git repository: ${repo}`);
await show(repo, { [TEST_MOCK_SCRIPT]: await scriptFile(scanScript(NO_TESTS_SCAN)) }, ["review", "code"]);
await show(repo, {}, ["findings", "approve", "1", "2"]);
await show(repo, {}, ["findings", "approve", "3"]);
await show(repo, {}, ["findings", "approve", "3", "--allow-unchecked"]);
await show(repo, { [TEST_MOCK_SCRIPT]: await scriptFile(NO_TESTS_FIXES) }, ["fix"]);
await show(repo, {}, ["findings"]);
await show(repo, {}, ["findings", "sign-off", "1"]);
await show(repo, {}, ["findings"]);

const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf-8", env: cleanGitEnv() }).trim();
console.log("\n$ git log --oneline");
console.log(git(["log", "--oneline"]));
