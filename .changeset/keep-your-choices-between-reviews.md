---
"delivery-service": minor
---

Running the same review again keeps your choices. Problems you skipped, or whose fix you declined,
in an earlier review of the same kind are not offered again: the review says how many it left out,
and `delivery findings --include-skipped` shows them. A problem that was fixed and is still gone is
not offered again; one whose flagged code is back is marked "came back". `delivery findings approve
--recommended` approves in one step the problems with a check of their own that will not wait for
your sign-off, and says which it chose. Findings data gains an `earlier` key per problem, and each
new fix task names the review it came from in its tags.
