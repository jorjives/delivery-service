# Install a pack from elsewhere, pinned: product design

> Item 3 of `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` (lines 122-144). Author: product-designer. Facts cite `research.md` (this directory) as [R§n]. Anything uncited is a design choice. Mechanism, file layout and the task ledger belong to the architect.
> Persona status: `docs/personas.md` is team-derived and unratified. The Item 3 goal extensions added there are assumed, not human-confirmed: there is no human to ratify this run.

## 1. Vision

A pack is a folder of prompts that an agent follows with every power the project's agent already has (`src/agent-invoke.ts:246-247` [R§0]). Item 2 made a pack readable. Item 3 makes it **stay what was read**.

Today a pack that is not built in is a folder path in `delivery.config.json`. It has no source, no version and no memory of what the owner approved. Whatever is in the folder runs, and `loadPack` has no expected-hash check [R§6.7]. Sharing cannot work on that footing: a pack someone else wrote must arrive from somewhere, be read once, be accepted once, and then be the same pack on every machine and every run until the owner chooses otherwise.

The product is a short, boring loop that every package manager owner already trusts: **add** (read, accept, record), **run** (verify, then use), **update** (see the change, accept, record), **refuse** (a pack that differs from what was accepted does not run). Its value is not clever safety. It is that "I read this" and "this is what runs" stay true.

It is honest about limits. Pinning does not make a pack safe; it makes review stable [R§6.1]. The output never says "safe", "trusted" or "verified" about a pack; it says what was recorded and whether it still matches.

## 2. Personas and goals

Source of truth: `docs/personas.md`. Goal extensions for this item are added there, flagged assumed.

| Persona | Goal for this item | Success looks like |
|---|---|---|
| Dana Okafor, non-technical project owner | Use a pack someone else published, and know it is the same pack for everyone, every time | One command to add after reading; a colleague's fresh checkout runs the same pack; a newer version arrives only when she says, with the change in plain words; a changed pack stops with a reason she can act on. The package name comes from the publisher or the pack's documentation; typing it, and having npm installed, are unavoidable and are explained where used. She never needs the words hash or lock file |
| Priya Shah, harness extender | Have her published pack installed by a colleague exactly as she wrote it, and be refused in her terms when the package is not a pack | A colleague adds it with one command; refusals name the file and what to do; the same account an owner sees is what she sees when she tests an add |
| Marcus Webb, on-call engineer | Know which exact pack text an agent was given when a held change reaches him | `delivery packs` and `delivery packs inspect <name>` give the recorded version and fingerprint; the record is in git history, so "which version was active on Tuesday" is answerable |

## 3. Journeys

Each journey names the persona and goal it serves.

