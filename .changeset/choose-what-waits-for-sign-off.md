---
"delivery-service": minor
---

`delivery fix --sign-off-threshold <level>` chooses how serious a problem must be for its fix to
wait for your sign-off: critical, high, medium, low or none. The default stays the review's own
(high on a security review, nothing on a code review). The choice is recorded with the fixes it
applies to; in a project with no tests every fix still waits.

`delivery findings approve <n> --allow-test-edits` lets that problem's fix change existing tests,
never delete or skip one; it is recorded and the fix always waits for your sign-off. A problem that
ended "needs a change to one of your tests" can be approved again this way and is fixed on the
next `delivery fix`, which now says how. Fix tasks and the review's record gain an optional
`allowTestEdits`.
