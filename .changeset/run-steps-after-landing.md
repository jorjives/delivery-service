---
"delivery-service": minor
---

Your `notify` command now hears about every `delivery run --sources`, however it ends, including a run that started no task because something was in the way and a run that found nothing to do.

A `command` source can now say `"tracker": true` and answer `<command> raise`: a follow-up an agent adds while working one of its items is then kept out of the delivered work and raised in your tracker once your closer has taken the delivery branch, once only. Command sources that do not opt in behave as before.
