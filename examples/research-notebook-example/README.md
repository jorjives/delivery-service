# A research notebook: questions answered with code

Simon Willison's asynchronous code research
([Code research projects with async coding agents](https://simonwillison.net/2025/Nov/6/async-code-research/)):
write a question that can be answered by writing and running code, hand it to an agent you do not
watch, and read the findings when they arrive. He keeps the work in a repository of its own, one
folder per question, and runs several at once because the results are cheap to check
([The parallel coding agent lifestyle](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
The same shape fits the data questions Anthropic's teams ask Claude Code about their own
data ([How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code)).

Each task is a question. Three run at once (`concurrency: 3`), each on its own branch. The check,
`scripts/check-research.mjs --new`, does not judge whether the answer is right, which only you can
do. It judges whether the answer is backed by code that runs:

- the work added a folder under `research/` with a `run.mjs`;
- every folder's README has a question, an answer and a way to check it;
- every `run.mjs` runs without the network, and its last line, `ANSWER: ...`, appears word for
  word in the README, so the written answer is the one the code produced.

## Try it

```bash
cp -r examples/research-notebook-example ~/research
cd ~/research
git init -b main
git add -A
git commit -m "Start the notebook"
delivery run
delivery report
```

Each question ends on its own branch. Read the findings with `git show <branch>:research/<folder>/README.md`,
and merge the ones worth keeping.

Keep a notebook like this in a repository of its own, as Willison does: the agent runs code, and
a question copied from somewhere else could carry instructions you did not write.
