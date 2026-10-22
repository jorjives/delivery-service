# Named Schedules and a Scheduler Backend Port — Slice Scope

> Based on spec: docs/superpowers/specs/2026-10-21-named-schedules-design.md
> Next step: invoke writing-plans with this document

Assumptions (flagged, resolved conservatively because the run is unattended):

- The product's "UI" is the `delivery` command line; UAT steps are commands a non-technical operator can type and read the output of. No step needs a database, log or code inspection.
- The scheduler port split (spec section 7) delivers no user behaviour on its own, so it is carried inside Slice 2 (the first slice that needs a second schedule) rather than shipped as a layer-named slice. The default schedule must behave identically throughout.
- UAT avoids waiting for a real timer to fire; "next run" and "last run" shown by `status` are the observable evidence of a schedule being live.
- Documentation and changeset updates (spec section 11) are carried by the slice that introduces each behaviour, and completed in Slice 6.

---

## Slice 1: A Second Run on the Same Repository Is Refused, or Quietly Skipped

**Status:** ✅ Complete — 2026-10-22 — `eba040b`
**Tests:** ✅ Recorded — 2026-10-22 — `525adcc` — cli (vitest) — 1 UAT (covering 2 AC) + 4 AC, 0 skipped

**Delivers:** Starting `delivery run` while another run is already going on the same repository is refused, even for one-at-a-time runs, and `run --if-idle` turns that refusal into a quiet, successful skip.

**Operational note:** Every run, whatever its concurrency, now holds the repository's lock for its whole duration, so one-at-a-time runs gain the same "someone is running here" signal that several-at-once runs already have. A run killed mid-way is still taken over by the next run after the existing stale window.

**Build note:** Reuse the lock the repository already uses for several-at-once runs; do not add file-lock wrapping around the command or a lock of our own.

### Prerequisites

- None

### Acceptance Criteria

- [ ] While a one-at-a-time run is going, starting a second run on the same repository is refused with the same message and exit outcome that several-at-once runs already give.
- [ ] A second run started with `--if-idle` while another is going prints one line saying another run is going here, and finishes successfully.
- [ ] `--if-idle` on a repository with no run going behaves exactly like a normal run.
- [ ] A run on a different repository is never blocked by a run here.
- [ ] After a run is killed, the next run takes over once the existing stale window has passed.
- [ ] `--if-idle` is described in the CLI reference as a general flag, not a schedule-only one.

### UAT

**What you can now do:** Be sure that two runs on one project never work on the same item at once.

**How to try it:**
1. Start a delivery run on a project with work waiting, and leave it going.
2. In a second terminal, start another run on the same project.
3. In the second terminal, start a run again with the idle option.

**What you should see:** The second run is refused with a clear message; the idle-option run prints "Skipped: another run is going here" and ends without an error.

**Why this matters:** Work is never done and paid for twice, and unattended runs can overlap without producing failures.

---

## Slice 2: Run Several Named Schedules on One Project

**Tests:** ✅ Recorded — 2026-10-22 — `aeb5e47` — cli (vitest) — 1 UAT + 5 AC groups (9 checks), 0 skipped
**Delivers:** A project can have more than one schedule, each with its own name and interval, and `status` shows them all, while an already-installed default schedule keeps working untouched.

**Operational note:** Named schedules get their own scheduler entries and their own per-schedule log view, which `status` prints for each. Existing default timers are not modified until the user next enables. The scheduler is reached through a backend seam with a contract test suite, so a future platform needs one adapter and no change to the command; tests never need a real scheduler. Every scheduled invocation passes the idle option from Slice 1.

**Build note:** Scheduling stays with the platform's native scheduler (no custom daemon, no hand-rolled timer). The existing interval parsing and unit rendering are reused rather than rewritten.

### Prerequisites

- Runs can be told to skip quietly when another run is going on the repository
- A schedule can already be enabled, shown and disabled for a project under a single default name

