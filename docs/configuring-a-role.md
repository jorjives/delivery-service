# Configuring a role

This guide gets you from nothing to a first successful agent invocation for any
of the three roles a run dispatches: the **worker**, **gate-maintenance** and
**triage**. You do not need to read any source to follow it. A fourth role, the
**scanner**, reviews a project for `delivery review`; it is configured by the
review, not by you, and is read-only exactly as triage is.

## What a role is

The harness has one way of running an agent: `invoke(roleCfg, ctx)`. It starts one
fresh agent session, sends it a prompt the harness assembles from the case file,
and hands back exactly one result. A **role** is nothing more than the
configuration you pass as `roleCfg`. You never write invocation code for a new
role; you write a new configuration.

A role configuration has four fields:

| Field | What it is | What happens if it is wrong |
|---|---|---|
| `role` | `"worker"`, `"gate-maintenance"`, `"triage"` or `"scanner"`; `triage` and `scanner` may use only `Read`, `Glob` and `Grep` | Rejected before any session starts |
| `systemPromptFragment` | Who the agent is and what it is for, in plain sentences. Must not be empty. | Rejected before any session starts |
| `envelopeSchema` | The reply shape the agent must end with. Use `WorkerEnvelope` for the worker and gate-maintenance, and `TriageEnvelope` for triage. | Rejected before any session starts |
| `allowedTools` | The tools the agent may use, e.g. `["Read", "Edit"]`. Must not be empty. This is the role's entire blast radius. | Rejected before any session starts |

A mistake in any field throws `InvalidRoleConfig`, naming the field, before an
agent is started. It is never reported as a failed run.

Everything below is imported from the harness's single entry point,
`delivery-service`. Install it in your project as
[Getting started](getting-started.md) describes, then run the snippets with
`npx tsx`.

## The two reference configurations

Start from one of these. Copy it, change the sentences to suit your project, and
narrow the tools if you want.

**Worker**: makes the change the task asks for, inside the working tree.

```ts
import { WorkerEnvelope, type RoleConfig } from "delivery-service";

export const myWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: [
    "You are the worker on a gated delivery harness.",
    "You make the smallest change to the working tree that satisfies the task below.",
    "If you cannot proceed and no further attempt would help, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
};
```

**Gate-maintenance**: repairs the environment so the project's checks can run,
and never touches the checks themselves.

```ts
import { WorkerEnvelope, type RoleConfig } from "delivery-service";

export const myGateMaintenance: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: [
    "You are gate maintenance on a gated delivery harness.",
    "Repair the environment inside the working tree so that the gate can run again.",
    "You never edit, weaken, or work around the checks themselves.",
    "If the only fix is a change to a check, escalate instead.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob", "Grep", "Edit", "Write"],
};
```

The two are also exported ready-made as `workerRoleConfig` and
`gateMaintenanceRoleConfig`.

The only differences between them are the sentences and the tool list. The call
you make is identical.

## From the configuration file

A project using the `delivery` command can change the worker's and gate
maintenance's instructions and tools in its `delivery.config.json`, with no code:

```json
{
  "roles": {
    "worker": {
      "systemPromptFragment": "You are the worker for the on-call service. Never modify anything under the ops folder.",
      "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"]
    },
    "gateMaintenance": { "allowedTools": ["Read", "Glob", "Grep", "Edit"] }
  }
}
```

| Key | What it changes |
|---|---|
| `roles.worker.systemPromptFragment` | The worker's instructions, in place of the reference sentences above |
| `roles.worker.allowedTools` | The tools the worker may use, in place of its reference list |
| `roles.gateMaintenance.systemPromptFragment` | Gate maintenance's instructions |
| `roles.gateMaintenance.allowedTools` | The tools gate maintenance may use |

