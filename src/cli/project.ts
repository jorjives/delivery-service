import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { git } from "../git-exec.js";
import type { GateRef } from "../schema.js";
import { EXIT, Refusal } from "./failures.js";

export const NOT_A_REPOSITORY =
  "This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one.";

export const NO_CHECK =
  "I couldn't find a command to check the agent's work with. Tell me what marks a change as good, for example " +
  '`--gate-command "npm test"`, or add a `test` script to your `package.json`.';

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
 * The check this project's own `package.json` implies, or nothing when it
 * implies none. `npm init`'s placeholder is nothing: it always fails, so a
 * check built on it would accept any change, which is no check at all dressed
 * as one. Undefined rather than a refusal, because "there isn't one" is a
 * question `delivery init` asks and a refusal `delivery run` makes, and they
 * should not infer it separately.
 */
export async function inferredCheck(repoPath: string): Promise<string | undefined> {
  const script = await testScript(repoPath);
  return script === undefined || script.includes(NPM_INIT_PLACEHOLDER) ? undefined : "npm test";
}

/**
 * The default check: the repository's own `npm test`, judged by its exit code
 * alone, the one parse mode that assumes nothing about the runner's output.
 */
export async function inferGate(repoPath: string): Promise<GateRef> {
  const command = await inferredCheck(repoPath);
  if (command === undefined) throw new Refusal(NO_CHECK, EXIT.configuration);
  return { type: "command", command, parseMode: "exitcode" };
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
