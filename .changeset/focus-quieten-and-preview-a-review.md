---
"delivery-service": minor
---

Each problem a review finds says how sure the review is (high, medium or low). Problems it is
unsure of are set aside under "Possibly worth a look", in the review and in `delivery findings`,
and are never recommended. `delivery findings --json` gains `confidence` on each problem.

A pack may list kinds of problem its review is told not to report (`scan.exclude` in `pack.json`).
The built-in code review (now 1.1.0) lists style and naming preferences, and test files whose test
is not itself wrong.

`delivery review <pack> --path <part>` reviews only one folder or file of your project and says so; a problem reported elsewhere is listed as outside the part, never offered. `delivery findings --json` gains `review.path`.
