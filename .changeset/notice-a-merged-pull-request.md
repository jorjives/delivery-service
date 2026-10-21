---
"delivery-service": minor
---

With the `open-pr` closer, `delivery run --sources` fetches your base branch from `origin` and asks
GitHub which delivery pull requests have merged, before it does anything else. A delivery pull
request you merged on GitHub, by merge commit, squash or rebase, is seen without you pulling: the
delivery branch starts again from your base, `delivery status` stops listing what merged, and the
next item gets a new pull request. If the fetch or the question fails, for example offline, the run
says so and carries on with what it already has. Other closers do not fetch.
