/**
 * Demo for Task Packs Slice 1: Ask for a Code Review and Read the Problems in Plain Words.
 *
 * 1. Copies examples/code-review-example into a scratch git repository.
 * 2. Runs `delivery review code` against it with a scripted agent.
 * 3. Runs `delivery findings 1` and `delivery findings --unconfirmed`.
 * 4. Shows `git status` and the branches: nothing in the project changed.
 *
 * Runs against claude-mock, vendored in vendor/claude-mock and installed by
 * npm install: no agent, no sign-in, no network.
 *
 * Usage: npm run demo:packs-slice-1
 */
import { execFileSync } from "node:child_process";
import { TEST_MOCK_SCRIPT } from "../src/cli/agent-session.js";
import { delivery, scriptFile } from "../src/cli/command-fixtures.js";
import { cleanGitEnv } from "../src/git-env.js";
import { EXAMPLE_SCAN, exampleRepo, scanScript } from "../src/packs/review-fixtures.js";

async function show(repo: string, env: NodeJS.ProcessEnv, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd: repo, env });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

const repo = exampleRepo("packs-demo-");
const env = { [TEST_MOCK_SCRIPT]: await scriptFile(scanScript(EXAMPLE_SCAN, { durationMs: 252_000, costUsd: 0.38 })) };

console.log(`The example shop, as a fresh git repository: ${repo}`);
await show(repo, env, ["review", "code"]);
await show(repo, env, ["findings", "1"]);
await show(repo, env, ["findings", "--unconfirmed"]);

const git = (args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf-8", env: cleanGitEnv() }).trim();
console.log("\n$ git status --porcelain");
console.log(git(["status", "--porcelain"]) || "(nothing changed)");
console.log("\n$ git branch --list");
console.log(git(["branch", "--list"]));
