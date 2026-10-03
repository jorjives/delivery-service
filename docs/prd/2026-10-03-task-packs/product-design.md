# Product design: Pre-Built Task Packs (Roadmap Item 12)

Status: draft, revision 2 for critic review. Grounded in `research.md` (cited
`research §n`), `architecture.md` (cited `arch §n`; agreed with the architect),
`review-log.md` (including "Revised after critic round 1"), `docs/personas.md`, and
roadmap Items 12 to 14. Format and altitude follow
`docs/prd/2026-10-01-observability-and-reporting/product-design.md`. Mechanism and
storage are the architect's; this document says what the *person* must be able to
rely on, not how. This describes the product as it will exist, not the order of
building it.

## Vision

An owner who has never configured anything should be able to point the harness at
their repository and ask "what is wrong with this, and can you fix it?", and within
minutes read a list of problems written for a person who is not an engineer. They
choose which ones to have fixed. Each chosen problem is fixed by an agent and
*proved* fixed by a check the agent cannot reach, and the owner comes back to one
report: what was fixed and landed, what is waiting for their sign-off, and what could
not be fixed and why. A problem the harness cannot fix is never dropped quietly.

A pack is the thing that makes this repeatable: a small, versioned bundle (what to
look for, the shape of a finding, how to turn a finding into a task, how to check it,
how to land it) that ships with the harness for the two commonest reviews, and that an
engineer can write for their own domain.

The honest limits, stated up front because the owner will rely on them:

