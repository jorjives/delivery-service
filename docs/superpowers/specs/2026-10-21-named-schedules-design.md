# Delivery Service: Named Schedules and a Scheduler Backend Port — Design

> **Status:** Draft, awaiting review
> **Created:** 2026-10-21
> **Builds on:** `delivery schedule` (`src/cli/schedule.ts`, `src/cli/schedule-command.ts`, `docs/run-on-a-schedule.md`).

## 1. Why

`delivery schedule enable` gives a repository exactly one timer. Its units are named
`delivery-<repoKey>`, a second `enable` overwrites the first, and the service always runs plain
`delivery run --sources`. Someone who wants an hourly light pass with one config and a nightly
deep pass with another workflow, on the same machine and project, cannot have both.

Scheduling is also tied to systemd. That is acceptable for the first adapter but not as the shape
of the code: launchd, Windows Task Scheduler or a supervised daemon should be a new adapter, not a
rewrite. This spec fixes the model and the seam; it does not build any second adapter.

## 2. Scope

**In scope:**

- A schedule is a named `{name, interval, run arguments}` on a repository. A repository can have
  many.
- The `schedule enable`, `status` and `disable` contract for names.
- Finding a repository's schedules deterministically.
- A scheduler backend port, with systemd as its only adapter, and a contract test suite for it.
- Mutual exclusion of runs on one repository, which overlapping schedules make necessary (§6).

**Not in scope:** launchd, Task Scheduler, a `schedule serve` daemon, any container or sandbox
wrapper (handled elsewhere), `--task` or `--fresh` in a schedule (neither makes sense unattended),
and per-schedule `notify` (the top-level `notify` in the config file still applies to every run).

## 3. The schedule model

A schedule is data, independent of any scheduler:

| Field | Meaning |
|---|---|
| `repoPath` | The git repository, absolute. |
| `name` | `[a-z0-9-]{1,32}`. `default` is the unnamed schedule. |
| `every` | An `Interval`, as today (`5m`..`30m` dividing an hour, `1h`..`12h` dividing a day, or `1d`). |
| `args` | `config?: string` (absolute), `workflow?: string`, `max?: number`, `concurrency?: number`. |

The command a schedule runs is derived from the model, once, by one function: `run --sources`
followed by `--config <path>`, `--workflow <name>`, `--max <n>`, `--concurrency <n>` for each
given, then `--if-idle` (§6). Every adapter and the printed cron line use that same argument list,
so they cannot drift.

Validation happens in `enable`, before anything is written: the name matches the pattern and is
not `default` unless unnamed; `--max` and `--concurrency` are positive integers; `--workflow` is
non-empty; a `--config` path must exist and is stored resolved. A failure is a `Refusal` with exit
code `configuration`, worded as the existing interval refusal is.

## 4. The CLI contract

```
delivery schedule enable  [--name <n>] [--every <i>] [--config <p>] [--workflow <w>] [--max <n>] [--concurrency <n>] [--repo <p>]
delivery schedule status  [--name <n>] [--repo <p>]
delivery schedule disable [--name <n> | --all] [--repo <p>]
```

- No `--name` means `default`. The default schedule keeps the unit names it has today,
  `delivery-<repoKey>.service` and `.timer`, so every timer already installed keeps working, is
  shown by `status` and can be removed by `disable`, with no migration.
- `enable` on a name that exists replaces that schedule only, interval and arguments both. A
  re-`enable` with fewer flags clears the flags left out: the command line is the whole
  definition, not a patch.
- `status` without `--name` lists every schedule the repository has, one block each, with its
  name, interval, arguments, on or off, last run and next run. With `--name` it shows that one.
  With none installed it says `Scheduling is off for <repo>` as today.
- `disable` without flags removes `default` only. `--name <n>` removes that one; `--all` removes
  every schedule for the repository. `--name` with `--all` is refused. Disabling a schedule that
  is absent is a no-op with the existing "already off" wording naming the schedule.
- Running by hand is never affected.

## 5. The systemd adapter

Named schedules use `delivery-<repoKey>.<name>.service` and `.timer`. Unit contents are as today
with three changes: `ExecStart` is the derived argument list, `Description` names the schedule, and
the `[Unit]` section gains `X-Delivery-Schedule=<name>`. Unknown `X-` keys are ignored by systemd.
The default schedule keeps its present rendering, with the marker added only when it is next
written.

