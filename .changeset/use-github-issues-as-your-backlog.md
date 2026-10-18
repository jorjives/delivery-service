---
"delivery-service": minor
---

A `github` work source reads your GitHub issues as the backlog, through the `gh` command-line tool: label an open issue `delivery` (or a label you choose) to have `delivery run --sources` work it, with a `workflow:<name>` label to choose its workflow and a `priority:<n>` label to order it. An issue edited after it was labelled is left alone until it is labelled again, and if `gh` is missing or signed out the source is skipped with the reason while your other sources still run.

A follow-up an agent raises while working an issue is opened as a new, unlabelled issue once the work has landed, once only, rather than committed to the repository.

With the `open-pr` closer, the delivery branch's pull request closes each delivered issue when it merges.