**J1. Add a pack [Dana: use someone else's pack; Priya: be installed].** Dana hears of `@acme/delivery-pack-docs`. She runs `delivery packs add @acme/delivery-pack-docs`. Nothing is written. She sees where it came from, the exact version found, its age, and the whole Item 2 account (in short, what it may touch, how far each workflow goes, things to look at, fingerprint, verbatim instructions). At the end it asks one question. On yes, the version and fingerprint are recorded, a copy is kept in the project, and the output says to commit both. On no, nothing changed.

**J2. Run later, on another machine [Dana: same pack for everyone].** A colleague clones the repository on a new laptop, or CI checks it out. They run the project as normal. Before any agent call, the recorded pack is checked against its fingerprint; it matches; the run proceeds. No network call is made. `delivery packs` shows "As approved."

**J3. Update with a change review [Dana: accept a newer version knowingly; Marcus: know what changed].** Months later, `delivery packs update docs-drift` looks for a newer version. If there is one, nothing is applied yet. She sees, first, what changed in terms an owner cares about (did it start landing without sign-off, did it lose a guard, were workflows added or removed), then which instruction files changed, then the changed lines. She accepts or declines. Only acceptance moves the record.

**J4. A pack that changed since approval [Dana: be stopped; Marcus: trust the record].** Someone edits the kept copy by hand, deletes a file from it, or a merge goes wrong. The next run refuses before any agent call: it names the pack, its state and the file, and gives the ways forward. To go back to what was approved, `delivery packs restore` fetches the recorded version again and checks it against the record. To accept a different pack, `delivery packs update` shows the change and asks. Local edits are never approved in place: the pack the owner accepts is always one that came from the package, with the change shown first. That is how "approved the change" is met.

**J5. Two packs, one name [Dana: understand a refusal; Priya: fix it].** Adding a pack whose workflows share a name with one already in the project is reported plainly, in the existing sentence for local packs, with both sources named and an action the owner can take. Nothing is added.

**J6. A package that is not a pack, or carries too much [Priya, Dana].** The add is refused with the file and the reason, in the same words and form as Item 2's refusals. Nothing is written.

**J7. Take a pack out [Dana].** `delivery packs remove docs-drift` removes the record and the kept copy, after saying which workflows will stop existing.

## 4. Capabilities, tiered

### Derived minimum scope (assumed, not human-confirmed)

The floor below is derived from the five roadmap Item 3 success criteria and the roadmap constraint, not confirmed by a human. It is a floor, not a ceiling: the SHOULD tier is what lets each persona finish their journey end to end, and the MUST tier below already includes the pieces without which Dana could not finish (reading before accepting, a way forward when refused).

1. Add from a public package source (an npm package).
2. Record the exact version and a content fingerprint.
3. Runs use only the recorded version, never a newer one, until a deliberate update.
4. A deliberate update shows what changed before it applies.
5. A pack that changed since it was approved is refused until the owner approves it.
6. Duplicate workflow names are reported plainly, as for local packs.

### Constraint provenance

| Constraint | Governing document and location |
|---|---|
| Discovery uses an existing package ecosystem; no registry is hosted | Roadmap `2026-10-22-pluggable-architecture-roadmap.md` line 141 (Item 3 Constraints); Context lines 31-38 "keeps the hosted-registry non-goal"; task-packs spec `2026-10-03-task-packs-design.md` lines 893 and 935-936 [R§0] |
| Packs stay data only in this phase | Roadmap Item 1 Constraints; Item 9 (code in packs) is later; enforced today by `DATA_ONLY` at `src/packs/manifest.ts:110-111` [R§1.2] |
| Start from COULD 23 (`delivery-pack` field, `delivery packs add`, trust prompts) | Roadmap Item 3 Notes, lines 143-144; task-packs spec lines 151-153 |
| Inspection and fingerprint are the approval basis | Roadmap Item 3 Dependencies; inspect spec `2026-10-23-inspect-a-pack-design.md` lines 127, 192, 200 [R§0] |
| No signed or paid distribution as a feature we build | Roadmap "Not in this roadmap", lines 58-61 |
| Scope is Item 3 only | Orchestrator brief; Items 4, 5, 7 to 9 own settings, publishing and code |

Not a constraint, an assumption: that "no network at run time" is required. Criterion 2 says "get the same pack on every machine and every run"; this design reads that as meaning a run needs nothing from the network. The alternative reading (restore from the package source on demand, with an integrity check) is D1 below.

### MUST

| # | Capability | Persona and goal | Source |
|---|---|---|---|
| M1 | `delivery packs add <package>` reads a pack from an npm package named by the owner. Before anything is written it prints the exact version found and the full Item 2 account unchanged (same sections, same wording, same fingerprint line). The `Source:` line reads "npm, @acme/delivery-pack-docs 1.2.0". The package name, the pack's own name and any files in the package that are not part of the pack are all shown, so a name mismatch is visible. | Dana J1 | Roadmap criterion 1; Item 2 reuse (Dependencies) |
| M2 | Adding needs an explicit yes after the account. Where nothing can ask (no terminal, CI), the command prints the account and refuses with exit 2, saying how to accept: `--approve <fingerprint>`, which only succeeds if the fingerprint given is the one the package has. There is no blanket `--yes`: the accept is bound to what was read. | Dana J1; Priya (CI) | Reuses the `packs check` trust-confirm pattern [R§1.4] and `--yes` lesson (`packs-check-command.ts:11`), tightened |
| M3 | The record holds, for each installed pack: the package name, what the owner asked for (a version, range or tag; "latest" by default), the exact version found (the only one runs use, always shown), the package's integrity value, the pack fingerprint and the fingerprint the owner approved. The fingerprint names its own rule version. It lives in one file in the project, plain JSON, committed. No person or time is recorded: version control holds those. | Dana J2 | Roadmap criterion 2; the common lockfile shape [R§4.4]; version alone cannot pin [R§1.3] |
| M4 | A copy of the accepted pack is kept in the project at `.delivery/packs/<name>/`, with the record at `.delivery/packs.lock.json`. Both must be committed and visible in a pull request. Today `.delivery/` ignores everything but the backlog (`src/run-location.ts:62-68`), so the ignore rule must be widened to keep these two paths; that is a product requirement of this item, and the requirement is the outcome (committed, not ignored) rather than the path. Runs read the copy and make no network call. A fresh checkout runs with nothing downloaded. | Dana J2 | Roadmap Delivers "same pack on every machine"; R§6.10; assumption flagged above (D1) |
| M5 | Every use of an installed pack (a run, `review`, `preview`, `validate`, and `inspect` by name) first checks the copy against the record. The pack must be in one of five states: as approved, missing, invalid (the folder fails Item 2's closed-set check), changed (its fingerprint is not the record's) or unapproved (the record says the owner has not approved what it holds). Anything but "as approved" is refused before any agent call or file change, exit 2, naming the pack, the state and the one command that fixes it (5.5). | Dana J4 | Roadmap criterion 4; silent drift today [R§6.7] |
| M6 | `delivery packs update <name> [request]` is the only way a recorded version moves. It never happens during a run, never on a timer, never as a side effect of another command. It looks up what the recorded request now resolves to (or the version, range or tag the owner names, including an older one), shows the change report (M7) and asks. Declining or being unable to ask changes nothing. Nothing newer is a plain statement, not an error. | Dana J3 | Roadmap criterion 2 "until the owner deliberately updates it" |
| M7 | The change report for an update has four parts in this order: (1) one-line headline of versions and fingerprints; (2) what changed in owner terms, using Item 2's own comparison dimensions with the direction of each change (anything that widens what the agent may do, sign-off added or removed, guards added or removed, workflows added or removed, checks and landing); (3) which instruction files changed, were added or removed, with line counts; (4) the changed lines, each marked with a leading `-` or `+` and a legend that says so. The new version's Item 2 flags that the old one lacked are listed inline in part (2). Colour never carries meaning. | Dana J3; Marcus | Roadmap criterion 3; inspect spec C2 "belongs to Item 3" (line 69); Terraform/Go lock-diff precedent [R§4.4] |
| M8 | `delivery packs restore <name>` is the way back from a missing, invalid or changed pack: it fetches the recorded version again, requires the package integrity and the fingerprint to equal the record, and replaces the folder. It needs no question, because it re-creates exactly what was approved. If the registry now serves different bytes for the recorded version, it refuses and says so plainly. | Dana J4 | Roadmap criterion 4; Cargo/npm restore-from-lock precedent [R§4.4] |
| M9 | A pack that changed since approval is refused until the owner approves the change, and the owner approves a change only through `update` (the report is the thing approved). `delivery packs approve <name>` exists only for the unapproved state (the record, not the folder, disagrees: for example after a bad merge of the record) and shows the full Item 2 account before it asks. A pack that fails the closed-set check cannot be approved. | Dana J4 | Roadmap criterion 4; architect D9 |
| M10 | A workflow-name clash between the pack being added (or updated) and anything already in the project is refused before anything is written, in the existing sentence from `packWorkflowClash` [R§1.5], extended to name both sources and one action the owner can take without editing the pinned pack: remove the other one. The same applies to a pack name equal to a built-in's. | Dana J5 | Roadmap criterion 5; `pack-workflows.ts:6-12` |
| M11 | The package is never run. Install scripts are not executed, its own dependencies are not installed, and the output says so on every add. A package is only read as files. | Dana, Priya J1, J6 | R§4.1, R§6.2; Claude Code `npm` source precedent [R§7] |
| M12 | Packs stay data only: Item 2's closed-set check and manifest refusals apply to what is kept, with the same sentences and the same "Not read" form. The package's own `package.json` is read only to find the pack folder (`delivery-pack` field) and is not kept. Files in the package outside the pack folder are not kept and are listed as "in the package, not part of the pack". Anything inside the pack folder that the format does not name refuses the whole add. | Priya J6 | Roadmap Item 1 constraint; R§6.2 gap |
| M13 | A package is identified as a pack by a `delivery-pack` field in its `package.json` naming the pack folder inside the package. A package without it is refused: "this package does not say it holds a pack". | Priya J6 | Task-packs COULD 23 |
| M14 | `delivery packs` lists each pack with its source, pinned version and state ("As approved", "Changed since approved. Will not run.") and tells the owner the next command for each non-ordinary state. Installed packs appear next to built-in and folder packs. | Dana J2, J4 | Extends `packs-command.ts:38-50` [R§1.4] |
| M15 | `delivery packs remove <name>` is the remedy M10 relies on for a clash, and the only way out of a mistaken add, so it is in the floor. It removes the record and the kept copy after naming the workflows that will stop existing, and refuses (exit 2, nothing changed) if the project's configuration still names a workflow from it. | Dana J7 | Needed to finish the lifecycle |
| M16 | Every output is plain lines, a fact per line, readable at 60 columns, in a pipe and by a screen reader; flags and states are words; no colour carries meaning; British English; none of the words the owner-vocabulary test forbids, and none of "safe", "trusted", "verified", "clean" about a pack. Package, hash and lock are explained once, in a sentence, where used. | Dana | Inherits inspect M11 |
| M17 | Documented where owners look: the packs page gains "Add a pack from elsewhere", a worked add, update and refusal, and says plainly that pinning keeps review stable and does not make a pack safe. | Dana | Roadmap Delivers; mirrors inspect M12 |

### SHOULD

| # | Capability | Why |
|---|---|---|
| S1 | `--json` on `add`, `update`, `approve`, `packs` and the change report, versioned, same facts as the human output, same exit codes. | Priya tooling; `ctx.json` convention [R§1.4]; Item 8 reuse |
| S2 | Files in the package outside the pack folder are listed on add (already in M12); a note in `packs` for kept files the fingerprint does not cover, never a refusal [R§6.8]. | Honest about what the fingerprint covers |
| S3 | A pack in a format this build cannot read is refused with Item 2's existing "upgrade delivery-service" sentence, and the record is left untouched [R§1.2]. | Pinned packs after a harness downgrade |
| S4 | Package keyword `delivery-pack` named in the docs as the convention publishers use, so owners can find packs with `npm search` without us hosting anything. | Discovery without a registry |
| S5 | Wording for a failed network, missing npm, unknown package, unknown version, with a next step for each (section 5.6). | Operability |

### COULD

| # | Capability | Note |
|---|---|---|
| C1 | Source from a git address pinned to a full commit. | Adds clone hardening [R§4.2]; npm covers the constraint on its own |
| C2 | Source from an archive URL with a stated checksum. | Trust on first use only [R§4.3] |
| C3 | `delivery packs search`, wrapping npm search on the keyword. | S4 gives the same by hand |
| C4 | Show registry provenance or signature status when the package has it. | Weak assurance and the roadmap excludes signed distribution [R§4.5] |
| C5 | Show how long ago a version was published, and what the newest version is, on add and update; a caution under a threshold set in configuration. | Needs a metadata call the fetch does not make today (`npm view`); a threshold is a policy choice [R§6.5] |
| C6 | Not committing the copy and relying on `restore` alone (D1 alternative). | Only if committing copies is rejected |
| C7 | `--as <name>` on add: keep a pack under another local name when its name clashes. | Dana cannot rename a pinned third-party pack [R§1.5]; not built in this item (architect section 17); remove is the remedy |
| C8 | `delivery packs update` with no name checking every installed pack and listing newer versions, changing nothing. | Not built (architect section 17: no `outdated`) |
| C9 | A project-wide allowlist of publishers or scopes. | Policy; no persona asks yet |

### Non-goals (with the owning item)

- A hosted registry, marketplace or search service: roadmap lines 58-61.
- Our own signing, or a paid tier: roadmap lines 58-61.
- Pack settings and their values: Item 4. The record leaves room for them; it stores none.
- Writing, scaffolding, checking and publishing a pack: Item 5. Item 5 documents the package shape M13 defines.
- Packs that carry code, and installing or enabling code plugins: Items 7 to 9. The record format names a "kind" so Item 8 can reuse "version recorded, updating shows what changed" [R§0], but nothing else here supports code.
- Automatic updates, update nags during runs, or any network call during a run.
- Judging a pack, scanning its text, or claiming it is safe (the position in inspect `product-design.md` section 4 stands).
- Recording who approved and when as separate data. The record is committed, so authorship and time come from version control; no identity system is added. No governing document asks for one [R§8.9].
- Several-person approval or review workflows.
- Installing from a private registry as a supported, tested path. It may work through the owner's own npm settings; it is not promised.

## 5. CLI UX

All examples are drafts of wording and are 60 columns wide or less. A run with a terminal asks; one without refuses and says how. Sample fingerprints are shortened here; the real output prints the whole value on two lines, as Item 2 does.

### 5.1 Add: the account, then one question

```text
$ delivery packs add @acme/delivery-pack-docs
Found @acme/delivery-pack-docs on npm.
  Version: 1.2.0
Nothing is added until you say yes. Nothing from the
package is run: its install scripts and its own
dependencies are never used.

Pack: Keep docs in step with code (docs-drift, version 1.2.0)
Fingerprint: 3f9a...c21 (changes if any instruction changes)
Source: npm, @acme/delivery-pack-docs 1.2.0

In short
  ...(the rest of the Item 2 account, unchanged)...

Add docs-drift 1.2.0 to this project? [y/N]
```

Answer yes:

```text
Added docs-drift 1.2.0.
  Recorded: .delivery/packs.lock.json
  Kept as:  .delivery/packs/docs-drift
Commit both, so everyone gets this same pack.
See its workflows:  delivery packs
Read it again:      delivery packs inspect docs-drift
Later runs use 1.2.0 until you run:
  delivery packs update docs-drift
```

Answer no (or empty):

```text
Nothing was added.
```

Typed a range, tag or no version: the line reads "Version: 1.2.3 (found for ^1.2.0)", so the owner sees what was found and that only the exact version is recorded.

Where nothing can ask:

```text
Not added: nothing here can ask you.
  Read the account above, then add it with the fingerprint
  you read:
    delivery packs add @acme/delivery-pack-docs@1.2.0 \
      --approve 3f9a...c21
  The command is refused if the package has a different
  fingerprint.
```

Already added at the same fingerprint:

```text
docs-drift is already added at 1.2.0. Nothing to do.
```

### 5.2 Run later on another machine

```text
$ delivery packs
Packs
  code          built in
  deprecations  built in
  docs-drift    1.2.0, from @acme/delivery-pack-docs
                As approved.
  our-checks    folder ./packs/our-checks
```

A run prints nothing extra when the pack matches. It never says "verified". If a pack does not match, see 5.5.

### 5.3 Update: see the change first

```text
$ delivery packs update docs-drift
Checking @acme/delivery-pack-docs on npm.
Found 1.3.0 for "latest" (you have 1.2.0).
Nothing is changed until you say yes.

docs-drift: 1.2.0 to 1.3.0
Fingerprint: 3f9a...c21 to 77b0...e5d

What changed, in short
  Sign-off: "fix" no longer waits for your sign-off.
  Guards: "fix" is no longer refused if it edits an
          existing test.
  Workflows added: audit
  Workflows removed: none
  Checks and landing: no change.
  Widens what the agent may do: no.
  Read the changed lines below. This summary does not
  cover what the instructions say.

Instruction files
  check.md   changed: 4 lines added, 2 removed
  fix.md     changed: 1 line added, 1 removed
  audit.md   new: 18 lines
  scan.md    unchanged

Changed lines
  A line starting "-" was removed. A line starting "+" was
  added. Two spaces start an unchanged line.

  check.md
  - Look for docs older than the code they describe.
  + Look for docs older than the code they describe, and
  + for any link in them that no longer resolves.
  ...

Move docs-drift from 1.2.0 to 1.3.0? [y/N]
```

Answer yes:

```text
Updated docs-drift to 1.3.0.
  Recorded: .delivery/packs.lock.json
  Kept as:  .delivery/packs/docs-drift
Commit both. Runs use 1.3.0 from now on.
```

Nothing newer:

```text
docs-drift is up to date at 1.2.0.
  "latest" on npm is still the pack you have.
```

New version cannot be read, or clashes: refused with the Item 2 sentence or the 5.4 clash sentence, record unchanged.

"Widens what the agent may do: no." is the same statement Item 2 prints, computed for the new version, and carries Item 2's own caveat. When the answer is yes, the line reads "Widens what the agent may do: yes", followed by the new flags the old version did not have, each with its Item 2 sentence, in the same part of the report.

### 5.4 A name clash

```text
Not added: two things define the workflow "check".
  1. the pack docs-drift, already in this project
     (from @old/docs-pack 0.4.0)
  2. the pack docs-sweep, in @acme/delivery-pack-docs 1.2.0
Each workflow name must be used once.
  To keep the new pack, remove the first:
    delivery packs remove docs-drift
  Or ask the authors to rename a workflow.
Nothing was changed.
```

A pack name used twice, or equal to a built-in's:

```text
Not added: the pack name docs-drift is already used.
  It is the pack docs-drift from @old/docs-pack 0.4.0.
Each pack name must be used once.
  To keep the new pack, remove the first:
    delivery packs remove docs-drift
Nothing was changed.
```

```text
Not added: the pack name code is already used.
  It is a pack built in to delivery-service.
Each pack name must be used once. A built-in pack cannot
be removed, so ask the authors of the new pack to rename it.
Nothing was changed.
```

A clash with a folder pack names its path; a clash with a workflow of the owner's own keeps the existing "rename your own workflow" sentence. For an update that would add a clashing workflow, the same text appears under "Not updated". Exit 2. Adding a pack under another local name is a COULD (C7).

### 5.5 A pack that is not as approved

One sentence per state, then the one command that fixes it. Each refusal is exit 2 and says nothing was sent to an agent.

Changed:

```text
Not run: the pack docs-drift is not as you approved it.
  Approved: 1.2.0, fingerprint 3f9a...c21
  Now:      fingerprint 77b0...e5d
  Nothing was sent to an agent.
To go back to the approved pack:
  delivery packs restore docs-drift
To accept a different version, with the change shown first:
  delivery packs update docs-drift
To take it out:
  delivery packs remove docs-drift
```

Missing (a folder deleted, or a clone that dropped it):

```text
Not run: the pack docs-drift is in this project's record
but its files are missing.
  Nothing was sent to an agent.
To fetch it again at 1.2.0, checked against the record:
  delivery packs restore docs-drift
```

Invalid (a stray file, a link, a pack.json the format cannot read):

```text
Not run: the pack docs-drift has something the format does
not allow.
  .delivery/packs/docs-drift/install.sh is not part of the
  pack format. A pack holds only data.
  Nothing was sent to an agent.
To put back the approved pack:  delivery packs restore docs-drift
```

Unapproved (the record says the owner has not approved what is in the folder):

```text
Not run: the pack docs-drift is in the record but has not
been approved.
  Nothing was sent to an agent.
To read it and decide:  delivery packs approve docs-drift
```

`approve` shows the full account from Item 2, then asks "Approve docs-drift at this fingerprint? [y/N]". It cannot approve a pack in the other states, and says so:

```text
Cannot approve docs-drift: its files are not the ones in
the record. Approving local edits is not possible.
  To go back:      delivery packs restore docs-drift
  To take a new one: delivery packs update docs-drift
```

`restore`:

```text
$ delivery packs restore docs-drift
Fetching @acme/delivery-pack-docs 1.2.0 again.
It matches the record. Replaced .delivery/packs/docs-drift.
```

```text
Not restored: npm now serves different contents for
@acme/delivery-pack-docs 1.2.0.
  Recorded: sha512-... Now: sha512-...
  A published version should never change. The folder is
  unchanged. Do not use this pack until you know why.
  To take it out:  delivery packs remove docs-drift
```

A run of several workflows refuses before the first. `review` and `preview` say "Not used" in place of "Not run".

### 5.6 Error and empty states

| Situation | Wording (first lines) | Exit |
|---|---|---|
| Package not on npm | "Not added: npm has no package called x. Check the name; scoped packages start with @." | 2 |
| Version not published | "Not added: x has no version 9.9.9. Published versions: 1.0.0, 1.1.0, 1.2.0." (first ten, newest first) | 2 |
| Package has no `delivery-pack` field | "Not added: x does not say it holds a pack. If you wrote it, add a delivery-pack field to its package.json naming the pack folder." | 2 |
| `delivery-pack` points to a missing folder or one without `pack.json` | "Not added: x says its pack is in ./pack, but there is no pack.json there." | 2 |
| The pack folder holds a file the format does not name | Item 2's "Not read: x" form, naming the file; "A pack holds only data." Files in the package outside the pack folder are not an error; they are listed as not part of the pack | 2 |
| Package is a link, not UTF-8, unnamed prompt | Item 2's existing refusals, unchanged | 2 |
| Pack in a newer format | Item 2's "upgrade delivery-service" sentence; nothing recorded | 2 |
| npm cannot be found | "Not added: this needs npm to fetch the package, and npm was not found. Runs of packs already added do not need npm." | 2 |
| Network or registry failure | "Not added: npm could not be reached. Nothing was changed. Runs of packs already added are not affected." | 2 |
| Git or URL address given | "Not added: only npm packages can be added now. x looks like a git address." | 2 |
| A kept copy with no record entry | "Not run: docs-drift has files in .delivery/packs but no entry in .delivery/packs.lock.json. Add it again: delivery packs add <package>, or remove the folder." | 2 |
| A record entry with no kept copy | The "missing" screen in 5.5 | 2 |
| Record file unreadable or from a newer build | The record's own named-field sentences, in the form of Item 2's manifest refusals; never a partial read | 2 |
| `update`, `restore`, `remove` or `approve` for a pack not installed | "docs-drift is not an installed pack. Installed: ... (or none)." | 2 |
| No installed packs, `delivery packs` | The existing list, plus one footer line: "Add a pack from npm: delivery packs add <package>" | 0 |
| Interrupted add or update | The record and the copy are written so that a crash leaves the old state, or a pack the next run reports as changed or missing (5.5), which `restore` fixes. Leftover working files are ignored and removed next time. | 1 |

## 6. Plain language

- Vocabulary follows `docs/glossary.md`. "Pack" and "workflow" are as in Item 2. "Package" means the npm package the pack arrives in, explained at first use: "a package is how it is shared on npm". "Fingerprint" is Item 2's word; "hash" and "lock" do not appear in output. The file is named (`.delivery/packs.lock.json`) but described as "the record".
- Every refusal begins with the thing at fault.
- No sentence says a pack is safe or verified. "As approved" means only "matches what you accepted".
- British English, no em-dashes.

## 7. Success metrics

No telemetry. Success is checkable in the repository, each a test or a scripted check, using local package fixtures (a tarball made by `npm pack`, served without the network) and the scripted agent:

1. Add: a fixture package is added; nothing is written before the yes; after the yes, the record holds name, exact version, integrity, fingerprint and rule version; the kept copy equals the package's pack folder; both paths are shown by `git status` and not ignored (`git check-ignore`).
2. Pin: with the package source then made to offer a newer version, a run still uses the recorded version, and a network-denied run succeeds (M4).
3. Another machine: a fresh clone of a fixture project, with no package cache and no network, runs the pack.
4. Tamper: edit one byte of a prompt in the kept copy (or delete a prompt, or add a stray file); the run is refused before any agent call, the refusal names the file, the exit code is 2. The same for a changed `pack.json`; each gives the right state sentence from 5.5.
5. Way back: after (4), `restore` repairs the copy and the next run proceeds; `approve` on a changed pack refuses and names `restore` and `update`; `update` to a new fixture version shows the change and, on yes, the next run uses it. Editing only the record's approved value gives the unapproved state, and `approve` then accepts it after showing the account.
6. Update: the change report for a fixture update contains the sign-off, guard, workflow and widening lines expected for known diffs, and does not apply anything until yes. A harmless-looking update that removes a hold is reported on the "What changed" lines without reading the prose.
7. Clash: a second fixture pack sharing a workflow name is refused with both sources named and nothing written, for pack-vs-folder, pack-vs-installed, and pack-vs-built-in.
8. Never run: a fixture package with a `postinstall` script that writes a marker file; after add, the marker does not exist and no dependency was installed.
9. Data only: Item 2's refusal fixtures (stray file, link, bad UTF-8, unnamed prompt, unknown key) refuse the same way when delivered inside the pack folder of a package; a file elsewhere in the package is listed as not part of the pack and not kept.
10. Non-interactive: without a terminal, add refuses with the account and the `--approve` instruction; with a wrong fingerprint it refuses; with the right one it adds.
11. Output tests: every example in section 5 is a snapshot test at 60 columns; the vocabulary test passes and fails if "safe", "verified" or "trusted" is added.
12. Compatibility: a project with only `packs: ["./folder"]` and no record behaves exactly as before, and every Item 1 and Item 2 fixture still passes.
13. Fingerprint stability: a recorded fingerprint for a fixture pack still verifies after the format reader changes in a way the rule-version field covers (R§6.9).

## 8. Open decisions

- **D1. Kept copy or restore.** Recommended: keep a copy in the project and commit it (M4). Pros: a run needs nothing from the network, the copy is reviewable in a pull request, and it needs almost no loader change [R§6.10]. Cons: the repository grows by a few text files. Alternative: commit only the record and rely on `restore` (C6): smaller, but a run on a new machine fails until someone has network and the package. Assumed because criterion 2 says "every machine and every run".
- **D2. Where the record and copy live.** Agreed with the architect: `.delivery/packs.lock.json` and `.delivery/packs/<name>/`, with the ignore rule widened so both are committed (M4). The requirement is "committed, not ignored, visible in a pull request"; the path is the architect's.
- **D3. Approving local edits.** Not offered (M9). The owner accepts a changed pack only by `update`, whose report is the thing approved, or goes back with `restore`. Cost: an owner who edited a pack on purpose must publish or keep that edit as a pack of their own folder. That is also the honest reading of "pinned": a local edit is a different pack.
- **D4. `package.json`.** Read only to find the pack folder; not kept (M12).
- **D5. Names.** The pack's own `name` is its identity in the project. A local alias is not built (C7), so remove is the clash remedy.
- **D6. Which tool fetches.** Recorded under buy-versus-build below; a product requirement only that it is npm's own ecosystem, runs no scripts, and verifies the package's integrity.
- **D7. Does `add` also edit `delivery.config.json`?** Product requirement: after add, `delivery packs` and the workflows appear without a second manual step. How is the architect's.

## 9. Buy versus build, and operability

- **Commodity or ours?** Finding a package, fetching it, checking its integrity and unpacking it are commodity and belong to npm [R§5]. What a pack will do (inspection, closed set, fingerprint) is already ours and is the differentiator. The record and the update report are custom to our pack format and have no off-the-shelf equivalent [R§5]. Do not hand-roll registry access or archive extraction: safe extraction (traversal, links, size) is the part libraries exist for [R§5.3].
- **Alternatives named.** (a) Shell out to `npm pack --ignore-scripts` and `npm view`: no new dependency; needs npm on the path and inherits the owner's npm settings [R§5.1]. (b) `pacote` as a library: npm's own fetcher with an integrity option; 17 direct dependencies and a narrower Node range than this repository's [R§5.2]. (c) Hand-rolled fetch and extract: rejected. (d) Git only: pin by commit; mutable tags make exact commits the only safe form [R§4.2]; deferred to C1. (e) Archive URL with a checksum: deferred (C2). Recommendation to the architect: (a) first, because it adds nothing to the harness's seven runtime dependencies, with `pacote` as the fallback if shelling out proves unreliable.
- **Prior art in this estate beats a template.** Reuse: the Item 2 account, the closed-set `readPackFolder` and `Pack.hash` as the approval basis; `withWorkflowsOf` and `packWorkflowClash` for clashes; the `packs check` confirm pattern and `@inquirer/prompts`; zod and the published-schema pattern for the record [R§1, R§3]. The record shape should not be pack-specific, so Item 8 can reuse it.
- **Prior art outside.** Terraform's lock file and `init -upgrade` ("review those changes and commit them"), Go's `go.sum` and `-mod=readonly`, Cargo's `cargo update`, npm's `package-lock.json`, GitHub Actions' "pin the commit, read the source", and Claude Code plugin marketplaces' `npm` source ("unpacked without running install scripts") [R§4.4, R§7]. Common shape: a committed record of exact identity plus content hash, a deliberate update command, verification on every use, and the diff of the record as the review artefact. This design follows that shape and does not invent a parallel one.
- **Developing, running, observing.** Everything is testable offline with a package fixture (a tarball) and the scripted agent. Add and update print the account and the report before anything is written, so a dry look costs nothing. `--json` (S1) lets CI assert the same facts. `delivery validate` (M5) lets CI catch drift before a run. The record and the copy are in git, so "what changed and when" is a `git log`. The one new hazard is fetching: input from a stranger is parsed only by the existing closed-set check after unpacking, and nothing from the package is executed.

## 10. Risks

- **Rubber-stamping.** An owner accepts the question without reading. Mitigation: the account is the question's context; non-interactive accept needs the fingerprint typed; the docs say pinning is not safety (M17). Residual.
- **Reviewing a diff is not reviewing the pack.** An update summary says "no widening" and the owner stops reading. Mitigation: the summary line always ends with "This summary does not cover what the instructions say", and the changed lines are in the same output.
- **Fingerprint covers what runs, not the folder.** Changes to fixtures and documentation do not refuse a run [R§1.3]. S2 reports them; the package integrity also covers them at update.
- **Fingerprint rule drift.** A future change to hash order or the `/2` upgrade would invalidate recorded values. The record names the rule version (M3), and metric 13 tests it.
- **First-add and update are the attack points,** not the pinned state [R§6.5]: a new malicious version cannot alter an old one. The age line (M1) and the full account at each moment of acceptance are the controls.
- **Name impersonation and typosquatting** [R§6.4]. The account shows the exact package name and manifest name side by side, so a mismatch is visible. No allowlist (C7).
- **npm unavailable.** Add and update need npm; runs do not. Stated in the error and the docs.
- **Committed copies grow the repository.** Small text only; closed-set check forbids anything else. Accepted (D1).
