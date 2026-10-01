# Spec review: Observability and Reporting design spec

Round 1. Verdict: REVISE (one blocking finding).

## Findings

1. BLOCKING. `status --watch` over a one-at-a-time task list is undefined. At concurrency 1 each task is its own run and there is no run file (spec "Problem", section 3 `list`). Watch defaults to "most recently touched" and "exits with the run's code when an outcome is recorded". Read literally, watching the default overnight list ends, with "Run finished" and exit 0, when task 1 closes, while the list carries on. The sample output only shows a supervised run. Two defensible builds: (a) watch the single task-run; (b) watch the list (`kind: list`) and end when every task has an outcome or the list stops at one that did not close. Recommendation: (b) for a bare `status --watch` in a project with a task list, (a) when an id is given; state the ending rule, the exit code for a list (same rule as `delivery run`) and the `stream_ended` payload for it.
2. Non-blocking, fixed. Sample inconsistencies: "Task 6 of 7" pointed at `...-3` (now `-6`); F4 "retry budgets at stop" showed correction 2 of 3 after one reroute (now 1 of 3).
3. Non-blocking, fixed. Section 3 said `live` was the only non-record input, but `kind: list` also needs the configured task list. Stated, and the determinism NFR now includes it.
4. Non-blocking, fixed. "Failed after N attempts" is built from worker dispatches (architecture), which can be cap+1 (budget `correction` counts reroutes, not the first dispatch). Spec now says N is the dispatch count, not the cap.

## Assembly checks

- Assembly resolutions (limit MUST, `touchesCheck` on files, `stopped` placement, forbidden-word union): all present and consistent. The full forbidden-word list is only in Assembly resolutions, not the Vocabulary section; acceptable, left as is.
- Dropped or contradicted versus the two approved artefacts: nothing material dropped. Minor omissions accepted: `--since <seq>` note, `reportJsonSchema` export name, "opt-in for one minor release" wording, test-first note.
- Buy-vs-build ledger: every row survived (ink retained as deferred; `log-update` option dropped from the alternatives, harmless). Operability / DX: all six headings present.
- Scope: no speculative additions; control-flow ideas correctly excluded.

## Claims verified against src

`appendLine` has exactly two log writers (case-file.ts, run-file.ts); `deterministicRouter` wired in cli/drive.ts; `findQueueRun` content match and `alreadyFinished` refusal in resume; `escalateFromTail`, `escalateIfNotRun`, `dispatchOwnRepair`, `abort` exist in surface.ts; `Incomplete.limit` exists in ports.ts; `deriveBudgetsFromLog` counts correction on `reroute` triage entries; queue.ts takes the repo lock only above concurrency 1 (concurrency > 1 branch); `z.toJSONSchema` is already used in src. Not verified (future code): `total_cost_usd` capture in agent-invoke.ts (absent today, as the spec says).

## Round 2

Verdict: APPROVED.

- Finding 1 (watch over a one-at-a-time list) is resolved by build (b). Checked: Commands table (`status --watch [id]`), exit-code rule per subject, list-watch wording ("Run finished" only for a supervised run), the "When a watch ends" table (ending rule, exit code, `stream_ended` payload per subject), the between-tasks gap (keeps waiting, liveness stays `null`), event shape `run|null`, and the Assembly resolutions entry.
- New contradictions: none found. The empty-states table (unfinished run: keeps waiting; stopped part way: ends ok) agrees with section 2, and the no-list fallback to the most recent run is stated in the Commands table.
- Residual, non-blocking: the exact list-level exit code is "what `delivery run` ends with for a list in that state"; this is defined by existing code and needs no further decision.
