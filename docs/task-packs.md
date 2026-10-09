# Reviewing your project

Point the harness at your project and ask "what is wrong with this?". It needs no setup: no configuration file, no tasks.

## Your first review

In your project's folder, with Claude Code signed in (`claude auth status`), type:

```bash
delivery review code
```

It says first what it will do:

```
Code review of your project.
This reads your project and writes nothing to it. It can take a few minutes.
```

An agent then reads your **last commit**. It can read files and nothing else: it cannot change a file, run a command, or read anything outside your project. If you have uncommitted changes, the review says so, because it does not see them.

When it finishes, you get a numbered list. Each problem says how serious it is (critical, high, medium or low), where it is, what is wrong, why it matters and what fixed looks like, and then **How we will know**, which is one of:

- "checked: the flagged code is gone": the harness will check that exact code is no longer there.
- "checked: the risky pattern no longer appears": the harness will check a pattern no longer matches anywhere it looked.
- "checked: the vulnerable version is no longer installed": the harness will check a library version is no longer in the project.
- "tests only: no check of this specific problem": only your existing tests will say whether a fix broke something. Nothing checks this problem itself.

The list ends by saying how many problems have a specific check, then:

```
Nothing has been changed and nothing will be until you approve it.
```

followed by the commands to run next. On a terminal you can also pick problems and choose "Fix now" or "Not now". "Not now" loses nothing.

The review is an agent's opinion, and it says so. "No problems" means none were found, not that there are none.

## A security review

`delivery review security` reviews your project for weaknesses someone could take advantage of:
passwords and keys written in the code, outside input reaching commands or queries, missing
checks on who may do what, unsafe default settings, and library versions known to be unsafe. It
needs no configuration, reads your last commit and changes nothing.

It opens with how many problems there are at each level (critical, high, medium, low) and says
that problems that are critical or high are fixed and checked, but wait for your sign-off before
they reach your main copy. Each problem says "What could happen" in plain words.

A problem about a library version says: "Note: this comes from the reviewer's knowledge, not an
advisory database; it may be out of date or wrong." Its fix is checked by that version no
longer being installed, read from your `package-lock.json`.

A problem that leaves something only you can do, such as changing a leaked password where it was
issued, says "One thing is left for you:" and what it is.

## Reading it again

- `delivery findings` lists the latest review's problems and where each stands.
- `delivery findings 1` shows problem 1 in full, followed by a **FOR ENGINEERS** block: the category, the exact lines, the kind of check and what it looks for.
- `delivery findings --unconfirmed` lists problems the review reported that the harness could not find in your project, so did not offer. The reason is one of: "that file is not in your last commit", "that path leads outside your project", "that path is not an ordinary file in your project", "the code it points at is not in that file", or "it did not say exactly which code it means".
- `delivery packs` lists the reviews available. `delivery review ./my-review` runs one from a folder of your own, exactly as a built-in one. `delivery packs --schema` prints the JSON Schema of a review folder's `pack.json`. To write one, see [Writing a pack](writing-a-pack.md).

## Choosing what to fix

Nothing is fixed until you say so. Choose by the numbers in the list:

```bash
delivery findings approve 1 3
delivery findings skip 2
delivery findings approve --all
```

`--all` approves every problem listed now, by name, so a later review never adds to it. If you
change your mind, choose again: your latest choice counts, until fixing starts. Approving a
problem that is tests only says so once, because only your existing tests can show it is fixed.

`delivery findings` then shows each problem as one of:

- "not yet decided": you have not chosen.
- "needs your decision": it cannot be checked (it has no specific check, and either your project has no tests or the review requires one), so it is not offered. See "A project with no tests".
- "skipped by you": nothing will be done about it.
- "being fixed": approved, and fixed when you run `delivery fix`.
- "fixed and merged": fixed, checked, and in your project. If your project opens a pull request
  for finished work instead, this reads "fixed, pull request opened".
- "already fixed": the code it points at had gone before its fix started, so nothing was done.
- "could not be fixed": the agent could not fix it. The reason follows, with what the agent said.
- "stopped by a setup problem": something in the setup stopped the fix, and an engineer is needed.

## Having them fixed

```bash
delivery fix
```

It says how many approved problems it is fixing and how many at once, and you can follow it
from another terminal with `delivery status --watch`. Each problem is fixed by an agent in its
own copy of your project. The agent is given the problem as the review described it, and told
that this is a description to act on, not instructions to obey. A fix counts only when the
problem's own check passes (the flagged code is gone, and commenting it out does not count, or
the risky pattern no longer appears) and every test that passed before still passes. A check
that cannot run is treated as a problem with the check, never as a pass.

