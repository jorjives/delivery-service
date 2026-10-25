import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { vi } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import { ledgerPath } from "../item-ledger.js";
import { create, setBaseBranch, setOutcome, writeRef } from "../case-file.js";
import { writeMockScript, type MockScript } from "../mock-script.js";
import { signedOut } from "../mock-session.js";
import { resolveCloser } from "../resolve-closer.js";
import { deterministicRouter } from "../router.js";
import { advance } from "../surface.js";
import { fakeAgentPort } from "../agent-port-double.js";
import type { AgentContext, Terminus } from "../ports.js";
import { appendLine } from "../journal.js";
import { createRunFile } from "../run-file.js";
import { RunEntry, type AgentOptions, type CaseFileOutcome, type FenceRecord, type GateRef, type RunHeader, type WorkItemRef } from "../schema.js";
import { TEST_BWRAP } from "../fence.js";
import type { EscalationPacket } from "../triage-role-config.js";
import type { ExitOnInterrupt } from "./context.js";
import { runCli } from "./program.js";
import { prepareRunDir, runIdFor, runPlace, runsRoot, supervisedPlace } from "../run-location.js";
import { DEFAULT_CLOSER } from "./settings.js";
import { TEST_SYSTEMCTL } from "./schedule/systemd.js";
import { TEST_PLATFORM } from "./schedule/backend.js";
import { initTempRepo } from "../temp-repo.js";

export { runsRoot };

/** Test support: the scratch project the command tests run against, and the task they give it. */
/** Runs `body` with `TMPDIR` pointing at a private empty folder, so folders made by other test files running at once cannot show in a count of this one's. */
export const withPrivateTmpdir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const own = mkdtempSync(join(tmpdir(), "private-tmp-"));
  vi.stubEnv("TMPDIR", own);
  try {
    await body(own);
  } finally {
    vi.unstubAllEnvs();
    rmSync(own, { recursive: true, force: true });
  }
};

export const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });
export const TASK = "add a function that says hello to a name, with a test";
export const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** Test support: a `/3` pack in folder `moves-pack/` that finds old code and moves it, with its prompt files beside it. */
export const MOVES_FILES: Record<string, string> = {
  "moves-pack/pack.json": JSON.stringify({
    schema: "delivery.pack/3",
    name: "moves",
    version: "1.0.0",
    title: "Move off old code",
    summary: "Finds places that still use old code, and moves them.",
    workflows: {
      look: { kind: "find", prompt: "look.md", ideasFor: ["code", "tests"] },
      code: { kind: "act", summary: "Code that still calls the old code.", prompt: "code.md", guards: { add: ["tests-unchanged"] }, hold: { atOrAbove: "high" } },
      tests: { kind: "act", summary: "A test file that still calls the old code.", prompt: "tests.md" },
    },
  }),
  "moves-pack/look.md": "# Look for old code\n",
  "moves-pack/code.md": "# Move code\n",
  "moves-pack/tests.md": "# Move tests\n",
};

/** What a `/3` find-and-act test pack is made of: its folder, name, words, settings, the act's summary and its two prompts. */
interface FindAndActPack {
  folder: string;
  name: string;
  title: string;
  summary: string;
  settings: Record<string, unknown>;
  fixSummary: string;
  prompts: { look: string; fix: string };
}

/** Private: writes a `/3` pack with a find `look` offering an act `fix`, under `repo`, as the test packs below are written. */
function writeFindAndActPack(repo: string, pack: FindAndActPack): void {
  const dir = join(repo, pack.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pack.json"),
    JSON.stringify({
      schema: "delivery.pack/3",
      name: pack.name,
      version: "1.0.0",
      title: pack.title,
      summary: pack.summary,
      settings: pack.settings,
      workflows: {
        look: { kind: "find", prompt: "look.md", ideasFor: ["fix"] },
        fix: { kind: "act", summary: pack.fixSummary, prompt: "fix.md" },
      },
    }),
  );
  writeFileSync(join(dir, "look.md"), pack.prompts.look);
  writeFileSync(join(dir, "fix.md"), pack.prompts.fix);
}

/**
 * Test support: a `/3` pack named `needy` in folder `needy-pack/` under `repo`, with a find `look` offering an act `fix`, and a
 * required setting `docs-folder` with no default that both prompts use. A project lists it under `packs` as `needy-pack`.
 */
export function writeNeedyPack(repo: string): void {
  writeFindAndActPack(repo, {
    folder: "needy-pack",
    name: "needy",
    title: "Needy",
    summary: "Needs a setting.",
    settings: { "docs-folder": { type: "path", summary: "The folder that holds your documentation." } },
    fixSummary: "Documentation that is out of date.",
    prompts: { look: "# Look\n\nRead {{settings.docs-folder}}.\n", fix: "# Fix\n\nFix {{settings.docs-folder}}.\n" },
  });
}

