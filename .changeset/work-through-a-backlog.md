---
"delivery-service": minor
---

`delivery run --sources` works through your backlog on its own: items you keep in `.delivery/backlog/`, your config file's `tasks`, and any script of your own that lists tasks, in order (due recurring items first, then each source in turn, then a fallback only when nothing else has work). `--max N` takes up to N items. It remembers each item between runs: an interrupted item carries on where it got to, one that used up its corrections starts afresh and keeps the old branch to look at, and one that keeps failing or stops for you is set aside until you deal with it. A delivered backlog item is marked resolved on its branch.