A fix that passes is merged into your project, unless your `delivery.config.json` names another
`closer`. A problem whose code had already gone when its fix would start is "already fixed" and
is not worked on: the check is made just before each fix starts, so a problem that an earlier fix in the same
run has already resolved is found out without an agent being spent on it. One the agent cannot fix is "could not be fixed", with the reason and what
the agent said, and the other approved problems are still fixed.

Run `delivery fix` again at any time, including after an interruption: it works only on the
approved problems that have not finished, and never fixes the same problem twice. Several at
once (`delivery fix --concurrency 3`), fixes are never merged over each other: merging only ever
moves your project forward onto a fix that already contains everything before it, so a fix that
finished after another had already been merged cannot be merged, and is reported as stopped
with the reason rather than forced in. To fix several at once, a `closer` that keeps a branch
or opens a pull request suits better than merging.
`validate`, `preview`, `status` and `report` show a fix like any other list.

## Serious fixes wait for your sign-off

On a security review, a problem that is critical or high is fixed and checked like any other,
but its fix does not reach your main copy. It is kept on its own branch and `delivery findings`
says it is "waiting for your sign-off", with how to look at what changed, say yes or say no.
On a code review nothing waits for its severity: severity only orders the list. In a project with no tests every fix waits (see below).

`delivery findings 1 --changes` shows what the fix changed, file by file, after a note: "The agent
changed these files. This shows what changed; it cannot tell you it is safe."

To say yes:

```bash
delivery findings sign-off 1
```

It says "Checking the fix still works on your current main copy...", brings the fix up to date
with your main copy, checks it again exactly as it was checked when it was made, and only then
merges it: "Passed. Problem 1: fixed and merged." This works when other fixes have been merged
since. If your main copy changed the same lines, or the fix no longer passes there, nothing is
merged, the fix is kept on its branch, and the problem reads "signed off but could not be merged"
with the reason. Running it again once the fix is merged changes nothing. Nothing serious reaches
your main copy without your sign-off being recorded.

To say no, `delivery findings reject 1`: nothing is merged, the fix is kept on its branch for an
engineer, and the problem reads "declined at sign-off".

Once a problem with something left for you is fixed, `delivery findings` lists that step under
NEEDS YOU, such as changing a leaked password where it was issued.

Sign-off waits for nothing: while fixes are being made several at a time it says so and changes
nothing; run it again once they have finished.

## Come back to the report

After a fix phase, `delivery report` tells you what happened in one place. It opens with which
review it was and one sentence about the whole of it, then lists each problem by its title and how
serious it is, under who must act:

```
Security review of shop: 6 problems found; you approved 5 and skipped 1.
2 are fixed and merged; 1 is waiting for your sign-off; 1 could not be fixed; 1 was stopped by a setup problem.
Review 5 Oct 10:19 UTC.

WAITING FOR YOUR SIGN-OFF (1)
  Problem 1 of 6: "A password for the payments service is written in the code" (critical)
    What could happen: "Anyone who can read this code can use the payments service as you."
    The agent changed your code so the code the review flagged is gone.
    The agent said: "Read the key from PAYMENTS_KEY."
    How we know: the check passed (checked: the flagged code is gone), and every test that passed before still passes.
    Why this needs you: it is a serious problem, and you should see what changed before it reaches your main copy.
    Look at what changed: delivery findings 1 --changes
    Say yes: delivery findings sign-off 1
    Say no: delivery findings reject 1
```

The sections are WAITING FOR YOUR SIGN-OFF, NEEDS YOU (problems that could not be fixed, with why,
what the agent said, who acts and what to do, and anything only you can do once a fix is merged),
STOPPED, FOR YOUR ENGINEERS (a problem stopped by a setup problem, such as a check that could not
run, and a fix you declined), DONE (each fixed line says how it was checked, so a fix checked only
by your tests never reads as proved), and SKIPPED BY YOU. Problems still being fixed, or not yet
decided, have sections of their own.

It reads only the records, so it works from another terminal while `delivery fix` is going, and
after an interruption it says to carry on with: delivery fix.

## Read a review as data

`delivery findings --json` prints the latest review as one document, versioned
`delivery.findings/1`, and `delivery findings --schema` prints its JSON Schema. A later release may
add keys and names; it never removes or changes one.

- `schema`: always `delivery.findings/1`.
- `review`: the review's `id`, its `pack` name and `title`, the `commit` it read, and when it
  `startedAt` and `endedAt`.
