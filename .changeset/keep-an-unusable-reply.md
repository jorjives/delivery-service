---
"delivery-service": patch
---

When an agent session ends without reporting a result, or replies with something that is not a
valid result for its role, the harness now keeps what it said in
`refs/session-error-<session key>.json` beside the run's case file, as `agentReply`, cut to the
first 4,000 characters. For a reply in the wrong shape, the same file says why the role's schema
refused it. A role that keeps failing this way now leaves the evidence needed to fix its
configuration; the rationale a project owner reads is unchanged.
