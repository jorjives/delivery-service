# Configuring a role

This guide takes you from nothing to a first successful agent invocation for each role a run
dispatches: the **worker**, **gate-maintenance** and **triage**. It is for developers who want to
change what an agent is told, or to run one by hand. You do not need to read any source. Two
further roles, the **scanner** (used by `delivery review`) and **after** (used by after-landing
steps that run an agent), are configured by the harness, not by you.

The `npm run demo:*` commands in this guide need a clone of the harness repository; the snippets
need only the installed package.

## What a role is

The harness has one way of running an agent: `invoke(roleCfg, ctx)`. It starts one
fresh agent session, sends it a prompt the harness assembles from the case file,
and hands back exactly one result. A **role** is the
configuration you pass as `roleCfg`. You never write invocation code for a new
role; you write a new configuration.

A role configuration has three fields (a fourth, `budgets`, is reserved and unused):

| Field | What it is | What happens if it is wrong |
|---|---|---|
| `role` | `"worker"`, `"gate-maintenance"`, `"triage"`, `"scanner"` or `"after"` | Rejected before any session starts |
| `systemPromptFragment` | Who the agent is and what it is for, in plain sentences. Must not be empty. | Rejected before any session starts |
| `envelopeSchema` | The reply shape the agent must end with. Use `WorkerEnvelope` for the worker and gate-maintenance, and `TriageEnvelope` for triage. | Rejected before any session starts |

A mistake in any field throws `InvalidRoleConfig`, naming the field, before an
agent is started. It is never reported as a failed run.

Everything in this guide is imported from the harness's single entry point,
`delivery-service`, except the offline helpers in `delivery-service/testing`. Install it in your project as
[Getting started](getting-started.md) describes, then run the snippets with
`npx tsx`.

## The two reference configurations

Start from one of these. Copy it and change the sentences to suit your project.

