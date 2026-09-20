---
"delivery-service": patch
---

When an agent session errors or cannot be started at all, the harness now keeps the underlying
error where a person can read it: `refs/session-error-<session key>.json` beside the run's case
file. What a project owner reads is unchanged; the rationale is still the same plain sentence,
with no stack trace or raw error text in it. Diagnosing a harness that will not start its agent
no longer means editing the installed copy to print the error.
