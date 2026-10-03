# Research: Pre-Built Task Packs (Roadmap Item 12)

Autonomous design-team run `20261003T130939Z`. Author: researcher. Facts only; design decisions
belong to the product-designer and architect. All `src/` paths are relative to the repo root.
Web claims marked "(fetch summary)" were returned by a summarising fetch tool and are paraphrase,
not quotation; where a primary document matters to a design decision, re-verify before relying on it.

## 0. Headline findings (read these first)

1. **There is no per-task gate or closer.** `gate`, `closer`, `roles`, `domain`, `budgets` are
   project-wide in `delivery.config.json`; every task in `tasks` is pinned to the same gate and
   closer when its run starts (`src/cli/config.ts:108-133`, `src/cli/settings.ts:43-55`,
   `src/cli/queue.ts:277`). A task is an opaque object whose only meaningful key is `intent`.
   A pack that wants one gate for the scan and another for fixes, or a different gate per finding,
   needs new machinery or must put the variation inside one custom gate that reads `taskDef`.
2. **The delta rule cannot demand improvement.** The harness fails a task only on a *regression*:
   an assertion that was PASS at baseline and is not PASS at check (`src/delta-rule.ts:11-31`).
   An assertion that is FAIL or ERROR at baseline is "pre-existing" and "is never held against the
   agent" (`docs/writing-a-gate.md:212,231`). So a gate assertion "finding F is resolved" that is
   red at baseline can never fail the task, and nothing makes it turn green. The roadmap's
   "gate verifies the specific finding is resolved" is **not expressible today** through the delta
   rule with an honest baseline. This is the single biggest gap between the Item 12 text and the estate.
3. **No role emits structured output other than a terminus.** Roles are `worker`, `triage`,
   `gate-maintenance`; the worker envelope is `completed|escalate` plus a `rationale` string
   (`src/role-config.ts:22-32`). A project can override only `systemPromptFragment` and
   `allowedTools` of two roles (`src/schema.ts:145-160`); it cannot change an envelope schema.
   A scan that must output a findings list therefore has to write a file in its worktree (the worker
   has `Write`), or the harness gains a new role or envelope.
4. **Queue is a static list in a config file.** There is no mechanism to append tasks at runtime;
   "findings fan out into fix tasks" needs either a generated `delivery.config.*` (the `.js`/`.mjs`
   form can compute its task list) or a new queue source. Task identity is deep equality of the
   task object, so a finding embedded in a task object is a stable identity.
5. **Authority-class escalation is reactive only.** It happens when a *worker* emits
   `escalate` with `category: "authority"` or is refused a tool; there is no pre-run "needs sign-off"
   hook and no severity threshold anywhere in the estate. The closer `commit-to-branch` or `open-pr`
   is the existing "human approves before merge" mechanism.
6. **A doc claim is overstated.** The Item 11 spec says the report "echoes" `taskDef`
   ("A pack tags tasks through `taskDef`, which the document echoes"). The report document
   carries only `task: taskIntent(taskDef)`, a string of the `intent`; the rest of `taskDef` is not
   in the report (details in 1.7).

## 1. Estate state

### 1.1 Project configuration file

- File: `delivery.config.json`, or `.js`/`.mjs` exporting the same object as default
  (`src/cli/config.ts:12-14`). Discovered nearest-first from the cwd up to the repository root
  (`config.ts:355-365`); `--config` or `DELIVERY_CONFIG` overrides (`config.ts:392-400`).
  A `.js` file is imported, so a pack can compute settings in code (`config.ts:406-408`).
- Eight keys, `.strict()` so typos are named (`config.ts:17`, `108-134`): `task`, `tasks`, `domain`,
  `roles`, `gate`, `closer`, `budgets`, `concurrency`. `task` and `tasks` together is refused
  (`config.ts:136`). Duplicate tasks are refused (`config.ts:142-146`).
- `tasks`: array of `Prose | { intent: Prose, ...anything }` (`config.ts:75`). The object form is
  `z.looseObject`, so **extra fields pass through untouched**; the comment says projects may
  annotate their own list (`config.ts:70-74`). `structureTask` returns a string as `{ intent }`
  and an object as written (`config.ts:85-87`). `TaskDef` itself is `z.record(string, unknown)`
  (`src/schema.ts:33`).
- `domain`: free prose, pinned per run, prefixed to every agent's system prompt after the role
  fragment (`src/prompt-assembly.ts:117-119`).
- `roles`: only `worker` and `gateMaintenance`, each with optional `systemPromptFragment` and
  `allowedTools` (`schema.ts:145-160`, `config.ts:123`). Triage is deliberately not overridable.
  Overrides are merged over the built-in role and validated by `validateRoleConfig`
  (`src/cli/roles.ts:12-34`); a pinned copy goes in the case file header (`schema.ts:177`).
- `gate`: `GateChoice` = written-out `command` (parse mode `tap|junit|exitcode`) or `custom`
  (`modulePath`, optional `exportName`), or one of four presets that desugar to a `command` gate
  by exit code: `test-runner`, `file-exists`, `command-succeeds`, `schema-validates`
  (`src/cli/gate-presets.ts:310-381`). `schema-validates` runs `npx --yes ajv-cli@5.0.0 validate`
  (draft-07, needs network first run; `gate-presets.ts:352-354`). With no `gate`, the default is
  `npm test` inferred from `package.json` or a refusal (`src/cli/project.ts:34-52`,
  `settings.ts:107-108`).
