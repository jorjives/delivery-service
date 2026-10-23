# Packs for any workflow: product design

> Item 1 of `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`.
> Author: product-designer. Facts cite `research.md` (this directory) as [R§n]; format and mechanism cite `architecture.md` as [A§n]. Anything uncited is a design choice, not a fact.
> Persona status: `docs/personas.md` is team-derived and unratified; the goal extensions added for this item are assumed, not human-confirmed: there is no human to ratify this run.
> This document and `architecture.md` name the same built-in pack, command story and format features; where they differ in detail, `architecture.md` owns mechanism and this document owns what the person sees and reads.

## 1. Vision

Today a pack means "a review": an agent scans, the owner approves, an agent fixes. The engine underneath is more general: a workflow carries its own prompt, guards and hold, and an idea can name any workflow to be acted on [R§3, R§6, R§7.4]. Only the pack format, `delivery review`, `delivery packs check` and the documents say "scan then fix" [R§10].

After this item an owner reads one page and knows: **a pack is a shareable, repeatable find-then-act job.** A review is one kind. Moving a codebase off code its own team has marked deprecated is another, and ships built in. The owner finds it with `delivery packs`, starts it with the command they already know, chooses what to act on, signs off the risky changes, and reads the same report as for a review. Nothing about the review journey changes for anyone who uses it today.

The honest limits stay stated to the owner, as for reviews: the find step is an agent's opinion; "done" is only as strong as the check behind it; a pack is data and cannot run its own code.

## 2. Personas and goals

All three exist in `docs/personas.md`; goal extensions for this item are added there (flagged assumed). No new persona is needed: the item widens what they do, not who they are.

| Persona | Goal for this item | Success looks like |
|---|---|---|
| Dana Okafor, non-technical project owner | Use a pack for a job that is not a review and decide what is done and what waits for her | One command lists work in plain words; she approves; she signs off or hands the technical block to Marcus for the serious ones; she reads one report |
| Priya Shah, harness extender | Author a pack whose workflows are not a scan and a fix, and prove it with the scripted agent | She names her workflows in the manifest, `delivery packs check` runs every one end to end, and a mistake is named by file and field. Her `/2` review packs need no edit |
| Marcus Webb, on-call engineer | Judge a held migration without re-running the find | Same FOR ENGINEERS block and sign-off handling as any other item |

## 3. Journeys

**J1. Dana learns packs cover more than reviews** [Dana]. The docs index and the packs page say in their first paragraph that a pack is a repeatable find-then-act job, that reviews are one kind, and that `deprecations` is another. She learns this before she reads a word about manifests.

**J2. Dana moves a codebase off retired code** [Dana: use a non-review pack; Marcus: judge a held change]. Her team has marked the old date-handling module as replaced. She types `delivery packs`, sees `deprecations` with one sentence and its start command, then `delivery review deprecations`. The agent lists, in plain words, the places that still use the retired code ("Invoices still use the old date handling the team marked as replaced"), each with how serious a mistake would be, as the agent rates it. `delivery backlog` shows them; she approves some; `delivery run --sources` moves each, and a move is accepted only when the old use is gone and the project's tests still pass. The scan rates each place by how serious a wrong move would be; moves rated high or critical are held: she reads what changed, hands the technical block to Marcus, and signs it off or rejects it. The report says what moved, what waits for her, and what could not be done.

**J3. Dana is not told the wrong thing** [Dana]. Output for a non-review pack never says "review found problems" as if the agent had judged quality; it says what this pack does (J2's sentences come from the pack's own title and summary).

**J4. Priya authors a non-review pack** [Priya]. She copies the built-in `deprecations` pack, renames it, adds a further act workflow with its own prompt, guards and hold, adds fixtures, and runs `delivery packs check ./my-pack`. The check proves the find, the approvals, each act workflow, and a refused cheat, with nothing sent to a real agent.

**J5. Priya keeps her existing review pack** [Priya]. Her `delivery.pack/2` pack is listed under `packs`, passes `delivery packs check`, runs under `delivery review`, and backlog items naming `mine:fix` still run. She changes nothing.

**J6. Marcus takes over a held migration** [Marcus]. `delivery backlog <id>` shows the same FOR ENGINEERS block as for any item; `sign-off` and `reject` behave as for a review.

## 4. Capabilities, tiered

Format features follow `architecture.md` section 4: named workflows of two kinds, each one step; no per-step checks, no multi-step workflows, no gate or closer choice in this version.

### MUST

