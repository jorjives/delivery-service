# Configuring a role

This guide gets you from nothing to a first successful agent invocation for either
of the two roles the harness ships: the **worker** and **gate-maintenance**. You do
not need to read any source to follow it.

## What a role is

The harness has one way of running an agent: `invoke(roleCfg, ctx)`. It starts one
fresh agent session, sends it a prompt the harness assembles from the case file,
and hands back exactly one result. A **role** is nothing more than the
configuration you pass as `roleCfg`. You never write invocation code for a new
role; you write a new configuration.

A role configuration has four fields:

| Field | What it is | What happens if it is wrong |
|---|---|---|
| `role` | `"worker"` or `"gate-maintenance"` | Rejected before any session starts |
| `systemPromptFragment` | Who the agent is and what it is for, in plain sentences. Must not be empty. | Rejected before any session starts |
| `envelopeSchema` | The reply shape the agent must end with. Use `WorkerEnvelope` for both roles. | Rejected before any session starts |
| `allowedTools` | The tools the agent may use, e.g. `["Read", "Edit"]`. Must not be empty. This is the role's entire blast radius. | Rejected before any session starts |

A mistake in any field throws `InvalidRoleConfig`, naming the field, before an
agent is started. It is never reported as a failed run.

Everything below is imported from the harness's single entry point,
`./src/index.js` from the repository root (the harness is not published as a
package yet). Run the snippets with `npx tsx`.

## The two reference configurations

Start from one of these. Copy it, change the sentences to suit your project, and
narrow the tools if you want.

**Worker**: makes the change the task asks for, inside the working tree.

```ts
import { WorkerEnvelope, type RoleConfig } from "./src/index.js";

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
import { WorkerEnvelope, type RoleConfig } from "./src/index.js";

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

## Making your first invocation

You need two directories: a **case file** directory (the harness's record of the
run) and a **worktree** (the files the agent works on). `invoke` reads the task
from the case file and runs the agent inside the worktree.

```ts
import { create, invoke, gateMaintenanceRoleConfig } from "./src/index.js";

const dir = "/tmp/my-run/case";          // the case file directory
const worktreePath = "/tmp/my-run/tree"; // the agent's working tree

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

You will never get a stack trace or raw error text in `rationale`.

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

`claude-mock` is a scripted stand-in for the `claude` command. It is a separate
project, not included here: install it with `npm link` from its own checkout so
that `claude-mock` works from your shell. Then pass a third argument to `invoke`:

```ts
const ctx = { worktreePath, dir, sessionKey: "gate-maintenance-1-0" };
const result = await invoke(gateMaintenanceRoleConfig, ctx, {
  pathToClaudeCodeExecutable: "claude-mock",
  env: { ...process.env, CLAUDE_MOCK_SCRIPT: "/tmp/my-run/mock.json" },
});
```

where `/tmp/my-run/mock.json` scripts what the agent does and replies, for example:

```json
[
  {
    "effects": [{ "edit": { "path": ".env", "old": "PORT=", "new": "PORT=8080" } }],
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
