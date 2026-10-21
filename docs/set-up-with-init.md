# Set up with questions

This guide shows how to create a configuration file, `delivery.config.json`, by answering questions instead of writing it yourself. It is for anyone setting up a project of their own.

Run it in the git repository you want to set up, in a terminal:

```bash
delivery init
```

It asks for:

- a sentence or two about your project (press Enter to skip); it becomes `domain`;
- the command that checks the agent's work, which becomes `gate`. If your `package.json` has a `test` script, it offers `npm test` and Enter accepts it. If not, there is no default and you must type a command;
- what should happen to work that passes, which becomes `closer`. The choices are to commit it to a branch of its own (the default), to merge it into the branch you started from, or to open a pull request (this needs a remote and a signed-in `gh`);
- what you would like done, one thing at a time, until you press Enter on an empty answer. Each answer becomes an entry under `tasks`.

When you list more than one thing, it also asks whether to work on some of them at the same time,
and says what that costs. If you say yes, it asks how many: press Enter for 2, or type another
whole number of 1 or more, and it writes that as `concurrency`. If you say no, or press Enter, it
writes no `concurrency`, so the list is worked one task at a time.

When it has all the answers it writes the file and tells you where:

```text
Written <path>/delivery.config.json. To start the run: delivery run
```

The file is written at the top of the repository, whichever folder you ran the command from. For
the answers in [Check your setup](check-your-setup.md) it looks like this:

```json
{
  "tasks": [
    "add a page that shows who's on call today",
    "let someone swap their on-call day with a teammate",
    "send a reminder the morning before someone's on-call day starts"
  ],
  "domain": "A small internal tool that tracks who's on call this week. Node.js, Express, a SQLite file for storage.",
  "gate": {
    "type": "command",
    "command": "npm test",
    "parseMode": "exitcode"
  },
  "closer": {
    "type": "commit-to-branch"
  }
}
```

`delivery validate` checks that file, and the next `delivery run` works through it with no flags.
To set up a repository other than the current one, add `--repo <path>`.

## If it does not start

If a configuration file is already there, `init` asks before replacing it and leaves it as it was
if you say no:

```text
Left <path>/delivery.config.json as it was. Nothing has changed.
```

`init` asks questions, so it needs a terminal. In a pipe or in CI it exits with code 2 and prints:

```text
`delivery init` asks you a few questions, so it needs a terminal to type the answers in. Run it in a terminal, or write a delivery.config.json yourself: the README says what goes in it.
```

Outside a git repository it exits with code 2 and prints:

```text
This isn't a git repository yet. The harness needs one to track changes: run `git init` here, or point `--repo` at one.
```

To write the file yourself, see the [Configuration reference](configuration-reference.md).

## Next steps

- [Check your setup](check-your-setup.md): validate the file and preview what the agent is told
- [Configuration reference](configuration-reference.md): every setting