| # | Capability | Persona and goal | Governing source |
|---|---|---|---|
| M1 | A new pack format version in which a pack declares **named workflows**, any number of them. A workflow is a **find** (an agent writes ideas to the backlog) or an **act** (changes the project for one idea). Each has its own prompt file; each act has its own guards (additions only) and its own hold. [A§4] | Priya: author non-scan-fix workflows | Roadmap Item 1 criterion 2; engine already supports it [R§3, R§6] |
| M2 | A pack may have several act workflows. The find says which an idea belongs to, and an idea reaches that workflow, so differing prompts, guards and hold apply per idea type. [A§4, A§6] | Dana, Priya | Idea `workflow:` honoured [R§7.4]; hold per workflow [R§8] |
| M3 | Packs in the current format (`delivery.pack/2`) keep working with no edit: same workflow names `code:scan\|fix` and `security:scan\|fix`, same commands, same output for existing packs, same backlog items running. [A§5, A§7] | Priya, Dana | Roadmap criterion 4; names persisted in users' repos, runs and ledgers [R§5] |
| M4 | An owner can start any pack's find with the command they already know, `delivery review <pack>`. The words the owner reads are keyed on the format the pack declares: a `delivery.pack/2` pack keeps every current string byte for byte (so `review code` and `review security` output is unchanged); a `delivery.pack/3` pack gets fixed, pack-neutral strings built from its own title and summary, never "review" or agent text [A§6]. A pack that is not listed gets a reworded refusal that names the pack and not "the review" [A§6, A§14]; it is no longer worded as if every pack were a review [R§10.7]. | Dana | Roadmap criterion 3 |
| M5 | **Built-in non-review pack `deprecations`** (section 6), shipped with fixtures and passing the pack check on every build. | Dana | Roadmap criterion 3 and Notes |
| M6 | `delivery packs check` runs a new-format pack end to end (find, approve, every act, a refused cheat) with the scripted agent only; and fails a pack with an act that no scripted idea reaches. [A§6] | Priya | Roadmap Notes; check is scan-fix shaped today [R§9] |
| M7 | Documentation: a packs page whose first paragraph says packs cover more than reviews; a how-to for `deprecations`; `writing-a-pack.md` for the new format with `deprecations` as the worked non-review example; glossary, index, README, CLI help, `delivery packs` and check wording stop calling every pack a review. | Dana, Priya | Roadmap criterion 1; inventory [R§10] |
| M8 | Data-only stays: keys the format does not name are refused with the existing plain explanation; a malformed new-format pack is refused by file and field. | Priya; owner safety | Roadmap lines 16-18 and Item 1 Constraints; [R§1] |
| M9 | Outcome: Item 4 can add pack settings without a second, incompatible format change. Mechanism and reserved keys are in [A§10]; this document adds no requirement of its own. No persona goal in this item needs it. | (roadmap constraint) | Roadmap Item 4 Notes, lines 163-164 [R§14] |
| M10 | Workflow name clashes (pack and pack, pack and project) are reported plainly by the existing sentence. | Dana, Priya | Existing behaviour [R§5] |
| M11 | Shipping a built-in must not make any project valid today refuse to load. The built-in's workflow names are chosen so that no `/2` pack derives them (`<name>:scan`, `<name>:fix`) unless its pack is itself named `deprecations`; a project that defines one of the exact names is refused by the clash sentence, which for a built-in's name gains a case naming the built-in and what to rename [A§13]; the release note and packs page say so. | Dana, Priya | Roadmap criterion 4; built-ins load in every project and nothing can shadow them [R§2, R§16.6; researcher check of `pack-workflows.ts:6,14`] |

### SHOULD

| # | Capability | Why |
|---|---|---|
| S1 | `delivery packs` lists every pack with one sentence and its start command. | Dana: discovery without knowing verbs |
| S2 | `delivery packs check` says what it proved in the pack's own workflow names, not "the scripted review". | Priya: honest feedback |
| S3 | `writing-a-pack.md` says what fixtures can and cannot prove for non-review shapes. | Priya |
| S4 | Docs-site navigation groups the pack pages under "Packs", not "Review". | Dana: findability |
| S5 | The release note and packs page state, in one sentence, that `delivery review` starts any pack's find step. | Dana: the old verb is not a trap |

### COULD

