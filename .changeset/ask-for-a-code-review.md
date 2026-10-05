---
"delivery-service": minor
---

`delivery review code` reviews your project with nothing configured. An agent reads your last commit,
without being able to change anything, and the harness prints a numbered list of problems in plain
words: where each is, what is wrong, why it matters, what fixed looks like and how it would know it
was fixed. Each problem is checked against your project first; one it cannot find is listed under
`delivery findings --unconfirmed` instead. `delivery findings` reads the latest review back, one
problem in full with `delivery findings <n>`, and `delivery packs` lists the reviews available. A
review is kept under `.delivery/packs/`, and one interrupted after the agent replied is finished by
running the command again. The built-in reviews now ship in the package under `packs/`.
