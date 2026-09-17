---
"delivery-service": minor
---

A project can now describe itself once, in its own words, and have every agent hear it. A
`domain` setting in `delivery.config.json` holds a sentence or two about the project: what it
is, what it is built with, anything an agent should know before it starts. Every run started
from that file keeps the description as it was written when the run began, and puts it ahead of
each agent's own instructions, for the worker and for gate maintenance alike. Editing the
description changes the next run, never one already going. A description that is there but
empty stops the command at once, saying so and offering the two ways out. A file with no
`domain` behaves exactly as it did before.
