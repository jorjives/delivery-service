---
"delivery-service": minor
---

`delivery fix --sign-off-threshold <level>` chooses how serious a problem must be for its fix to
wait for your sign-off: critical, high, medium, low or none. The default stays the review's own
(high on a security review, nothing on a code review). The choice is recorded with the fixes it
applies to; in a project with no tests every fix still waits.