Each field is optional. Anything you leave out keeps its built-in value, so
overriding only `allowedTools` keeps the reference instructions, and a project
with no `roles` runs exactly as before. The reply shape (`envelopeSchema`) is not
a setting: it stays the harness's own. Triage cannot be changed from the file: its
tools are read-only by design (see [Triage](#triage)), and it stays a choice made
in code.

A run keeps the roles it started with. Editing `roles` changes the next run, not
one already going, and resuming a run tells its agents what they were told before.

`delivery validate` refuses a role other than `worker` or `gateMaintenance`, a
setting other than those two, empty instructions and an empty tools list, each
with the field named and the fix: remove it to keep the built-in one.
`delivery preview` shows the instructions and the tools as your file sets them;
add `--role gate-maintenance` for gate maintenance.

**A misspelled tool name is not caught by `delivery validate`.** No list of valid
tool names is checked, because none could stay in step with the agent runtime you
have installed. A misspelling shows up during a run instead: the tool you meant is
refused to the agent as a tool outside its list (see "What a role cannot do"
below), and the run reports that refusal. If an agent says it was refused a tool
you thought you granted, check the spelling in `allowedTools` first.

Whatever the file lists, a role still works only inside its working tree: the
tool guard below applies to every role, overridden or not.

## Making your first invocation

You need two directories: a **case file** directory (the harness's record of the
run) and a **worktree** (the files the agent works on). `invoke` reads the task
from the case file and runs the agent inside the worktree.

```ts
import { mkdirSync } from "node:fs";
import { create, invoke, gateMaintenanceRoleConfig } from "delivery-service";

const dir = "/tmp/my-run/case";          // the case file directory
const worktreePath = "/tmp/my-run/tree"; // the agent's working tree

mkdirSync(dir, { recursive: true });
mkdirSync(worktreePath, { recursive: true });

await create(
  dir,
  {
    surfaceId: "my-first-run",
    taskDef: { intent: "the gate cannot start: repair its environment" },
    gateRef: { type: "command", command: "npm test", parseMode: "tap" },
  },
  {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  },
);

const result = await invoke(gateMaintenanceRoleConfig, {
  worktreePath,
  dir,
  sessionKey: "gate-maintenance-1-0", // a label for this attempt's transcript
});

console.log(result);
```

To run the worker instead, pass `workerRoleConfig` (or your own worker config).
Nothing else changes.

`invoke` uses the `claude` command on your machine and needs whatever credentials
that command needs. To try it without a real agent or an API key, see "Trying it
offline" below.

## What comes back

Always exactly one of three results:

| `status` | Meaning | What the harness does next |
|---|---|---|
| `completed` | The agent finished and says why, in `rationale`. | Runs the gate to judge the work. The agent's word is never taken as proof. |
| `escalate` | The agent says it cannot go on, with a `category` of `exhaustion` or `authority`. | Stops retrying that step and escalates. |
| `incomplete` | The session produced nothing usable. `rationale` says which of these it was, in plain English: it crashed, it ended without a reply, it replied in the wrong shape, it could not be started, or it tried something it is not allowed to do. | Retries, within the run's budget. |

You will never get a stack trace or raw error text in `rationale`. When a session
errored or could not be started, the underlying error is kept verbatim as `cause` in
`refs/session-error-<session key>.json` beside the case file, so a harness problem
can still be diagnosed without it reaching the person reading the run. When a session
ended without a reply or replied in the wrong shape, the same file keeps what it said
as `agentReply` (the agent's own words, cut to the first 4,000 characters), and, for
the wrong shape, why the role's `envelopeSchema` refused it as `cause`.

## What a role cannot do

Two rules are enforced by the harness itself, not requested of the agent:

1. **Only the tools in `allowedTools`.** Any other tool call is refused before it runs.
2. **Only inside the worktree.** Any call aimed at a file outside the worktree is
   refused before it runs, even with a tool the role is allowed. This is how
   gate-maintenance can edit files but can never edit the project's checks: keep
   the checks outside the worktree and they are out of every role's reach.

A refusal comes back as `incomplete`, with a sentence naming the role, what it
tried, and that the refusal was the boundary working as intended.

One limit to know about: if you grant `Bash`, the agent's shell can write to
places the harness cannot always see. That is why the gate-maintenance reference
configuration does not grant it. Grant `Bash` only to a role you would trust
with the whole machine the run executes on.

## Trying it offline

`claude-mock` is a scripted stand-in for the `claude` command. It is vendored in
`vendor/claude-mock` and installed by `npm install`, so there is nothing else to set
up. `mockSessionEnvironment` points a session at it, with the script it replays and
the journal it writes; pass that as the third argument to `invoke`:

```ts
import { mockSessionEnvironment } from "delivery-service/testing";

const ctx = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
const result = await invoke(
  gateMaintenanceRoleConfig,
  ctx,
  mockSessionEnvironment({ scriptPath: "/tmp/my-run/mock.json", journalPath: "/tmp/my-run/journal.jsonl" }),
);
```

The session makes no network call and needs no API key.

where `/tmp/my-run/mock.json` scripts what the agent does and replies, for example:

```json
[
  {
    "effects": [{ "write": { "path": ".env", "content": "PORT=8080\n" } }],
    "json": { "status": "completed", "rationale": "set the missing PORT in .env" }
  }
]
```

The ready-made demos do exactly this, one per role:

```bash
npm run demo:agent-slice-1   # worker
npm run demo:agent-slice-3   # gate-maintenance
```

The mock does not model tool permissions, so it cannot show a refusal happening
inside a live session. The demos show the refusal by driving the harness's own
decision directly; the live guarantee comes from the real `claude` runtime.

This section is the single-role quick start. To test your gate, closer and role
configurations together through a whole surface against the scripted agent, follow
[Testing your delivery pipeline](testing-your-pipeline.md).

## Triage

Triage decides what happens after a setback: the gate failed, the gate could not
run, the worker gave up, or the close failed. It reads; it never edits. It is the
same kind of role as the other two: one configuration, the same `invoke`.

### The reference configuration

```ts
import { TriageEnvelope, READ_ONLY_TOOLS, type RoleConfig } from "delivery-service";

export const myTriage: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: [
    "You are triage on a gated delivery harness: a read-only classifier.",
    "Read the setback, the remaining budgets and what earlier rounds decided, then choose what happens next.",
    "Your diagnosis is a hypothesis for the next session to test, not an established fact.",
  ].join("\n"),
  envelopeSchema: TriageEnvelope,
  allowedTools: [...READ_ONLY_TOOLS], // Read, Glob, Grep
};
```

It is also exported ready-made as `triageRoleConfig`.

**Triage's tool list is read-only by design. It is not a setting to widen.**
Triage must never change the thing it is judging: the gate is the only proof
that work is good, and a triage session that could edit the worktree could make
a failure disappear rather than explain it. Change the sentences if you like;
keep the tools to `Read`, `Glob` and `Grep`.

### When triage is asked

The harness only calls the triage agent when its answer can change what
happens. Every other setback is settled by a fixed rule, at no cost:

| Setback | The agent is asked when | Otherwise |
|---|---|---|
| The worker lacked authority | never | escalate to a person |
| The worker is stuck | a correction slot is left | escalate once none is left |
| The gate failed | exactly one correction slot is left | retry the worker while more are left; escalate at none |
| The close failed | exactly one close slot is left | retry the close while more are left; escalate at none |
| The gate could not run | gate rechecks are used up and a gate repair slot is left | re-run the gate free while rechecks are left; escalate when both are used up |

### What comes back

`invoke(triageRoleConfig, …)` returns a typed verdict. Which verdicts are
allowed depends on the setback. An answer that is not allowed is escalated
rather than acted on.

| `status` | Allowed after | `payload` |
|---|---|---|
| `reroute` | the gate failed, the worker is stuck | a brief for the next worker: `problem`, `dead_ends`, `scope`, `references`, `diagnosis` |
| `fix_the_gate` | the gate could not run | the same brief shape, for the repair session |
| `retry_close` | the close failed | the same brief shape, kept in the case file and handed to the closer on the retried close as `repairBrief` (the built-in closers ignore it) |
| `escalate` | any setback | a packet for a person: `decision`, `evidence`, `dead_ends`, `why_now`, `references` |
| `abort` | any setback | `{ reason }` |
| `incomplete` | (the harness's own verdict) | none: the session produced nothing usable, and the harness escalates rather than guessing |

### Your first triage invocation

Offline, with `claude-mock` (see "Trying it offline" above). Write the reply the
mock should give to `/tmp/my-triage/mock.json`:

```json
[
  {
    "json": {
      "status": "reroute",
      "rationale": "Worth one more attempt with a sharper brief.",
      "payload": {
        "problem": "The greeting still says hi.",
        "dead_ends": "Attempt 1 edited the template; the text comes from translations.json.",
        "scope": "Touch translations.json only.",
        "references": ["worker-1-0"],
        "diagnosis": "The template reads its greeting from translations.json."
      }
    }
  }
]
```

Then, from the repository root, save the following as `first-triage.ts` and run
it with `npx tsx first-triage.ts`:

```ts
import { mkdirSync } from "node:fs";
import { create, invoke, triageRoleConfig } from "delivery-service";
import { mockSessionEnvironment } from "delivery-service/testing";

const dir = "/tmp/my-triage/case";
const worktreePath = "/tmp/my-triage/tree";
mkdirSync(dir, { recursive: true });
mkdirSync(worktreePath, { recursive: true });

await create(
  dir,
  {
    surfaceId: "my-first-triage",
    taskDef: { intent: "make the greeting say hello" },
    gateRef: { type: "command", command: "npm test", parseMode: "tap" },
  },
  {
    correction: { used: 0, max: 3 },
    gateError: { used: 0, max: 3 },
    gateMaintenance: { used: 0, max: 2 },
    terminus: { used: 0, max: 5 },
    close: { used: 0, max: 3 },
  },
);

const verdict = await invoke(
  triageRoleConfig,
  { worktreePath, dir, sessionKey: "triage-0" },
  mockSessionEnvironment({ scriptPath: "/tmp/my-triage/mock.json", journalPath: "/tmp/my-triage/journal.jsonl" }),
);

if (verdict.status === "reroute") {
  console.log("Retry, and tell the next worker:", verdict.payload.dead_ends);
} else {
  console.log(verdict.status, verdict.rationale);
}
```

`verdict` is typed: inside the `reroute` branch your editor knows `payload` is a
brief. The script prints
`Retry, and tell the next worker: Attempt 1 edited the template; the text comes from translations.json.`
Without the third argument, `invoke` uses the real `claude` command.

### Wiring triage into a run

A run takes one agent port for every role, and a triage port built from it:

```ts
import {
  createAgentPort, createAgentTriage, noopCloser, run,
  workerRoleConfig, gateMaintenanceRoleConfig, triageRoleConfig,
} from "delivery-service";

const agent = createAgentPort({
  worker: workerRoleConfig,
  "gate-maintenance": gateMaintenanceRoleConfig,
  triage: triageRoleConfig,
});
const ports = { agent, triage: createAgentTriage(agent), closer: noopCloser };

const { state, outcome } = await run(dir, { repoPath: "/path/to/your/repo", worktreePath: "/tmp/my-triage/run-tree" }, ports);
```

Pass `deterministicRouter` as `triage` instead to run with the fixed rules alone
and never call the agent. Every run then retries and escalates exactly as the
"Otherwise" column above says.

To watch triage being asked only on the last slot, and a flaky gate recovering
on a free recheck, run:

```bash
npm run demo:triage-slice-3
```

The mock does not enforce `allowedTools`, so it cannot show triage being refused
a write. That guarantee comes from the real `claude` runtime.
