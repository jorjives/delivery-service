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
- `delivery packs` lists the reviews available. `delivery review ./my-review` runs one from a folder of your own, exactly as a built-in one.

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
On a code review nothing waits: severity only orders the list.

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