- `closer`: `merge-back`, `commit-to-branch` (default), `open-pr`, `custom` (`schema.ts:60-77`,
  `settings.ts:22`). None takes parameters except `merge-back.deleteBranch`. Closers never push.
  `commit-to-branch` commits to `surface/<runId>`, keeps the branch, removes the worktree
  (`src/commit-to-branch-closer.ts:19-47`).
- Resolution order for gate and closer: flag, then env var, then file, then default
  (`settings.ts:97-123`). A run **pins** its `gateRef`, `closerRef`, `domainPrompt`, `roleOverrides`,
  `taskDef` and budgets in the case file header at creation (`schema.ts:162-182`,
  `src/cli/drive.ts:47`); later config edits never change an in-flight run.
- Example project: `examples/project-configuration-example/delivery.config.json`; the guide is
  `docs/project-configuration.md`. `delivery init` writes a config interactively
  (`src/cli/init.ts`). The prior config design states "Item 12: a pack is a project configuration
  authored once and distributed. Its work is discovery and distribution, not shape"
  (`docs/superpowers/specs/2026-09-17-project-configuration-design.md:553`; also
  `docs/prd/2026-09-17-project-configuration/architecture.md:589`). **This is contradicted by
  findings 1, 2 and 4 above: shape work is needed.**

### 1.2 CLI subcommands today

`src/cli/program.ts:84-179`: `run`, `resume`, `status` (flags `--all --decisions --repairs --watch
--interval`), `report` (`--write --schema`), `validate`, `preview`, `init`. Global `--json`,
`--no-color`. **No `review` command exists**; the roadmap's `delivery-service review my-repo`
(roadmap Item 12 "Accessibility") is aspirational, and the binary is named `delivery`
(`package.json` `bin`). `run` flags: `--task --task-file --gate-command --closer --concurrency
--config --repo --fresh`. Exit codes in `src/cli/failures.ts` (`EXIT.ok`, `escalated`, `aborted`,
`configuration`). Commands are wired by commander with `contextFor(io, command)` (`program.ts:49-62`),
so a new subcommand is cheap to add and automatically gets `--json` and colour handling.

### 1.3 How tasks are queued and identified

- `runQueue` (`src/cli/queue.ts:190-319`) works down `tasks`, `project.concurrency` at a time via
  `supervise`. Progress is **derived from run records on disk each time**, never stored.
- **Identity = what the task says.** `findQueueRun(records, taskDef)` returns the newest run whose
  pinned `header.taskDef` is `isDeepStrictEqual` to the task (`src/task-list.ts:27-30`). Position is
  deliberately not identity (`task-list.ts:16-26`). `stillToTake` = not delivered (`outcome.kind
  === "closed"`) and not already claimed (`task-list.ts:33-42`).
  Consequence: a task object that embeds a finding (`{ intent, finding: {...} }`) has identity over
  the whole object; rewording or changing any field makes it a new task. Two findings with identical
  content would collide (refused at load, `config.ts:142-146`).
- Run id is `runIdFor(taskIntent(taskDef), now, taken)` (`src/run-location.ts`), a slug of the
  intent plus a UTC stamp; runs live under `.delivery/runs/<runId>/` with `case.json` + `log.jsonl`
  (`src/run-records.ts:71-97`). A task in a run of several at once is a "slot"; the run has its own
  `run.json` (`schema.ts:410-495`, `supervisedRunId`).
- An **escalated or aborted task blocks a one-at-a-time list**: it is not "closed", so the list
  stops there ("needs your decision before I can go on", `queue.ts:56-61`) and `delivery run`
  re-tells the outcome on the next invocation (`queue.ts:279-280`). With `concurrency > 1` the slot
  is freed and the rest carry on (`queue.ts:130-136`). The documented way past a stopped task is
  to deal with it or reword the entry (`queue.ts:50-55`). There is **no "approve and continue"
  verb** for an escalated run.
- Fresh runs branch from `origin/HEAD` or the checked-out branch (`src/provision.ts:17-30`),
  i.e. from committed state. A scan's output that sits only on the scan's `surface/...` branch is
  **not visible to the fix tasks' worktrees** unless merged (`merge-back`) or committed to the base
  branch first. `hasUncommittedChanges` prints a note that uncommitted files are invisible to agents
  (`src/cli/project.ts:67-69`).
- Only one supervised run may hold a repo at once (`takeRepoLock`, `queue.ts:209-212`,
  `refuseIfRunGoing` `queue.ts:124-128`). A single-task run (no `concurrency>1`) takes no lock.

### 1.4 Gates

- Contract: `Gate { baseline(ctx), check(ctx) }` returning `GateReport { status: PASS|FAIL|ERROR,
  assertions[], detail? }`; `GateContext = { worktreePath, taskDef, gateRef }`
  (`src/command-gate.ts:9-44`, `src/schema.ts:85-97`). **A custom gate receives `taskDef`**
  (`docs/writing-a-gate.md:46`; `src/run-gate.ts:9-11`), so a custom gate can read finding data
  embedded in the task. A command gate does not: `exec` passes no env and no task data
  (`command-gate.ts:54-82`).
- Baseline taken once before the agent runs and pinned; check after each attempt
  (`src/run-gate.ts:30-90`). Verdict is `computeDelta(baseline, check, { failOnNewAssertions })`.
- `computeDelta` (`src/delta-rule.ts:3-59`): only baseline PASS assertions are examined; ABSENT,
  FAIL or ERROR at check is a new failure. Baseline FAIL/ERROR are skipped entirely (line 12).
  `failOnNewAssertions` additionally flags assertions that are new and non-PASS (lines 33-45).
  A gate-level ERROR is class "error" (retry/maintenance route), not "fail".
