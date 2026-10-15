---
"delivery-service": minor
---

The agent now works as your own Claude Code session would: your settings, CLAUDE.md, skills,
plugins, hooks and MCP servers load, and every tool is available. The harness adds its own
instructions to Claude Code's, rather than replacing them. To keep the agent from a tool, add it
to `permissions.deny` in your Claude settings. The harness's own tool guard is gone, with
`createToolAuthority`, `refusalSentence`, `outsideWorktreeSentence` and `authorityRefusal`.
