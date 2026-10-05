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
- "tests only: no check of this specific problem": only your existing tests will say whether a fix broke something. Nothing checks this problem itself.

The list ends by saying how many problems have a specific check, then:

```
Nothing has been changed and nothing will be until you approve it.
```

followed by the commands to run next. On a terminal you can also pick problems and choose "Fix now" or "Not now". "Not now" loses nothing.

The review is an agent's opinion, and it says so. "No problems" means none were found, not that there are none.

## Reading it again

- `delivery findings` lists the latest review's problems, each "not yet decided".
- `delivery findings 1` shows problem 1 in full, followed by a **FOR ENGINEERS** block: the category, the exact lines, the kind of check and what it looks for.
- `delivery findings --unconfirmed` lists problems the review reported that the harness could not find in your project, so did not offer. The reason is one of: "that file is not in your last commit", "that path leads outside your project", "that path is not an ordinary file in your project", "the code it points at is not in that file", or "it did not say exactly which code it means".
- `delivery packs` lists the reviews available. `delivery review ./my-review` runs one from a folder of your own, exactly as a built-in one.

## Where a review is kept

Each review is a folder under `.delivery/packs/` in your project. `.delivery/` ignores itself, so nothing shows up in `git status`. If a review is interrupted after the agent has replied, run the same command again: the review is finished from the saved reply without asking the agent again. If it is interrupted while the agent is working, running it again starts the review afresh. If a review could not run (not signed in, no connection, a usage limit, or a reply the harness could not read), it says so in one sentence and saves nothing.

## Try it without an agent

`examples/code-review-example` is a tiny shop with three planted problems. Its README shows how to review it for real. To see the whole review with a scripted agent instead (no agent, no sign-in, no network), run from a checkout of the harness:

```bash
npm run demo:packs-slice-1
```
