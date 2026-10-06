---
"delivery-service": minor
---

A fix from `delivery fix` that deletes or changes an existing test, adds a skip marker, changes
how the tests are run (test-runner or CI settings, the ignore rules, or the test scripts in
`package.json`), or hides a test setting or a skipping test from git, is refused, whatever kind of results the
project's tests report. The agent is told why and tries again; the problem's history in
`delivery findings` says "The agent's fix was rejected because it removed or skipped existing
tests", and a problem where the agent's only way forward was a test edit is counted separately. A pack
can add to the test, protected and skip-marker lists under `fix`, and mark a category whose fixes
change tests; the code review gains such a category. The scripted agent gains a `delete` effect.
