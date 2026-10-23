import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { allRuns } from "./runs.js";
import { readBacklog, itemTask, type BacklogItem } from "../backlog.js";
import { ledgerPath, readItemLedger } from "../item-ledger.js";
import { taskIntent } from "../task-list.js";
import { inspectPack, BUILT_IN_PACKS, type Pack, type PackProblem } from "../packs/manifest.js";
import { FIXTURES, readFixtures } from "../packs/pack-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { git } from "../git-exec.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { Refusal } from "./failures.js";
import { approveCommand } from "./backlog-commands.js";
import { reviewCommand } from "./review-command.js";
import { runCommand } from "./run-command.js";
import { plainReporter } from "./report.js";

export const WEAKENED_TESTS = "it removed, changed or skipped tests";
export const CHECK_FAILED = "its check did not pass";

export interface PackCheckRun {
  /** The titles the find added ideas for, in the order it added them. */
  found: string[];
  /** The titles whose idea's change passed its check. */
  fixed: string[];
  /** The titles whose idea's cheat was refused, and why. */
  refused: { title: string; why: string }[];
  /** The find that ran, by its full name, such as `moves:look`. */
  find: string;
  /** Each found title to the full name of the workflow its idea names, such as `moves:code`; a title whose idea names none is absent. */
  workflowOf: Record<string, string>;
}

/** The problem with an act workflow that no idea reaches: the check never ran it, so it proved nothing about it. */
export const unreachedAct = (subject: string, workflow: string): string => `${subject} added no idea for the act workflow "${workflow}", so the check never ran it`;

/**
 * The words a pack's problems are named in. A `delivery.pack/2` pack keeps the words it always had; a
 * `delivery.pack/3` pack is named by its own find and workflows.
 */
function runWords(pack: Pack): { find: string; acts: string; change(title: string, workflow: string | undefined): string; cheat(title: string, workflow: string | undefined): string } {
  if (pack.schema === "delivery.pack/2") {
    return {
      find: "the scripted review",
      acts: "the scripted fixes",
      change: (title) => `the scripted fix for "${title}"`,
      cheat: (title) => `the scripted cheat for "${title}"`,
    };
  }
  const under = (workflow: string | undefined): string => (workflow === undefined ? "" : ` under ${workflow}`);
  return {
    find: `the scripted find ${pack.find}`,
    acts: "the scripted acts",
    change: (title, workflow) => `the scripted change for "${title}"${under(workflow)}`,
    cheat: (title, workflow) => `the scripted cheat for "${title}"${under(workflow)}`,
  };
}

/** What checking a pack showed: every problem with it, and what its scripted run did. */
export interface PackCheck {
  ready: boolean;
  pack: { name: string; version: string; hash: string } | null;
  problems: PackProblem[];
  /** Null when the pack could not be run at all. */
  run: PackCheckRun | null;
  /** Always false: every reply came from the pack's fixtures. */
  sentToAgent: false;
}

/**
 * `env` cut to the one thing the pack's own fixture code needs from the
 * caller's environment to run at all (`PATH`, to find a shell and its tools),
 * plus a scratch `HOME` in place of the caller's own: every secret the
 * caller's environment carries, credentials included, stays out of a pack's
 * code, trusted or not.
 */
export function sandboxedEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  const sandboxed: NodeJS.ProcessEnv = { HOME: home };
  if (env.PATH !== undefined) sandboxed.PATH = env.PATH;
  return sandboxed;
}

/** Thrown by `checkPack` when `confirm` declines to run a validated pack's fixtures. */
export class NotTrusted extends Error {
  constructor() {
    super("Declined to run this pack's fixtures.");
    this.name = "NotTrusted";
  }
}

/**
 * Check a pack the way an author needs it checked: every problem with its manifest and fixtures,
 * named by file and field; then, when there are none, its fixtures run end to end exactly as
 * `delivery review`, `delivery approve --all` and `delivery run --sources` would run them, with every
 * agent reply scripted by the fixtures. Nothing is sent to a real agent, no credentials are passed on,
 * and nothing is written into the pack's folder.
 *
 * `confirm`, when given, is asked exactly once, after the manifest and fixtures are known to be
 * valid and before any of the pack's own code runs — never for a pack that was going to be
 * rejected anyway. Declining throws `NotTrusted`. Leaving it unset (the default for a pack's own
 * test suite, which has no one to ask) runs the fixtures outright: `checkPack` itself asks no
 * questions unless told to.
 */