**Finding a repository's schedules.** A key prefix cannot be used: `/a/b` and `/a/b.c` share
`delivery-a-b`. Instead the adapter lists `delivery-*.service` in the user unit directory, reads
`WorkingDirectory` (with `%%` unescaped) and `X-Delivery-Schedule` from each, and keeps the files
whose directory equals the repository. A file without the marker is `default`. This is
deterministic and needs no registry file.

**Name collision.** `delivery-a-b.nightly` can in principle also be repository `/a/b.nightly`'s
default unit. `enable` refuses when the target unit file exists and belongs to a different
repository, saying so; it never overwrites another repository's schedule.

## 6. Running more than one schedule: exclusion

systemd stops one service overlapping itself but not two services. Reading the code: a
`run --sources` at concurrency 1 takes no repository lock (`queue.ts`: "One at a time takes no
lock"), and neither does `--task`. Two such runs would pick the same next item and fight over the
delivery branch. The backlog idea "One-at-a-time runs take no repository lock" names scheduled runs
as the point at which this stops being theoretical. Named schedules are that point, so this spec
closes it rather than documenting around it.

- **Every `delivery run` takes the repository lock** (`takeRepoLock`, `proper-lockfile`, already
  used for several-at-once runs) for as long as it runs, whatever its concurrency. A second run
  while it is held is refused as `refuseIfRunGoing` already refuses. This also gives one-at-a-time
  runs the liveness signal the idea asked for. The lock lives under `.delivery/`, so it is
  per-repository and per-machine, which is the scope of "same machine, same project".
- **`run --if-idle`**: when the lock is held by a live run, exit `0` after printing one line
  (`Skipped: another run is going here`) instead of refusing. Every scheduled invocation passes it,
  so an hour that overlaps a long run is a quiet skip, not a failed unit every hour. A run started
  by hand does not pass it and still gets the refusal. `--if-idle` is documented in the CLI
  reference as general, not schedule-only; it is a portable alternative to wrapping `flock`, which
  no adapter other than systemd-on-Linux could rely on.
- The lock is the only mutual exclusion; adapters do not implement their own, so a future adapter
  is exclusive for free.
- The stale-lock window is unchanged (10 s). A killed run is followed by a run that takes the lock
  over, as today.

This changes concurrency-1 behaviour that an earlier item left untouched deliberately. The change
is in scope because the alternative, overlapping runs on one delivery branch, corrupts the thing
the tool exists to protect.

## 7. The scheduler backend port

Four modules replace the single `schedule.ts`; `schedule-command.ts` becomes orchestration only
(parse, validate, call the port, print).

| Module | Purpose | Depends on |
|---|---|---|
| `schedule/model.ts` | `Schedule`, name and argument validation, `parseInterval`, the derived argument list. | `run-location` (`repoKey`) |
| `schedule/backend.ts` | The `SchedulerBackend` interface and `selectBackend(platform, env)`. | `model` |
| `schedule/systemd.ts` | The systemd adapter: unit rendering, `systemctl`, the repository scan. | `model`, `backend` |
| `schedule/cron.ts` | `cronLine(schedule)`: the line printed when no backend can run schedules. | `model` |

```ts
interface SchedulerBackend {
  /** Whether this machine can run schedules with this backend; the reason when not. */
  probe(env): Promise<{ ok: true; catchesUp: boolean } | { ok: false; reason: string }>;
  /** Install or replace one schedule, enabled and running. Idempotent. */
  install(schedule: Schedule, env): Promise<void>;
  /** Stop and remove one schedule. Returns false when it was not installed. */
  remove(repoPath: string, name: string, env): Promise<boolean>;
  /** Every schedule installed for the repository, with state and last and next run as the scheduler reports them. */
  list(repoPath: string, env): Promise<InstalledSchedule[]>;
}
```

`selectBackend` returns the systemd adapter on Linux and, elsewhere, a backend whose `probe` fails
with `"<platform> has no scheduler backend yet"`. The refusal is then the same refusal as today:
exit `configuration`, with one `cronLine` per schedule for the user's own crontab, and the same
caveat that cron skips a run missed while the machine is off. The cron line is portable text
derived from the model, not an adapter, because it installs nothing.

The port speaks in `Schedule` and `InstalledSchedule`; no systemd concept (unit, specifier,
`OnCalendar`, `Persistent`) appears in it. `Persistent=true`'s "missed runs happen when the machine
is back" is a property an adapter declares (`catchesUp`), so the "on" message says it or not,
rather than the command assuming it.

## 8. Errors

| Situation | Outcome |
|---|---|
| Bad name, interval, argument or missing `--config` | `Refusal`, exit `configuration`, nothing written. |
| `--name` together with `--all` | `Refusal`, exit `configuration`. |
| Backend probe fails | `Refusal`, exit `configuration`, cron lines printed. |
| Target unit belongs to another repository | `Refusal`, exit `configuration`, nothing written. |
| A backend call that must work after the probe fails | Thrown as an internal error, as `must` is today. |
| Scheduled run finds the repository held | Exit `0`, one line, journal shows a skip. |
| Manual run finds the repository held | Refused as today. |

## 9. Testing

- **Contract suite** (`schedule/backend.contract.ts`): one function that takes a backend factory and
  asserts the port's behaviour: install then list returns the schedule; install twice replaces;
  two names coexist; two repositories do not see each other's schedules (including `/a/b` and
  `/a/b.c`); remove returns true then false; a pre-existing unmarked unit lists as `default`. The
  systemd adapter runs it today; a future adapter must pass it unchanged.
