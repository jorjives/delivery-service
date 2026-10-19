---
"delivery-service": minor
---

`delivery approve <ids>` (or `--all`) chooses ideas in your backlog to be fixed: each becomes an open item, fixed through its workflow the next time you run `delivery run --sources`. `delivery decline <ids>` sets ideas aside. Each commits only the named item files, and refuses, changing nothing, if you have uncommitted changes to one of them.
