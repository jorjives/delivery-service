import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readFindingStates, UNDECIDED, type FixState } from "../packs/fix-state.js";
import { inspectPack, type PackProblem } from "../packs/manifest.js";
import { FIXTURES, readFixtures } from "../packs/pack-fixtures.js";
import { stateWords, UNCONFIRMED_WHY } from "../packs/render.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import type { CommandContext } from "./context.js";
import { Refusal } from "./failures.js";
import { decideCommand, finishedReview } from "./findings-command.js";
import { fixCommand } from "./fix-command.js";
import type { Ask } from "./init.js";
import { plainReporter } from "./report.js";
import { reviewCommand } from "./review-command.js";

export const WEAKENED_TESTS = "it removed, changed or skipped tests";
export const CHECK_FAILED = "its check did not pass";

export interface PackCheckRun {
  /** The titles the scripted review found, in the review's order. */
  found: string[];
  /** The titles whose scripted fix passed its check. */
  fixed: string[];
  /** The titles whose scripted cheat was refused, and why. */
  refused: { title: string; why: string }[];
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

/** A fix that passed its check: merged, or waiting for sign-off because the problem is serious. */
const PASSED: ReadonlySet<FixState> = new Set(["fixed", "held"]);

const nobody = (): Promise<never> => Promise.reject(new Error("the pack check asks no questions"));
const NO_QUESTIONS: Ask = { text: nobody, choose: nobody, confirm: nobody, pick: nobody };

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
 * `delivery review`, `delivery findings approve` and `delivery fix` would run them, with every agent
 * reply scripted by the fixtures. Nothing is sent to a real agent, no credentials are passed on,
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

    try {
      await reviewCommand(dir, undefined, ctxWith(reviewScript), NO_QUESTIONS);
    } catch (err) {
      if (err instanceof Refusal) return failed({ file: join(dir, FIXTURES.review), field: null, message: `the scripted review could not be used: ${err.message}` });
      throw err;
    }
    const review = await finishedReview(repo);
    const titles = review.result.findings.map((finding) => finding.title);
    const run: PackCheckRun = { found: titles, fixed: [], refused: [] };
    const { found, fixed, refused } = fixtures.expect;

    const notFound = found.flatMap((title, index): PackProblem[] => {
      if (titles.includes(title)) return [];
      const placed = review.result.unconfirmed.find((entry) => entry.title === title);
      const why = placed === undefined ? "" : `: it could not be placed in ${FIXTURES.project} (${UNCONFIRMED_WHY[placed.reason]})`;
      return [{ file: expectFile, field: `found.${index}`, message: `the scripted review did not find "${title}"${why}` }];
    });
    const unexpected = titles.filter((title) => !found.includes(title)).map((title): PackProblem => ({ file: expectFile, field: "found", message: `the scripted review also found "${title}", which "found" does not list` }));
    if (notFound.length + unexpected.length > 0) return { ready: false, pack, problems: [...notFound, ...unexpected], run, sentToAgent: false };

    try {
      await decideCommand("approve", [...fixed, ...refused].map((title) => String(titles.indexOf(title) + 1)), {}, ctxWith(fixesScript));
      await fixCommand({}, ctxWith(fixesScript));
    } catch (err) {
      if (err instanceof Refusal) return failed({ file: fixesFile, field: null, message: `the scripted fixes could not run: ${err.message}` }, run);
      throw err;
    }

    const { states } = await readFindingStates(repo, review);
    const at = (title: string) => states[titles.indexOf(title)] ?? UNDECIDED;
    const runProblems: PackProblem[] = [];
    for (const title of fixed) {
      const state = at(title);
      if (PASSED.has(state.state)) run.fixed.push(title);
      else runProblems.push({ file: fixesFile, field: null, message: `the scripted fix for "${title}" did not pass its check: it ended "${stateWords(state)}"` });
    }
    for (const title of refused) {
      const state = at(title);
      const checkFailed = (state.fix?.rounds ?? []).some((round) => round.length > 0);
      if (state.state === "unfixable" && checkFailed) run.refused.push({ title, why: state.refused ? WEAKENED_TESTS : CHECK_FAILED });
      else runProblems.push({ file: fixesFile, field: null, message: `the scripted cheat for "${title}" was not refused: it ended "${stateWords(state)}"` });
    }
    return { ready: runProblems.length === 0, pack, problems: runProblems, run, sentToAgent: false };
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
}