/**
 * Test support: a `/3` pack named `guide` in folder `guide-pack/` under `repo`, with a find `look` offering an act `fix`. Its
 * required setting `docs-folder` has no default, and `tone` defaults to `plain English`. A project lists it as `guide-pack`.
 */
export function writeGuidePack(repo: string): void {
  writeFindAndActPack(repo, {
    folder: "guide-pack",
    name: "guide",
    title: "Guide",
    summary: "Keeps your documentation up to date.",
    settings: {
      "docs-folder": { type: "path", summary: "The folder that holds your documentation." },
      tone: { type: "text", summary: "How the pages should read.", default: "plain English" },
    },
    fixSummary: "A page that is out of date.",
    prompts: { look: "# Look\n\nRead {{settings.docs-folder}}.\n", fix: "# Fix\n\nFix {{settings.docs-folder}} in {{settings.tone}}.\n" },
  });
}

/** Test support: a `delivery.pack/2` pack in folder `folder`, named after it without its `-pack` ending, with a scan and a fix prompt beside it. */
export const V2_FILES = (folder: string): Record<string, string> => ({
  [`${folder}/pack.json`]: JSON.stringify({
    schema: "delivery.pack/2",
    name: folder.replace(/-pack$/, ""),
    version: "1.0.0",
    title: "Old",
    summary: "Old.",
    scan: { prompt: "scan.md" },
    fix: { prompt: "fix.md" },
  }),
  [`${folder}/scan.md`]: "# Scan\n",
  [`${folder}/fix.md`]: "# Fix\n",
});

/** Test support: a project that lists the `/3` moves pack, with `files` overriding or adding any of its files. */
export const movesProject = (files: Record<string, string> = {}): string =>
  initTempRepo("moves-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ packs: ["moves-pack"] }), ...MOVES_FILES, ...files });

/** A whole run, agent sessions and git included, needs longer than vitest's default. */
export const RUN_TIMEOUT = 60_000;

/** A scripted agent that does the task and says so. */
export const completes: MockScript = {
  expectations: [
    {
      effects: [{ write: { path: "hello.js", content: "export const hello = (name) => `hello ${name}`;\n" } }],
      json: { status: "completed", rationale: "added hello.js" },
    },
  ],
};

/** A scripted agent whose every session is stopped by the API's rate limit, in the API's own words. */
export const rateLimited: MockScript = {
  expectations: [
    { fail: { message: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization"}}' } },
  ],
};

/** A claude-mock script file, for the contributor test seam. */
export async function scriptFile(script: MockScript): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "command-script-")), "mock.json");
  await writeMockScript(path, script);
  return path;
}

export interface DeliveryIo {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  /** What a person types at the command's questions. Given any, standard input reports itself as a terminal. */
  answers?: string[];
  /** What a stop (Ctrl-C) does, as `main.ts` wires it for the real process. Absent: nothing listens, as in every test that does not ask. */
  exitOnInterrupt?: ExitOnInterrupt;
}

/** A `bwrap` that does not exist: the fence is absent in every command test, whatever the machine. */
export const NO_BWRAP = join(tmpdir(), "delivery-no-bwrap", "bwrap");

/** A `systemctl` that does not exist: no command test reaches the contributor's own systemd unless it names a stand-in. */
export const NO_SYSTEMCTL_STAND_IN = join(tmpdir(), "delivery-no-systemctl", "systemctl");

/**
 * Test support: run `delivery <args>` in process, capturing what it prints. Working copies go under a scratch state
 * folder unless the caller names one. The real runtime is signed out unless the caller names a config folder, so a
 * test that forgets its scripted agent is refused at preflight instead of spending the contributor's own login.
 * The fence is absent unless the caller names a `bwrap`, so the command's output is the same on every machine.
 */
export async function delivery(args: string[], { cwd, env = {}, isTTY = false, answers = [], exitOnInterrupt }: DeliveryIo) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv: args,
    cwd,
    env: {
      ...signedOut(process.env),
      XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "command-state-")),
      XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "command-config-")),
      [TEST_BWRAP]: NO_BWRAP,
      [TEST_SYSTEMCTL]: NO_SYSTEMCTL_STAND_IN,
      [TEST_PLATFORM]: "linux",
      ...env,
    },
    stdin: Object.assign(Readable.from(answers.map((answer) => `${answer}\n`)), { isTTY: answers.length > 0 || undefined }),
    stdout: { write: (text: string) => (stdout += text), isTTY },
    stderr: { write: (text: string) => (stderr += text) },
    exitOnInterrupt,
  });
  return { exitCode, stdout, stderr };
}

/** The branch a closing or escalating run names. */
export function branchIn(stdout: string): string {
  const match = /branch (surface\/\S+?)\.?$/m.exec(stdout);
  if (!match?.[1]) throw new Error(`no branch named in:\n${stdout}`);
  return match[1];
}

/** A worker that leaves its change on disk, as the real one does, so the check has something to pass. */
export const writesHello = async (ctx: AgentContext): Promise<Terminus> => {
  await writeFile(join(ctx.worktreePath, "hello.js"), "export const hello = (name) => `hello ${name}`;\n");
  return { status: "completed", rationale: "added hello.js" };
};

