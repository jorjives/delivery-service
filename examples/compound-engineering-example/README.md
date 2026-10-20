# Compounding engineering: plan, work, review, record the lesson

Kieran Klaassen and Dan Shipper at Every
([Compound engineering](https://every.to/source-code/compound-engineering-camp-every-step-from-scratch)):
plan with an agent, have it do the work, review the work with other agents, then spend the last
step teaching the system what went wrong, so the next piece of work starts smarter. Boris Cherny
describes the same habit on the Claude Code team, whose shared `CLAUDE.md` collects the mistakes
agents made so they are not made again.

The `compound` workflow has four checked steps:

| Step | What the agent does | What checks it |
|---|---|---|
| `plan` | Reads the code and the lessons, writes a plan to `plans/` | `scripts/changed.mjs --only plans/` |
| `work` | Carries out the plan, in the same session | The project's tests |
| `review` | A fresh session reviews the work and fixes what it finds | The project's tests, with `tests-unchanged` |
| `compound` | Writes one lesson to `docs/solutions/` and links it from `CLAUDE.md` | `scripts/lesson-recorded.mjs`: a new lesson with a problem, what worked and what to do next time, linked from `CLAUDE.md`, and nothing else changed |

The work is two backlog items in `.delivery/backlog/`, each naming the `compound` workflow. The
closer is `merge-back`, so each item's lesson is on `main` before the next item starts, and every
agent loads the project's `CLAUDE.md`: the second item's agents read the first item's lesson.

## Try it

```bash
cp -r examples/compound-engineering-example ~/feature-flags
cd ~/feature-flags
git init -b main
git add -A
git commit -m "Start the flags"
delivery run --sources          # the first item: plan, work, review, lesson
git log -p -1 -- CLAUDE.md      # the lesson it linked
delivery run --sources          # the second item starts with that lesson in front of it
```

The check proves a lesson was written in the right shape and linked, not that it is worth
keeping. Read the lessons when you review the branch, and delete the ones that are noise.