**Worker**: carries out the task, inside the [worktree](glossary.md#working-copy) and branch
made for it. A worktree is the harness's copy of your project that one run works in.

```ts
import { WorkerEnvelope, type RoleConfig } from "delivery-service";

export const myWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: [
    "You are carrying out one task for a delivery harness, in a worktree and branch it made for this task.",
    "Work as you normally would, with your own tools, skills and judgement.",
    "If you cannot finish and no further attempt would help, escalate instead of guessing.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
};
```

**Gate-maintenance**: repairs the environment so the project's checks can run,
and never touches the checks themselves.

```ts
import { WorkerEnvelope, type RoleConfig } from "delivery-service";

export const myGateMaintenance: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: [
    "The project's check could not run in this worktree, so the delivery harness asked you to repair it.",
    "Repair the environment (configuration, fixtures, dependency manifests) so that the check can run.",
    "Deleting, renaming or skipping a test, or hiding one from git, is refused, and so is a change to the check's own module.",
    "If only a change to the check would fix it, escalate instead.",
  ].join("\n"),
  envelopeSchema: WorkerEnvelope,
};
```

These are shortened. The exported `workerRoleConfig`, `gateMaintenanceRoleConfig` and
`triageRoleConfig` hold the full text. To keep the full text and change one thing, spread it:
`{ ...gateMaintenanceRoleConfig, systemPromptFragment: "..." }`.

The only difference between them is the sentences. The call you make is identical.

To change what a role is told in a real run, set `agent.append` (see
[Project configuration](project-configuration.md)). To keep an agent from a tool, use
`permissions.deny` in your own Claude settings.

## Making your first invocation

You need two directories: a **case file** directory (the harness's record of the
run) and a **worktree** (the files the agent works on). `invoke` reads the task
from the case file and runs the agent inside the worktree.

```ts
import { mkdirSync } from "node:fs";
import { create, invoke, gateMaintenanceRoleConfig } from "delivery-service";

const dir = "/tmp/my-run/case";          // the case file directory
const worktreePath = "/tmp/my-run/tree"; // the agent's worktree

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
that command needs. If `claude` is missing or signed out, the result has `status: "incomplete"`
and a plain-English `rationale`. To try it without a real agent or an API key, see
[Trying it offline](#trying-it-offline).

## What comes back

Always exactly one of three results:

| `status` | Meaning | What the harness does next |
|---|---|---|
| `completed` | The agent finished and says why, in `rationale`. | Runs the gate to judge the work. The agent's word is never taken as proof. |
| `escalate` | The agent says it cannot go on, with a `category` of `exhaustion`, `authority` or `decision`. | Stops retrying that step and escalates. A `decision` also carries a `question` for the operator and goes straight to them, as `authority` does. |
| `incomplete` | The session produced nothing usable. `rationale` says which of these it was, in plain English: it crashed, it ended without a reply, it replied in the wrong shape, it could not be started, or it tried something it is not allowed to do. | Retries, within the run's budget. |

`rationale` never holds a stack trace or raw error text. When a session
errors or cannot start, the harness keeps the underlying error verbatim as `cause` in
`refs/session-error-<session key>.json` beside the case file. A harness problem
can still be diagnosed, and the error never reaches the person reading the run. When a session
ended without a reply or replied in the wrong shape, the same file keeps what it said
as `agentReply` (the agent's own words, cut to the first 4,000 characters), and, for
the wrong shape, why the role's `envelopeSchema` refused it as `cause`.

## What a role cannot do

A role does not limit what the agent may do: every session has every tool your own Claude Code
setup gives it. Afterwards the gate and the harness's own checks on the work (see
[Writing a gate](writing-a-gate.md#how-the-verdict-is-reached)) decide whether to accept it. To keep
the agent from a tool, use `permissions.deny` in your own Claude settings.

## Trying it offline

`claude-mock` is a scripted stand-in for the `claude` command. It is bundled with the
`delivery-service` package, so there is nothing else to set up. `mockSessionEnvironment` points a session at it, with the script it replays and
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

With the scripted reply described next, `console.log(result)` prints this (the `sessionId` differs each time):

```text
{
  status: 'completed',
  rationale: 'set the missing PORT in .env',
  usage: { costUsd: 0, durationMs: 0 },
  sessionId: '0ed1fb5f-207b-480e-aece-44f5094541ca'
}
```

The file `/tmp/my-run/mock.json` scripts what the agent does and replies, for example:

```json
[
  {
    "effects": [{ "write": { "path": ".env", "content": "PORT=8080\n" } }],
    "json": { "status": "completed", "rationale": "set the missing PORT in .env" }
  }
]
```

The ready-made demos do exactly this, one per role (from a clone of the harness repository):

```bash
npm run demo:agent-slice-1   # worker
npm run demo:agent-slice-3   # gate-maintenance
```

The mock does not model tool permissions, so it cannot show a refusal happening
inside a live session. The demos show the refusal by driving the harness's own
decision directly; the live guarantee comes from the real `claude` runtime.

To test your gate, closer and role configurations together through a whole
[surface](glossary.md#surface) (one task's run) against the scripted agent, follow
[Testing your delivery pipeline](testing-your-pipeline.md).

## Triage

Triage decides what happens after a setback: the gate failed, the gate could not
run, the worker gave up, or the close failed. It reads; it never edits. It is the
same kind of role as the other two: one configuration, the same `invoke`.

### The reference configuration

```ts
import { TriageEnvelope, type RoleConfig } from "delivery-service";

export const myTriage: RoleConfig<TriageEnvelope> = {
  role: "triage",
  systemPromptFragment: [
    "You are triage on a gated delivery harness: you decide what happens after a setback.",
    "Read the setback, the remaining budgets and what earlier rounds decided, then choose what happens next.",
    "Your diagnosis is a hypothesis for the next session to test, not an established fact.",
  ].join("\n"),
  envelopeSchema: TriageEnvelope,
};
```

It is also exported ready-made as `triageRoleConfig`.

**Triage works in a disposable copy.** Triage must never change the thing it is
judging: the gate is the only proof that work is good. Triage has every tool a
session has, so the harness gives it a copy of the task's worktree as it
stands, uncommitted changes included, and throws the copy away when triage
replies. It can read, run the check and try things there; none of it reaches the
task's work.

### When triage is asked

The harness only calls the triage agent when its answer can change what
happens. Every other setback is settled by a fixed rule, at no cost:

| Setback | The agent is asked when | Otherwise |
|---|---|---|
| The worker lacked authority | never | escalate to a person |
| The worker is stuck | a correction slot is left | escalate once none is left |
| The gate failed | exactly one correction slot is left, or the round failed only because test-runner settings changed | retry the worker while more are left; escalate at none |
| The close failed | exactly one close slot is left | retry the close while more are left; escalate at none |
| The gate could not run | gate rechecks are used up and a gate repair slot is left | re-run the gate free while rechecks are left; escalate when both are used up |

### What comes back

`invoke(triageRoleConfig, …)` returns a typed verdict. Which verdicts are
allowed depends on the setback. An answer that is not allowed is escalated
rather than acted on.

| `status` | Allowed after | `payload` |
|---|---|---|
| `reroute` | the gate failed, the worker is stuck | a brief for the next worker: `problem`, `dead_ends`, `scope`, `references`, `diagnosis`; an optional `acceptSettings` boolean, honoured only when the gate failed on a settings change alone |
| `fix_the_gate` | the gate could not run | a brief with the same five fields, for the repair session |
| `retry_close` | the close failed | a brief with the same five fields, kept in the case file and handed to the closer on the retried close as `repairBrief` (the built-in closers ignore it) |
| `escalate` | any setback | a packet for a person: `decision`, `evidence`, `dead_ends`, `why_now`, `references` |
| `abort` | any setback | `{ reason }` |
| `incomplete` | (the harness's own verdict) | none: the session produced nothing usable, and the harness escalates rather than guessing |

### Your first triage invocation

Offline, with `claude-mock` (see [Trying it offline](#trying-it-offline)). Write the reply the
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

Then save the following as `first-triage.ts` and run
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
"Otherwise" column of the table in [When triage is asked](#when-triage-is-asked) says.

To watch triage being asked only on the last slot, and a flaky gate recovering
on a free recheck, run:

```bash
npm run demo:triage-slice-3
```

The mock does not enforce `permissions.deny`, so it cannot show triage being refused
a write. That guarantee comes from the real `claude` runtime.

## See also

- [Testing your delivery pipeline](testing-your-pipeline.md): test roles, gates and closers together against the scripted agent.
- [Writing a gate](writing-a-gate.md) and [Writing a closer](writing-a-closer.md): the other two extension points.
- [Project configuration](project-configuration.md): `agent.append` and the other settings.
- [Glossary](glossary.md): the terms used here.