- **Stand-in:** `systemctl-stand-in` answers `show` with one property set for every unit. It gains
  per-unit answers, keyed by the unit argument, so `status` of several schedules can be tested. It
  stays the only way tests reach systemd (`DELIVERY_TEST_SYSTEMCTL`).
- **Model:** parse and validation table tests, including the derived argument list for every
  combination of flags, and the cron line's quoting.
- **Exclusion:** a failing-first test that two `delivery run` commands at concurrency 1 on one
  repository do not both start; one that `--if-idle` exits `0` with the skip line and a run
  without it exits `configuration`; one that a stale lock is taken over.
- **Behaviour tests** for the `schedule` commands follow the existing course-correction test for
  item 6, extended for names.

## 10. Buy-vs-build decisions

- **Scheduling is bought, not built.** systemd user timers remain the mechanism; nothing here is a
  scheduler. Future portability prefers each platform's native scheduler (launchd, Task Scheduler)
  as an adapter over a custom daemon, since OS schedulers are commodity and a daemon would need
  its own supervision. Before the first non-systemd adapter, check the wider estate for prior art
  (Autoloop uses systemd `autoloop@<key>` timers, so it offers none cross-platform).
- **Locking is bought.** `proper-lockfile` is already the repository's lock; this extends its use,
  rather than adding `flock` wrapping or a lock of our own.
- **New code** is name and argument validation, the derived argument list, the repository scan and
  the port. The unit renderers and `parseInterval` are reused.

## 11. Operability / DX

- **Developing:** no systemd needed; all schedule tests go through the stand-in. The port plus the
  contract suite is the extension point: an adapter is one module and one contract-suite line.
- **Running:** each scheduled run's output is in the journal under its own unit, so
  `journalctl --user -u delivery-<key>.<name>.service` is per-schedule. `status` prints that
  command for each schedule, as it does today for one.
- **Verifying:** `status` reports state from the scheduler, not from files, as now.
- **Deploying:** installed default timers are untouched until the user next runs `enable`.
  `docs/run-on-a-schedule.md` and `docs/cli-reference.md` are updated (a worked example with two
  schedules, `--if-idle`, the exclusion behaviour), and a changeset is added.
- **Refactor safety:** the port split is behaviour-neutral for the default schedule: the existing
  schedule tests pass unchanged against the new modules.

## 12. Resolved questions

- *Does a name collide across repositories?* It can in principle; `enable` refuses (§5).
- *Why not make `--if-idle` schedule-only?* It is a general need for any unattended invocation
  (cron, CI), and keeping it a plain flag keeps the port free of exclusion logic.
- *Why does re-`enable` clear omitted flags?* Merging with an old definition would make the stored
  schedule depend on history; the command line should be the whole truth.
