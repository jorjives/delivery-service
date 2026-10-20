# Spec, plan, then work the plan in a loop

Three practitioners describe the same shape:

- Harper Reed ([My LLM codegen workflow atm](https://harper.blog/2025/02/16/my-llm-codegen-workflow-atm/)):
  write a spec, have a model turn it into a plan of small prompts and a todo list, then feed the
  prompts to a coding agent one at a time.
- Addy Osmani ([My LLM coding workflow going into 2026](https://addyosmani.com/blog/ai-coding-workflow/)):
  spec first, then a plan of small tasks, implemented and tested one chunk at a time with a
  commit after each.
- Geoffrey Huntley's "Ralph" loop ([ghuntley.com/ralph](https://ghuntley.com/ralph/)): the spec is
  the source of truth, a planning pass compares it with the code and writes a prioritised fix
  list, and a dumb loop restarts the agent with fresh context, one item per iteration, with tests
  as backpressure.

Here the spec is `docs/spec.md`, the todo list is `.delivery/backlog/`, and the loop is
`delivery run --sources` on a schedule.

| Piece | What it is |
|---|---|
| `20261020T080000Z-plan-from-spec.md` | A recurring item (`cadence: 1d`, `priority: 0`) that runs the `plan` workflow: compare the spec with the code and add one `build` item per requirement that is neither done nor planned |
| `scripts/spec-coverage.mjs` | The plan's check: every requirement id is either named by a test or by an open item. A plan that forgets a requirement fails it |
| `build` workflow | One requirement per item, in a fresh session, checked by the project's tests |
| `merge-back` | Each run's work lands on `main`, so the next run sees the items the plan added and the code the last build wrote |

## Try it

```bash
cp -r examples/spec-to-backlog-example ~/reading-list
cd ~/reading-list
git init -b main
git add -A
git commit -m "Start the reading list"
node scripts/spec-coverage.mjs   # R1 done, R2 to R4 missing
delivery run --sources           # the plan item runs first and adds three build items
delivery backlog                 # see them
delivery run --sources --max 3   # build them, one fresh session each
```

To leave it running, as Huntley does overnight:

```bash
delivery schedule enable --every 1h
delivery report                  # in the morning: what landed, and what is parked for you
```

Edit `docs/spec.md` to change what gets built: the next planning pass, at most a day later,
plans the new requirement. An item that keeps failing is parked after three tries (`parkAfter`)
rather than looping, and `delivery report` says so.

## What this does not do

A Ralph loop restarts the agent until it says it is finished. Here each item gets a bounded
number of attempts, and the loop is the schedule, so an item that cannot be done stops and waits
for you instead of running all night.
