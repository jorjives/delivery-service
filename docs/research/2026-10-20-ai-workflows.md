# How people work with coding agents, and what delivery-service is missing

Date: 20 October 2026

This note surveys the workflows practitioners describe for AI coding agents, says which ones
delivery-service can already express (and where the example is), and lists the ones it cannot,
with the features each would need. It also records defects found while building the examples.

## Method

The survey drew on 31 web searches. Two sources were read in full: Anthropic's
[Claude Code best practices](https://code.claude.com/docs/en/best-practices) and
[How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code).
Several primary sites could not be reached from the research environment (simonwillison.net,
harper.blog, mitchellh.com, ghuntley.com, chatprd.ai). For those authors the descriptions come
from search summaries and secondary write-ups, so check the original before quoting it.

Each workflow was then tried against the harness: an example was built when the existing
features could express it, and each example was run end to end against the scripted agent
(`tests/workflow-examples.test.ts`).

## Summary

- 34 workflows were found. 20 are expressed by the ten new examples, and 3 more were already
  covered by the harness's design.
- 5 can be expressed only in part: the example ships, but a step a person or a trigger would
  take is missing. Two of the 20 (workflows 15 and 20) also lack one such step, noted in their
  rows.
- 6 cannot be expressed. Three gaps account for most of them: no event triggers (pull request,
  comment, CI failure, merge, alert), no task whose deliverable is an answer rather than a branch,
  and no way for a person to approve between workflow steps.
- Building the examples found two defects (`{{task.<field>}}` is never substituted; the closing
  sentence names the wrong check) and some smaller gaps, listed in
  [Defects and gaps found while building the examples](#defects-and-gaps-found-while-building-the-examples).

## Every workflow, and where it stands

| # | Workflow | Who describes it | Status | Where |
|---|---|---|---|---|
| 1 | Explore, plan, implement, commit | Anthropic | Partial: no pause to approve the plan | `plan-then-build-example` |
| 2 | Spec interview, then a fresh session executes | Anthropic, Harper Reed | Partial: one question per run | `spec-to-backlog-example` (the execution half) |
| 3 | Spec, then prompt plan and todo list, then execute | Harper Reed | Example | `spec-to-backlog-example` |
| 4 | Spec, small plan, one chunk at a time with a commit each | Addy Osmani | Example | `spec-to-backlog-example` |
| 5 | Test-first augmented coding from a test list | Kent Beck | Example | `test-first-example` |
| 6 | Visual iteration against a mock or screenshot | Anthropic | Not possible as described | |
| 7 | Codebase questions and onboarding | Anthropic | Not possible as described | |
| 8 | A feature over many short sessions, then a cleanup pass | Mitchell Hashimoto | Example | `plan-then-build-example` (`review` step) |
| 9 | Many agents in one shared checkout | Peter Steinberger | Covered by design, deliberately differently | Each task gets its own copy; `concurrency` |
| 10 | Hands-off agent in a sandbox with fast, clear tooling | Armin Ronacher | Covered by design | The fence, gates and guards |
| 11 | Parallel agents on work that is cheap to review | Simon Willison | Example | `research-notebook-example` |
| 12 | Scouting run to learn the shape of a change | Simon Willison | Example | `plan-then-build-example` (`scout`) |
| 13 | Asynchronous code research in a repository of its own | Simon Willison | Example | `research-notebook-example` |
| 14 | Architect plans, fresh agents implement | Jesse Vincent | Example | `plan-then-build-example` |
| 15 | Plan-first sessions with a shared CLAUDE.md of lessons | Boris Cherny | Example, except tagging Claude on pull requests | `compound-engineering-example` |
| 16 | Writer and reviewer split; test writer and code writer split | Anthropic | Partial: the reviewer cannot send work back | `plan-then-build-example`, `test-first-example` |
| 17 | Orchestrated agents with a work ledger and merge queue | Steve Yegge | Covered | Backlog, item ledger, delivery branch, `concurrency` |
| 18 | Ralph loop: specs, a fix plan, one item per fresh session | Geoffrey Huntley | Example | `spec-to-backlog-example` |
| 19 | Compounding engineering: plan, work, review, record the lesson | Every | Example | `compound-engineering-example` |
| 20 | Issue assigned to an agent becomes a pull request | GitHub Copilot | Example, except iterating on review comments | `issue-to-pr-example` |
| 21 | `@claude` mention on an issue or pull request | Anthropic | Not possible | |
| 22 | Headless fan-out over a list of files | Anthropic | Example | `migration-campaign-example` |
| 23 | Step-wise migration pipeline with retries | Airbnb | Example | `migration-campaign-example` |
| 24 | Migration with automated validation, failures to people | Google | Example | `migration-campaign-example` |
| 25 | Playbook-driven migration in parallel sessions | Nubank and Devin | Example | `migration-campaign-example` |
| 26 | Bot opens a version bump, an agent repairs the breakage | Renovate and Dependabot users | Partial: cannot work on the bot's branch | `dependency-upgrade-example` |
| 27 | Flaky-test fixer that improves itself | Intercom | Example | `flaky-test-example` |
| 28 | Automatic pull request review bot | Cursor Bugbot, Anthropic | Not possible | |
| 29 | Docs kept in step on merge or nightly | Claude Code GitHub Actions users | Example, on landing and daily rather than on merge | `docs-drift-example` |
| 30 | Incident triage from screenshots, traces and logs | Anthropic, Datadog, OpenHands | Not possible | |
| 31 | Data analysis with read-only access and business context | Practitioners, Anthropic | Example | `research-notebook-example` |
| 32 | Marketing copy within strict limits | Anthropic | Example | `ad-copy-example` |
| 33 | Product manager's second brain; PRD to prototype | Teresa Torres, Builder.io, Hamel Husain | Partial: PRD to prototype only | `spec-to-backlog-example` |
| 34 | Evals by error analysis and validated judges | Hamel Husain | Not possible as described | |

## Workflows that cannot be built, and what they need

### 6. Visual iteration against a mock

The agent builds a page, takes a screenshot, compares it with the design, and repeats.

- **Missing: an image gate.** A custom gate could render the page and diff it against the mock,
  but nothing ready-made does, and the project would need a browser in every working copy.
- **Missing: image evidence.** Gate evidence reaches the next attempt as text. A failing visual
  check needs to hand the agent the diff image, not a sentence about it.

### 7. Codebase questions and onboarding

A person asks "how does logging work?" and reads the answer.

- **Missing: an answer-only task.** Every run's deliverable is a branch, judged by a gate. A
  question's deliverable is an answer. The research notebook is a workaround (the answer is
  committed with code that backs it), but for a quick question a run that ends with "here is
  what I found", and changes nothing, is the right shape.
- It is also interactive, which is outside what the harness is for. This one may be better left
  to Claude Code itself.

### 21. `@claude` mention on an issue or pull request

Someone comments "@claude fix this" and an agent acts on that comment.

- **Missing: event triggers.** Work starts from the command line, a timer, or by polling GitHub
  issues for a label. Nothing starts a run from a comment, a pull request being opened, a CI
  failure or a merge.
- **Missing: state that survives an ephemeral runner.** The item ledger (attempts, parked
  items, what landed) lives in `~/.local/state/delivery-service/` on one machine. Running
  `delivery run --sources` in GitHub Actions would start from nothing each time and lose the
  parking and retry history. Keeping it in the repository, or on a branch, would fix this.
- **Missing: a reply.** The outcome needs to go back to the comment thread. `notify` gets the
  report on standard input, so this can be scripted, but there is no ready-made "reply where you
  were asked".

### 28. Automatic pull request review

On every pull request, a bot reads the diff and posts inline comments.

- **Missing: a diff-scoped review.** `delivery review` reviews the project, or a path with
  `--path`. A review of "what this branch changed against main" (for example `--since <ref>`)
  would fit a pull request.
- **Missing: comments as output.** A review's output is backlog ideas. A pull request review
  needs findings posted on lines of the diff, and no change to the branch.
- **Missing: a pull request trigger**, as for workflow 21.

### 30. Incident triage

During an outage, the agent reads screenshots, traces and logs and says what is wrong.

- **Missing: an alert source** (a webhook or a command source that polls an alerting system
  would do) and the answer-only task described under workflow 7.
- **Missing: read-only access to live systems.** The agent's tools come from the user's own
  Claude Code setup, and the harness neither grants nor restricts access to production. Triage
  needs read-only credentials scoped for the purpose, which is outside the harness.
- It is time-critical and conversational. The harness's strength, a gate that judges a change,
  does not apply until a fix is proposed. Proposing that fix as a follow-up task would fit.

### 34. Evals with validated LLM judges

Collect traces, label failures by hand, write code checks for deterministic failures and judge
prompts for the rest, and validate each judge against held-out human labels.

- **Not possible by design, as described.** A gate must give the same verdict on the same work.
  A gate that calls a model does not, and needs credentials inside the check. The code-check half
  works today (a gate that runs deterministic checks over a labelled set). The judge half needs
  either a sanctioned "judge" gate type, run several times with agreement thresholds and recorded
  as such, or to stay outside the harness.

## Workflows that can be built only in part

### 1. Explore, plan, implement: approving the plan

**Missing: a checkpoint between steps.** Anthropic's version has a person read and edit the plan
before any code is written. A workflow runs its steps straight through. `hold` waits for a
person only at the end, and only for an item at or above a severity. A step option such as
`"approve": true`, which parks the item after that step until `delivery sign-off`, would cover
it. The example's README gives the workaround.

### 2. Spec interview

**Missing: a conversation step.** The agent can ask one question by escalating with
`category: "decision"`. The item parks, `delivery answer` replies, and the next run carries on.
An interview of ten questions would take ten runs. An interactive step, or a way to ask several
questions at once, would make it practical.

### 16. Writer and reviewer: sending work back

**Missing: loops between steps.** The reviewing step can fix what it finds, which the example
does, but it cannot send the work back to the writing step with its notes. A step that fails
retries only itself. A step outcome of "back to step N, with this brief" would cover the
Anthropic pattern exactly.

### 20. Issue to pull request: iterating on review comments

The example opens the pull request. Copilot's agent also responds to review comments on it.
**Missing: pull request review comments as a work source**, and the ability to work on the pull
request's existing branch rather than the delivery branch.

### 26. Repairing a bot's version bump

The example has the harness do the bumps itself. The workflow as described starts from a pull
request Renovate or Dependabot already opened and failed CI on. **Missing: a task that starts
from an existing branch** (every item starts from the delivery branch) and a CI-failure trigger.

### 33. Product manager's second brain

PRD to prototype works (`spec-to-backlog-example`, with the PRD as the spec). Daily routines
over notes and meetings are interactive and are not repository work. Tasks from Linear or Jira
work today through a `command` source, but there is no ready-made source for either.

## Defects and gaps found while building the examples

1. **`{{task.<field>}}` is documented but never substituted** ([#17](https://github.com/jorjives/delivery-service/issues/17)). `docs/project-configuration.md`
   says any front-matter field is available to step prompts as `{{task.<field>}}`, and
   `{{task.body}}` as the brief. A step prompt containing them reaches the agent with the
   placeholders still literal. The fields are in the prompt's `## Task` block, so the agent can
   find them. The examples avoid the placeholders and say "the file named in the task's `file`
   field" instead.
2. **The closing sentence names the project's check, not the one that ran** ([#18](https://github.com/jorjives/delivery-service/issues/18)). A run through a
   workflow whose steps each name their own gate ends "passed `npm test`" even when no step ran
   `npm test` (`checkOf` in `src/cli/outcome.ts` reads only the header's `gateRef`).
3. **A task list cannot be worked through a workflow.** `--workflow` needs `--task`, and an
   entry in `tasks` cannot name a workflow. Only backlog items and source tasks can. Three
   examples use the backlog for this reason alone.
4. **Two example READMEs use commands that no longer exist** ([#19](https://github.com/jorjives/delivery-service/issues/19)). `examples/code-review-example` and
   `examples/no-tests-example` tell the reader to run `delivery findings` and `delivery fix`.
   The commands are now `delivery backlog`, `delivery approve`, `delivery decline`,
   `delivery sign-off` and `delivery run --sources`.
5. **A command gate cannot see the task's fields.** The migration and upgrade examples need a
   custom gate module only to read `file`, `package` and `to`. Passing the task to a command gate
   (an environment variable naming a JSON file, say) would let them be one-line commands.
6. **Custom gate modules are shared between concurrent tasks** ([#20](https://github.com/jorjives/delivery-service/issues/20)). A gate module is loaded once per
   process, so state kept in a module variable is shared by every task running at once. The
   migration example's gate keys its state by working copy for this reason.
   `docs/writing-a-gate.md` does not warn about it.
7. **`delivery validate` does not describe sources** ([#21](https://github.com/jorjives/delivery-service/issues/21)). For a project that works from `sources`, it
   says "no tasks listed: name one when you run, with `delivery run --task`", which suggests the
   wrong command, and it lists neither the sources nor the workflows.
8. **Only Claude agents.** Jesse Vincent and others have a second vendor's model review the
   first one's work. A step can set its own `agent` options, including the model, but every step
   runs Claude Code.

## Suggested order

By how many surveyed workflows each would unlock:

1. Event triggers, with state kept somewhere an ephemeral runner can reach (workflows 20, 21, 26,
   28 and 29).
2. A step checkpoint for a person's approval, and a "send back to step N" outcome (workflows 1, 2
   and 16).
3. An answer-only task and a diff-scoped review (workflows 7, 28 and 30).
4. The defects in items 1 to 4 of the previous section, which are small and affect what is
   already documented.
