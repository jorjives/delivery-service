---
"delivery-service": minor
---

`delivery report` and `delivery status` now say how long the agent sessions behind a run took
and roughly what they cost: in the report's "For whoever tunes this" block for the whole run,
and in `delivery status` for each task and for a run of several tasks. The figures are the agent
runtime's own, the cost labelled as its estimate, and every figure says how many sessions it
covers ("recorded for 13 of 14 agent sessions"). A run with nothing recorded says "Time and cost
were not recorded for this run", never zero; runs made before this release read that way. The
worker's sessions, repairs and an agent-backed triage all count. Nothing a run does depends on
these figures. The report document gains `usage` and `usageRecorded`, per task and for the whole
report. For tests, a scripted session can be given a cost and a time with `costUsd` and
`durationMs` on its expectation.
