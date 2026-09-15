# Writing a closer

This guide gets you from nothing to a working closer for your project: either
one of the **built-in closers**, named as data, or a **custom closer** you write
yourself. You do not need to read any source to follow it.

## What a closer is

When the gate accepts a surface's work, the harness runs the surface's closer
once to do something with it: merge it, leave it on a branch, open a pull
request, tell someone. The harness decides *when* the closer runs and acts on
what it reports; the closer decides *what* closing means.

The same closer is also called when a surface stops without being accepted
(escalated to a person, or aborted), so it can tidy up after itself.

What the harness does with the report:

| Report | On an accepted surface | On a stopped surface |
|---|---|---|
| `"DONE"` | the surface is `CLOSED`, and your `detail` is its closing report | nothing more |
| `"FAIL"` or `"ERROR"` | close-triage retries the close while the close budget lasts, then hands it to a person with your `detail` as the evidence | logged, never retried |

A failed close is never sent back to the worker: the work is already accepted.

Everything below is imported from the harness's single entry point,
`./src/index.js` from the repository root (the harness is not published as a
package yet). Run the snippets with `npx tsx`.

## Choosing a closer

A surface pins its closer in the case file header as a `closerRef`, passed to
`create()` with the rest of the header, exactly as in
[Configuring a role](configuring-a-role.md):

```ts
// Built in: fast-forward the base branch onto the work, then remove the worktree and branch.
{ type: "merge-back" }
{ type: "merge-back", deleteBranch: false } // keep the branch after merging

// Built in: commit the work to the surface's own branch and keep the branch.
{ type: "commit-to-branch" }

// Built in: commit the work, push the surface's branch to origin, and open a GitHub pull request into the base branch.
{ type: "open-pr" }

// Your own closer module.
{ type: "custom", modulePath: "closers/notify.mjs", exportName: "default" }
```

`open-pr` runs the GitHub command-line tool, `gh`, as whoever runs the harness,
so only projects that name it need `gh` installed and signed in: install it from
https://cli.github.com and run `gh auth login` first. The harness never takes or
stores a token. The repository's `origin` remote must be the GitHub repository.
The closing report is the pull request's address; closing again finds the pull
request already open and reports it rather than opening a second. The worktree is
left in place after the pull request opens, for follow-up commits. A missing
`gh`, an expired sign-in or a missing permission is reported as `"ERROR"` naming
the fix; a pull request GitHub declines, for example because of branch
protection, is `"FAIL"`.
To watch it open a pull request, reuse it on a repeat close, and report an
expired sign-in, against a stand-in for `gh` with no network: `npm run demo:close-slice-5`.

Whoever runs the surface turns the pinned reference into a closer and passes it
in the surface's ports:

```ts
import { load, resolveCloser } from "./src/index.js";

const { header } = await load(dir);
if (!header.closerRef) throw new Error(`no closer pinned for ${dir}`);
const closer = resolveCloser(header.closerRef, repoPath);
```

`repoPath` is required. A relative `modulePath` is resolved against it, the
repository root, never the worktree the surface ran in, so the agent whose work
is being closed cannot edit the closer. An absolute path works too.

A `closerRef` the harness cannot understand (an unknown `type`, a missing
`modulePath`) is not an exception: it resolves to a closer whose every report is
`"ERROR"`, naming what was wrong.

From the command line, the same shape goes in `delivery.config.json` under `closer`, and
`--closer` names one of the three built-in types for a single run:

```json
{ "closer": { "type": "custom", "modulePath": "closers/notify.mjs" } }
```

`delivery run` checks the closer before it starts rather than letting it become an `"ERROR"`
report: an unknown type stops the command listing the choices, and a custom module it cannot
load stops it with the path named.

## The contract

A closer is any object with one method:

```ts
import type { CloseContext, CloseOutcome, CloseReport } from "./src/index.js";

interface Closer {
  close(ctx: CloseContext, outcome: CloseOutcome): Promise<CloseReport>;
}
```

`close` receives a `CloseContext`:

| Field | What it is | When it is set |
|---|---|---|
| `worktreePath` | The surface's scratch worktree, holding the accepted work. It may already be gone on a replay (see below). | Always |
| `dir` | The surface's case file directory. Most closers ignore it. | Always |
| `repoPath` | The repository checkout the worktree was created from. It is shared with the people using that checkout: act on it, but never switch its checked-out branch. | Always |
| `branch` | The surface's own branch, for example `surface/surface-7`. The worktree has it checked out. | Always |
| `baseBranch` | The local branch the surface was started from, pinned when it was provisioned, for example `main`. The branch to merge into or open a pull request against. | Always; the empty string only if provisioning never completed, which a closer should report as `"ERROR"` |
| `repairBrief` | Guidance written by triage's agent: `{ problem, dead_ends, scope, references, diagnosis }`. You may surface it, in a pull request body or a notification. The built-in closers ignore it. | Only on a close retried by triage's agent; absent on a first close and on a deterministic retry |

