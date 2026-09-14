import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "../git-exec.js";
import type { GateRef } from "../schema.js";
import { EXIT, Refusal } from "./failures.js";

export const NOT_A_REPOSITORY =
  "This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one.";

export const NO_CHECK =
  "I couldn't find a command to check the agent's work with. Add a `test` script to your `package.json` that passes when a change is good.";

export const UNCOMMITTED_NOTE =
  "Note: you have uncommitted changes. The agent works from your last commit, so it won't see them.";

/** The top folder of the git repository containing `path`, or a refusal saying the folder needs to be one. */
export async function findRepository(path: string): Promise<string> {
  try {
    return await git(path, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Refusal(NOT_A_REPOSITORY, EXIT.configuration);
  }
}

const TestScript = z.object({ scripts: z.object({ test: z.string().trim().min(1) }) });

/**
 * The placeholder `npm init` writes. It always fails, so a delta against it
 * would accept any change: no check at all, dressed as one.
 */
const NPM_INIT_PLACEHOLDER = "no test specified";

/**
 * The default check: the repository's own `npm test`, judged by its exit code
 * alone, the one parse mode that assumes nothing about the runner's output.
 */
export async function inferGate(repoPath: string): Promise<GateRef> {
  const script = await testScript(repoPath);
  if (script === undefined || script.includes(NPM_INIT_PLACEHOLDER)) {
    throw new Refusal(NO_CHECK, EXIT.configuration);
  }
  return { type: "command", command: "npm test", parseMode: "exitcode" };
}

async function testScript(repoPath: string): Promise<string | undefined> {
  try {
    const parsed = TestScript.safeParse(JSON.parse(await readFile(join(repoPath, "package.json"), "utf-8")));
    return parsed.success ? parsed.data.scripts.test : undefined;
  } catch {
    return undefined; // no package.json, or not JSON
  }
}

/** Whether `git status` shows anything: changes the agent will not see, because it starts from the last commit. */
export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
  return (await git(repoPath, ["status", "--porcelain"])) !== "";
}
