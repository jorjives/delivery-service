---
"delivery-service": minor
---

`delivery init` now sets up a whole small project. Before its other questions it asks for a
sentence or two about the project, which can be skipped, and at the end it asks what you would
like done one thing at a time until you press Enter on an empty answer. The description is
written as the project's description and the answers as its list of tasks, even when there is
only one, so `delivery validate` accepts the file and `delivery run` works through the list
straight away. A blank first answer, or the same thing said twice, is asked again rather than
written.