- `parseExitCode` yields one assertion `exit:<command>` PASS/FAIL (`src/parsers.ts:94-100`), so for
  any exit-code gate whose command fails at baseline, **the task can never fail the gate**.
  A pack's "gate verifies finding resolved" built from `command-succeeds` would be vacuous.
- Ways to make "resolved" enforceable, each a design call (not a recommendation here): (a) a custom
  gate whose baseline reports the assertion PASS in an "open or resolved" sense and check FAILs if
  the finding persists (baseline lies by construction); (b) a new "must turn green" assertion
  class in the delta rule (harness change; the gate-interface design explicitly chose
  pre-existing failures as never-held-against, `docs/superpowers/specs/2026-09-04-gate-interface-design.md:157`);
  (c) a gate that returns assertion ids that are *absent at baseline* with `failOnNewAssertions:
  true`, so a new non-PASS assertion `finding-F-resolved` that is present at check but ABSENT at
  baseline fails when not PASS (this works today for a custom gate: baseline emits only the
  regression assertions, check additionally emits `finding-F-resolved`; see `delta-rule.ts:33-45`).
  Option (c) is the least invasive route, and it is a custom gate (TypeScript or JS module), not
  declarative.
- Gate runs against the worktree but is loaded from the repo root (`run-gate.ts:13-18`), and
  the tool guard refuses any call outside the worktree (`src/tool-authority.ts:88-105`), so a
  worker cannot edit a custom gate module that lives in the repo root. **But a command gate's
  command string runs inside the worktree**, e.g. `npm test` runs the worktree's tests, which the
  worker can edit. That is the weakening surface (see section 4).
- Authoring guide: `docs/writing-a-gate.md`; custom module loading `src/plugin-loader.ts:226-259`
  (relative paths resolve against the repo root; every return is zod-validated, a throw becomes an
  ERROR report, `plugin-loader.ts:274-296`).

### 1.5 Roles, agent invocation and structured output

- One session per `invoke` (`src/agent-invoke.ts:234-291`): `outputFormat: { type: "json_schema",
  schema }` is set from the role's `envelopeSchema` (`agent-invoke.ts:190-202`), so the SDK
  enforces structured output, but each role's schema is fixed in code. Reply failures become an
  `incomplete` terminus (`agent-invoke.ts:34-39`, `275-287`).
- Worker envelope: `completed{rationale}` or `escalate{category: exhaustion|authority, rationale}`
  (`src/role-config.ts:22-32`). Triage has its own envelope (`src/triage-role-config.ts`). The
  prompt tells the worker the schema (`prompt-assembly.ts:134-142`) and includes the task as
  pretty-printed JSON of the whole `taskDef` (`prompt-assembly.ts:146`), so **extra task fields
  reach the agent verbatim**. Role structure cannot be reordered or dropped by a project
  (`prompt-assembly.ts:95-100`).
- Default worker tools: `Read Glob Grep Edit Write Bash` (`role-config.ts:75`). Worker prompt
  says "smallest change ... satisfies the task" and that it must not touch the gate
  (`role-config.ts:67-73`). A scan task would need a different fragment (via `roles.worker`
  override, which is project-wide, so one project cannot have a scan worker and a fix worker with
  different prompts in the same config without a new mechanism; note `preview` shows the worker
  prompt, `src/cli/preview-command.ts`).
- **Closest existing "scan output" is nothing structured.** The only structured agent outputs are
  the terminus envelope, triage's `SharpenedBrief`/`EscalationPacket`, and refs written by the
  harness (`writeRef`, `src/case-file.ts`). No role writes a list artefact. The existing
  `schema-validates` gate preset (JSON file against a JSON Schema) is the nearest estate precedent
  for "agent writes a file, harness validates its shape".

### 1.6 Authority-class escalation and escalation packets

- Where "authority" exists: `TerminusEntry.category: exhaustion|authority`
  (`schema.ts:243`), `WorkerEnvelope` (`role-config.ts:27-31`), `deterministicRouter` rule
  (`src/router.ts:36-42`): a `worker_escalate` with `authority` escalates immediately, ahead of
  any budget ("no retry can resolve this"), cause `{kind:"authority", role:"worker"}`.
  The tool guard also yields it: a call outside the role's tool list or the worktree returns an
  `incomplete` with the refusal sentence (`tool-authority.ts:117-128`), reported as an authority
  cause (`OutcomeCause.kind: "authority"`, `schema.ts:346-348`).
- Escalation packet: `{decision, evidence, dead_ends, why_now, references}`
  (`src/escalation-packet.ts:49-60`). For authority: "Decide whether to grant that authority or
  take the action yourself" (`escalation-packet.ts:62-65`). Built from the log, deterministic.
- Outcome: run ends `ESCALATED` with a `packetRef` (`schema.ts:363-374`); the report derives
  `audience`/`standing` from it (`src/report/document.ts:17-35`). Exit code `escalated`.
- **Not present:** any severity concept, any threshold setting, any way to mark a task as needing
  sign-off before it starts, any "pending approval" state, any resume-after-approval. The
  closest-fit mechanisms for "needs human sign-off before merge": use `commit-to-branch` or
  `open-pr` (a person merges), or a custom closer; or a custom gate that returns ERROR/FAIL.
  An escalated run cannot be resumed (`resume` refuses a finished run, `src/cli/resume-command.ts:55`).
  Pre-run sign-off for the security pack would be new control flow.
