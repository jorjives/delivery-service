import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanGitEnv } from "./git-env.js";

/**
 * Test and demo support: a stand-in for the GitHub CLI, so the open-pr closer
 * can be exercised with no network and no GitHub account. It is the same
 * swap-the-executable approach claude-mock takes for the agent: a real
 * executable named `gh`, honouring the argv and output of the commands the
 * closer uses (`gh api graphql` answering the aliased exact-head `pullRequests(headRefName:…)` lookup, `gh pr create`,
 * `gh pr edit --body` and `--base`, `gh pr close --comment`; a test closes one as the owner would with `closePullRequest`; a test merges a pull request with `merge`, which merges it on origin by squash, rebase or merge
 * commit as GitHub would, or marks it merged with `mergePullRequest`) and the issue commands the github
 * work source uses (`gh api graphql` listing issues by label, `gh issue create|close|comment|edit`, `gh label create`),
 * with their failure messages and exit codes copied from gh 2.94 itself. It refuses any query that searches: search
 * lags, and nothing may depend on it. Every invocation's argv is logged, so a test can count requests.
 */

export type GhStandInMode = "signed-in" | "signed-out" | "expired" | "forbidden" | "offline";

export interface StandInPullRequest {
  url: string;
  head: string;
  base: string;
  title: string;
  body: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  /** The head commit the pull request merged at; set by `mergePullRequest`. */
  headRefOid?: string;
  /** The base's commit the merge made; set by `merge` or `mergePullRequest`, answered as `mergeCommit{oid}`. */
  mergeCommit?: string;
  /** True when the head branch lives in a fork rather than this repository; answered as `isCrossRepository`. */
  fork?: boolean;
  /** What `gh pr close --comment` left on it. */
  comments?: string[];
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
  /** Make every later `gh pr create` fail with this message, as GitHub refusing the pull request would; null clears it. */
  refuseCreate(message: string | null): void;
  pullRequests(): StandInPullRequest[];
  /** Open a pull request whose head branch lives in a fork, as a stranger's would; returns its URL. */
  openFromFork(head: string, base: string): string;
  /** The argv of every gh invocation so far, in order. */
  calls(): string[][];
  /** Make every later `gh pr close` fail with this message, as GitHub refusing the close would; null clears it. */
  refuseClose(message: string | null): void;
  /** Close a pull request without merging it, as the owner closing it on GitHub would. */
  closePullRequest(url: string): void;
  /** Mark a pull request merged at this head commit, as merging it on GitHub would. Moves no branch: merge into origin yourself. */
  mergePullRequest(url: string, headRefOid: string, mergeCommit?: string): void;
  /**
   * Merge a pull request on `origin` by `method`, as GitHub would, and mark it merged. The head is read from origin's head
   * branch now. Pushes the base and `refs/pull/<number>/head`. Returns the base's new commit.
   */
  merge(url: string, method: "squash" | "rebase" | "merge", origin: string): string;
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
  closeRefusal?: string | null;
  pullRequests: StandInPullRequest[];
  issues: StandInIssue[];
  labels: string[];
  refuseLabels?: boolean;
  calls?: string[][];
}

