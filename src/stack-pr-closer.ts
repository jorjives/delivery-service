import { closeError, closerFromAcceptedHandler } from "./closer-support.js";
import { ghFailureOf, ghReason, runGh } from "./gh.js";
import { git, tryGit } from "./git-exec.js";
import { createOpenPrCloser } from "./open-pr-closer.js";
import { createdUrl, listPullRequests, prAccessProblem } from "./pull-requests.js";
import type { CloseContext, CloseReport, CloserPort, DeliveredLevel } from "./ports.js";

/** GitHub's limit on a pull request title. */
const TITLE_LIMIT = 256;

const nothingStacked = (base: string): CloseReport => ({
  status: "DONE",
  detail: `Nothing is stacked on ${base} yet, so no pull request was needed.`,
});

/** The body of a level's pull request: its text, what it closes, and the pull requests it builds on. */
function bodyOf(level: DeliveredLevel, below: readonly string[]): string {
  const parts = [level.text];
  if (level.closes !== undefined) parts.push(`Closes ${level.closes}`);
  if (below.length > 0) {
    const merge = below.length === 1 ? "that" : "those";
    parts.push(`This builds on ${below.join(", ")}: merge ${merge} first, bottom first.`);
  }
  return parts.join("\n\n");
}

/** The commit a ref names in `repoPath`, or undefined when there is no such ref. */
async function commitOf(repoPath: string, ref: string): Promise<string | undefined> {
  return git(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(() => undefined);
}

/**
 * The `--force-with-lease` flags for the levels whose origin head is not the commit they push. A level's expected head is
 * the one GitHub reported for its pull request at the start of the run, but only when this machine made it (the level's
 * commit, or one of its earlier commits); otherwise it is the head origin holds, when that is one of the level's earlier
 * commits. Any other head gets no lease, so a plain push refuses to overwrite it, the owner's commits included. Undefined when origin cannot be read, which the push then reports as an error.
 */
async function leasesFor(repoPath: string, levels: readonly DeliveredLevel[]): Promise<string[] | undefined> {
  const listing = await git(repoPath, ["ls-remote", "origin", ...levels.map((level) => `refs/heads/${level.ref}`)]).catch(
    () => undefined,
  );
  if (listing === undefined) return undefined;
  const heads = new Map<string, string>();
  for (const line of listing.split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha !== undefined && ref !== undefined) heads.set(ref, sha);
  }
  const leases: string[] = [];
  for (const level of levels) {
    const head = heads.get(`refs/heads/${level.ref}`);
    const ours = (sha: string | undefined): sha is string => sha !== undefined && (sha === level.commit || level.earlier?.includes(sha) === true);
    const expected = ours(level.reported) ? level.reported : ours(head) ? head : undefined;
    if (expected !== undefined && expected !== level.commit) {
      leases.push(`--force-with-lease=refs/heads/${level.ref}:${expected}`);
    }
  }
  return leases;
}

/**
 * The levels that hold commits of their own, bottom up. A level whose commit is an ancestor of, or equal to, the commit
 * below it changed nothing, so it is dropped and the next kept level stands on the level below that one. The bottom is
 * compared with the base as origin holds it, or as the local base when origin's copy is absent.
 */
async function ownLevels(
  repoPath: string,
  base: string,
  levels: readonly DeliveredLevel[],
): Promise<{ kept: DeliveredLevel[]; dropped: DeliveredLevel[] }> {
  const kept: DeliveredLevel[] = [];
  const dropped: DeliveredLevel[] = [];
  let below = (await commitOf(repoPath, `refs/remotes/origin/${base}`)) ?? (await commitOf(repoPath, `refs/heads/${base}`));
  for (const level of levels) {
    if (below !== undefined && (await tryGit(repoPath, ["merge-base", "--is-ancestor", level.commit, below]))) {
      dropped.push(level);
    } else {
      kept.push(level);
      below = level.commit;
    }
  }
  return { kept, dropped };
}

/**
 * Publish a stack of pull requests, one per level, for owners who want each slice reviewed, tried and merged on its
 * own. Each level's branch is pushed in one atomic push, and each is opened on the level below (the bottom on the base).
 * A repeat close finds the pull requests already open and changes only what is wrong with them. The delivery branch
 * itself is never pushed.
 *
 * Only a delivery branch with a stack (`delivery.stack`) is published this way; any other close is the rolling
 * `open-pr` closer, unchanged. `ghCommand` exists so tests can substitute a stand-in executable.
 */
