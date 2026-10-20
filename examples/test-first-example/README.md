# Test first: red, green, refactor

Kent Beck's "augmented coding"
([Augmented coding: beyond the vibes](https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes)):
keep a list of the tests still to write, and for each one have the agent write that one test,
then just enough code to pass it, then tidy. Beck watches for an agent that deletes or weakens
tests to get to green; here the harness refuses that for you. It also follows Anthropic's
suggestion of having one session write the tests and another write the code
([best practices](https://code.claude.com/docs/en/best-practices)).

The project is a small basket-totalling module. `plan.md` is the test list, and each unticked
test is a backlog item in `.delivery/backlog/`, ordered by `priority`. Each item names the
`red-green-refactor` workflow:

| Step | What the agent does | What checks it |
|---|---|---|
| `red` | Writes one failing test, and no code | `scripts/red.mjs`: only test files changed, and the tests now fail |
| `green` | A fresh session, which did not write the test, makes it pass | The project's tests, with `tests-unchanged`: no existing test may be edited |
| `refactor` | The same session tidies the code and ticks `plan.md` | The project's tests, still with `tests-unchanged` |

Because `green` starts a new session (no `continue`), the code is written by an agent that only
knows the test, not the thinking behind it, so the test has to say what it means.

## Try it

```bash
cp -r examples/test-first-example ~/basket
cd ~/basket
git init -b main
git add -A
git commit -m "Start the basket"
delivery backlog
delivery run --sources          # the next test on the list: Beck's "go"
delivery run --sources --max 3  # or work down the whole list
```

Each item merges into `main` (`merge-back`) once all three steps pass, so the next item starts
from the code the last one left. To add a test to the list, add a line to `plan.md` and an item
file beside the others, commit both, and run again.