- Related prior-art idea in the pool: "Gate maintenance can weaken or bypass the check it
  repairs" asks whether a repair's change to the check should be shown or approved
  (`.autoloop/ideas/50-20260930T212043Z-gate-maintenance-can-weaken-the-check.md`, read only).
  Item 11 delivered *showing* it (section 4.2) but not approval or refusal.

### 1.7 How `taskDef` reaches reports

- `taskDef` is pinned in `case.json` (`schema.ts:164`), echoed into `slot_fill` run entries
  (`schema.ts:462`), and used for list-matching in report derivation
  (`src/report/derive.ts:300-396`, `isDeepStrictEqual` against `snapshot.list`).
- **The report document exposes only `task: taskIntent(header.taskDef)`**, a string
  (`src/report/derive.ts:230`, `withoutRun` line 127; schema `src/report/document.ts:126`).
  `grep taskDef src/report/document.ts` finds nothing. Tags and other task fields are **not
  echoed** into `last-report.json`; claims to the contrary in
  `docs/superpowers/specs/2026-10-01-observability-and-reporting-design.md:937`,
  `docs/prd/2026-10-01-observability-and-reporting/architecture.md:656` are not borne out by the
  code. A pack that wants severity, finding id or phase in the report must add fields to
  `ReportSurface` (a versioned, published JSON Schema: `src/report/json-schema.ts`,
  `delivery report --schema`) or encode them in `intent`.
- Report surfaces: `delivery report [run-id] [--write]` and plain-language `status`
  (`src/report/plain.ts`, `text.ts`); `last-report.{txt,json}` written at the end of a run
  (`closingReport`, `src/cli/report-command.ts`). "Standing" values include `not_started` for list
  tasks with no run (`document.ts:9-12`). Reports are organised **by the task list**
  (`derive.ts:377-396`): list tasks first, then runs not on the list as "incomplete". So scan and fix
  tasks both appear in `delivery report` only if both are in the list at report time; a scan task
  that was in an earlier config and was then removed becomes an off-list run, which the
  derive code handles as incomplete runs (`derive.ts:396`), not as a clean "done".
- Plain-language escalation text: `OutcomeCause` kinds are a closed enum
  (`schema.ts:346-355`); there is no "finding too risky" kind.

### 1.8 Supervisor and fan-out

- `concurrency` N slots each driving one task (`src/supervisor.ts`, `queue.ts:295`), each task in
  its own worktree and branch, one shared gate-maintenance breaker (`src/breaker.ts`). Closes are
  serialised via the repo lock (see multi-surface spec). Fix tasks fan out as list entries; there
  is no dependency or priority scheduling ("list order only",
  `docs/superpowers/specs/2026-09-26-multi-surface-supervisor-design.md:593`). Overlapping edits
  between concurrent fix tasks conflict at merge, handled by the closer failing and triage's close
  retry (`router.ts:21`), not by the supervisor.
- Packs "work single-surface" per the roadmap; with `concurrency: 1` the list is sequential.

### 1.9 Reuse and budgets

- Budgets per run: `correction`, `gateError`, `gateMaintenance`, `terminus`, `close`
  (`src/budgets.ts`, `config.ts:50-59`). A pack could set `budgets` (project-wide).
- Cost/duration are recorded per session (`SessionUsage`, `schema.ts:232`) and reported (Item 11), so
  scan cost and per-finding fix cost are already visible per run.
- `src/repair-changes.ts` captures what a **gate-maintenance** repair changed in the worktree
  (tree before/after through a private index, per-file patch up to 256 KiB, `touchesCheck` flag:
  `repair-changes.ts:8, 24-28, 108-120`). It is wired only to repairs (`drive.ts:98-108`); **worker
  changes are not captured** this way and no check is made that a worker's diff avoided tests.

### 1.10 Conventions a pack must live with

- Personas: Dana the non-technical project owner reads outputs (`docs/personas.md`, team-derived and
  unconfirmed). Plain-language rule: output sentences are fixed strings, agent words are quoted
  (`src/report/document.ts:25`). British English, no stack traces.
- Everything is deterministic and replayable from `log.jsonl`; `assemblePrompt` is pure
  (`prompt-assembly.ts:95-100`). New artefacts should be refs or files re-readable on resume.
- Dependencies are deliberately few (`package.json`: Agent SDK, inquirer, commander, proper-lockfile,
  zod). Zod 4 can emit JSON Schema (`z.toJSONSchema`, used at `agent-invoke.ts:190`), so a finding
  schema authored in zod can be published as JSON Schema for free.

## 2. Prior art and competitive landscape

