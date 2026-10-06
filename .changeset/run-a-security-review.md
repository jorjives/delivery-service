---
"delivery-service": minor
---

`delivery review security` reviews your project for weaknesses with nothing configured: passwords
and keys in the code, outside input reaching commands or queries, missing checks on who may do
what, unsafe defaults, and library versions known to be unsafe. It opens with how many problems
there are at each level, explains each by what could happen, labels what comes only from the
reviewer's knowledge, and notes what only you can do. A secret it finds is never printed: every
output shows its first four characters, an ellipsis and its length, and a fix that only moves it
to another file is not counted as fixed. A library problem is checked by that version leaving
`package-lock.json`. Fixes of critical and high problems are checked, then kept on their own
branch, waiting for your sign-off: `delivery findings <n> --changes` shows what changed,
`delivery findings sign-off <n>` checks it again on your current main copy and merges it, and
`delivery findings reject <n>` declines it and keeps the branch. A code review holds nothing.