export function createStackPrCloser(options: { ghCommand?: string } = {}): CloserPort {
  const ghCommand = options.ghCommand ?? "gh";
  const rolling = createOpenPrCloser(options);
  const gh = (cwd: string, args: string[]): Promise<string> => runGh(args, { cwd, command: ghCommand });

  async function publish(ctx: CloseContext, levels: readonly DeliveredLevel[]): Promise<CloseReport> {
    const { repoPath, baseBranch: base } = ctx;
    if (levels.length === 0) return nothingStacked(base);

    if (!(await tryGit(repoPath, ["remote", "get-url", "origin"]))) {
      const refs = levels.map((level) => level.ref).join(", ");
      return closeError(
        `The repository at ${repoPath} has no remote named origin, so the stack's branches (${refs}) could not be ` +
          `pushed for pull requests. Add the GitHub repository as origin and close again.`,
      );
    }

    const { kept, dropped } = await ownLevels(repoPath, base, levels);
    if (kept.length === 0) return nothingStacked(base);

    const refs = kept.map((level) => level.ref);
    const refspecs = refs.map((ref) => `refs/heads/${ref}:refs/heads/${ref}`);
    const leases = await leasesFor(repoPath, kept);
    if (leases === undefined || !(await tryGit(repoPath, ["push", "--atomic", ...leases, "origin", ...refspecs]))) {
      return closeError(
        `git could not push ${refs.join(", ")} to origin, so no pull request was opened for the stack. Check that the ` +
          `operator can push to origin from ${repoPath}, then close again.`,
      );
    }

    const listing = await listPullRequests(repoPath, { heads: refs }, { state: "all", command: ghCommand });
    if (!listing.ok) {
      const { failure } = listing;
      return (
        prAccessProblem(failure) ??
        closeError(
          `gh could not check which pull requests the stack on ${base} has: ${ghReason(failure)}. Check that origin is ` +
            `the GitHub repository and that gh can reach it from ${repoPath}, then close again.`,
        )
      );
    }

    const published: string[] = [];
    const notes = dropped.map((level) => `${level.intent} changed nothing of its own, so it has no pull request.`);
    const below: string[] = [];
    let parent = base;
    for (const level of kept) {
      const pullRequests = listing.pullRequests.filter((pr) => pr.headRefName === level.ref);
      const open = pullRequests.find((pr) => pr.state === "OPEN");
      const body = bodyOf(level, below);

      const settled = pullRequests.at(-1);
      if (open === undefined && settled !== undefined) {
        notes.push(`${settled.url} (${level.ref}) is ${settled.state.toLowerCase()}, so it was left alone.`);
        below.push(settled.url);
      } else if (open !== undefined) {
        const args = ["pr", "edit", open.url, `--body=${body}`];
        if (open.baseRefName !== parent) args.push(`--base=${parent}`);
        try {
          await gh(repoPath, args);
        } catch (err) {
          const failure = ghFailureOf(err);
          return (
            prAccessProblem(failure) ??
            closeError(`gh could not update ${open.url} for ${level.ref}: ${ghReason(failure)}. Close again.`)
          );
        }
        published.push(open.url);
        below.push(open.url);
      } else {
        let created: string;
        try {
          created = await gh(repoPath, [
            "pr",
            "create",
            `--base=${parent}`,
            `--head=${level.ref}`,
            `--title=${level.intent.slice(0, TITLE_LIMIT)}`,
            `--body=${body}`,
          ]);
        } catch (err) {
          const failure = ghFailureOf(err);
          // Anything that is not an access problem is GitHub declining this pull request: a decision a person can make.
          return (
            prAccessProblem(failure) ?? {
              status: "FAIL",
              detail:
                `GitHub refused to open a pull request from ${level.ref} into ${parent}: ${ghReason(failure)}. ` +
                `The stack is pushed. Resolve the refusal on GitHub, then close again.`,
            }
          );
        }
        const url = createdUrl(created);
        published.push(url);
        below.push(url);
      }
      parent = level.ref;
    }

    const summary =
      published.length > 0
        ? `Published the stack on ${base}, bottom first: ${published.join(", ")}.`
        : `Every pull request on the stack on ${base} is already merged or closed, so none was published.`;
    return { status: "DONE", detail: [summary, ...notes].join(" ") };
  }

  const stacked = closerFromAcceptedHandler((ctx) => publish(ctx, ctx.delivery?.stack ?? []));

  return {
    close: (ctx, outcome) => (ctx.delivery?.stack === undefined ? rolling.close(ctx, outcome) : stacked.close(ctx, outcome)),
  };
}