- A scan is an agent's opinion. The product says so, and shows how sure the scan was.
- "Fixed" is only as strong as the check behind it. Every problem shows, before the
  owner approves it, *how the harness will know it is fixed*, and says plainly when the
  answer is only "the existing tests still pass" (research §4.1: "the location
  changed" is the weakest signal, so it is not used; re-run detectors are the strongest).
- The product proves a fix passed its check. It does not prove the fix is wise; that
  is what sign-off on the serious ones is for.

## Personas (by reference)

`docs/personas.md` is the source of truth (team-derived, assumed, not human-confirmed).
This phase appends a goal extension to Dana, Marcus and Priya in place. Every journey
and feature below cites **[Dana: ...]**, **[Marcus: ...]** or **[Priya: ...]**.

- **Dana Okafor, non-technical owner.** Extended goal: with no configuration, ask for
  a code review or security review, read the problems in plain words, choose which to
  fix, and come back to a report that says what was fixed, what waits for her
  sign-off, and what could not be fixed. Never asked to approve what she cannot
  understand.
- **Marcus Webb, on-call engineer.** Extended goal: for an unfixable problem or a
  security fix held for sign-off, see the technical detail beside the plain sentence
  (file and line, the problem's own check, what the check saw), so he can judge it or
  take it over without re-running the scan.
- **Priya Shah, extender.** Extended goal: author a pack for her own domain, prove it
  with scripted agents (no real agent run), and have a malformed pack refused in terms
  she can fix (which file, which field).

## Derived minimum scope (assumed, not human-confirmed)

The floor is derived, not confirmed: the team-lead's inference in `review-log.md`
(revised after critic round 1) that the roadmap's Item 12 success criteria, each
reachable by a named persona with no configuration beyond pointing at the repository,
are the least this phase must deliver. Refined here to the smallest capability set
that lets each persona complete the primary journey end to end. The critic is asked to
attack it.

| # | Roadmap criterion | Persona and goal | Reached by |
|---|---|---|---|
| 1 | Run a code review with no configuration beyond the repo | Dana: first review | `delivery review code` |
| 2 | Scan findings: location, problem, why it matters | Dana, Marcus | the findings list; `delivery findings` |
| 3 | Each code finding becomes a fix task with a gate that verifies that issue | Dana | `delivery fix`; per-finding check |
| 4 | Run a security review with the same ease | Dana | `delivery review security` |
| 5 | Security findings by severity, understandable to a non-technical owner | Dana | severity words and "what could happen" line |
| 6 | Each security finding's gate verifies the vulnerability is closed | Dana, Marcus | per-finding check; held-for-sign-off above threshold |
| 7 | Unfixable findings escalated with a clear explanation, not skipped | Dana, Marcus | `could not be fixed` state, report section |
| 8 | Owner reviews scan output before authorising the fix phase | Dana | `delivery findings approve / skip` |
| 9 | A pack is a defined, stable bundle others can author | Priya | pack format `delivery.pack/1`, `delivery packs check` |

Items beyond the literal criteria that the floor needs because a criterion cannot be
met for the default user without them (each justified so the critic can test it):

- **A named verification level per finding, shown at review time.** Criterion 3 and 6
  ("a gate that verifies the specific finding is resolved") cannot be honestly met for
  every LLM-found finding: some have a re-runnable check, some have only "tests still
  pass and the location changed" (research §4.1, §4.3). Without telling the owner which
  is which, "fixed" over-claims. The *check is approved with the finding* (research
  §4.3).
- **A held-for-sign-off state with a one-step way to land or reject.** Criterion 6's
  roadmap text requires "human sign-off before the fix is merged". There is no
  approve-and-continue today and an escalated run cannot be resumed (research §1.6).
  Without a landing step Dana is asked to sign off something she then cannot act on.
  (Mechanism: arch §8. Sign-off runs the project's landing closer on the kept branch.
  If the base has moved, the existing plain failure applies and the finding shows
  *signed off but could not be merged*.)
- **A stable finding identity.** Needed so that a finding the owner skipped is not
  re-proposed after the next scan, which Item 13 (a weekly review) will otherwise
  turn into daily nagging. Without it the review step is not credible as a repeated
  practice. (Remembering skips across scans is SHOULD; the *identity* is MUST so the
  option stays open.)
- **The anti-weakening guarantee on the per-finding check.** The roadmap's own line is
  "a finding fixed by deleting the test is caught by the gate". Research §4.2 shows
  that is false for the default exit-code gate. The guarantee is therefore part of the
  product promise, not an implementation detail: a fix that deletes, skips or empties
  tests, or edits the check, is rejected.
- **Report integration with no new report type.** Item 11 states "a pack's fix phase
  is more tasks and more events; no new report type". The owner must see finding
  title, severity and phase in the existing report. (Needs new fields; research §1.7.)

Not in the floor: configurable severity threshold (SHOULD), remembering skipped
findings across scans (SHOULD), ingesting other tools' output (COULD), third-party
discovery (COULD).

## Finding states (the closed set, defined once)

Every other section, the report, the JSON and the metrics refer to this table
(arch §9.1 holds the internal names). "Who acts" is what the owner is told.

| Owner-facing state | Terminal? | Who acts | Internal |
|---|---|---|---|
| not yet decided | no | the owner: approve or skip | proposed |
| being fixed | no | nobody | approved, fixing |
| waiting for your sign-off | no | the owner: sign off or reject | held |
| fixed and merged | yes | nobody | fixed, signed off and landed |
| already fixed | yes | nobody (the flagged code is no longer there) | already_resolved |
| skipped by you | yes | nobody | skipped |
| declined at sign-off | yes | an engineer if wanted: the branch is kept | rejected |
| signed off but could not be merged | yes | the owner or an engineer: the fix conflicts with your main copy, or no longer passes its check there (it is rebased and re-checked before landing); the branch is kept | signed_off_failed |
| could not be fixed | yes | the owner or an engineer, per the explanation. One cause is counted separately: "needs a change to one of your tests, which this review does not let an agent do" | unfixable (`needs_test_change` among causes) |
| stopped by a setup problem | yes | an engineer | stopped |
| needs your decision | yes | the owner (the review says only a person can resolve it, or the problem has no specific check: "cannot be checked"; `approve <n> --allow-unchecked` overrides, recorded, and the fix is then always held) | needs_decision |
| could not be confirmed | yes | nobody (the scan could not find the flagged code again, listed, not offered) | unconfirmed |

A fix that is done except for something only a person can do (rotating a leaked
credential) is *waiting for your sign-off* when the severity or the no-tests rule
holds it, and otherwise *fixed and merged* with the "one thing is left for you" line
shown beside it as part of the fix's explanation, not a separate state.

## Tiering

### MUST

1. **Pack format `delivery.pack/1`.** A pack is a folder: a manifest naming what to
   look for (scan instructions and categories), the finding shape (extra fields the
   pack adds to the common ones), how a finding becomes a fix task (fix template), the
   per-finding check, the closer, the sign-off policy, and a plain-language
   description and example finding. Versioned; additive-only within a major. [Priya:
   author a pack; the roadmap's "stable format for community contributions".]
2. **Two shipped packs: `code` and `security`.** Code review looks for correctness
   issues, dead code, missing error handling, inconsistent patterns, documented
   technical debt. Security review looks for dependency vulnerabilities (in this release from the reviewer's own knowledge, shown to the owner as "from the reviewer's knowledge, not from an advisory database; it may be out of date or wrong"; an advisory-database feed is COULD, item 24), injection
   surfaces, authentication and authorisation gaps, secret exposure, insecure
   defaults. Both run with no configuration file. [Dana.]
3. **Scan phase: `delivery review <pack> [repo]`.** Runs the scan agent read-only
   over the repository and ends with the findings list and the exact next step. It
   changes nothing in the repository's code. [Dana.]
4. **Plain-language findings.** Every finding has a title, a severity (critical, high,
   medium or low, on both packs), where (file and line), the problem, why it matters,
   and what "fixed" looks like, each in words a non-engineer follows, plus a separate
   technical block for engineers. On the code pack severity is only a way to order
   and read the list; it never holds a fix (see 9). [Dana, Marcus; roadmap
   accessibility example.]
5. **Owner review step before any fix.** Nothing is fixed until the owner approves
   it. Findings start *proposed*; the owner approves or skips each (or approves all)
   with `delivery findings approve / skip`, or by choosing in an interactive list.
   [Dana: criterion 8.]
6. **Fix phase: `delivery fix`.** Each approved finding becomes one gated fix task,
   run through the existing queue and supervisor (so concurrency, retries, budgets,
   triage, escalation and resume behave exactly as today; fan-out follows
   `concurrency`). [Dana, Priya.]
7. **Per-finding targeted check, with an honest level.** Each finding carries the
   check that proves it fixed, from a closed set of deterministic kinds (arch §5.3):
   the flagged code is gone (the default); a named risky pattern no longer appears; the
   vulnerable library version is no longer installed (npm lockfile). A finding the scan
   cannot confirm still exists is not offered (it is listed as "could not be
   confirmed"). A finding with no specific check is shown as "tests only: no check of
   this specific problem". The level is shown at review time and beside "fixed" in the
   report. In a project with no tests see "Empty states" for what this means.
   [Dana: understand what "fixed" means; Marcus.]
8. **Anti-weakening guarantee.** A fix is rejected, and the agent is told why, if it
   deletes or modifies existing tests, adds a skip marker, or changes the test runner
   configuration or the project's test command (arch §7.2); new test files are
   allowed. One narrow exemption: for a finding in the *tests* category (for example
   "this test checks nothing"), modifying (never deleting) existing tests is
   permitted, and the review shows that finding as "this fix will change your tests".
   [Dana: trust; Priya.]
9. **Sign-off hold.** Each severity has fixed wording for what the level means. On
   the security pack, findings at or above the **default threshold, high**, are fixed
   and checked but **not merged**: they are held, and the report says in plain words
   what changed and what the risk was. The owner lands a held fix with one command
   (`delivery findings sign-off <n>`: the kept branch is rebased onto the current main copy, the check is re-run there, then it lands by the project's closer, arch §8)
   or rejects it with one (`reject <n>`); nothing is merged before a recorded
   sign-off, and the branch is named for engineers. The code pack's default threshold
   is none. Independently of severity, a fix in a project with no tests is always held
   (see "Empty states"). [Dana, Marcus: roadmap's authority-class
   default.]
10. **Unfixable findings escalate, never vanish.** A finding the fix agent cannot
    resolve (needs a human decision, a structural change, or an outside action) ends
    as *could not be fixed* with a plain explanation and what the owner can do. Every
    finding is in exactly one state of the closed set in "Finding states" at every
    moment and ends in a terminal one. [Dana: criterion 7; Marcus.]
11. **Results in the existing report and status.** `delivery report` and `delivery
    status` show each fix task by finding title and severity, group findings by state
    in the owner's words, and carry the review (how many found, approved, skipped) in
    the headline. `--json` carries the same facts. [Dana: return to a report; Priya.]
12. **Machine-readable output.** `--json` on `review`, `findings`, `fix`, `packs`;
    the finding and pack schemas printable (`--schema`), versioned, additive-only.
    [Priya.]
13. **Pack authoring check: `delivery packs check <path>`.** Validates a pack's
    manifest and finding schema in terms of file and field, and dry-runs the pack
    against a scripted agent (the existing scripted-agent testing story,
    `docs/testing-your-pipeline.md`), so a pack can be proved without a real agent
    run. [Priya.]
14. **Degraded states handled** (below): no findings, scan fails, scan output
    malformed, repo with no tests, stale findings.

### SHOULD

15. **Allow test edits per finding**: `delivery findings approve <n> --allow-test-edits`
    (recorded, fix forced held). [Dana: unblock "needs a test changed".]
16. **Configurable sign-off threshold** (`critical`, `high`, `medium`, `low`, or
    `none`), per pack, via the project configuration and a flag. Default stays `high`.
    [Dana: sets "everything medium and above".]
17. **Skips remembered across scans** (by finding identity), so a re-run or a weekly
    review does not re-propose what the owner declined; the review shows "3 declined
    earlier, not shown (`--include-skipped`)". [Dana; precondition for Item 13.]
18. **Confidence and quiet controls on the scan**: the scan states how sure it is of
    each finding; low-confidence ones are collapsed under "Possibly worth a look"; a
    pack-level exclusion list (as Claude's security review and Code Review do,
    research §2 pattern 3). [Dana: noise.]
19. **Scan scope**: `delivery review code --path src/auth` to review part of a
    repository. [Dana: cost and time.]
20. **Cost and duration** of the scan and of each fix, from the existing session
    records, in the report's tuning section. [Priya, Dana.]
21. **Recommended selection**: `delivery findings approve --recommended` approves
    the findings whose check is strongest and which are below the sign-off threshold.
    [Dana: shortest path.]
22. **Preview**: `delivery review <pack> --preview`, with no sign-in or network.

### COULD

23. **Third-party pack discovery and distribution** (the roadmap's "adopters and the
    community author new packs"): `delivery packs add <source>`, a listing of
    installed packs, trust prompts before running a third-party pack. Local-path packs
    already work in MUST, as data only (manifest and prompts); packs carrying code
    modules are COULD and need an explicit trust confirmation (arch §13).
24. **Ingest another tool's results as the scan** (SARIF 2.1.0, or detector output
    such as `npm audit --json` / OSV, which would give the security pack an advisory
    database) so a pack can fix what an existing scanner found; export of
    findings as SARIF (research §3.1: SARIF is a good edge format, a poor authoring
    format).
25. **Plain-language "what changed" summary** of a fix for the sign-off page written
    by the agent and labelled as the agent's.
26. **Pack scaffold: `delivery packs new <name>`** producing a working skeleton with a
    passing scripted test.
27. **Findings as a self-contained HTML report.**
28. **More shipped packs** (accessibility, performance, documentation coverage).

### Explicitly not in this phase (non-goals)

Scheduling and recurring runs (Item 13); repository, webhook or PR triggers (Item
14); a hosted pack registry or marketplace; a web console or dashboard; notifications;
packs that change the harness's control flow beyond the sign-off hold; per-task gates
and closers as a general project-configuration feature (a pack needs different
checks per finding, which is delivered inside the pack; the general feature is
the architect's call and not required here); changing what triage decides; a second
LLM judging whether a fix is good (the agent's word is never proof; a reviewer model
may only ever be advisory, and is not built here); automatic merging of
critical or high security fixes; fixing findings the owner has not approved.

## Buy-vs-build (lens summary; ledger is the architect's)

| Need | Considered | Chosen direction |
|---|---|---|
| Where a pack lives and how it is configured | New config format; a pack as ordinary project configuration | **Reuse project configuration** (Item 9 said "a pack is a project configuration authored once and distributed"). Research §0.1, §0.2 and §0.4 show shape work is nonetheless needed (per-finding checks, a task source). Product stance: reuse the configuration surface; add only what the findings force. |
| Finding format | SARIF as the authoring format; a small harness-owned schema | **Small plain-language schema** the owner can read, with SARIF as an edge format (COULD). SARIF's nesting and lack of "why it matters" make it poor for review by a non-engineer (research §3.1). |
| Severity scale | Invent one; SARIF levels; CVSS bands | **critical / high / medium / low**, matching CVSS bands, GitHub's mapping and the roadmap; each level defined by consequence, not number (research §3.2: LLM-assigned scores are opinion). |
| Dependency checks | Parse the lockfile ourselves; run OSV-Scanner or `npm audit` | Deterministic lockfile check for "vulnerable version gone" as the roadmap says; scanner re-run is SHOULD/COULD because it needs a binary and the network (research §3.3). |
| Review step UI | Hand-written prompts; the estate's `@inquirer/prompts` (used by `init`) | **Reuse `@inquirer/prompts`** (already a dependency); the same actions exist as plain commands so nothing needs a TTY. |
| Report | New findings report | **Existing report** (Item 11), more fields. |
| Per-finding check | Second LLM review; hand-rolled static analysis per language | Deterministic checks only; a language-agnostic, install-free set (research §3.4 last bullet). |

## Vocabulary for Dana (and the table that enforces it)

Owner-facing text uses only:

| Say | Never say (appears only in `--json`, technical blocks and "For engineers") |
|---|---|
| problem, what the review found | finding (the *command* is `delivery findings`; prose says "problems") |
| how serious it is: critical, high, medium, low | CVSS, CVE, exploit, vector |
| waiting for your sign-off | authority-class, escalated, held |
| could not be fixed | escalated, unresolvable |
| the check | gate, assertion, delta |
| your dependencies, the libraries your project uses | lockfile, transitive |
| the agent | worker, scan agent, triage |
| fixed and merged | closed, landed |

Enforced the way Item 11 enforces it: closed enums, total phrase tables, and one test
that scans every owner-facing phrase for the forbidden words. Whatever the agent writes
(titles, problem sentences) is quoted or labelled as the agent's; the harness's own
sentences are fixed strings. Technical blocks keep the harness's own words, because
for Marcus and Priya that is the point.

## Primary journeys

### J1. Dana runs a code review for the first time [Dana: ask for a review with no configuration]

Dana has the harness installed and a repository that has never had a configuration
file. She opens a terminal in the folder and types one command:

```
$ delivery review code
```

The harness tells her what it is about to do and that it will not change her code,
scans, and prints the problems. It then asks whether to fix them. She may say "not
now"; nothing is lost, because the list is saved and every later command works from
it. Success: a useful list in minutes, from a single command, with no file edited.

### J2. Dana reviews the findings and authorises some [Dana: choose what is fixed]

She reads the numbered list: each has a plain title, where it is, what is wrong, why it
matters, what fixed looks like, and how the harness will know. She skips the two she
disagrees with, approves the rest, and the harness fixes only those. She can come back
tomorrow: `delivery findings` shows the same list with her choices remembered.
Success: nothing is fixed without her say-so, and she understood each choice.

### J3. Dana comes back to a report [Dana: return to a whole run]

`delivery report` (the command Item 11 already tells her to type) opens with one
sentence: what was found, what was fixed and landed, what is waiting for her, what
could not be fixed. Fixed problems are listed by their plain title; the ones needing
her say what to do next.

### J4. A security finding needs Dana's sign-off [Dana: never approve what she cannot understand; Marcus: judge a held fix]

A high-severity problem was approved, fixed and passed its check, but is *held*. The
report says, in her words, what the risk was, what the agent changed, how the harness
knows the risk is closed, and that her say-so is required before it reaches the main
copy of her project. She can land it, reject it, or hand the technical block to an
engineer (Marcus), who sees file, line, the check and its result. Success: she is
never asked to sign off in terms she cannot read, and nothing high-severity reaches
her main copy unseen.

### J5. A problem cannot be fixed [Dana, Marcus: escalated with a clear explanation]

The fix agent could not do it (it needs a decision, a bigger change, or something
outside the repository, such as rotating a credential). The report lists it under
*could not be fixed*, says why in one sentence from a fixed phrase table plus the
agent's own words, says whether an engineer or she must act, and what. Marcus can read
the technical block and the agent's attempts from `delivery status`.

### J6. Priya authors her own pack [Priya: author and prove a pack]

Priya wants an accessibility review for her team. She copies the shipped `code` pack's
folder, changes the scan instructions, categories, example finding and check, and runs
`delivery packs check ./a11y-pack`. It names any manifest problem by file and field,
then dry-runs her pack against a scripted agent that "finds" two issues and "fixes"
one, showing the flow ends as designed. Then `delivery review ./a11y-pack` on a real
repository works exactly as for a shipped pack. Success: a pack proved without a real
agent run, with no harness source read.

## Key UX flows: what a person sees

Layout rules (inherited from Item 11): plain lines, no box drawing, no alignment
columns, no cursor movement in non-interactive output, fact-per-line so it reads at 60
columns, in a pipe and in a screen reader. Times 24-hour UTC. Numbers and words, never
colour alone. Output the same for the same record. Run and finding identifiers in the
examples are illustrative.

### F1. `delivery review code`

```
$ delivery review code
Reviewing your project for problems with the code (a code review).
This reads your project and writes nothing to it. It can take a few minutes.

Review finished in 4 min 12 s. It found 6 problems.
The agent that did the review is giving its opinion: check anything that matters.

 1. The price shown at checkout can be negative                      (high)
    Where: src/checkout/total.js, line 42
    What is wrong: A discount larger than the price makes the total negative, so
    the shop would pay the customer.
    Why it matters: Wrong totals cost money and trust.
    Fixed looks like: A total never goes below zero.
    How we will know: checked: the flagged code is gone.
 2. Old code for a payment provider you no longer use                (medium)
    Where: src/payments/legacy-gateway.js (whole file)
    What is wrong: Nothing calls this file any more.
    Why it matters: It is extra code to maintain and could confuse the next person.
    Fixed looks like: The file is removed and everything still works.
    How we will know: tests only: no check of this specific problem (31 tests pass today).
 ...

3 of 6 have a specific check; 3 are tests only.
Nothing has been changed and nothing will be until you approve it.

What next?
  Fix all 6:           delivery findings approve --all  then  delivery fix
  Choose:              delivery findings
  Look at them again:  delivery findings
```

On a terminal, it then offers an interactive list (a checkbox with the plain title and
severity, "a" to select all, enter to confirm) and "Fix now / Not now". In a pipe, or
with `--json`, it only prints and exits; no prompt is ever required. Exit code: ok when
the scan finished (whether or not it found anything); the existing configuration
failure code when the scan could not run.

### F2. `delivery findings` (review step)

```
$ delivery findings
Code review of text-helpers, 3 Oct 11:02 UTC. 6 problems. Nothing approved yet.

 1. The price shown at checkout can be negative            high      not yet decided
 2. Old code for a payment provider you no longer use      medium    not yet decided
 ...
Approve: delivery findings approve 1 3 4    or    delivery findings approve --all
Skip:    delivery findings skip 2 5
Details: delivery findings 1
```

`delivery findings <n>` shows the full plain block above, then **FOR ENGINEERS** (the
technical detail block: category, file range, the check kind and parameters, scan
confidence). States are the closed set in "Finding states". Approving a problem
that is *tests only* prints one line: "Approved. Note this one cannot be proved fixed
except by your existing tests." Approving one that will change tests prints "This fix
will change your tests." Skipped problems from earlier reviews are not shown by
default (`--include-skipped`); problems the scan could not confirm are listed with
`--unconfirmed`.

### F3. `delivery fix`

```
$ delivery fix
Fixing 4 approved problems, up to 2 at once. Skipped: 2. Waiting: 0.
Watch with: delivery status --watch
...
Fix phase finished: 3 fixed and merged; 1 is waiting for your sign-off.
Run `delivery report` for what to do.
```

Refuses, in one sentence and with the command to run, when nothing is approved or
when there is no review yet. A re-run only picks up approved problems not yet in a
terminal state (an interrupted fix phase continues; the existing resume behaviour).

### F4. Security: severity and the sign-off page

```
$ delivery review security
...
Review finished in 6 min. It found 5 problems: 1 critical, 1 high, 2 medium, 1 low.
Problems of high or critical seriousness are fixed and checked but wait for your
sign-off before they reach your main copy. You can change that: delivery findings --help
Problems about out-of-date libraries come from the reviewer's knowledge, not from an
advisory database; they may be out of date or wrong.

 1. A password for the payments service is written in the code        (critical)
    Where: config/settings.js, line 9
    What could happen: Anyone who can read this code can use the payments service
    as you, including people who should not see it, such as past contractors.
    Fixed looks like: The password is not in the code, and the code reads it from
    somewhere private instead.
    How we will know: checked: the flagged code is gone.
    Note: the password has already been seen by everyone with access to the project.
    Removing it from the code does not undo that; it needs changing at the provider.
    That part only a person can do.
```

Note the last paragraph: a finding may carry a plain "what only a person can do"
line (rotating a credential). That is a *could not be fully fixed by code* case; the
state is "fixed in the code; one thing is left for you" and it appears in the report
beside the sign-off (see error states).

`delivery report` after the fix, for a held fix:

```
WAITING FOR YOUR SIGN-OFF (1)
  Problem 1 of 5: "A password for the payments service is written in the code" (critical)
    The agent removed the password from the code and made the code read it from the
    environment. The check passed: the password text no longer appears anywhere in the
    project (secrets are checked across the whole project; other problems in the
    one file), and your existing tests still pass (31 of 31).
    The agent said: "Moved the key to PAYMENTS_KEY; documented it in the README."
    Why this needs you: it is a serious problem, and you should see what changed
    before it reaches your main copy.
    To act: Look at what changed: delivery findings 1 --changes
            Say yes:  delivery findings sign-off 1
            Say no:   delivery findings reject 1
    For engineers: branch surface/..., 2 files changed.
```

`delivery findings sign-off 1` prints "Checking the fix still works on your current
main copy... passed. Landed." or "Could not land: <reason>. Kept on <branch>." (the
finding is then *signed off but could not be merged*: a rebase conflict or a failed
re-check; nothing is ever merged un-checked). It lands through the project's closer; `reject 1` leaves the branch for an engineer and ends the finding as
*declined at sign-off*. `--changes` prints the changed files and a patch, and a plain
note beginning "The agent changed these files. This shows what changed; it cannot tell
you it is safe."

### F5. `delivery report` after a pack run [Dana: return to a report]

```
$ delivery report

Code review of text-helpers: 6 problems found; you approved 4 and skipped 2.
3 are fixed and merged; 1 could not be fixed.
Review 3 Oct 11:02 UTC. Fixes 11:09 to 11:38 UTC (29 min), up to 2 at once.

NEEDS YOU (1)
  Problem 5 of 6: "Settings load fails silently if the file is missing" (medium)
    Could not be fixed. The agent decided this needs a choice only you can make.
    The agent said: "The right behaviour depends on whether the app should start
    without a settings file; I did not want to guess."
    To act: 1. Decide what should happen when there is no settings file.
            2. Run: delivery review code   (to re-check), or reword it as a task.
    Full account: delivery status <run-id>

DONE (3)
  Problem 1 of 6: "The price shown at checkout can be negative": fixed, merged into main
  ...
SKIPPED BY YOU (2)
  Problem 2, 4

Next: delivery findings (all problems), delivery report --json (data)
```

The sections reuse Item 11's (`NEEDS YOU`, `STOPPED, FOR YOUR ENGINEERS`, `DONE`), adding
`WAITING FOR YOUR SIGN-OFF` and `SKIPPED BY YOU`, one section per owner-facing
state in "Finding states"; each item is tagged by who must act as that table says.
Findings that could not be fixed because of the setup (broken check) go to the
engineers' section, as for any task.

### F6. Machine-readable [Priya]

`delivery findings --json` is one `delivery.findings/1` document: scan identity, pack
name and version, every finding with every field, its state, its check kind and level,
and a pointer to its fix run. `delivery report --json` gains finding title, severity
and phase on each fix task (new optional fields on `delivery.report/1`, additive).
`delivery findings --schema` and `delivery packs --schema` print the JSON Schemas. Prose fields are not
part of the stability promise.

### F7. `delivery packs`

```
$ delivery packs
Reviews you can run on your project:
  code      Looks for mistakes, dead code, missing error handling and untidy patterns.
  security  Looks for weak spots an attacker could use: out-of-date libraries,
            secrets in the code, missing login checks and risky settings.
Run one with: delivery review <name>
Your own: delivery review ./path-to-a-pack
```

### F8. `delivery packs check ./a11y-pack` [Priya]

```
$ delivery packs check ./a11y-pack
a11y-pack/pack.json: "check.kind" is "page-contains" but this pack's checks are:
  dependency-absent, pattern-absent, anchor-gone. Did you mean "pattern-absent"?
```
and on success: "Pack a11y-pack is valid (delivery.pack/1). Scripted run: scan found
2 problems; fix of 1 passed its check, fix of 1 was rejected by its check (as
designed). Nothing was sent to a real agent." Exit codes follow `validate`.

## Pack format (what a pack *is*, in product terms)

A pack's folder contains: a manifest (`delivery.pack/1`) with name, plain description,
version, categories, scan instructions, the pack's extra finding fields, the fix
template (the words the fix agent is given for each finding), the closer, the sign-off
policy and the default threshold; the per-finding checks the pack supplies; and an
example finding in plain words used by `packs check`. What a pack **cannot** do, by
design, so that the format stays safe and stable: change harness control flow; widen
the agent's tool authority beyond its stated role (a pack's agents are the existing
roles with a pack's prompt fragment); see or edit its own check from the fix agent. The
manifest is validated in the owner's and Priya's terms (file, field, what to do).

## Accessibility of terminal output

- Severity is a word, always, in the same place; colour only adds tone and never carries
  the meaning. `--no-color` and non-TTY stripping as today.
- Findings are numbered and one-per-block, never tabular, so a screen reader reads
  title, location, problem in order. Numbers (not titles) are the selection handle;
  titles are not required to be unique.
- The interactive list is a convenience only: every action it performs is a plain
  command, and a user who cannot use a checkbox list loses nothing. Interactive mode
  is never entered without a TTY, and `--json` never prompts.
- Reading level: the harness's own sentences are fixed and short. The agent's plain
  sentences are written to the pack's reading-level instruction ("someone who is not an
  engineer"), and anything that is only meaningful to an engineer lives in the FOR
  ENGINEERS block.
- Long output is safe in a pipe: nothing depends on terminal width.

## Empty, loading and error states

| State | What the person sees |
|---|---|
| **No findings** | "The review found no problems. That is not proof there are none: the review is an agent's opinion, it looked at 84 files, and it can miss things." Exit ok. Offers `delivery review <pack> --path ...` to look closer. Nothing to approve, `delivery fix` says there is nothing to fix. |
| **Scan running** | One line at start, one progress line per minute in a TTY and not in a pipe, "Reviewing... (2 min)". `delivery status --watch` works as today. |
| **Scan fails** (agent error, no sign-in, no network, ran out of its allowance) | Plain sentence from a fixed table, the agent's own words quoted if any, one next step ("run `claude auth login`"; "try again"). Nothing partial is saved as a review. Exit configuration/aborted code as today. |
| **Scan output malformed** | The harness validates every finding. Valid ones are kept; unreadable ones are counted and named: "2 of 8 problems could not be read and were left out. Run `delivery review code` again to retry, or see them: `delivery findings --unreadable`." If none can be read: scan treated as failed, one automatic retry within a budget, then a plain explanation. Never silently shown as "no findings". |
| **Repo has no tests** | The review still runs and says so: "Your project has no tests, so nothing will check that a fix has not broken something else. Each fix is checked only by its own specific check, and every fix will wait for your sign-off before it is merged." The product requirement, stated once: in a project with no tests the owner **can** approve any problem; every fix is **always held** for sign-off whatever its severity (arch §7.4); and "checked" means only the problem's own check, shown as "finding check only, no regression tests". A problem that is also *tests only* is approvable with the extra line "Nothing will check this fix except you." The roadmap's built-in static analysis fallback is met by this honesty and sign-off, not by a bundled analyser (arch §7.4); a bundled analyser is COULD. |
| **Uncommitted changes** | The existing note that uncommitted files are invisible to agents (research §1.3), repeated at `review` and `fix`: "Your agents only see what is committed." |
| **Project changed since the review** | Fix tasks start from the current main copy, so there is no stale-fix state. A problem whose flagged code has since gone is shown as *already fixed* and not worked on. |
| **Fix cannot be proved** (gate keeps failing) | As Item 11: failed after N attempts, in plain words, the agent's last words, the next step. |
| **Fix rejected as weakening the check** | "The agent's fix was rejected because it removed or skipped existing tests." The agent is told, retries within the normal budget. |
| **Fix needs an outside action** (rotate a credential, change a setting in a service) | Not a separate state: the finding is *fixed and merged* or *waiting for your sign-off*, with the agent's plain "one thing is left for you" line beside it, and it also appears under NEEDS YOU. |
| **Fix would need a test changed** | *Could not be fixed*, counted separately: "needs a change to one of your tests, which this review does not let an agent do." SHOULD: `approve <n> --allow-test-edits` (recorded; the fix is then always held). |
| **Damaged or missing review record** | "No review found in this project. Run `delivery review code` first." A damaged one: say which file and offer a re-run; never guess. |
| **Pack malformed or unknown name** | Names the pack, file and field; lists the available packs. |

## Success metrics

Proposed; no baseline exists (assumed, not measured).

- **Time to first findings list** for a new owner: under 10 minutes from install on a
  repository of up to about 20 000 lines, with no file edited (journey J1).
- **Owner completes the journey unaided**: in a moderated trial or the UAT script,
  review, choose, fix and read the report with no engineering help (the persona bar).
- **Zero silently dropped findings**: every finding is in exactly one state of the
  closed set (see "Finding states") at every moment and ends in a terminal one.
  Verified by a property test over the scripted scenarios.
- **Zero accepted weakening**: no scripted scenario where a fix deletes or modifies
  existing tests (outside the shown tests-category exemption, where modification only
  is allowed), adds a skip marker, or changes the test configuration or test command,
  ends fixed or held. (The roadmap's central promise.)
- **Zero unseen high-severity merges**: no fix at or above the threshold reaches the
  main copy without a recorded sign-off.
- **Owner-facing text is clean**: the forbidden-word test passes for every phrase.
- **Gate catch rate** (fix attempts the targeted check rejected / attempts): reported
  per pack; a rate of 0 over many runs is a smell (checks too weak), a rate near 1 a
  smell (findings poorly specified). Tuning evidence for Priya and pack authors.
- **Pack authoring**: a new pack proved with `packs check` and its scripted dry run
  without reading harness source (the persona bar), measured by the pack authoring
  guide being sufficient in the UAT.
- **Approval rate and skip reasons** (what share of findings owners approve) as a
  signal of scan noise; no target.

## Operability and DX

- **Develop and verify locally with no model.** Every flow runs against the existing
  scripted-agent double: a scripted scan that returns findings, a scripted fix that
  passes, one that deletes a test (must be rejected), one that cannot fix, malformed
  scan output, no findings, no tests. Priya uses the same for her own pack. No test
  needs a real agent or the network.
- **A fixture repository with planted flaws** ships as the example (as
  `examples/project-configuration-example` does), so "try it" is one copy and one
  command, and the guide's output is real.
- **Docs the persona can follow without source**: `docs/task-packs.md` (Dana: first
  review to report) and `docs/writing-a-pack.md` (Priya), following
  `docs/writing-a-gate.md` and `docs/project-configuration.md`.
- **Deploy**: packs ship inside the existing package; no service, registry or
  daemon. A local-path pack needs nothing installed.
- **Preview before spending** (SHOULD, item 22): `delivery review <pack> --preview`
  shows what the agent will be told (same idea as the existing `preview`), with no
  sign-in and no network.

## Decisions settled with the architect

1. **Landing a held fix**: `delivery findings sign-off <n>` rebases the kept branch
   onto current main, re-runs the check there, then runs the project's landing closer;
   a conflict or failed re-check is `signed_off_failed` (arch §8);
   `reject <n>` keeps the branch (arch §8).
2. **Where findings live**: a per-review folder in `.delivery/packs/`, self-ignored;
   each fix task carries its finding; the owner commits nothing by hand (arch §3.4, §6).
3. **Scan and fix phases**: the scan is a read-only session, not a gated task; the fix
   phase is one ordinary generated configuration whose single gate and closer read the
   finding; no per-task gate or closer is needed (arch §2.3, §7, §8).
4. **Report fields**: one additive `tags` field (pack, finding id, severity, phase) on
   each report task; finding states come from `delivery findings` (arch §10).

## Risks the design names

- **Check strength.** For judgement findings a pattern check is not proof (arch §5.3:
  an agent can rename a variable past it). The product never calls a fix "proved"; it
  shows the check's level beside "fixed", labels the weakest as "tests only", and holds
  anything severe for a human.
- **Weakening the check** (idea `50-20260930T212043Z`): the pack's check lives where the
  fix agent cannot edit it, and changes to existing tests or the test command fail the task. For repairs
  *of the check*, Item 11's visibility applies; approval and refusal there remain with
  that idea.
- **Scan noise and false positives.** Mitigated by the owner review, confidence labels,
  the exclusion list, and "skipped stays skipped" (SHOULD).
- **A finding fixed wrongly but passing its check.** Mitigated only by sign-off on
  the serious ones and the owner's own review; the product says so rather than
  claiming otherwise.
- **Fix tasks that conflict when run at once.** Handled by the existing close
  retry; reported plainly when it fails.
