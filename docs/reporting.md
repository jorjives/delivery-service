# Reports as data

Everything `delivery report`, `delivery status` and `delivery status --watch` say in words is
also available as data, for a dashboard, a script or a CI step. There are two formats. Each
names its own version, and both come with a published schema and a promise about what will not
change.

In the data, a task is called a surface: `surfaces`, `surface` and `surfaceId` all mean a task
(see the [glossary](glossary.md#surface)). The `breaker` key describes the
[shared environment](shared-environment.md).

| You want | Run | You get |
|---|---|---|
| Where everything stands, once | `delivery report --json` | One `delivery.report/1` document |
| The same, with what `status --json` always printed | `delivery status --json` | The keys it always printed, and the document under `report` |
| Each change as it happens | `delivery status --watch --json` | One `delivery.event/1` event per line |
| The schema of both | `delivery report --schema` | One JSON Schema for each format |

With `--json`, standard output holds only data: no colour, and no sentence meant for a person.
Anything said alongside goes to standard error. A command that cannot answer (a run id that
names nothing) says so in words on standard error and exits 2.

## The report document

`delivery report --json` prints one `delivery.report/1` document about your task list, as
`delivery report` does. `delivery report <run-id> --json` prints it about one task's run, or
about one run of several tasks at once. A run saves the document as `.delivery/last-report.json`
when it ends.

```bash
delivery report --json
```

Every key is always present. Where a key does not apply its value is `null`, or `[]` for a list,
so you never need to check whether a key is there. That holds inside a cause too: a task's
`cause` and a trip's `cause` each name every key their kinds can have, with `null` where the
kind has none.

| Key | What it holds |
|---|---|
| `schema` | Always `"delivery.report/1"` |
| `kind` | What the document is about: `"list"`, `"run"` or `"task"` |
| `live` | Whether the work is going right now: `true`, `false`, or `null` when nothing records it. It is never guessed from how old a file is |
| `incomplete` | One entry for each record that could not be read: its `run`, the damaged `file`, and its place on the list as `queue`. When it is not empty the document is incomplete; every task that could be read is still in `surfaces` |
| `counts` | How many tasks stand in each standing: `closed`, `escalated`, `aborted`, `paused`, `unfinished`, `queued`, `not_started` |
| `run` | The run of several tasks at once the document is about, or `null` when there is none |
| `surfaces` | One entry for each task |
| `trips` | Each time the shared environment broke: the `cause` (its `kind`, the `surfaceId` of the task whose report tripped it, and either a `reason` or the `surfaceIds` of every task counted, whichever the kind does not have being `null`), the tasks `held`, every one of the `repairs` tried, how it `ended`, the `reason` and any usage `limit`. Empty when there is no run of several tasks |
| `usage`, `usageRecorded` | What the agent sessions behind everything the document reports took and cost, and how many sessions that covers. See [Time and cost](#time-and-cost) |
| `parked` | The backlog items this machine's item ledger has set aside, oldest key first, each with its `item` key, its `intent`, the `reason` it is parked (`"decision"`, `"escalated"`, `"attempts"` or `"held"`), the `question` it is waiting on, its `attempts`, and the `lastRun` that ended it. Empty when nothing is parked or the machine has no ledger |
| `held` | The [sequences](work-sources.md#keep-items-in-order) waiting behind an earlier item, as the latest `delivery run --sources` found them, each with its `sequence` name, the `item` key holding it, and the `reason` it has not moved on: `"parked"`, `"decision"` (waiting for your answer) or `"in_flight"` (being worked). An entry whose item has since been unparked, answered or delivered is left out. Empty when no sequence is held or no run has looked |
| `delivery` | The delivery branch this machine's `delivery run --sources` runs land their tasks on, or `null` when none was ever opened: its `branch` and the `base` it is for, `openedAt`, its `tip` (`null` once your closer has merged and deleted it), every task `landed` on it since it opened (each with its `run`, `item` key, `intent`, the delivery branch's `commit` that holds it, and `at`), what your `closer` last did with it (`status`, `detail`, `at`, or `null`), and what `blocked` it (`reason`, `at`, or `null`), and `stack`: its levels bottom up, each with its `run`, `item` key, `intent`, level `ref`, the `commit` that holds it, and its `pr` (`url` and `state`, one of `"OPEN"`, `"MERGED"` or `"CLOSED"`, or `null` before one was seen). Empty when the closer is not in stack mode. An item that landed no changes of its own is delivered but has no level |
| `after` | The after-landing steps this machine's `delivery run --sources` runs ran: every batch still waiting on a step, then the most recent, oldest first, each with its `batch` id, the `branch` and `commit` that landed, when it began (`at`), the tasks `landed` (each with its `run`, `item` key and `intent`), and its `steps`, each with the `after` list it came `for` (`"project"`, a workflow's name, or `"follow-ups"`), its `label`, its `status` (`"done"`, `"failed"`, `"skipped"` (superseded by a later batch, dropped, or gone from the config) or `"pending"`), the `detail` of what happened, and `at`. Empty when none ran |

`run`, when there is one:

| Key | What it holds |
|---|---|
| `runId`, `startedAt` | Which run, and when it started |
| `tasks`, `concurrency` | How many tasks the list held when it started, and how many it works on at once |
| `governs` | Whether the run says how the document's tasks stand. Always `true` in a document about the run itself. In a document about your task list it is `true` while the run goes and until a task of the list is worked on its own after the run began. From then on it is `false` and the run is only history |
| `breaker` | How the shared environment stands: `HEALTHY`, `DEGRADED` or `REPAIRING` |
| `outcome`, `finishedAt` | `"drained"` (every task it could take has ended) or `"escalated"` (it stopped), and when; `null` while it has not ended |
| `lastActivityAt` | The latest time its record holds |
| `reason`, `cause`, `limit` | Why it stopped, when it did: the recorded reason, `"shared_environment"` or `"usage_limit"`, and which usage limit |
| `runBudgets` | How many shared repairs it used, of how many it allows |

Each entry of `surfaces`:

| Key | What it holds |
|---|---|
| `task`, `queue` | The task as it is written, and its place on the list (`task` of `of`), or `null` for a task the list does not ask for |
| `tags` | What the task says of itself, copied from its own `tags` when each value is a string, number or true/false, otherwise `null`. A fix of a problem a review found carries `pack`, `findingId`, `severity` and `phase` (`"fix"`) |
| `run` | The id of the task's own run, or `null` for a task with no run yet |
| `standing` | Where the task stands, by the names `counts` uses |
| `state`, `states` | The step the record is in, and every step it entered, oldest first, each with the time `at` it was entered |
| `startedAt`, `finishedAt`, `lastActivityAt` | When it started and ended, and the latest time its record holds |
| `reason`, `cause` | The recorded reason for a stop, and its cause: a `kind`, with the `role` or `population` it concerns, for `"landed_outside_closer"` (the agent opened a pull request for the task's branch itself) the `pullRequest` it opened; and for `"decision"` (the agent asked the operator a question) the `question`, word for word; each of these the kind does not have is `null`. `cause` is `null` for a stop recorded before causes were |
| `closer`, `branch`, `base` | How its work is landed, and where. `closer` is `"delivery-branch"` for a task a `--sources` run landed on the delivery branch, whose `base` is then that branch |
| `fence` | Whether the task's agent sessions ran inside the write fence: the `mode` the run was set to, whether it was `present`, and the `reason` when it was not. `null` for a run recorded before the fence was |
| `guards` | How the task's test guards differ from the defaults: the guards it `added` and those it turned `off`. `null` when it kept the defaults |
| `workflow` | The workflow step the task is on: the workflow's `name`, the `step` number, how many steps it is `of`, and the step's name as `stepName`. `null` for a task run without a workflow. A task in a workflow reports its `budgets` for the step it is on |
| `attempts` | How many times the agent was set to work on it |
| `budgets` | Each kind of retry: its `population`, how many were `used` and the `max` allowed |
| `decisions` | Every triage round, oldest first: `afterAttempt`, `trigger`, `verdict`, the `rationale` word for word, and the `brief` or `packet` the round produced. `recorded` is `false` when what the round wrote can no longer be read |
| `repairs` | Every repair that ran in the task's working copy, oldest first. Each entry is described in its own table |
| `usage`, `usageRecorded` | The same for the task's own agent sessions. See [Time and cost](#time-and-cost) |
| `item` | The work-source item the task was, such as `backlog:x.md`; `null` for any other task |
| `limit` | The usage limit that stopped its last session, when one did |
| `escalation` | The packet the task stopped with, word for word: `decision`, `evidence`, `dead_ends`, `why_now`, `references` |
| `plain` | For a stopped task, the stop in plain words: the `group` it is reported under, the `audience` who must act (`owner`, `engineer` or `unknown`), the `sentence`, what the agent last said as `agentSaid`, and what to do `next` |

Each entry of `repairs`:

| Key | What it holds |
|---|---|
| `of` | `"check"` for the task's own repair of its check, `"setup"` for its run's repair of the setup every task shares, which ran in this task's copy |
| `attempt`, `max` | Which repair of how many its limit allows |
| `at` | When it was set going |
| `status` | How its session ended: `"completed"`, `"escalate"` or `"incomplete"`; `null` while it is still going |
| `recorded` | `false` when the record does not hold what it changed: a repair from before changes were kept, one still going, or one whose record of them cannot be read. `files` is then empty because the record cannot say |
| `files` | Each file it changed: its `path`, its `status` (`"added"`, `"modified"` or `"deleted"`; a rename is a deleted file and an added one), the lines `added` and `removed`, `touchesCheck` (the check runs this file: a custom check's module, or a command's first word), and the `patch`, which is `null` for a binary file or once the 256 KiB kept per repair is used |
| `truncated` | Whether any patch was left out |

`touchesCheck` says only that the path is one the check runs. Nothing in the document says
whether a change was safe, and nothing a run does depends on it.

## Time and cost

`usage` holds `costUsd`, an estimated cost in US dollars, and `durationMs`, how long the agent
sessions took in milliseconds. Each is added up over the sessions for which the agent runtime reported both.
The figures are the runtime's own: the harness counts no tokens and keeps no prices, so
the cost is an estimate. `usage` is `null` when no session reported them, never `0` for lack of
data.

`usageRecorded` says how complete the figure is: `recorded` sessions of the `sessions` that ran.
The figure covers everything only when the two are equal.

A task's sessions are each time its agent was set to work, each of its own repairs of the check,
and each triage round an agent decided. Not counted are a round the rules decided (no session
ran), a session the agent runtime never started, and a session still going (not recorded yet).

The document's figure adds up its tasks' figures and, for a run of several tasks, that run's
repairs of the shared environment. A task's figure leaves those out. A run made before these
counts were kept shows `recorded` as `0`.

Nothing a run does depends on these figures: no run is stopped, slowed or changed because of them.

## What `delivery status --json` prints

`delivery status --json` prints every key it always has, with the same names and meanings (see
[See what happened to a run](check-a-run.md)), and one more: `report`, which holds
the `delivery.report/1` document for the same run. It is exactly what `delivery report <run-id>
--json` prints, so a script that already reads `status --json` finds the retry budgets, the
state history and every triage round under `report.surfaces`. `delivery status --decisions
--json` prints the same document: the rounds are already in it in full.

`delivery status --all --json` is unchanged: the list of runs as an array.

## The event stream

This prints one `delivery.event/1` event per line, as newline-delimited JSON. It follows your
task list or the run you name, as `delivery status --watch` does:

```bash
delivery status --watch --json
```

The output looks like this:

```text
{"schema":"delivery.event/1","run":null,"surface":null,"seq":0,"subject":"list","at":null,"type":"stream_started"}
{"schema":"delivery.event/1","run":null,"surface":"fix-the-broken-footer-links-20261001T022000Z","seq":0,"at":"2026-10-01T02:20:00.000Z","state":"AGENT_ACTIVE","from":null,"attempt":1,"type":"surface_state"}
{"schema":"delivery.event/1","run":null,"surface":"fix-the-broken-footer-links-20261001T022000Z","seq":1,"at":"2026-10-01T02:24:30.000Z","type":"surface_outcome","outcome":"closed"}
{"schema":"delivery.event/1","run":null,"surface":null,"seq":0,"subject":"list","at":"2026-10-01T02:24:30.000Z","type":"stream_ended","ending":"ended","counts":{"closed":1,"escalated":0,"aborted":0,"paused":0,"unfinished":0,"queued":0,"not_started":0},"runOutcome":null,"surfaceOutcome":null}
```

Every event carries the same six keys:

| Key | What it holds |
|---|---|
| `schema` | Always `"delivery.event/1"` |
| `type` | What kind of event this is |
| `run` | The run of several tasks at once it belongs to, or `null`. A list worked one task at a time, or worked on its own since a run took one of its tasks, has no run of its own, so it is `null` there |
| `surface` | The id of the task's own run, or `null` for an event about the run as a whole |
| `seq` | The position, in the log it came from, of the entry this event tells |
| `at` | When that entry was recorded, or `null` for a record made before steps carried a time |

| `type` | When | What else it carries |
|---|---|---|
| `stream_started` | Always the first line | `subject`: `"list"`, `"run"` or `"task"` |
| `surface_state` | A task's log gained an entry | `state`, the step the task is now in; `from`, the step before; `attempt` |
| `triage_decision` | A task's log gained a triage round | What `surface_state` carries, and `afterAttempt`, `trigger`, `verdict`, `rationale` |
| `surface_outcome` | A task ended | `outcome`: `closed`, `escalated` or `aborted` |
| `breaker_changed` | The setup a run's tasks share broke, or was repaired | `state` |
| `repair_started` | A repair of that setup started | `attempt`, `of` |
| `repair_finished` | That repair's session ended | `status` |
| `run_outcome` | A run of several tasks ended | `outcome`, `cause`, `reason` |
| `stream_ended` | Always the last line | `subject`, `ending`, `counts`, `runOutcome`, `surfaceOutcome` |

The first line says what is being followed. Then comes one event for every step already
recorded, then one for each step as it is recorded. The stream is over when `stream_ended`
arrives, so a reader knows when to stop without watching the process. Its `ending` says why:

| `ending` | Meaning | Exit code |
|---|---|---|
| `ended` | What was followed recorded its ending. `runOutcome` is the outcome of a run of several tasks; `surfaceOutcome` is one task's outcome, or the outcome of the task that stopped a list worked one at a time | The code that run ended with |
| `stopped_part_way` | A run of several tasks is known to have been stopped with no ending recorded | 0 |
| `unreadable` | The record of what was followed is damaged | 0 |
| `nothing_recorded` | The folder holds no run to follow | 0 |

Every event between the two markers is one recorded entry, never a difference between two looks
at the record. Replaying a finished run therefore prints the same lines that following it
live printed. Within one task the order is the order of its log. Across tasks working at
the same time the order is by recorded time, so two tasks' events can interleave differently
between a live watch and a replay.

Where nothing records whether the work is still going, the stream waits. It never decides
that a run is dead.

## The schema

`delivery report --schema` prints one JSON object holding a JSON Schema (draft 2020-12) under
each format's name, `delivery.report/1` and `delivery.event/1`. It needs no project and reads no
record:

```bash
delivery report --schema
```

The harness generates the schema from the definitions it validates its own data with, so the two
cannot drift apart, and every document and event the commands print is valid against it.

The schema is open on purpose, to match the promise in [What will not change](#what-will-not-change).
No object forbids a key it does not name. A value that is one of a set of names (`standing`, `outcome`, `verdict` and the like) is
published as a string, with the names in use today listed as `examples`. An event whose `type`
the schema does not name is valid so long as it carries the six keys every event carries.

An event of a known `type` is validated only for the six keys every event carries. The schema
does not check the keys that type requires. A `surface_state` event lacking a `state` field
still passes validation. The stability promise holds those keys; the published
schema enforces only the envelope.

## What will not change

Within a version (the `/1` in `delivery.report/1` and `delivery.event/1`):

1. No key is ever removed, renamed or given another type, and no name a value can take is ever
   removed. The harness's own test suite fails if one is.
2. New keys, new names and new event types may be added. Ignore keys you do not know, and
   treat a name or an event type you do not know as "other" rather than as an error.
3. A change that breaks this is a new version, which you must ask for.
4. The keys `delivery status --json` printed before it carried `report` are under the same
   promise.
5. Do not parse sentences meant for people. `plain.sentence`, `plain.next`, `plain.agentSaid`,
   `reason`, `rationale`, and the `summary` and `details` of `status --json`, are words for a
   reader and may be reworded. Decide on `standing`, `cause.kind`, `plain.group`,
   `plain.audience`, `outcome` and `verdict`.

Outside the promise: the step-by-step lines `delivery run --json` and `delivery resume --json`
print while a run happens. They are the running command's own account of itself, they carry no
version, and they stay as they are. To follow a run from a script, use `delivery status --watch
--json`.

## From your own code

The functions the commands are built on are part of the TypeScript library, which a project installs separately from the command (see
[Get started](getting-started.md)). Run this as an ES module (a
`.mjs` file, or `"type": "module"` in your `package.json`), because it uses top-level `await`:

```ts
// reporting from your own code
import { deriveReport, eventsOf, loadSnapshot, publishedSchema, renderText, repoLocked, ReportDocument, ReportEvent } from "delivery-service";

const repo = process.cwd();
const snapshot = await loadSnapshot(repo, { kind: "list" }, { live: await repoLocked(repo), list: [{ intent: "Add a contact form" }] });
const report = deriveReport(snapshot); // the delivery.report/1 document
const events = eventsOf(snapshot); // its delivery.event/1 events, in order
const text = renderText(report, { colour: false }); // the lines `delivery report` prints
ReportDocument.parse(report);
events.forEach((event) => ReportEvent.parse(event));
console.log(text.join("\n"), Object.keys(publishedSchema()));
```

`loadSnapshot` is the only one that reads the disk. It takes what to report on (`{ kind: "list"
}`, `{ kind: "run", runId }` or `{ kind: "task", runId }`), whether a run holds the repository
(`repoLocked` answers that) and the task list. The rest are pure: the same snapshot always gives
the same document, events and text. `ReportDocument` and `ReportEvent` are the zod schemas the
data is validated with, `publishedSchema()` is what `delivery report --schema` prints, and
`streamStarted` and `streamEnded` build the two marker events.

## See also

- [Read the report](read-a-report.md): the same report in words.
- [See what happened to a run](check-a-run.md): `delivery status` and its output.
- [Command reference](cli-reference.md#machine-readable-output): `--json` on each command.