| # | Capability | Note |
|---|---|---|
| C1 | A second non-review built-in. The documentation-drift pack is the recommended candidate (section 6). | Each built-in is loaded in every project and reserves names [R§16.6]; one proves the format |
| C2 | A neutral alias for `delivery review` (provisionally `delivery find`). | Wanted if a second non-review pack makes "review" feel wrong; costs a second verb to teach |
| C3 | The cap of 40 ideas per scan as a pack key. | Additive later [A§6] |

### Non-goals (with the owning roadmap item)

- Seeing what a pack will do before running it: Item 2.
- Installing from a package or repository, pinning, update diffs: Item 3.
- Pack settings and per-project values: Item 4 (this item only keeps room, M9).
- Scaffolding, publishing, the publish walkthrough: Item 5.
- Editor completion for project configuration: Item 6.
- Custom gates, closers, sources, plugins: Items 7 to 9. A pack cannot ship a work source [R§16.2], so a pack's find is an agent scan; a dependency upgrade or a migration driven by an external command source stays out of reach.
- A pack choosing its own gate, closer, agent options or after steps, and multi-step workflows: left out of the format version by the architect [A§4, A§15]; D1 below.
- Event triggers, answer-only tasks, step approval: roadmap Deferred section.

## 5. Open decisions

- **D1. Shell-string checks are not "data only"; gate and closer choice absent.** No document decides whether a pack may select `command`/`command-succeeds` gates or a closer [R§1, R§17]; roadmap lines 17-18 call "choices from built-in gates and closers" data. Recommendation: left out, as the architect proposes [A§4, A§16.1]: no Item 1 criterion needs them, a pack-supplied shell string is what inspection (Item 2) would most need to flag, and Item 4 settings give the better route (the owner supplies the command). Cost: examples needing a project script wait.
- **D2. How old packs are read** is the architect's [A§5]: both `/2` and `/3` read side by side, nothing rewritten. Product requirement is M3 only.
- **D3. Fixture names and the "at least one refused cheat" rule** stay as they are [A§9]; that rule is a code rule, not a governing document [R§9]. Relaxing it later is additive.

## 6. The built-in non-review pack: `deprecations`

**What it does.** Finds places in the project that still use code the project's own team has marked deprecated (a `@deprecated` note naming its replacement, or a legacy module with a named successor), and moves each place to the replacement. Each place becomes an idea. Approved ideas are moved by an agent; a move is accepted only when the old use is gone from that file and the project's tests still pass. The pack name is `deprecations`; the architect's draft calls it `migrate`. A plain word like `migrate` is a likely name for an author's own `/2` pack, which would collide on `migrate:scan` on upgrade (M11); `deprecations` is far less likely.

**Why this pack, by user value and the research.**

