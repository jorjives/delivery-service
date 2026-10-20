# Set up with questions

This guide shows how to create a `delivery.config.json` by answering questions instead of writing the file yourself.

To create the config file by answering questions:

```bash
delivery init
```

It asks for:

- a sentence or two about your project (press Enter to skip);
- the command that checks the agent's work, offering your project's own `npm test` when it has one;
- what should happen to work that passes;
- what you would like done, one thing at a time, until you press Enter on an empty answer.

When you list more than one thing, it also asks whether to work on some of them at the same time,
says what that costs and suggests 2. Say yes and it asks how many: press Enter for 2 or type
another whole number of 1 or more, and it writes that as `concurrency`. Say no, or press Enter,
and it writes no `concurrency`, so the list is worked one task at a time.

It writes the answers to a `delivery.config.json` at the top of the repository. `delivery validate`
checks that file, and the next `delivery run` works through it with no flags. If a config file is
already there, `init` asks before replacing it and leaves it as it was if you say no.

`init` asks questions, so it needs a terminal. In a pipe or in CI it says so and stops, rather
than guess an answer.

## Next steps

- [Check your setup](check-your-setup.md): validate the file and preview what the agent is told
- [Configuration reference](configuration-reference.md): every setting
