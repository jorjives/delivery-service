# Work through a backlog

Items you keep in `.delivery/backlog/` (see [A backlog of work items](project-configuration.md#a-backlog-of-work-items))
are worked by `delivery run --sources`, along with the other work sources in your config file, in
order: due recurring items first, then each source in turn, and a fallback source only when nothing
else has work.

```sh
delivery backlog                # list the ideas, open, held and parked items
delivery run --sources          # take one item
delivery run --sources --max 3  # take up to three items in this run
```

The command remembers each item between runs. An interrupted item carries on in the same working
copy, with the work it had done. An item whose run used up its corrections starts afresh, and its
old branch is kept to look at. An item that keeps ending undelivered, or that asks you a question,
is set aside: answer it with `delivery answer <item> "your answer"`, or deal with it and run
`delivery unpark <item>`. `delivery status` shows what is parked.

Each item's work lands on one delivery branch, `delivery/main` (named after your base branch), built on everything landed before it: an item that finishes after another is rebuilt on top of it and checked again first, and one that conflicts is given a fresh attempt from the latest work. Your closer then takes the delivery branch once per run: `merge-back` merges it into `main`, `open-pr` opens one pull request for it (and updates that pull request's list on later runs), and `commit-to-branch` leaves it for you. A delivered item is marked `resolved` on the delivery branch and is not taken again until that branch is merged.

A project that already tracks its work in GitHub issues can use them instead: add a `github`
source, and label an issue `delivery` to have it worked (see
[GitHub issues](project-configuration.md#github-issues)).
