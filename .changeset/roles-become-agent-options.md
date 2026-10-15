---
"delivery-service": minor
---

`roles` is gone from `delivery.config.json`. Instructions you added with
`roles.*.systemPromptFragment` now go in `agent.append`. `roles.*.allowedTools` has no
replacement in the file: the agent has the tools your own Claude Code setup gives it, and
`permissions.deny` in your Claude settings keeps it from one. `delivery validate` names either
field and says where it now belongs.
