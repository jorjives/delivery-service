---
"delivery-service": minor
---

`delivery validate --json` prints one JSON document saying whether the configuration is ready
and listing every problem in it, not only the first, each with the setting it concerns and the
same plain-language message the plain form gives. A clean configuration gives
`{ "ready": true, "problems": [] }`. The exit codes are the same as without `--json`, and
without it `delivery validate` still shows the first problem in one line.
