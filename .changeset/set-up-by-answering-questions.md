---
"delivery-service": minor
---

A project can now be set up by answering a few questions. `delivery init` asks what command
should check the agent's work, offering the project's own `npm test` when it has one; what
should happen to work that passes, from the three built-in choices with a line saying what each
one does; and the first thing you would like done. It writes those answers to a
`delivery.config.json` at the top of the repository, which the next `delivery run` uses with no
flags at all. An existing config file is never replaced without being asked about first, and
because the command asks questions, it says so and stops when there is no terminal to answer in.