// CommonJS, because an extensionless file outside any package is loaded as
// CommonJS. No template interpolation or backticks inside: String.raw keeps
// every character verbatim.
const SCRIPT = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const statePath = path.join(__dirname, "state.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
state.calls = (state.calls || []).concat([process.argv.slice(2)]);
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

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

// True when origin holds both refs and the head is an ancestor of, or equal to, the base: the state GitHub refuses a pull request for.
function headAncestorOfBase(head, base) {
  const headSha = remoteHead(head);
  const baseSha = remoteHead(base);
  if (headSha === "" || baseSha === "") return false;
  try {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    execFileSync("git", ["-C", origin, "merge-base", "--is-ancestor", headSha, baseSha], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (group === "pr" && command === "create") {
  if (state.mode === "forbidden") {
    fail("pull request create failed: GraphQL: operator does not have the correct permissions to execute 'CreatePullRequest' (createPullRequest)", 1);
  }
  if (state.refusal) fail(state.refusal, 1);
  // GitHub refuses a head with nothing beyond its base. Only checked when origin holds both refs, so a head never pushed is created as before.
  if (headAncestorOfBase(flags.head, flags.base)) fail("No commits between " + flags.base + " and " + flags.head, 1);
  const url = "https://github.com/example/project/pull/" + (state.pullRequests.length + 1);
  state.pullRequests.push({ url, head: flags.head, base: flags.base, title: flags.title, body: flags.body, state: "OPEN" });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(url + "\n");
  process.exit(0);
}

if (group === "pr" && command === "edit") {
  const pr = state.pullRequests.find((p) => p.url === rest[0]);
  if (!pr) fail("no pull requests found for " + rest[0], 1);
  if (flags.body !== undefined) pr.body = flags.body;
  if (flags.base !== undefined) pr.base = flags.base;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stdout.write(pr.url + "\n");
  process.exit(0);
}

if (group === "pr" && command === "close") {
  if (state.closeRefusal) fail(state.closeRefusal, 1);
  const pr = state.pullRequests.find((p) => p.url === rest[0]);
  if (!pr) fail("no pull requests found for " + rest[0], 1);
  if (pr.state === "CLOSED") {
    process.stderr.write("! Pull request " + pr.url.replace(/^.*\/pull\//, "#") + " (" + pr.title + ") is already closed\n");
    process.exit(0);
  }
  pr.state = "CLOSED";
  if (flags.comment !== undefined) pr.comments = (pr.comments || []).concat([flags.comment]);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  process.stderr.write("✓ Closed pull request " + pr.url.replace(/^.*\/pull\//, "#") + " (" + pr.title + ")\n");
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

// The head commit GitHub reports for a branch still on origin: what git ls-remote says, empty when absent.
function remoteHead(head) {
  try {
    const listed = execFileSync("git", ["ls-remote", "origin", "refs/heads/" + head], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return listed.split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

if (group === "api" && command === "graphql") {
  const query = fieldsOf(rest).query || "";
  if (query.includes("search(")) {
    fail("GraphQL: this stand-in does not answer search, which lags behind a pull request just opened", 1);
  }
  if (query.includes("pullRequests(")) {
    // One alias per exact head: p<i> lists the pull requests whose head is the value of h<i>, in the states its query names.
    const repository = {};
    for (const alias of query.matchAll(/\bp(\d+):pullRequests\(headRefName:\$h\1,states:\[([A-Z,]+)\]/g)) {
      const head = fieldsOf(rest)["h" + alias[1]];
      const wanted = alias[2].split(",");
      const nodes = state.pullRequests
        .filter((pr) => pr.head === head && wanted.includes(pr.state || "OPEN"))
        .map((pr) => ({
          url: pr.url, state: pr.state || "OPEN", headRefName: pr.head, headRefOid: pr.headRefOid || remoteHead(head), baseRefName: pr.base,
          isCrossRepository: pr.fork === true, mergeCommit: pr.mergeCommit ? { oid: pr.mergeCommit } : null,
        }));
      repository["p" + alias[1]] = { nodes };
    }
    process.stdout.write(JSON.stringify({ data: { repository } }) + "\n");
    process.exit(0);
  }
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

/** Run git in `cwd` with a fixed identity, so a merge made here is the same on any machine. */
function gitIn(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Owner", "-c", "user.email=owner@example.invalid", ...args], { cwd, encoding: "utf-8", env: cleanGitEnv() }).trim();
}

export function createGhStandIn(): GhStandIn {
  const binDir = mkdtempSync(join(tmpdir(), "gh-stand-in-"));
  const command = join(binDir, "gh");
  const statePath = join(binDir, "state.json");
  const read = (): StandInState => JSON.parse(readFileSync(statePath, "utf-8")) as StandInState;
  const write = (state: StandInState): void => {
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  };

  const mergePullRequest = (url: string, headRefOid: string, mergeCommit?: string): void => {
    const state = read();
    const pr = state.pullRequests.find((p) => p.url === url);
    if (!pr) throw new Error(`no pull request ${url}`);
    pr.state = "MERGED";
    pr.headRefOid = headRefOid;
    if (mergeCommit !== undefined) pr.mergeCommit = mergeCommit;
    write(state);
  };

  writeFileSync(command, SCRIPT, { mode: 0o755 });
  write({ mode: "signed-in", refusal: null, pullRequests: [], issues: [], labels: ["delivery"] });

  return {
    command,
    binDir,
    setMode: (mode) => write({ ...read(), mode }),
    refuseCreate: (message) => write({ ...read(), refusal: message }),
    refuseClose: (message) => write({ ...read(), closeRefusal: message }),
    pullRequests: () => read().pullRequests,
    openFromFork: (head, base) => {
      const state = read();
      const url = "https://github.com/example/project/pull/" + (state.pullRequests.length + 1);
      state.pullRequests.push({ url, head, base, title: "T", body: "B", state: "OPEN", fork: true });
      write(state);
      return url;
    },
    calls: () => read().calls ?? [],
    closePullRequest: (url) => {
      const state = read();
      const pr = state.pullRequests.find((p) => p.url === url);
      if (!pr) throw new Error(`no pull request ${url}`);
      pr.state = "CLOSED";
      write(state);
    },
    mergePullRequest,
    merge: (url, method, origin) => {
      const pr = read().pullRequests.find((p) => p.url === url);
      if (!pr) throw new Error(`no pull request ${url}`);
      const number = /\/pull\/(\d+)$/.exec(url)?.[1];
      if (number === undefined) throw new Error(`no pull request number in ${url}`);
      const headSha = gitIn(origin, ["rev-parse", "--verify", `refs/heads/${pr.head}`]);
      const clone = mkdtempSync(join(tmpdir(), "gh-merge-"));
      try {
        gitIn(tmpdir(), ["clone", "-q", origin, clone]);
        gitIn(clone, ["checkout", "-q", "-B", pr.base, `refs/remotes/origin/${pr.base}`]);
        if (method === "squash") {
          gitIn(clone, ["merge", "-q", "--squash", headSha]);
          gitIn(clone, ["commit", "-q", "-m", `${pr.title} (#${number})`]);
        } else if (method === "rebase") {
          gitIn(clone, ["checkout", "-q", "--detach", headSha]);
          // GitHub replays every commit, even one already on the base, so a rebase-merge never keeps the head's own commits.
          gitIn(clone, ["rebase", "-q", "--force-rebase", pr.base]);
          gitIn(clone, ["checkout", "-q", "-B", pr.base]);
        } else {
          gitIn(clone, ["merge", "-q", "--no-ff", "-m", `Merge pull request #${number} from ${pr.head}`, headSha]);
        }
        const mergeCommit = gitIn(clone, ["rev-parse", "HEAD"]);
        gitIn(clone, ["push", "-q", "origin", `HEAD:refs/heads/${pr.base}`, `${headSha}:refs/pull/${number}/head`]);
        mergePullRequest(url, headSha, mergeCommit);
        return mergeCommit;
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    },
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