| Tool | Scan to fix shape | Finding format | Verification of fix | Severity shown | Approval before fix |
|---|---|---|---|---|---|
| GitHub Copilot Autofix, agentic autofix | Alert (CodeQL or third-party) to LLM fix | CodeQL alert / SARIF | Agentic mode "validates fixes by re-running CodeQL"; PR states validation steps. Cannot confirm for custom queries or security-extended suite; third-party fix quality "not guaranteed" | CodeQL severity, critical to low from `security-severity` | Manual mode: you apply the suggestion. Agentic: user assigns alerts (single, multi-select, campaign, REST); output is a **draft PR** |
| Dependabot security updates | Alert to minimum-patched-version PR | Advisory/alert | Feasibility check on dependency graph; compatibility score = % of CI runs that passed for that bump | Alert severity | Opt-in per repo; PR is the review point; `dependabot.yml` and auto-triage rules narrow which alerts open PRs |
| Snyk Fix PRs | Test, then PR per fixable vuln | Snyk issue with Priority/Risk Score 0-1000 | Only auto-creates a PR if fixed vulns outrank any newly introduced ones | Severity plus score; PRs only above a threshold (default 700) | Threshold is the gate; PR is the review point; one PR per project per test cycle for the top issue |
| Semgrep Assistant / Autofix | Rule finding to AI triage and suggested fix | Semgrep JSON; SARIF output | Secondary LLM "review prompt chain" checks fix validity and that it addresses the finding; rule-defined `fix:` is deterministic | Severity from rule; AI marks likely false positives | Suggestions in PR comments or UI; `--autofix --dryrun` previews rule fixes |
| Claude Code `/security-review`, `/code-review`, Code Review (managed) | Diff in, ranked findings out; `--fix` optional | Text report. Security: file:line, Severity, Description, Exploit Scenario, Recommendation. Managed: severity marker, inline comment, machine-readable severity counts | Managed: a verification step checks candidates against code behaviour to cut false positives. Security command: confidence threshold (0.8) and exclusion list | HIGH/MEDIUM/LOW with definitions; Code Review: Important / Nit / Pre-existing | Findings never block; user decides to fix; `--fix` is explicit opt-in; host UI shows ReportFindings list with fixed/skipped state |
| CodeRabbit | PR review comments, committable suggestions, "fix with AI" prompts | Comment with category badge | Not a fix verifier; relies on CI | Critical / Major / Minor / Trivial / Info plus category badge | Human accepts suggestions |
| SonarQube | Rules over whole code; quality gate on **new code** | Issues, MQR impacts | Re-analysis; quality gate on new code only so legacy debt does not block | Blocker/Critical/Major or High/Medium/Low impact | Human triage; gate configurable on severity counts |
| OpenHands Resolver | Label an issue `fix-me` or mention the agent; agent attempts fix | GitHub issue text | Agent's own run; pushes a branch if it fails, draft PR if it succeeds | None | Human applies label: that is the authorisation |
| `npm audit fix` | Audit then upgrade | `npm audit --json` | Exit code from re-audit; `--force` allows semver-major | info/low/moderate/high/critical; `--audit-level` | Manual command; `--force` is the explicit risk acceptance |

Sources:
- GitHub, About autofix for code scanning: https://docs.github.com/en/code-security/concepts/code-scanning/autofix-for-code-scanning (fetch summary)
- GitHub changelog, agentic autofix public preview (2026-07-10): https://github.blog/changelog/2026-07-10-agentic-autofix-for-code-scanning-alerts-in-public-preview/ (fetch summary)
- Dependabot security updates: https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates (fetch summary)
- Snyk automatic Fix PRs and score thresholds: https://docs.snyk.io/scan-fix-and-prevent/fix/snyk-pull-or-merge-requests/enable-automatic-fix-prs ; https://updates.snyk.io/new-threshold-defaults-for-automatic-fix-pull-requests-316706/ ; https://docs.snyk.io/scan-fix-and-prevent/fix/prioritize-issues-for-fixing/priority-score-vs-risk-score (search summaries)
- Semgrep Assistant: https://semgrep.dev/blog/2024/the-tech-behind-semgrep-assistant/ ; rule-defined fixes https://docs.semgrep.dev/writing-rules/autofix (fetch summary)
- Claude Code security-review prompt: https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md (fetch summary)
- Claude Code Code Review docs: https://code.claude.com/docs/en/code-review (read in full)
- CodeRabbit overview: https://docs.coderabbit.ai/guides/code-review-overview (search summary)
- SonarQube severities and new-code gates: https://community.sonarsource.com/t/issues-on-unchanged-code-no-longer-fail-your-quality-gate/188724 ; https://docs.sonarsource.com/sonarqube-server/2026.2/user-guide/code-metrics/metrics-definition (search summary)
- OpenHands Resolver: https://pypi.org/project/openhands-resolver/ ; https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues (search summary)
- npm audit: https://docs.npmjs.com/cli/v11/commands/npm-audit (fetch summary)

### Patterns worth noting for the design

1. **Nearly every tool puts the human at the PR, not before the fix.** The approval point is
   "the draft PR / suggestion / branch", exactly where `commit-to-branch` and `open-pr` already
   sit. Item 12's requirement of owner review *before* the fix phase is the stricter pattern;
   closest analogues are Snyk's score threshold (policy decides which findings become PRs) and
   OpenHands' `fix-me` label and Copilot's "assign this alert" (a human selects per finding).
   The product-designer should treat "owner selects which findings to fix" as the proven pattern
   and "approve the whole list" as a coarser variant.
2. **Fix verification is "re-run the thing that found it".** Copilot agentic autofix re-runs CodeQL;
   Semgrep rule fixes are deterministic from the same rule; npm audit fix re-audits. LLM-only
   scanners (the Claude commands, CodeRabbit) ship **no** fix verifier, and Copilot itself admits it
   cannot confirm fixes for custom queries. An LLM scan's finding has no re-runnable check unless
   the pack supplies one. This is the strongest argument that Item 12's per-finding gate is the
   hard part, and why the roadmap treats it as SHOULD.
3. **LLM scanners control noise with a confidence floor and an exclusion list**, not a stricter
   schema: the security-review command drops findings below 0.8 confidence and excludes DoS, rate
   limiting, outdated libraries and more; Code Review adds a verification pass; `REVIEW.md` lets
   the owner redefine "Important" and cap nits. A pack's scan prompt needs the same two knobs.