an `outcome`, `{ kind: "accepted" | "escalated" | "aborted" }`, and must return a
`CloseReport`:

| Field | What it is |
|---|---|
| `status` | `"DONE"`, `"FAIL"` or `"ERROR"` |
| `detail` | One or two plain sentences a person will read: what happened, or exactly what stopped the close |

## The three outcomes

Every closer switches on `outcome.kind`:

- **`"accepted"`**: the gate accepted the work. Land it, whatever landing means
  for your project.
- **`"escalated"`**: the surface was handed to a person. Nothing is landed. Tidy
  up, and keep whatever that person needs to take over: the built-ins remove
  the worktree and keep the branch.
- **`"aborted"`**: the surface was stopped. Nothing is landed. Tidy up the same
  way.

A report on a stopped surface is only logged, so make teardown something that is
safe to run twice.

## FAIL or ERROR

Both route to close-triage in the same way; the difference tells the person
reading the escalation what kind of problem it is.

- **`"FAIL"`: a decision could resolve it.** The close was refused for a reason
  in the work or the project: the base branch has moved on, a pull request was
  rejected by branch protection.
- **`"ERROR"`: the environment is broken.** Your closer could not do its job at
  all: a command is missing, a credential has expired, the network is down, the
  checkout is on the wrong branch.

Either way, write `detail` as plain prose naming the specific cause and, where
you can, what to do about it: "the gh CLI is not authenticated; run gh auth
login", not a stack trace.

## Replays: detect "already done" yourself

The harness can crash after your closer has done its work but before it records
the report. On restart it calls your closer again, with the same context. There
is no resume token: your closer must work out from the world itself whether the
job is already done, and report `"DONE"` if it is.

So each closer starts with a detect step, and never assumes anything it did last
time is still there:

- a merge closer checks whether the base branch already contains the work;
- a pull request closer checks whether an open pull request already exists for
  the branch;
- a notification closer records what it sent somewhere it can check, or accepts
  that a crash may send the message twice.

In particular, `worktreePath` may already have been removed by the earlier run.
Check that it exists before touching it.

## Never echo secrets in `detail`

`detail` is written to the case file and quoted, word for word, into the
escalation a person reads. Never put a token, a password or a credentialed URL
in it, and never paste a subprocess's raw output or error into it: `git` and
`gh` can print a remote URL with a token embedded. The same applies to the
message of anything your closer throws, because the harness records that too.
Describe the cause in your own words instead.

## Worked example: the merge-back closer

This is the built-in `merge-back` closer's algorithm, written as a custom closer
module that uses nothing but Node.js and `git`. Use it as a starting point: name
`{ type: "merge-back" }` if the built-in already does what you need.

Its order matters, and every step is safe to replay:

1. **Guard.** No `baseBranch` means nothing to merge into: `"ERROR"`.
2. **Detect a finished close.** If `branch` no longer exists, an earlier close
   merged and cleaned up: `"DONE"`, without touching the worktree.
3. **Commit the work**, but only if the worktree still exists.
4. **Detect a finished merge.** If `baseBranch` already contains `branch`, clean
   up and report `"DONE"`. This check comes after the commit: before it, the
   uncommitted work is invisible and the branch looks already merged.
5. **Check the shared checkout** is on `baseBranch`. Switching it is not the
   closer's call: `"ERROR"`.
6. **Fast-forward or refuse.** A fast-forward that git refuses changes nothing:
   `"FAIL"`, naming where the base branch now is.
7. **Clean up**: the worktree first, then the branch.

Stopped surfaces remove the worktree and keep the branch.