- **Strong, offline check.** Each idea's check is `pattern-absent` on the old call in its file [A§9], one of the closed check kinds that exists today [R§4]; the project's tests still run. "Done" is therefore stronger than for a docs pack, which can pass by deleting a sentence.
- **Shows what a pack can be, in a shipped artefact.** It has one find and two act workflows: `code` (guards the tests, so a move that needs a test to change is refused, and holds high-severity moves for sign-off) and `tests` (updating a test's own calls is the job, so tests may change). Different prompts, guards and hold, exercised end to end by the pack check on every build [A§9]. This is criterion 2 made visible.
- **Generic.** The project, not the pack, says what is deprecated, so no per-project settings are needed. Item 4 will let an owner name the from and the to explicitly.
- **Grounded.** The migration sweep is one of the three find-then-act examples the roadmap names [R§13]; the pack form removes its project script and custom gate by using the closed check kind and the agent's find.
- **Alternatives weighed.** Dependency upgrade: needs registry knowledge an offline agent lacks, and Renovate and Dependabot already do it [A§12; R§15]. Documentation drift: valued by every project, but its check can pass by deleting the stale sentence, so it is the recommended second built-in (C1), with that limit stated, once settings can restrict what it touches.

**What the owner reads.**

| Where | Words |
|---|---|
| `delivery packs` | "Finds places that still use code your team has marked as replaced, and moves them to the replacement. Start it with: delivery review deprecations" |
| Start of a run | What it will read; that it changes nothing but the backlog; that the list is the agent's opinion |
| An idea | A plain sentence naming the place and what replaces it; how serious a wrong move would be, as the agent rates it from the scan's instructions (money, sign-in and data-saving code is meant to rate higher) |
| A held move | The standard held-item text: the item, how serious the scan rated it, and what to do next (`sign-off` or `reject`) |

Never "pattern-absent", "guard", "deprecation sweep" or "check kind" in owner text.

**Limits, stated in `docs/packs.md` and the how-to, not hidden.**

- The agent's list is an opinion; "nothing found" means it found none, not that none exist.
- A scan writes at most 40 ideas [A§6]. In a large project, run it again after the moves land; each run finds what is left.
- A move is checked in its own file and by the tests. It cannot prove behaviour no test covers; that is what sign-off on high-severity moves is for.
- Which moves wait for sign-off depends on the severity the agent assigns, compared with the act workflow's threshold. Nothing guarantees the agent rates payment code high. Sign-off protects only as well as that rating, and the owner can decline or hold anything by reading the backlog before approving.
- If the project marks nothing as deprecated the pack finds nothing, and says so (section 9). How to mark a deprecation so the pack can find it is taught in the how-to page, not printed by the command.

## 7. Key UX flows

### 7.1 Discover

`delivery packs` lists every pack the project can use, one sentence each and how to start it. Illustrative:

```text
Packs you can use:
  code          Looks for wrong results, missing error handling and unused code. Start it with: delivery review code
  security      Looks for weaknesses an attacker could use. Start it with: delivery review security
  deprecations  Finds places that still use code your team has marked as replaced, and moves them. Start it with: delivery review deprecations
```

Plain lines, no box drawing; readable at 60 columns, in a pipe and by a screen reader (the conventions the pack and report UX already follow, `docs/superpowers/specs/2026-10-03-task-packs-design.md` "What a person sees").

### 7.2 Select and run

`delivery review deprecations` (with `--path` and `--preview` as for a review). Output is built from fixed sentences with the pack's title and summary slotted in: "Starting: Move off deprecated code. This reads your project and adds to your backlog; it changes nothing else." The closing line reads "The pack added 3 ideas to your backlog". For a `delivery.pack/2` pack every string stays as it is today ("The review added ..."). The rule that decides which wording is the declared format, not the title and not a manifest attribute [A§6]. Each line has a named printer in `review-command.ts`, `packs-command.ts` or `packs-check-command.ts` [A§14].

### 7.3 Choose, act, sign off, report

Unchanged commands: `delivery backlog`, `approve`, `decline`, `run --sources`, `sign-off`, `reject`, `report`. A second journey that shares every later step is one thing to learn, not two. The only new owner knowledge is that `delivery review <pack>` starts any pack's find.

### 7.4 How the docs teach it

- `docs/index.md` and `README.md`: one sentence that packs are repeatable find-then-act jobs, reviews being one kind, with the three built-ins.
- New `docs/packs.md`: what a pack is; what each built-in does; the shared find, approve, act, sign-off loop (also as a numbered list for readers who skip the diagram); the limits; the name-collision note (M11).
- New how-to for `deprecations` in the structure of `task-packs.md`.
- `task-packs.md` keeps the review journey; its title sentence stops defining a pack as a review [R§10].
- `writing-a-pack.md`: the new format with `deprecations` as the worked non-review example; says `delivery.pack/2` still works; the field table gains the new fields.
- Glossary, CLI reference, `--help`, `config.ts` help text, `mkdocs.yml` navigation: reworded [R§10].
- Documentation tests that assert guide contents [R§10.11] are extended to assert the packs page's opening claim and that the how-to names every command it uses.

## 8. Accessibility

- All output is plain lines: fact per line, no box drawing, no cursor movement outside a terminal, no colour carrying meaning alone, severity always a word, 24-hour UTC times. Inherited from the review UX; no new visual language.
- Any diagram has a text equivalent on the same page (the numbered loop).
- Error text starts with the thing at fault (file and field for authors; the command typed for owners) so a screen reader reads the cause first.

## 9. Empty and error states

| Situation | What the owner sees |
|---|---|
| A `/3` pack adds no ideas | One fixed line built from the pack title: "Move off deprecated code found nothing to add. That is the agent's reading of your project, not a guarantee." Printed when the merged idea count is 0 [A§14]. Guidance on marking a deprecation lives in the how-to page |
| The scan merged as many ideas as the cap (40) | "There may be more: run it again once these have landed." Printed when the count equals the harness cap, a deterministic count that never claims there are more [A§14] |
| Unknown pack name | Existing unknown-pack message listing the packs available |
| `delivery review <path>` where the pack is not listed in the project | The reworded refusal [A§6]: names the pack and says to list it under `packs`; it does not call it a review |
| Not signed in | Existing exit 3 message, unchanged |
| An idea names a workflow the project does not define | Existing refusal at approve [R§5] |
| Workflow name clash | The clash sentence naming the workflow; for a built-in's name it also names the built-in and what to rename [R§5; A§13] |
| New-format pack with a key the format names for the other kind of workflow, or an unknown key | The new sentences in [A§8], each naming file and field |
| Pack of a format this build does not read | One sentence naming the readable versions [A§8] |
| A held move | Same held-item handling as any item; no new states |

## 10. Success metrics

No telemetry exists or is proposed. Success is checkable in the repository and in a scripted run:

1. The first paragraph of the packs page and the docs index state that packs cover more than reviews (documentation test).
2. `deprecations` runs end to end against the scripted agent on every build: `delivery review deprecations` adds the scripted ideas, `approve --all`, `run --sources` lands the unheld honest fix, holds the high-severity one, and refuses the cheat (built-in pack test, [A§9, A§11]).
3. Criterion 2 is evidenced by shipped artefacts: the `deprecations` fixtures exercise two act workflows with different guards and hold, and a test shows an edit to a test refused under `code` and accepted under `tests`.
4. Every existing review pack, its fixtures and a backlog item naming `code:fix` or `security:fix` behave as before; the characterisation test of today's loader output passes for the `code` and `security` built-ins, which stay on `/2`, through the new loader [A§7].
5. Owner-facing strings for the new pack contain none of the words the review UX forbids (existing vocabulary test extended).
6. Compatibility of the new format is mechanically enforced from its first release: published keys are compared against a committed list in both directions, so removing or retyping a key fails and adding one requires a listed line [A§8]. A settings key added later by Item 4 is then additive by construction.
7. A malformed new-format pack is refused with file and field in every case listed in [A§8].

## 11. Derived minimum scope (assumed, not human-confirmed)

The conservative MUST set, for the critic to scrutinise: **M1 to M11**.

- M1 and M2 are criterion 2: without them no non-review pack can exist, and "each with its own prompts, guards and hold" is stated there.
- M3 is criterion 4. M4 is criterion 3 (an owner "can run it"). M5 is criterion 3 and the Notes. M6 is the Notes' "end to end against the scripted agent" and is the only way Priya can prove a non-review pack.
- M7 is criterion 1 and stops the documents contradicting the product.
- M8 and M10 are existing guarantees carried to the new format. M9 is the Item 4 constraint (no persona needs it in this item; it is there because the roadmap says so). M11 is criterion 4 applied to shipping a built-in.

Considered and excluded from the floor: gate, closer and shell-command choices (D1); a second built-in (C1); a neutral command alias (C2); per-step checks and multi-step workflows (not in the format, [A§4]).

## 12. Buy versus build, and operability

- **Commodity or ours?** Workflow execution, guards, checks, hold, sign-off, backlog fan-out, JSON Schema generation and the pack-check harness exist in this repository [R§3, R§6, R§9]. This item builds none of them; it exposes them in the pack format. No library is added. Ledger and alternatives: [A§12].
- **Commodity left to others.** Dependency upgrades are Renovate and Dependabot territory [A§12; R§15]; no built-in pack competes with them.
- **Prior art in this estate beats a template.** The stability promise (published-keys test) and the owner loop (`backlog`, `approve`, `run --sources`, `sign-off`) are reused, not redesigned [R§1].
- **How it is developed, verified, deployed.** A built-in is a folder under `packs/` shipped by the existing `files` entry, verified by the built-in pack check every build; tests that pin the built-in set by name move with it [R§16.6]; the release is a changeset-driven minor [A§13]. Because every built-in loads in every project, a broken built-in breaks every command [R§2]: the pack check must be in the normal test suite, not an on-demand step. The concrete task ledger is the architect's.

## 13. Risks

- Name reservation: M11. The residual is a project defining exactly `deprecations:scan`, `deprecations:code` or `deprecations:tests`, or a `/2` pack named `deprecations`; it is refused on upgrade with the clash sentence, which names the built-in and what to rename [A§13], and the release note says so. No shadowing or opt-out exists today [researcher check of `pack-workflows.ts:14`], so this cannot be made silent without new behaviour outside this item.
- The scripted agent never reads the prompts [`docs/writing-a-pack.md`, "What a scripted check cannot prove"]. The quality of the `deprecations` prompts is verified by a person reading them and by a recorded real run, not by the pack check. The docs say so.
- "Review" as the start verb for a non-review pack may feel wrong once a second non-review pack ships; C2 is the escape and is deliberately not built now.
