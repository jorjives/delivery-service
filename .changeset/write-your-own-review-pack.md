---
"delivery-service": minor
---

A review folder of your own is now checked as a whole: every mistake in its `pack.json` is named
by file and field in one plain sentence, quoting what you wrote and listing what is allowed. A
`pack.json` that tries to give the agent tools or commands, or bring code of its own for its
check, is refused: a review folder holds only data.

A review's `pack.json` can list the checks its problems may use under `scan.checks` (any of
`anchor-gone`, `pattern-absent` and `dependency-absent`, always including `anchor-gone`); left
out, all three are offered. The code review now offers `anchor-gone` and `pattern-absent`.

`delivery packs --schema` prints the JSON Schema of `pack.json`, so an editor can check a
review folder as you write it (a `pack.json` may name it under `$schema`), and `delivery packs
--json` lists the reviews as data.

Each problem's part for engineers (`delivery findings <n>`) and `delivery findings --json`
(`review.packVersion`, `review.packHash`) say which version of the review made it, with a
fingerprint of its contents.