```js
// merge-back-closer.mjs
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

// Git sets GIT_DIR and friends when it runs hooks. Left in place they would
// point every command below at the wrong repository, whatever cwd says.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

// Arguments as a list, never a shell string: branch names can come from task content.
async function git(cwd, args) {
  const { stdout } = await run("git", args, { cwd, env });
  return stdout.trim();
}

async function succeeds(cwd, args) {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
  }
}

// Safe to run twice: removing a worktree that is already gone is tolerated.
async function removeWorktree(ctx) {
  await succeeds(ctx.repoPath, ["worktree", "remove", "--force", "--", ctx.worktreePath]);
  await succeeds(ctx.repoPath, ["worktree", "prune"]);
}

async function cleanUp(ctx) {
  await removeWorktree(ctx);
  // Lower-case -d is git's own guard: it refuses to delete unmerged work.
  await succeeds(ctx.repoPath, ["branch", "-d", "--", ctx.branch]);
}

async function land(ctx) {
  if (ctx.baseBranch === "") {
    return { status: "ERROR", detail: "This surface has no pinned base branch, so there is nothing to merge into." };
  }

  if (!(await succeeds(ctx.repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${ctx.branch}`]))) {
    return { status: "DONE", detail: `Already closed: ${ctx.branch} no longer exists, so an earlier close merged it.` };
  }

  if (existsSync(ctx.worktreePath)) {
    await git(ctx.worktreePath, ["add", "-A"]);
    if ((await git(ctx.worktreePath, ["status", "--porcelain"])) !== "") {
      await git(ctx.worktreePath, ["commit", "-m", `Accepted work from ${ctx.branch}`]);
    }
  }

  if (await succeeds(ctx.repoPath, ["merge-base", "--is-ancestor", ctx.branch, ctx.baseBranch])) {
    await cleanUp(ctx);
    return { status: "DONE", detail: `Already merged: ${ctx.baseBranch} has everything from ${ctx.branch}.` };
  }

  const head = await git(ctx.repoPath, ["symbolic-ref", "--short", "HEAD"]);
  if (head !== ctx.baseBranch) {
    return {
      status: "ERROR",
      detail: `The main checkout is on ${head}, not ${ctx.baseBranch}, so nothing was changed. Check out ${ctx.baseBranch} there and close again.`,
    };
  }

  if (!(await succeeds(ctx.repoPath, ["merge", "--ff-only", "--", ctx.branch]))) {
    const tip = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
    return {
      status: "FAIL",
      detail: `${ctx.baseBranch} has moved on to ${tip} and cannot be fast-forwarded onto ${ctx.branch}. Nothing was changed; the work is still on ${ctx.branch}.`,
    };
  }

  const sha = await git(ctx.repoPath, ["rev-parse", "--short", ctx.baseBranch]);
  await cleanUp(ctx);
  return { status: "DONE", detail: `Fast-forwarded ${ctx.baseBranch} to ${sha} and removed ${ctx.branch}.` };
}

export default {
  async close(ctx, outcome) {
    try {
      if (outcome.kind === "accepted") return await land(ctx);
      await removeWorktree(ctx);
      return { status: "DONE", detail: `The surface was ${outcome.kind}: removed its worktree and kept ${ctx.branch}.` };
    } catch (err) {
      // Name the cause without echoing git's output, which can contain a credentialed URL.
      return { status: "ERROR", detail: `A git command failed while closing ${ctx.branch} (exit code ${err.code ?? "unknown"}).` };
    }
  },
};
```

Save it in your repository, for example as `closers/merge-back-closer.mjs`, and
reference it:

```ts
{ type: "custom", modulePath: "closers/merge-back-closer.mjs" }
```

`exportName` selects a named export instead of `default`, so one module can hold
several closers.

To try it on a real surface's worktree without running a whole surface:

```ts
import { branchName, provisionWorktree, resolveCloser } from "./src/index.js";

const repoPath = "/home/me/project";
const dir = "/tmp/closer-try/case";
const worktreePath = "/tmp/closer-try/tree";

const { baseBranch } = await provisionWorktree(dir, repoPath, worktreePath, "surface-1");
// ... change something in worktreePath ...
const closer = resolveCloser({ type: "custom", modulePath: "closers/merge-back-closer.mjs" }, repoPath);
const ctx = { worktreePath, dir, repoPath, branch: branchName("surface-1"), baseBranch };
console.log(await closer.close(ctx, { kind: "accepted" }));
```

## When your closer goes wrong

The harness wraps every custom closer, so a mistake in yours is reported, never
crashed on. Each of these becomes an `"ERROR"` report, and on an accepted
surface goes to close-triage like any other failed close:

| Mistake | The `detail` names |
|---|---|
| The module cannot be imported | the module path and the import error |
| The export is missing, or has no `close` method | the module path, the export and `missing "close" method` |
| `close` throws, or its promise rejects | the module path and the error message |
| `close` returns something that is not a `CloseReport` | the module path and what was invalid |

To watch an example closer close a surface, then a broken one reach close-triage:

```bash
npm run demo:close-slice-4
```
