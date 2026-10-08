/**
 * Demo for Task Packs Slice 4: Run a Security Review and Sign Off Serious Fixes Before They Land.
 *
 * 1. Copies examples/code-review-example into a scratch git repository and
 *    gives it a security review with a scripted agent: a critical password in
 *    the code and an old library version. The password is never shown.
 * 2. Approves both and runs `delivery fix`: the library fix is merged at once;
 *    the password fix is checked and kept on its branch, waiting for sign-off.
 * 3. Reads the report while the password fix still waits, then shows what the
 *    kept fix changed, signs it off (it is checked again on the current main
 *    copy, then merged), and lists what is still left for the owner.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no agent, no sign-in, no network.
 *
 * Usage: npm run demo:packs-slice-4
 */
import { execFileSync } from "node:child_process";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery, scriptFile } from "../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../src/git-env.js";
import { EXAMPLE_SECURITY_SCAN, exampleRepo, scanScript, SECURITY_FIXES } from "../src/packs/review-fixtures.js";

async function show(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd: repo, env });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

const repo = exampleRepo("packs-security-demo-");
console.log(`The example shop, as a fresh git repository: ${repo}`);
await show(repo, { [TEST_MOCK_SCRIPT]: await scriptFile(scanScript(EXAMPLE_SECURITY_SCAN)) }, ["review", "security"]);
await show(repo, {}, ["findings", "approve", "--all"]);
await show(repo, { [TEST_MOCK_SCRIPT]: await scriptFile(SECURITY_FIXES) }, ["fix"]);
await show(repo, {}, ["findings"]);
await show(repo, {}, ["report"]);
await show(repo, {}, ["findings", "1", "--changes"]);
await show(repo, {}, ["findings", "sign-off", "1"]);
await show(repo, {}, ["findings"]);

const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf-8", env: cleanGitEnv() }).trim();
console.log("\n$ git log --oneline");
console.log(git(["log", "--oneline"]));