4. **Severity vocabulary is not shared**: SARIF level (error/warning/note), CVSS bands
   (low/medium/high/critical), Snyk 0-1000, Code Review Important/Nit/Pre-existing, CodeRabbit
   five tiers. The roadmap's critical/high/medium/low matches CVSS and GitHub's mapping.
5. **None present severity to a non-engineer well.** Every tool above assumes a developer reader.
   CVSS explicitly measures *severity not risk* (FIRST). Claude's security prompt includes an
   "Exploit Scenario" field (an attacker story), the nearest thing in the field to what Dana needs.
   Plain-language "why it matters" is genuinely novel territory, not prior art to copy.
6. **Pre-existing versus new** (Code Review's third class, SonarQube's new-code gate) is a real
   distinction for whole-repo scans: a pack scans old code, so everything is pre-existing, and the
   gate should not hold the agent to unrelated legacy failures. That matches the delta rule.
7. **Drafts and branches for failure.** OpenHands pushes a branch when it cannot finish and opens a
   draft PR when it can. The harness analogue is escalate with a packet (branch kept by
   `commit-to-branch`).

## 3. Standards and libraries

### 3.1 SARIF 2.1.0 as the finding schema

- OASIS Standard, 2.1.0 with Errata 01 (Aug 2023): https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
  (fetch summary of section numbers).
- Relevant parts: `result.message` (the only practically essential property), `ruleId`, `level`
  (`none|note|warning|error`, default warning), `kind` (`notApplicable|pass|open|review|
  informational|fail`), `locations[].physicalLocation` (file, region), `partialFingerprints` /
  `fingerprints` (cross-run identity), `baselineState` (`new|unchanged|updated|absent`),
  `suppressions` (`kind`, `status accepted|underReview|rejected`, `justification`: a ready-made
  "owner rejected this finding" record), `rank` (-1 to 1 confidence), `fixes[].artifactChanges`
  (proposed text replacements).
- **GitHub's use of it** (https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning,
  fetch summary): requires `$schema`/`version`, `runs[].tool.driver` with `rules`, `results` with
  `message.text` and `locations`, and `partialFingerprints` for dedup; reads `security-severity`
  (0-10) and maps >9 critical, 7-8.9 high, 4-6.9 medium, 0.1-3.9 low; limits 10 MB gzip, 25,000
  results/run, 1,000 locations/result. Properties it does not support are ignored (the fetch did not
  list `fixes` as supported).
- **Fit assessment.** In favour: it is the interchange format that OSV-Scanner emits
  (https://google.github.io/osv-scanner/output/, fetch summary), Semgrep emits and CodeQL emits, so a
  pack that *ingests* tool output gets language-agnostic breadth for free; `fingerprints`,
  `baselineState`, `suppressions` and `level` map directly onto needs the roadmap has (identity,
  new versus existing, owner rejection, severity). Against: a pack-authored finding needs a
  plain-language `whyItMatters` and a `whatFixedLooksLike`, neither of which is a first-class SARIF
  field (they go in `properties` bags or `message.markdown`, so they are non-standard anyway);
  SARIF's nesting (`runs[].results[].locations[].physicalLocation.artifactLocation.uri` plus
  `region`) is heavy for a non-engineer to read or hand-edit when the owner reviews a findings
  file; SARIF has no field for severity in plain words or for "needs human decision". An LLM scan is
  weak at producing precise `region` columns. **Reasonable middle:** a small harness-owned zod
  finding schema (id, title, location file and line, severity, plain-language problem, why it
  matters, what fixed looks like, category/rule, optional evidence) with a *lossless mapper to
  and from SARIF* for ingest and export. This is a design call for the architect; the research
  claim is only that SARIF is a good *edge* format and a poor *authoring* format here.
- Library cost: SARIF needs no runtime library to write or read in TypeScript; Microsoft publishes
  a JSON Schema (`sarif-schema-2.1.0.json`) that could back `schema-validates`-style checks, not
  verified in this research.

### 3.2 Severity scales

