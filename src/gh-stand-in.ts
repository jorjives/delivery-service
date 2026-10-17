import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test and demo support: a stand-in for the GitHub CLI, so the open-pr closer
 * can be exercised with no network and no GitHub account. It is the same
 * swap-the-executable approach claude-mock takes for the agent: a real
 * executable named `gh`, honouring the argv and output of the three commands the
 * closer uses (`gh pr list --json url`, `gh pr create`, `gh pr edit --body`), with its failure
 * messages and exit codes copied from gh 2.94 itself.
 */

export type GhStandInMode = "signed-in" | "signed-out" | "expired" | "forbidden" | "offline";

export interface StandInPullRequest {
  url: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface GhStandIn {
  /** Absolute path of the stand-in executable, named `gh`. */
  command: string;
  /** The directory holding it, to put first on PATH. */
  binDir: string;
  setMode(mode: GhStandInMode): void;
  /** Make every later `gh pr create` fail with this message, as GitHub refusing the pull request would. */
  refuseCreate(message: string): void;
  pullRequests(): StandInPullRequest[];
}

interface StandInState {
  mode: GhStandInMode;
  refusal: string | null;
  pullRequests: StandInPullRequest[];
}

// CommonJS, because an extensionless file outside any package is loaded as
// CommonJS. No template interpolation or backticks inside: String.raw keeps
// every character verbatim.
const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const statePath = path.join(__dirname, "state.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

function fail(message, code) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

// gh's flag parsing: "--name=value", or "--name value" where the next argument
// is the value whatever it looks like.
function flagsOf(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else flags[arg.slice(2)] = args[++i];
  }
  return flags;
}

if (state.mode === "signed-out") {
  fail("To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.", 4);
}
if (state.mode === "expired") {
  fail("HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com", 1);
}
if (state.mode === "offline") {
  fail("error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com", 1);
}

const [group, command, ...rest] = process.argv.slice(2);
const flags = flagsOf(rest);

if (group === "pr" && command === "list") {
  const open = state.pullRequests.filter((pr) => pr.head === flags.head);
  process.stdout.write(JSON.stringify(open.map((pr) => ({ url: pr.url }))) + "\n");
  process.exit(0);
}

if (group === "pr" && command === "create") {
  if (state.mode === "forbidden") {
    fail("pull request create failed: GraphQL: operator does not have the correct permissions to execute 'CreatePullRequest' (createPullRequest)", 1);
  }
  if (state.refusal) fail(state.refusal, 1);
  const url = "https://github.com/example/project/pull/" + (state.pullRequests.length + 1);
  state.pullRequests.push({ url, head: flags.head, base: flags.base, title: flags.title, body: flags.body });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(url + "\n");
  process.exit(0);
}

if (group === "pr" && command === "edit") {
  const pr = state.pullRequests.find((p) => p.url === rest[0]);
  if (!pr) fail("no pull requests found for " + rest[0], 1);
  if (flags.body !== undefined) pr.body = flags.body;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(pr.url + "\n");
  process.exit(0);
}

fail("gh stand-in: unsupported command: " + process.argv.slice(2).join(" "), 1);
`;

export function createGhStandIn(): GhStandIn {
  const binDir = mkdtempSync(join(tmpdir(), "gh-stand-in-"));
  const command = join(binDir, "gh");
  const statePath = join(binDir, "state.json");
  const read = (): StandInState => JSON.parse(readFileSync(statePath, "utf-8")) as StandInState;
  const write = (state: StandInState): void => {
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  };

  writeFileSync(command, SCRIPT, { mode: 0o755 });
  write({ mode: "signed-in", refusal: null, pullRequests: [] });

  return {
    command,
    binDir,
    setMode: (mode) => write({ ...read(), mode }),
    refuseCreate: (message) => write({ ...read(), refusal: message }),
    pullRequests: () => read().pullRequests,
  };
}
