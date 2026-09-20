---
"delivery-service": minor
---

A run whose agent runtime cannot start a session at all now stops after one attempt instead of
spawning the same unstartable session five times. Retrying is still right for a session that ran
and answered badly: it may answer well next time. It was never right for one that never started,
because nothing between attempts can change, so the retries only cost money and delay. The
escalation names the runtime rather than a spent budget, so the person reading it is not sent
looking for the wrong fault. Every other kind of incomplete session, including a crash or a cap,
is retried exactly as before.
