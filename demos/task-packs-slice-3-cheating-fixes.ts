/**
 * Demo for Task Packs Slice 3: A Fix That Weakens the Tests Is Refused.
 *
 * 1. Copies examples/code-review-example into a scratch git repository and
 *    reviews it with a scripted agent.
 * 2. Approves every problem and runs `delivery fix` with a scripted agent that
 *    cheats: one fix deletes a test, one skips a test and changes the test
 *    command, and one makes the honest minimal edit to a test. Each is refused;
 *    told why, the agent gives up. Only the last is counted as needing a change
 *    to one of the owner's tests.
 * 3. Runs `delivery findings` and shows the project's tests untouched.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no agent, no sign-in, no network.
 *
 * Usage: npm run demo:packs-slice-3
 */
import { execFileSync } from "node:child_process";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery, scriptFile } from "../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../src/git-env.js";
import { CHEATING_FIXES, EXAMPLE_SCAN, exampleRepo, scanScript } from "../src/packs/review-fixtures.js";

async function show(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd: repo, env });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

const repo = exampleRepo("packs-cheat-demo-");
console.log(`The example shop, as a fresh git repository: ${repo}`);
await show(repo, { [TEST_MOCK_SCRIPT]: await scriptFile(scanScript(EXAMPLE_SCAN)) }, ["review", "code"]);
await show(repo, {}, ["findings", "approve", "--all"]);
await show(repo, { [TEST_MOCK_SCRIPT]: await scriptFile(CHEATING_FIXES) }, ["fix"]);
await show(repo, {}, ["findings"]);

const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf-8", env: cleanGitEnv() }).trim();
console.log("\n$ git log --oneline");
console.log(git(["log", "--oneline"]));
console.log("\n$ git status --porcelain");
console.log(git(["status", "--porcelain"]) || "(nothing changed: every test is still there, as it was)");
