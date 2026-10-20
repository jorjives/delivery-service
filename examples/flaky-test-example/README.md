# Fix a flaky test, and learn from it

Intercom's flaky-test agent, described by Brian Scanlan on How I AI
([How Intercom 2x'd their engineering](https://www.lennysnewsletter.com/p/how-intercom-2xd-their-engineering)):
given a flaky test, the agent reproduces the failure, finds the cause, fixes it, reruns the test
to show it stays fixed, then improves itself: it writes the new pattern down where the next run
will read it, and looks for the same mistake elsewhere.

| Piece | What it is |
|---|---|
| `load-all.test.js` | A test that fails about half the time, because `loadAll` collects results in the order they finish |
| `scripts/repeat.mjs 30` | The check: the tests must pass 30 runs in a row, so one lucky run proves nothing |
| `fix` step | Reproduce, find the cause, fix the code. `tests-unchanged` stops the agent from making the test pass by weakening it, retrying it or slowing it down |
| `learn` step | Add the pattern to `docs/flaky-patterns.md`, which every later agent is told to read, and add a follow-up item for each other place the same mistake appears. Its check allows only those two changes |

`prices.js` has the same mistake and no test, so a good `learn` step adds a follow-up for it.

## Try it

```bash
cp -r examples/flaky-test-example ~/catalogue
cd ~/catalogue
git init -b main
git add -A
git commit -m "Start the catalogue"
for i in 1 2 3 4 5; do npm test >/dev/null 2>&1 && echo pass || echo fail; done
delivery run --sources
git log -p main..delivery/main
```

The fix, the new pattern and any follow-ups are on `delivery/main` for you to review, as a draft
pull request would be.

`tests-unchanged` suits a flaw in the code under test, as here. When the flaw is in the test
itself (shared state between tests, a fixed sleep), turn the guard off for that item's
workflow, and read the change to the test carefully.