export async function checkPack(dir: string, { env = process.env, confirm }: { env?: NodeJS.ProcessEnv; confirm?: () => Promise<boolean> } = {}): Promise<PackCheck> {
  const [inspected, read] = await Promise.all([inspectPack(dir), readFixtures(dir)]);
  const pack = inspected.ok ? { name: inspected.pack.manifest.name, version: inspected.pack.manifest.version, hash: inspected.pack.hash } : null;
  const problems = [...(inspected.ok ? [] : inspected.problems), ...(read.ok ? [] : read.problems)];
  if (!inspected.ok || !read.ok) return { ready: false, pack, problems, run: null, sentToAgent: false };
  if (confirm !== undefined && !(await confirm())) throw new NotTrusted();
  const { fixtures } = read;
  const loaded = inspected.pack;
  const words = runWords(loaded);
  const expectFile = join(dir, FIXTURES.expect);
  const fixesFile = join(dir, FIXTURES.fixes);

  const scratch = await mkdtemp(join(tmpdir(), "delivery-pack-check-"));
  const repo = initTempRepo("delivery-pack-check-project-", fixtures.project);
  try {
    // Copied out, because claude-mock writes its journal beside its script.
    const reviewScript = join(scratch, "review.json");
    const fixesScript = join(scratch, "fixes.json");
    const home = join(scratch, "home");
    await Promise.all([writeFile(reviewScript, fixtures.reviewScript), writeFile(fixesScript, fixtures.fixesScript), mkdir(home, { recursive: true })]);
    const quiet = (): void => undefined;
    const ctxWith = (script: string): CommandContext => ({
      cwd: repo,
      env: { ...sandboxedEnv(env, home), XDG_STATE_HOME: join(scratch, "state"), [TEST_MOCK_SCRIPT]: script },
      colour: false,
      json: false,
      interactive: false,
      stdin: Readable.from([]),
      writeLine: quiet,
      report: plainReporter(quiet, false),
    });
    const failed = (problem: PackProblem, run: PackCheckRun | null = null): PackCheck => ({ ready: false, pack, problems: [problem], run, sentToAgent: false });

    // A pack of the author's own is used the way a project uses one: listed under `packs`, committed with the project.
    const builtIn = resolve(dir).startsWith(resolve(BUILT_IN_PACKS));
    if (!builtIn) {
      await writeFile(join(repo, "delivery.config.json"), JSON.stringify({ packs: [resolve(dir)] }));
      await git(repo, ["add", "delivery.config.json"]);
      await git(repo, ["commit", "-q", "-m", "Use the pack under check"]);
    }
    // A built-in pack is named; one of the author's is a path, which `delivery review` reads from the folder itself.
    const packRef = builtIn ? inspected.pack.manifest.name : resolve(dir);
    try {
      await reviewCommand(packRef, undefined, {}, ctxWith(reviewScript));
    } catch (err) {
      if (err instanceof Refusal) return failed({ file: join(dir, FIXTURES.review), field: null, message: `${words.find} could not be used: ${err.message}` });
      throw err;
    }
    const ideas = (await readBacklog(repo, { at: "HEAD" })).items.filter((item) => item.status === "idea");
    const titleOf = (file: string): string => taskIntent(itemTask(ideas.find((item) => item.file === file) as BacklogItem));
    const titles = ideas.map((item) => titleOf(item.file));
    const workflowOf: Record<string, string> = {};
    for (const item of ideas) if (item.workflow !== undefined) workflowOf[titleOf(item.file)] = item.workflow;
    const run: PackCheckRun = { found: titles, fixed: [], refused: [], find: loaded.find, workflowOf };
    const { found, fixed, refused } = fixtures.expect;
    const notFound = found.flatMap((title, index): PackProblem[] => (titles.includes(title) ? [] : [{ file: expectFile, field: `found.${index}`, message: `${words.find} did not add "${title}"` }]));
    const unexpected = titles.filter((title) => !found.includes(title)).map((title): PackProblem => ({ file: expectFile, field: "found", message: `${words.find} also added "${title}", which "found" does not list` }));
    if (notFound.length + unexpected.length > 0) return { ready: false, pack, problems: [...notFound, ...unexpected], run, sentToAgent: false };

    // Every act the pack offers must be reached by an idea, or the check would prove nothing about it.
    const reached = new Set(Object.values(workflowOf));
    const unreached = Object.entries(loaded.manifest.workflows)
      .filter(([, workflow]) => workflow.kind === "act")
      .map(([local]) => `${loaded.manifest.name}:${local}`)
      .filter((workflow) => !reached.has(workflow));
    if (unreached.length > 0) {
      return { ready: false, pack, problems: unreached.map((workflow): PackProblem => ({ file: join(dir, FIXTURES.review), field: null, message: unreachedAct(words.find, workflow) })), run, sentToAgent: false };
    }

    const fixesCtx = ctxWith(fixesScript);
    try {
      await approveCommand([], { all: true }, fixesCtx);
      await runCommand({ sources: true, max: String(ideas.length) }, fixesCtx);
    } catch (err) {
      if (err instanceof Refusal) return failed({ file: fixesFile, field: null, message: `${words.acts} could not run: ${err.message}` }, run);
      throw err;
    }
    const ledger = await readItemLedger(ledgerPath(repo, fixesCtx.env));
    const records = await allRuns(repo);
    const stateOf = (title: string) => ledger.get(`backlog:${ideas[titles.indexOf(title)]?.file ?? ""}`);
    const weakened = (title: string): boolean => {
      const record = records.find((r) => r.runId === stateOf(title)?.lastRunId);
      return (record?.caseFile.history ?? []).some((entry) => entry.t === "gate" && entry.newFailures.some((f) => f.id.startsWith("guard:")));
    };
    const runProblems: PackProblem[] = [];
    for (const title of fixed) {
      const lastClass = stateOf(title)?.lastClass;
      // Held counts as passing: the fix is finished and checked, and waits only for the owner.
      if (lastClass === "delivered" || lastClass === "held") run.fixed.push(title);
      else runProblems.push({ file: fixesFile, field: null, message: `${words.change(title, workflowOf[title])} did not pass its check: it ended ${lastClass ?? "without running"}` });
    }
    for (const title of refused) {
      const lastClass = stateOf(title)?.lastClass;
      if (lastClass !== "delivered" && lastClass !== "held" && lastClass !== undefined && lastClass !== null) run.refused.push({ title, why: weakened(title) ? WEAKENED_TESTS : CHECK_FAILED });
      else runProblems.push({ file: fixesFile, field: null, message: `${words.cheat(title, workflowOf[title])} was not refused: it ended ${lastClass ?? "without running"}` });
    }
    return { ready: runProblems.length === 0, pack, problems: runProblems, run, sentToAgent: false };
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
}