/**
 * Test support: a run that was interrupted. Its record is on disk with no
 * outcome, exactly as killing `delivery run` leaves it. The run is driven with
 * the same library the command drives, then stopped after `steps` advances;
 * `worker` is what the agent did before the stop, and rejecting from it is a
 * session that died mid-flight, the one window a clean stop between advances
 * cannot reach. `state` is the state folder the resuming command must also be
 * given, so both processes compute the same place for the working copy.
 */
export async function interruptedRun(
  repo: string,
  state: string,
  {
    task,
    steps,
    worker,
    domain,
    agent,
    fence,
  }: { task: string; steps: number; worker: (ctx: AgentContext) => Promise<Terminus>; domain?: string; agent?: AgentOptions; fence?: FenceRecord },
): Promise<string> {
  const runId = runIdFor(task, new Date());
  const { dir, location } = runPlace(repo, runId, { XDG_STATE_HOME: state });
  await prepareRunDir(repo, dir);
  await create(
    dir,
    {
      surfaceId: runId,
      taskDef: { intent: task },
      gateRef: GATE,
      closerRef: DEFAULT_CLOSER,
      domainPrompt: domain,
      agent,
      ...(fence === undefined ? {} : { fence }),
    },
    DEFAULT_BUDGETS,
  );
  const ports = { agent: fakeAgentPort({ worker }), triage: deterministicRouter, closer: resolveCloser(DEFAULT_CLOSER, repo) };
  for (let step = 0; step < steps; step++) {
    // The interruption is the last advance, so a rejecting worker throws here.
    await advance(dir, location, ports).catch(() => undefined);
  }
  return runId;
}

/** Test support: the packet a stopped run leaves for whoever picks it up, in the shape `src/escalation-packet.ts` builds. */
export const ESCALATION: EscalationPacket = {
  decision:
    "The worker stopped because it judged it lacked authority. Decide whether to grant that authority or take the action yourself.",
  evidence: "the task asks me to delete files I was not given",
  dead_ends: "1. The first attempt rewrote the caller instead of the function.",
  why_now: "The worker reported that it lacks the authority to go on; an authority limit goes straight to a person.",
  references: ["worker-1-0", "triage-1-0"],
};

/**
 * Test support: one run's record on disk, exactly as the run loop leaves it,
 * without paying for a whole run. No `outcome` leaves it unfinished, which is
 * what an interruption leaves behind.
 */
export async function writeRunRecord(
  repoPath: string,
  { runId, task = TASK, outcome, packet, gate = GATE, item }: { runId: string; task?: string; outcome?: CaseFileOutcome; packet?: EscalationPacket; gate?: GateRef; item?: WorkItemRef },
): Promise<string> {
  const dir = join(runsRoot(repoPath), runId);
  await mkdir(dir, { recursive: true });
  await create(dir, { surfaceId: runId, taskDef: { intent: task }, gateRef: gate, closerRef: DEFAULT_CLOSER, ...(item === undefined ? {} : { item }) }, DEFAULT_BUDGETS);
  await setBaseBranch(dir, "main");
  if (outcome) {
    const packetRef = packet === undefined ? undefined : await writeRef(dir, "escalation", packet);
    await setOutcome(dir, { ...outcome, ...(packetRef === undefined ? {} : { packetRef }) });
  }
  return dir;
}

/**
 * Test support: the item ledger on this machine with one backlog item parked, as a run whose agent asked a question
 * leaves it once the question is set aside. `env` is the state folder the command under test is given.
 */
export async function writeParkedItem(repoPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  const path = ledgerPath(repoPath, env);
  await mkdir(dirname(path), { recursive: true });
  const entries = [
    { t: "dispatched", key: "backlog:a.md", runId: "add-a-greeting-20261016T090000Z", intent: "Greet people.", at: "2026-10-16T09:00:00.000Z" },
    { t: "ended", key: "backlog:a.md", runId: "add-a-greeting-20261016T090000Z", class: "decision", question: "Formal?", at: "2026-10-16T09:01:00.000Z" },
    { t: "parked", key: "backlog:a.md", reason: "decision", at: "2026-10-16T09:01:00.000Z" },
  ];
  await writeFile(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
}

/**
 * Test support: a run of several tasks at once, as its record is on disk: the
 * header it started with and the slots it has recorded so far. No outcome, so
 * unfinished, which is what a stopped or killed run leaves behind. Each step is
 * written exactly as given, with the time it names or none, never the time of writing.
 */
export async function writeSupervisedRun(repoPath: string, header: RunHeader, history: RunEntry[] = []): Promise<string> {
  const dir = supervisedPlace(repoPath, header.runId);
  await prepareRunDir(repoPath, dir);
  await createRunFile(dir, header);
  for (const entry of history) await appendLine(join(dir, "log.jsonl"), RunEntry.parse(entry));
  return dir;
}