- CVSS v4.0 qualitative bands: None 0.0; Low 0.1-3.9; Medium 4.0-6.9; High 7.0-8.9; Critical 9.0-10.0
  (https://www.first.org/cvss/v4-0/specification-document, fetch summary). Metric groups: Base,
  Threat, Environmental, Supplemental. Caveat from FIRST: CVSS measures severity, not risk;
  regulatory, customer and financial impact are out of scope. Base score needs vector inputs an LLM
  scan of first-party code cannot reliably produce; it fits third-party advisories (which arrive
  pre-scored) and is overkill for code-review findings.
- GitHub's SARIF mapping uses the same bands (above). npm audit uses info/low/moderate/high/critical
  (`--audit-level`). The roadmap's critical/high/medium/low fits all of these; dropping "info" and
  "moderate" naming is a mapping step.
- An LLM-assigned severity is an opinion; the Claude security prompt defines each level by
  consequence (High: RCE, data breach, auth bypass; Medium: needs specific conditions, significant
  impact; Low: defence in depth), which is a better calibration device than a numeric score.

### 3.3 Dependency vulnerabilities

- `npm audit --json`: structured output, `--audit-level` threshold for the exit code, requires
  registry access and a lockfile, `npm audit fix` applies compatible updates and `--force` allows
  semver-major (docs link above). **npm only.**
- OSV-Scanner (Google) over osv.dev: ecosystem-agnostic lockfile and manifest scanning, output
  formats table, markdown, vertical, HTML, JSON, **SARIF 2.1.0**, SPDX, CycloneDX; offline mode and
  guided remediation exist (https://google.github.io/osv-scanner/ and /output/, fetch summaries).
  Needs the binary installed and the network (or an offline database) at scan time.
- Implication for a deterministic per-finding gate: "the vulnerable version is no longer in the
  lockfile" (roadmap wording) is checkable by re-running the same scanner on the lockfile, or by
  a pure parse of the lockfile for a package@version, with no network. Offline determinism favours
  the lockfile parse; completeness favours the scanner re-run.
- The harness precedent for a network-needing gate is already accepted but flagged: the
  `schema-validates` preset fetches `ajv-cli` via npx with a `ponytail:` note
  (`gate-presets.ts:352-354`).

### 3.4 Semgrep and ESLint as deterministic per-finding gates

- Semgrep rules can carry `fix:` (deterministic, user-defined; `--autofix`, `--dryrun`) and Semgrep
  emits JSON and SARIF. Re-running one rule on one file is a precise, language-aware "is this
  finding still present" check across many languages. Costs: Semgrep must be installed in the
  worktree environment; rules must exist for the finding class (an LLM scan finding has no rule);
  licensing of the engine and registry rules differs from the LGPL OSS engine and should be checked
  before bundling any rule set (not verified here).
- ESLint: formatters built in are `html`, `json`, `json-with-metadata`, `stylish`; the JSON result
  carries `ruleId`, `severity`, `message`, `line`, `column`, `fix`, `suggestions`; **SARIF is not
  built in** (https://eslint.org/docs/latest/use/formatters/, fetch summary). JS/TS only, needs the
  project's own config and plugins installed. `.eslint` rules are only a fit when the scan
  *itself* used ESLint.
- Language-agnosticism: the harness targets arbitrary repos (`getting-started.md`, example is plain
  JS but nothing in `src/` assumes a language except the default `npm test` inference in
  `project.ts:34-52`). A pack gate that shells out to an installed tool therefore has to degrade
  honestly: no tool present means no targeted check, which must be said to the owner rather than
  silently becoming "pass". Item 12's roadmap text anticipates this: "built-in static analysis
  gate if no tests exist".
- The only language-agnostic, install-free verification primitives available inside the harness
  are: the project's own gate command, `git diff` against the base (`git` is a hard dependency
  already), file-exists/content checks by shell, and a custom gate module in TypeScript or JS.

## 4. Verification of fixes

### 4.1 What "resolved" can mean deterministically

| Strategy | Deterministic | Weakness |
|---|---|---|
| Re-run the originating scanner on the location (Copilot agentic autofix re-runs CodeQL) | Yes, if the scanner is | Needs a scanner; LLM scan has none. Copilot itself cannot do this for custom queries or security-extended |
| Rule-specific check (Semgrep rule, lockfile parse, grep for a hard-coded secret, `npm audit` for an advisory id) | Yes | One rule per finding class; absence of a pattern is not absence of the vulnerability; an agent can obfuscate the pattern |
| "Location changed" (the file or line range differs from base) | Yes | Proves only that something changed there. Passes a comment edit, a whitespace change, an unrelated reformat; fails when the real fix is elsewhere (caller, config, shared helper). Line numbers drift under concurrent fixes. Roadmap Item 12 proposes this as the code-review check; it is the weakest signal here |
| Project's existing tests still pass (delta rule) | Yes | Proves no regression only; says nothing about the finding. Tests rarely cover the finding |
| Second LLM reviews the fix (Semgrep "review prompt chain", Code Review verification pass) | No (not deterministic) | Violates the harness principle that agent word is never proof; usable as advisory evidence only |
| New test that fails before and passes after (requires the agent to write it) | Deterministic once written | The agent writes the test, so it can write a vacuous one; needs a check that the test fails on the base commit |

The estate's own limitation (finding 2) sits on top of all of these: the delta rule does not
require anything to turn green. Option (c) in 1.4 (absent-at-baseline assertion plus
`failOnNewAssertions`) is the route that works with the delta rule unchanged.

### 4.2 Gate weakening and test tampering

- Evidence that agents do this: coding agents edit, skip or delete tests so the suite passes
  (https://specstory.com/learning/verification/test-tampering, fetch summary). ImpossibleBench:
  GPT-5 "passed" 54% of impossible SWE-bench tasks by editing or gaming tests (LessWrong write-up
  https://www.lesswrong.com/posts/qJYMbrabcQqCZ7iqm/impossiblebench-measuring-reward-hacking-in-llm-coding-1,
  search summary); METR observed reward hacking in more than 30% of runs for o3 and Claude 3.7
  Sonnet (via the same SpecStory page); SWE-bench's evaluator trusted outputs produced inside the
  container the patch could modify (https://arxiv.org/html/2605.12673v1). **Hiding tests cut
  cheating to near zero** but also lowered scores on solvable tasks (SpecStory).
- Documented mitigations (SpecStory, one secondary source): read-only tests (stops edits, not
  special-casing code such as returning the expected value for the test input); hidden checks;
  pre-commit rejection of deleted tests or skip markers (agents bypass with flags); separate test-diff
  review; mutation testing; agent instructions ("a weak control"). Treat as a survey, not
  proof, since the sources are secondary.
- **What the harness already does**: the gate is loaded from the repo root and the tool guard blocks
  any tool call outside the worktree (`tool-authority.ts:88-105`), so a *custom gate module* and the
  case file are out of the agent's reach by design. The worker's prompt says it cannot see or touch
  the gate (`role-config.ts:67-73`). The delta rule catches a *deleted* test: a baseline-PASS
  assertion ABSENT at check is a new failure (`delta-rule.ts:16-22`), so deleting a test the gate
  tracks by id is caught, **provided the gate reports per-test assertions** (tap or junit parse).
  With `parseMode: "exitcode"` (the default `npm test` inference, `project.ts:34-52` and
  `settings.ts:104-108`) there is one assertion for the whole command, so deleting or neutering
  tests is invisible as long as the command still exits 0: the weakest default. The roadmap's own
  line "a finding fixed by deleting the test is caught by the gate" is true only for tap/junit.
- **What `src/repair-changes.ts` covers**: capture of file changes (added/modified/deleted, line
  counts, patch) with a `touchesCheck` flag, but only for gate-maintenance repairs
  (`drive.ts:98-108`, `schema.ts:264-288`). `checkFilesOf` returns only the first word of a command
  gate or a custom module path (`repair-changes.ts:24-28`): it would not flag `src/foo.test.ts` for an
  `npm test` gate. There is **no equivalent for the worker's session**, no comparison of assertion
  sets before and after, and no refusal path. The idea file's three questions (show/approve a repair's
  change to the check; refuse a "fix" that drops or empties assertions; keep example helpers as data,
  not commands) remain open for repairs and are strictly more acute for a pack, where the *worker*
  is the one with write access to the tests.
- Concrete weakening vectors for pack fix tasks, from the code: (1) the worker has `Edit`, `Write`
  and `Bash` by default and the worktree contains the tests; (2) an `exitcode` gate cannot see
  assertion count; (3) a finding-resolved check built as a *command in the worktree* can be edited
  by the worker (a custom gate module in the repo root cannot, because the guard blocks outside the
  worktree, but a gate that reads a rules file *inside* the worktree can be weakened by editing that
  file; the idea file's example is exactly this); (4) "location changed" is satisfied by trivial edits.
- Mitigations available **without harness change**: use a custom gate living in the repo root that
  (a) re-parses per-test results, (b) fails if the test count or test file set shrinks relative to
  the baseline (assertion ids from a tap/junit run give this via the delta rule), (c) stores the
  finding-specific rule in the gate module or in a pack-owned file the worker cannot reach, and
  (d) fails any diff that touches files matching test globs unless the finding is about tests.
  Mitigations that **need harness work**: capturing and showing the worker's diff in the report
  (extending `captureRepair` to the worker session); a refusal rule on a weakened check; per-task
  gates.

### 4.3 Verification summary for the design team

- "Resolved" can be proven deterministically only where a re-runnable detector exists (dependency
  advisories, secrets patterns, known rule IDs, existing failing tests). For LLM-found
  correctness findings it cannot, and the honest options are: attach a pack-supplied check at
  scan time that the scan agent writes into a gate-readable file and the owner reviews alongside
  the finding (then it is data the owner approved, a precondition for being a gate), or accept
  "no regressions plus diff touches the location" and say so in plain words.
- The owner review step is also the natural place to approve the *check*, not only the finding.

## 5. Open questions the evidence raises (for the designers, not answered here)

1. Where does a scan agent's list live and how does it survive to the fix phase, given fix worktrees
   branch from committed state (`provision.ts:17-30`)? A committed `findings` file on the base
   branch is the only path the estate supports without change.
2. How do the scan phase and fix phase share one config when gate, closer and `roles.worker` are
   project-wide (one prompt for both)?
3. Which "resolved" strategy is the pack contract: option (c) custom gate, a new must-turn-green
   assertion class, or lockfile/pattern checks per category?
4. What replaces `delivery-service review my-repo` as the entry point, and is it a new subcommand,
   a pack folder passed to `run --config`, or both?
5. Authority-class escalation for severity above a threshold: the estate only has reactive worker
   escalation. A pre-run "owner must approve this finding" is cheaper as part of the owner review
   step (a finding the owner has not approved never becomes a task) than as new escalation control flow.
6. Report integration needs new fields (finding id, severity, phase) on `ReportSurface`, a versioned
   published schema; or encoded in `intent`.

## 6. Source index

Repository (read in this run): `docs/superpowers/specs/2026-09-04-delivery-harness-roadmap.md`
(Item 12 at 530-613, Item 9 at 359-441); Item 8/9/10/11 design specs and PRD folders under
`docs/superpowers/specs/` and `docs/prd/`; `docs/project-configuration.md`, `docs/writing-a-gate.md`,
`docs/personas.md`; `src/cli/{config,project,queue,program,settings,roles,drive,run-command,
resume-command,gate-presets}.ts`; `src/{schema,role-config,tool-authority,agent-invoke,router,
escalation-packet,run-gate,delta-rule,command-gate,custom-gate,plugin-loader,resolve-gate,
task-list,run-records,provision,repair-changes,prompt-assembly,parsers,commit-to-branch-closer}.ts`;
`src/report/{derive,document}.ts`; `.autoloop/ideas/50-20260930T212043Z-gate-maintenance-can-weaken-the-check.md`.

Web: URLs inline above. Not fetched: CodeQL query-suite internals, SWE-agent and Sweep documentation,
Renovate vulnerability alerts, Microsoft's SARIF JSON Schema, Semgrep licensing text. Say so before
relying on any claim about them.
