/**
 * Demo for Task Packs Slice 7: Write Your Own Pack and Prove It Without a Real Agent.
 *
 * 1. Copies the built-in code review pack to a scratch folder as `my-review`.
 * 2. Changes one check kind to a made-up name and runs `delivery packs check my-review`: the
 *    file, the field and the available checks are named.
 * 3. Puts the name back and runs the check again: the scripted review, fix and cheat are reported,
 *    and nothing is sent to a real agent.
 *
 * Runs against claude-mock, which ships with the harness: no agent, no sign-in, no network.
 *
 * Usage: npm run demo:packs-slice-7
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delivery } from "../src/cli/command-fixtures.js";
import { BUILT_IN_PACKS } from "../src/packs/manifest.js";

async function show(cwd: string, args: string[]): Promise<void> {
  console.log(`\n$ delivery ${args.join(" ")}`);
  const { stdout, stderr, exitCode } = await delivery(args, { cwd });
  process.stdout.write(stdout + stderr);
  console.log(`(exit ${exitCode})`);
}

const cwd = mkdtempSync(join(tmpdir(), "packs-author-demo-"));
const manifest = join(cwd, "my-review", "pack.json");
cpSync(join(BUILT_IN_PACKS, "code-review"), join(cwd, "my-review"), { recursive: true });
const original = readFileSync(manifest, "utf-8");
console.log(`A copy of the built-in code review, as my-review: ${join(cwd, "my-review")}`);

writeFileSync(manifest, original.replace('"pattern-absent"]', '"page-contains"]'));
await show(cwd, ["packs", "check", "my-review"]);

writeFileSync(manifest, original);
await show(cwd, ["packs", "check", "my-review"]);
