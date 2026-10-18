import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test and demo support: a stand-in for the GitHub CLI, so the open-pr closer
 * can be exercised with no network and no GitHub account. It is the same
 * swap-the-executable approach claude-mock takes for the agent: a real
 * executable named `gh`, honouring the argv and output of the commands the
 * closer uses (`gh pr list --json url`, `gh pr create`, `gh pr edit --body`) and
 * the issue commands the github work source uses (`gh api graphql` listing
 * issues by label, `gh issue create|close|comment|edit`, `gh label create`), with
 * their failure messages and exit codes copied from gh 2.94 itself.
 */

export type GhStandInMode = "signed-in" | "signed-out" | "expired" | "forbidden" | "offline";

export interface StandInPullRequest {
  url: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export type StandInEvent = { type: "labeled"; label: string; at: string } | { type: "renamed"; at: string };

export interface StandInIssue {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  labels: string[];
  createdAt: string;
  lastEditedAt: string | null;
  events: StandInEvent[];
  comments: string[];
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
  openIssue(issue: { title: string; body: string; labels?: string[]; at?: string }): number;
  labelIssue(number: number, label: string, at: string): void;
  editIssue(number: number, change: { title?: string; body?: string }, at: string): void;
  issues(): StandInIssue[];
  repoLabels(): string[];
  /** From then on `label create` and `issue edit` fail with 403, as for an account that can read but not triage. */
  refuseLabels(): void;
}

interface StandInState {
  mode: GhStandInMode;
  refusal: string | null;
  pullRequests: StandInPullRequest[];
  issues: StandInIssue[];
  labels: string[];
  refuseLabels?: boolean;
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

// gh api's -f/-F (and --raw-field/--field) take "key=value" as the next argument.
function fieldsOf(args) {
  const fields = {};
  for (let i = 0; i < args.length; i++) {
    if (["-f", "-F", "--raw-field", "--field"].includes(args[i])) {
      const pair = args[++i] || "";
      const eq = pair.indexOf("=");
      fields[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return fields;
}
function save() { fs.writeFileSync(statePath, JSON.stringify(state, null, 2)); }
function issueAt(n) {
  const issue = state.issues.find((i) => String(i.number) === String(n));
  if (!issue) fail("GraphQL: Could not resolve to an issue or pull request with the number of " + n + ". (repository.issue)", 1);
  return issue;
}

if (group === "api" && command === "graphql") {
  const label = fieldsOf(rest).label;
  const nodes = state.issues
    .filter((i) => i.state === "OPEN" && i.labels.includes(label))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.number - b.number))
    .map((i) => ({
      number: i.number, title: i.title, body: i.body, createdAt: i.createdAt, lastEditedAt: i.lastEditedAt,
      labels: { nodes: i.labels.map((name) => ({ name })) },
      timelineItems: { nodes: i.events.map((e) => (e.type === "labeled" ? { __typename: "LabeledEvent", createdAt: e.at, label: { name: e.label } } : { __typename: "RenamedTitleEvent", createdAt: e.at })) },
    }));
  process.stdout.write(JSON.stringify({ data: { repository: { issues: { nodes } } } }) + "\n");
  process.exit(0);
}

if (group === "issue" && command === "create") {
  const number = state.issues.length + 1;
  const at = new Date().toISOString();
  state.issues.push({ number, title: flags.title, body: flags.body, state: "OPEN", labels: [], createdAt: at, lastEditedAt: null, events: [], comments: [] });
  save();
  process.stdout.write("https://github.com/example/project/issues/" + number + "\n");
  process.exit(0);
}

if (group === "issue" && command === "close") {
  const issue = issueAt(rest[0]);
  if (issue.state === "CLOSED") {
    process.stderr.write("! Issue #" + issue.number + " (" + issue.title + ") is already closed\n");
    process.exit(0);
  }
  if (flags.comment !== undefined) issue.comments.push(flags.comment);
  issue.state = "CLOSED";
  save();
  process.exit(0);
}

if (group === "issue" && command === "comment") {
  const issue = issueAt(rest[0]);
  issue.comments.push(flags.body);
  save();
  process.stdout.write("https://github.com/example/project/issues/" + issue.number + "#issuecomment-" + issue.comments.length + "\n");
  process.exit(0);
}

if (state.refuseLabels && ((group === "issue" && command === "edit") || (group === "label" && command === "create"))) {
  fail("HTTP 403: Resource not accessible by integration (https://api.github.com/graphql)", 1);
}

if (group === "issue" && command === "edit") {
  const issue = issueAt(rest[0]);
  const add = flags["add-label"];
  const remove = flags["remove-label"];
  if (add !== undefined) {
    if (!state.labels.includes(add)) fail("'" + add + "' not found", 1);
    if (!issue.labels.includes(add)) issue.labels.push(add);
  }
  if (remove !== undefined) issue.labels = issue.labels.filter((l) => l !== remove);
  save();
  process.stdout.write("https://github.com/example/project/issues/" + issue.number + "\n");
  process.exit(0);
}

if (group === "label" && command === "create") {
  const name = rest[0];
  if (state.labels.includes(name) && !rest.includes("--force")) fail("label with name \"" + name + "\" already exists; use --force to update its color and description", 1);
  if (!state.labels.includes(name)) state.labels.push(name);
  save();
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
  write({ mode: "signed-in", refusal: null, pullRequests: [], issues: [], labels: ["delivery"] });

  return {
    command,
    binDir,
    setMode: (mode) => write({ ...read(), mode }),
    refuseCreate: (message) => write({ ...read(), refusal: message }),
    pullRequests: () => read().pullRequests,
    openIssue: ({ title, body, labels = [], at = new Date().toISOString() }) => {
      const state = read();
      const number = state.issues.length + 1;
      state.issues.push({ number, title, body, state: "OPEN", labels: [...labels], createdAt: at, lastEditedAt: null, events: labels.map((label) => ({ type: "labeled" as const, label, at })), comments: [] });
      state.labels = [...new Set([...state.labels, ...labels])];
      write(state);
      return number;
    },
    labelIssue: (number, label, at) => {
      const state = read();
      const issue = state.issues.find((i) => i.number === number);
      if (!issue) throw new Error(`no issue #${number}`);
      if (!issue.labels.includes(label)) issue.labels.push(label);
      issue.events.push({ type: "labeled", label, at });
      state.labels = [...new Set([...state.labels, label])];
      write(state);
    },
    editIssue: (number, { title, body }, at) => {
      const state = read();
      const issue = state.issues.find((i) => i.number === number);
      if (!issue) throw new Error(`no issue #${number}`);
      if (title !== undefined) { issue.title = title; issue.events.push({ type: "renamed", at }); }
      if (body !== undefined) { issue.body = body; issue.lastEditedAt = at; }
      write(state);
    },
    issues: () => read().issues,
    repoLabels: () => read().labels,
    refuseLabels: () => write({ ...read(), refuseLabels: true }),
  };
}