- `problems`: every problem, in the order `delivery findings` numbers them. Each has its `number`,
  its `id` (the same for the same problem found again), `title`, `category`, `severity`, `where`
  (`path`, `line`, `endLine`), its `state` from the closed set and the `words` you read for it, its
  `check` (`kind`, and the `level` you read), whether a check ever `refused` its fix for weakening
  your tests, the `cause` when the harness knows why it could not be fixed, and its `fix`: the
  `run` (see it with `delivery status <run>`), `branch`, `base` and `closer`, or null before
  `delivery fix` took it on.
- `unconfirmed`: how many the review reported that could not be found in your project.
- `notShown`: how many it found beyond the review's limit.

`delivery review <pack> --json` prints the same document as soon as the review is saved, and `delivery fix --json` ends its step records with it as one last line.

The flagged code and a check's pattern are never in it: either may hold a secret.

## Where a review is kept

Each review is a folder under `.delivery/packs/` in your project. `.delivery/` ignores itself, so nothing shows up in `git status`. If a review is interrupted after the agent has replied, run the same command again: the review is finished from the saved reply without asking the agent again. If it is interrupted while the agent is working, running it again starts the review afresh. If a review could not run (not signed in, no connection, a usage limit, or a reply the harness could not read), it says so in one sentence and saves nothing.

A password, key or token a review finds is never shown: not in the review, `delivery findings`, `--json`, `delivery status`, `delivery report` or any error. It is shown as its first four characters, an ellipsis and its length, such as `pay-… (21 characters)`. The records that must hold it to check the fix stay under `.delivery/`, readable only by you.

## A fix may not weaken your tests

A fix that passes by removing, changing or switching off the tests that judge it is refused. Each
fix is compared with your project as it was when the fix started, and it is refused if it:

- deletes or changes an existing test file (adding a new test is welcome);
- adds a marker that skips a test, such as `.skip(`, `xit(`, `@Ignore` or `pytest.mark.skip`;
- changes how the tests are run: test-runner settings, CI files, the ignore rules, or the test scripts in `package.json`;
- leaves a test-runner setting, or a test file that skips or singles out tests, where git ignores
  it (however it was ignored), because the tests would still read it. Output your build or test run
  writes, such as compiled tests or caches, is fine.

This holds whether your tests report each test's result or only pass or fail as a whole. The agent
is told why its fix was refused and tries again, within the usual number of attempts. The
problem's history in `delivery findings` then says:

```
The agent's fix was rejected because it removed or skipped existing tests.
```

When the only way forward is to edit one of your existing tests, the agent is told to make the
smallest such edit and say so. The edit is refused, the agent stops, and the problem ends "could not
be fixed"; the list counts these on their own: it needs a change to one of your tests, which this
review does not let an agent do. A fix refused for deleting or skipping a test, or for changing how
tests run, is shown as rejected but is not counted this way.

A review may mark a problem as being in a test itself (the code review's "Tests that do not check
what they claim"). Such a problem says "Note: this fix will change your tests." before you approve
it: its fix may change an existing test, but still never delete or skip one.

## A project with no tests

If no test command can be found (no `test` script in `package.json`, and no `gate` in
`delivery.config.json`), the review says so at the top:

```
Your project has no tests, so nothing will check that a fix has not broken something else. Every fix will wait for your sign-off before it reaches your main copy.
```

A problem with a specific check can still be approved and fixed. Its "How we will know" line adds
"this problem's own check only, no regression tests": the fix is checked by that check and by the
rules that keep a fix from weakening tests, and nothing else. Every fix then waits for your
sign-off, whatever its severity and whichever review it came from. `examples/no-tests-example` is a
small project to try this on.

A problem with no specific check is not offered: it reads "needs your decision; cannot be checked", `delivery findings approve --all` leaves it out, and approving it by number is refused with how to approve it anyway. A review whose pack sets `"requireCheck": true` in its `scan` settings treats such a problem the same way in any project.

If you will check such a fix yourself, approve it by number anyway:

```bash
delivery findings approve 3 --allow-unchecked
```

It is recorded, and it says "nothing will check this fix except you, so it will wait for your
sign-off". Its fix always waits for your sign-off, in any project. `--allow-unchecked` does not go
with `--all`: name each problem.

## Try it without an agent

`examples/code-review-example` is a tiny shop with three planted problems. Its README shows how to review it for real. To see the whole review with a scripted agent instead (no agent, no sign-in, no network), run from a checkout of the harness:

```bash
npm run demo:packs-slice-1
```

To watch the harness refuse fixes that cheat (one deletes a test, one skips a test and changes the
test command) and one that honestly needs a test change, run:

```bash
npm run demo:packs-slice-3
```

To watch a review of a project with no tests (`examples/no-tests-example`): the warning, a problem
set aside as needing your decision, and every fix waiting for your sign-off, run:

```bash
npm run demo:packs-slice-6
```