### Acceptance Criteria

- [ ] `schedule enable` without a name sets up the default schedule exactly as before, and a default schedule installed before this change still appears in `status` and can still be disabled.
- [ ] `schedule enable --name <n> --every <i>` sets up a separate schedule alongside the default one.
- [ ] Enabling an existing name replaces that schedule only; other schedules are untouched.
- [ ] `status` without a name lists every schedule on the project, one block each, with name, interval, on or off, last run and next run, and the command to see its log.
- [ ] `status --name <n>` shows only that schedule.
- [ ] `status` on a project with no schedules says scheduling is off for it.
- [ ] A name that is not 1 to 32 lowercase letters, digits or hyphens, or the word `default` given explicitly, is refused with a configuration message and nothing is installed.
- [ ] The "on" message says whether a missed run happens when the machine is back, based on what the scheduler can do.
- [ ] The default schedule's behaviour is unchanged for existing users.

### UAT

**What you can now do:** Keep an hourly schedule and a nightly schedule on the same project.

**How to try it:**
1. Enable a schedule named `hourly` running every hour.
2. Enable a schedule named `nightly` running every day.
3. Look at the schedule status for the project.
4. Enable `hourly` again with a different interval, then look at the status again.

**What you should see:** Both schedules are listed with their own interval, last run and next run; the second enable changes only `hourly`, and `nightly` is unchanged.

**Why this matters:** One project can be served by a light frequent pass and a deeper nightly pass without one overwriting the other.

---

## Slice 3: Give a Schedule Its Own Run Settings

**Delivers:** Each schedule can carry its own config file, workflow, item cap and concurrency, so different schedules do different kinds of work.

### Prerequisites

- A project can have several named schedules, each with its own interval
- Scheduled runs skip quietly when another run is going

### Acceptance Criteria

- [ ] `schedule enable` accepts a config file, a workflow name, a maximum number of items and a concurrency, each optional.
- [ ] `status` shows each schedule's run settings alongside its name and interval.
- [ ] Re-enabling a name with fewer settings clears the ones left out; the latest command line is the whole definition.
- [ ] A config path that does not exist is refused, and a config that exists is stored as its full path.
- [ ] A maximum or concurrency that is not a positive whole number is refused.
- [ ] An empty workflow name is refused.
- [ ] Every refusal gives a configuration message and installs or changes nothing.
- [ ] The printed fallback crontab line for a schedule includes the same settings as the installed schedule would run with.
- [ ] Task and fresh options are not accepted for a schedule.

### UAT

**What you can now do:** Make the nightly schedule use a different workflow and config from the hourly one.

**How to try it:**
1. Enable `nightly` every day with a chosen workflow, a maximum of three items and a config file.
2. Enable `hourly` every hour with no extra settings.
3. Look at the schedule status.
4. Re-enable `nightly` with only the workflow, then look at status again.
5. Try to enable a schedule with a config file that does not exist.

**What you should see:** Each schedule lists its own settings; the re-enable drops the maximum and config; the missing config is refused with a clear message and nothing changes.

**Why this matters:** A single project can run a quick pass and a thorough pass that behave differently, with no surprise settings carried over from earlier.

---

## Slice 4: Switch Off One Schedule, or All of Them

**Delivers:** Schedules can be removed individually by name or all at once, without disturbing the others.

### Prerequisites

- A project can have several named schedules, each with its own settings and visible in `status`

### Acceptance Criteria

- [ ] `schedule disable` with no options removes only the default schedule.
- [ ] `schedule disable --name <n>` removes that schedule only.
- [ ] `schedule disable --all` removes every schedule on the project.
- [ ] Giving both a name and the all option is refused with a configuration message, and nothing is removed.
- [ ] Disabling a schedule that does not exist changes nothing and says the named schedule is already off.
- [ ] After a removal, `status` no longer lists the removed schedule.
- [ ] Running the project by hand is unaffected by any of this.

