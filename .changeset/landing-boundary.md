---
"delivery-service": minor
---

The agent can no longer land its own work. Inside its session git refuses a change to any branch
but the task's, a new tag and every push, saying: "Your branch is the deliverable. The harness
merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to."
Committing, rebasing and stashing on its own branch still work, and your project's own git hooks
still run. Only your project's repository is affected: other repositories the agent uses, such as
ones your tests create, work as normal.
