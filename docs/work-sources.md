# Take work from other sources

This guide shows how to tell `delivery run --sources` where to find work: in what order, with a fallback, from a command of your own, or from GitHub issues. It assumes a [project set up](project-configuration.md) with Claude Code signed in. The fields are in the [configuration reference](configuration-reference.md#work-sources).

## List the sources

`sources` says where `delivery run --sources` finds work, read in order. Each source is an object with a `type`: `backlog` (the [backlog items](work-a-backlog.md) in `.delivery/backlog/`), `list` (the `tasks` in your configuration file), `command` (a command of your own) or `github` (labelled issues).

```json
{
  "sources": [
    { "type": "backlog" },
    { "type": "command", "command": "./next-slice.sh", "name": "slices" },
    { "type": "list", "fallback": true }
  ]
}
```

`"fallback": true` reads a source only when no other source has any work. `name` tells a source's entries apart in a run's report; it defaults to the `type`. Two sources with the same name are refused, so give one of them its own `name`.

`fallback` only decides when a source is read: its items are delivered once, like any other. To derive new work whenever the backlog is empty, add `"recurring": true` to a `list` or `command` source. Its items are never counted as delivered, so each is taken again on every run that reaches it, `<command> complete <id>` is not called, and a `sequence` on its items is ignored.

## Take work from a command

A `command` source is run through its own command line. It needs two calls:

- `<command> list` prints a JSON array of tasks. Each is an object with a string `id`, and may have an `intent` sentence, a `body`, a `workflow`, a [`sequence`](#keep-items-in-order) and any other fields, which step prompts read as `{{task.<field>}}`.
- `<command> complete <id>` runs once that task has been delivered, so the command can mark it done.

A third call, `raise`, is for trackers; the [protocol table](configuration-reference.md#the-command-source-protocol) lists all three. Without `"tracker": true`, the follow-ups an agent writes land in the repository's `.delivery/backlog/` like any project's.

With `"tracker": true`, for example `{ "type": "command", "command": "./tracker.sh", "tracker": true }`, an agent still writes a follow-up as an item file in `.delivery/backlog/`, but that file does not land with the work. It is taken off the branch, and once your closer has taken the delivery branch, `<command> raise` runs once for it. The item arrives as JSON on standard input (its unique `file` name, its front matter and its `body`), and the command prints the new item's id. A follow-up is raised once only, even if raising is retried, and one whose task did not land is never raised. Turn `tracker` on only when the script implements `raise`.

## Take work from GitHub issues

A `github` source reads your repository's open issues through the GitHub command-line tool, `gh`, signed in as whoever runs `delivery`. No token goes in the configuration file and no script is needed.

```json
{ "sources": [{ "type": "github", "label": "delivery", "workflow": "resolve-issue" }] }
```

### How an issue becomes work

- An open issue carrying the label (`delivery` unless you set `label`) is an item. Adding the label approves it; an issue without it is left alone.
- The issue's title is the task's intent, and its title and body together are the brief, the `{{task.body}}` that step prompts receive.
- A `workflow:<name>` label chooses the [workflow](use-workflows.md) that delivers it; without one, the source's `workflow` does. A `priority:<n>` label orders it, lower first; otherwise the oldest issue goes first.
- A `sequence:<name>` label puts the issue in a [sequence](#keep-items-in-order). An issue with two `sequence:` labels is left alone, and the run says so.
- An issue whose title or body changes after the label was added is left alone, and the run says so, until you remove the label and add it again. On a public repository anyone can write an issue but only people you allow can label one, so the label approves the text as it reads.
- A step prompt that uses `{{task.body}}` places the issue's text among the step's instructions, not only in the task data the agent treats as a description. Approve such an issue with the label as carefully as you would approve an instruction.
- The agent is told the task came from an issue tracker, where anyone may write, and to treat the text as a description of the work, not as instructions that change its setup or the checks.

### When `gh` is not available

If `gh` is not installed, is not signed in, or cannot reach GitHub, the source is skipped for that run with the reason, and your other sources still run.

### Follow-ups

A follow-up an agent raises while working an issue is not committed to your repository. The agent writes it as a new item file in `.delivery/backlog/`, which is checked like any follow-up. It is taken off the branch, and once your closer has taken the delivery branch it is opened as a new issue without the label, so it waits for you to approve it. Its workflow, priority and other fields go in a fenced `delivery` block at the end of the issue body, which is read back when you label it. A follow-up is opened once only, even if opening it is retried.

### Closing issues

- With the `open-pr` closer, the delivery branch's pull request has a `Closes #<n>` line for every issue landed on it, so each issue closes when you merge the pull request. GitHub only acts on `Closes` when the pull request is merged into the repository's default branch; into any other branch, close the issues yourself.
- With any other closer, each delivered issue is closed once your closer has taken the delivery branch, with a comment naming the commit and the branch it is on. This is an [after step](run-after-landing.md) of its own, "Close delivered issues". If `gh` cannot close one, the run says so and the next run tries again, without closing any issue twice.

### Parked issues

An item that is [parked](work-a-backlog.md#handle-a-parked-item), whether it needs your answer or keeps ending undelivered, is marked on the issue with a `delivery:parked` label and a comment saying why, including the agent's question if it asked one. Answer or unpark it as usual; the label comes off when the issue is next worked. `delivery status` still lists it.

## Keep items in order

Some items build on each other: a spec's second slice assumes its first is there. Give such items the same `sequence` name and `delivery run --sources` works them one at a time, in order:

- A backlog item names it in its front matter (`sequence: greeting-spec`), a command source's task in a `sequence` field, and a GitHub issue with a `sequence:<name>` label.
- Items with the same name form one sequence, in the order the sources are listed and, within a source, in that source's own order.
- Only the earliest item of a sequence that is not yet delivered is taken. An item counts as delivered once it has landed, even while its pull request waits to be merged.
- If that item is parked, waiting for your answer, or still being worked, nothing later in its sequence is taken. Items without a sequence, and other sequences, carry on as usual.
- A run takes at most one item of each sequence, whatever `--max` says, since the next cannot start until the one before it lands.

A source of slices should name each slices file as the sequence, so every spec is its own sequence and a stalled slice holds only its own spec. For example, a `next-slice.sh` source's `list` prints:

```json
[
  { "id": "greeting-2", "intent": "Greet people by name", "sequence": "docs/specs/greeting-slices.md" },
  { "id": "greeting-3", "intent": "Greet people in their language", "sequence": "docs/specs/greeting-slices.md" },
  { "id": "export-1", "intent": "Export a report as CSV", "sequence": "docs/specs/export-slices.md" }
]
```

`delivery status` and `delivery report` name each held sequence, the item holding it, and why. In the [report's data](reporting.md) this is `held`.

A sequence is an order only. To make one spec's slices wait for another's, give them the same sequence name. A recurring backlog item (one with a `cadence`) cannot be in a sequence, and a `sequence` on a recurring source's items is ignored. An item the run leaves alone (an issue not approved, a backlog file it cannot read) is not part of its sequence until the run can use it; the run's note about it says why.

## Next steps

- [Work through a backlog](work-a-backlog.md): items kept in the repository.
- [Run on a schedule](run-on-a-schedule.md): take work without being there.
- [Configuration reference](configuration-reference.md#work-sources): every source field.