### UAT

**What you can now do:** Turn off the nightly pass but keep the hourly one, or clear everything.

**How to try it:**
1. With `hourly` and `nightly` enabled, disable `nightly` by name and view status.
2. Disable `nightly` again.
3. Try disabling with both a name and the all option.
4. Disable all schedules and view status.

**What you should see:** Only `nightly` disappears at step 1; step 2 says it is already off; step 3 is refused; step 4 leaves scheduling off for the project.

**Why this matters:** Operators stay in control of unattended work, one schedule at a time or all at once.

---

## Slice 5: Similarly Named Projects Never See or Overwrite Each Other's Schedules

**Delivers:** Schedules are attributed to exactly the project they were made for, so projects with similar paths or names that could clash stay separate.

**Operational note:** Which schedules belong to a project is decided by what each installed schedule records about its project directory, not by name prefixes, and needs no extra registry file. Installed schedules created before this change count as the default schedule.

### Prerequisites

- A project can have several named schedules and can list and remove them
- Schedules created before named schedules existed are still recognised as the default

### Acceptance Criteria

- [ ] Projects at `/a/b` and `/a/b.c` each see only their own schedules in `status`, and disabling one never removes the other's.
- [ ] An older, unlabelled default schedule is listed as `default` for its own project.
- [ ] Enabling a name whose scheduler entry already belongs to a different project is refused with a message saying so, and nothing is written or overwritten.
- [ ] Re-enabling the default schedule on a project with an older default timer replaces it cleanly.

### UAT

**What you can now do:** Trust that one project's schedules never touch another's, even when their paths look alike.

**How to try it:**
1. On two projects with similar names, enable a schedule on each.
2. View status for each project.
3. Disable all schedules on the first project, then view status for the second.
4. Try to enable a schedule whose name would collide with the other project's.

**What you should see:** Each project lists only its own schedules; the second project is unchanged after step 3; the collision is refused with a message naming the problem.

**Why this matters:** Shared machines with many projects cannot lose or overwrite each other's unattended work.

---

## Slice 6: Machines Without a Scheduler Get a Crontab Line per Schedule, and the Docs Say How

**Delivers:** On a machine where no scheduler backend is available, `schedule enable` explains why and prints a ready-to-paste crontab line for each schedule, and the user documentation covers named schedules end to end.

**Operational note:** The documentation set (scheduling guide and CLI reference) gains a worked two-schedule example, the idle option and the exclusion behaviour, and a release note is recorded.

**Build note:** The printed crontab line is plain text derived from the schedule definition; it is not an adapter and installs nothing. It must use the same argument list as an installed schedule.

### Prerequisites

- Schedules carry names, intervals and run settings
- Scheduled runs use the idle option so overlapping runs are skipped quietly

### Acceptance Criteria

- [ ] On a platform with no backend, `enable` is refused with a configuration message that says the platform has no scheduler backend yet.
- [ ] The refusal prints one crontab line for the schedule being enabled, with its interval, run settings and the idle option.
- [ ] The refusal notes that cron skips a run missed while the machine was off.
- [ ] The guide and CLI reference describe naming, the three commands, run settings, the idle option and the exclusion behaviour, with a worked example of two schedules.
- [ ] A release note describes the change.

### UAT

**What you can now do:** Use named schedules even on a machine without a supported scheduler, by pasting the printed line into the user's own crontab.

**How to try it:**
1. On a machine without a supported scheduler, try to enable a schedule named `nightly` with a workflow.
2. Read the message and the line it prints.
3. Open the scheduling guide and follow its two-schedule example.

**What you should see:** A clear refusal, a crontab line that includes the name's interval, workflow and idle option, a note about missed runs, and a guide whose example matches the behaviour.

**Why this matters:** Users on other platforms can still get unattended, non-overlapping runs, and everyone has one place that explains how.
