# Set it up by answering a few questions

If you would rather not write the config file yourself:

```bash
delivery init
```

It asks a few things: a sentence or two about your project (press Enter to skip), what command
checks the agent's work (offering your project's own `npm test` when it has one), what should
happen to work that passes, and what you would like done, one thing at a time until you press
Enter on an empty answer. When you list more than one thing, it also asks whether to work on
some of them at the same time, saying what that costs and suggesting 2. Say yes and it asks how
many: press Enter for 2 or type another whole number of 1 or more, and it writes that as
`concurrency`. Say no, or press Enter, and it writes nothing about it, so the list is worked
through one at a time. It writes the answers to a `delivery.config.json` at the top of the
repository, which `delivery validate` checks and the next `delivery run` works through with
no flags at all. If there is already a config file there, it asks before replacing it and leaves
it as it was if you say no.

It asks questions, so it needs a terminal. Run in a pipe or in CI it says so and stops, rather
than guessing an answer on your behalf.
