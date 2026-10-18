---
"delivery-service": minor
---

Your `notify` command now hears about every `delivery run --sources`, however it ends, including a run that started no task because something was in the way and a run that found nothing to do.

A `command` source can now say `"tracker": true` and answer `<command> raise`: a follow-up an agent adds while working one of its items is then kept out of the delivered work and raised in your tracker once your closer has taken the delivery branch, once only. Command sources that do not opt in behave as before.

Add `after` to your config file to run steps once a run's work has landed and your closer has taken it: a command such as a deploy, optionally confirmed by a `check`, or an agent pass such as writing release notes. A step that does not work stops the rest, which wait and are tried first on the next run, as your config then defines them; a later run that runs the same steps supersedes them, so an older commit is never redeployed over a newer one. A workflow can carry its own `after` in place of the project's.
