---
"delivery-service": minor
---

With the `open-pr` closer and `stack` on, `delivery run --sources` publishes one pull request per
delivered item, each on the one below. Merge from the bottom, by any method, and the next run moves
the rest onto your base, runs your gate on each and retargets the new bottom. Close a pull request
to say no: it and the levels above it are dropped and the item is delivered again. Push a fix to a
pull request's branch and the next run takes it in as that level's work, checks it, and moves the
levels above onto it; your commits are never overwritten. `delivery status` and the report show the
stack and any level that is blocked, and say why.
