---
"delivery-service": minor
---

A new guide, `docs/project-configuration.md`, sets up a whole project from start to finish in
an example project that ships with the harness, `examples/project-configuration-example`: it
describes the project in `domain`, lists what to do in `tasks`, chooses a built-in check and
closing action, narrows the worker's tools in `roles`, then checks the setup with `delivery
validate`, reads the agent's instructions with `delivery preview`, runs the whole list with
`delivery run`, and adds to the list afterwards. A test runs the guide's own commands, so what
it shows is what the command prints. Getting started now points to it as the next step.
Nothing about the command itself changes.
