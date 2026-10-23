# Inspect a pack before trusting it: product design

> Item 2 of `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` (lines 96-116). Author: product-designer. Facts cite `research.md` (this directory) as [R§n]. Anything uncited is a design choice, not a fact. Mechanism, module layout and the task ledger belong to the architect.
> Persona status: `docs/personas.md` is team-derived and unratified. The goal extensions added for this item are assumed, not human-confirmed: there is no human to ratify this run.

## 1. Vision

A pack is a folder of prompts that an agent follows with every power the project's agent already has. The agent runs with permissions bypassed [R§1.2, `src/agent-invoke.ts:246-247`]. A pack cannot ask for more power through any field [R§0.2]. It can only ask in words, and the words are the risk. Roadmap Item 2 says so directly: "prompt injection is the real risk of sharing. Inspection is the first control" (roadmap :115-116).

So the product is not a scanner that says "safe". It is a **complete, legible, read-only account of a pack** that a person who did not write it can read before anything runs: what it is for, each workflow it contains, every word it will tell the agent, how far each workflow is allowed to go without asking, what it leaves to the project's own checks, and anything unusual. It runs nothing, sends nothing to an agent and changes nothing [R§0.5]. It works on a pack that is not yet in the project, because "before installing or running" is the whole point [R§0.4].

Honest limits are stated in the output itself, in the house tone ("not a guarantee", `review-command.ts:63` [R§4]): inspection helps you read; it cannot prove that a pack is harmless; the command never prints the word "safe".

## 2. Personas and goals

Source of truth is `docs/personas.md`; goal extensions for this item are added there, flagged assumed. No new persona is needed.

| Persona | Goal for this item | Success looks like |
|---|---|---|
| Dana Okafor, non-technical project owner | Decide whether to use a pack someone else wrote, without reading a manifest or knowing what a guard is | From the first screen she can say what the pack does, how far it goes before asking her, and whether anything unusual was found; she can read the full instructions in ordinary prose if she wants to |
| Priya Shah, harness extender | See her own pack, or a colleague's, exactly as an owner would see it, and be refused in her terms when the folder holds something the format does not name | The same command, no extra flags; a refusal names the file and what to do |
| Marcus Webb, on-call engineer | Understand what an agent was told when a held change from a pack reaches him | He inspects the pack the item came from and reads the act's own instructions and hold, without opening files by hand |

## 3. Journeys

**J1. Dana is handed a pack** [Dana: decide whether to trust it]. A colleague sends a folder. She types `delivery packs inspect ./their-pack`. The first screen ("In short") says in plain sentences what the pack is for and what each workflow in it does. She skims "What it may touch", "Does it widen what the agent may do?" and "Things to look at". If she wants more, the same output continues with every instruction the pack gives, verbatim. She decides to ask her engineer to read the flagged part.

**J2. Dana checks a built-in** [Dana]. `delivery packs inspect deprecations` gives the same account for a shipped pack, so what she learns by inspecting a stranger's pack is what she can see for ours. Built-ins are not exempt.

**J3. Dana meets a refusal** [Dana, Priya]. A pack folder contains a file the format never names, or a prompt that is a link to a file elsewhere. Inspect says plainly that it will not read the pack, names the file, and says why: a pack holds only prompts and the files the format names [R§3]. Nothing else about the pack is shown as if it were fine.

**J4. Priya checks before she shares** [Priya]. She inspects her own folder and reads it as a stranger would. A flag she did not expect (a hidden character, a workflow that lands without sign-off) is something she meant, or fixes.

**J5. Marcus reads what the agent was told** [Marcus]. `delivery packs inspect code --workflow fix` shows one workflow's instructions in full, so he does not read a whole pack at a bad hour.

**J6. A script or a colleague reads it** [Priya]. `--json` returns the same facts as one document for her own tooling, and for Item 3 to build the approval record on later.

## 4. Capabilities, tiered

### Derived minimum scope (assumed, not human-confirmed)

The MUST tier, taken from the four roadmap Item 2 success criteria and made usable. The scope is a floor; the SHOULD and COULD tiers are what makes it good.

| Roadmap criterion | MUST that carries it |
|---|---|
| Owner sees workflows, full prompts, guards, hold policy, and the gates and closers it selects | M1 to M6 |
| Anything widening what an agent may do beyond the project's defaults is flagged | M7, M8 |
| A pack carrying something the format does not name is refused with a plain explanation | M9, M10 |
| A non-author can say, from the output alone, what it will do | M11 and the whole shape of M1 to M6 |

### MUST

| # | Capability | Persona and goal | Governing source |
|---|---|---|---|
| M1 | One read-only command, `delivery packs inspect <pack>`, where `<pack>` is a built-in name, a pack the project lists, or a folder path. It works for a folder that is not listed in the project and outside a project. It reads `pack.json` and the named prompts only; it runs no fixture, no test command, spawns nothing and makes no agent call. It asks no trust question. | Dana, J1 and J2 | Roadmap Item 2 "before it is installed or run"; no existing command previews an unlisted pack [R§0.4, R§2]; `packs check` runs fixture code and asks a trust question, which inspect must not [R§0.5] |
| M2 | For every workflow in the pack: its local name, whether it finds ideas or acts on one, and a plain-sentence purpose taken deterministically from the pack's `title`, `summary` and each act's `summary` (never generated). For a find, which acts it can send ideas to. | Dana, J1 | Format fields [R§1]; roadmap criterion 1 "workflows" |
| M3 | **Full prompts, verbatim**, for every workflow, with the pack's own words separated from the words delivery-service adds. For a find, the harness-added idea-format text is shown once, marked as the harness's. Nothing is truncated or summarised. Control characters, bidirectional controls, zero-width characters and escape sequences are shown visibly (for example as `<U+202E>`) and counted, never printed raw. | Dana, Marcus, J1, J5 | Roadmap criterion 1 "full prompts"; two prompt views exist and `ideaFormat` is separable [R§6]; display-integrity hazard [R§4]; precedent char class `HFS_IGNORABLE` [R§4] |
| M4 | **Guards in plain words** per act, showing the *effective* set, including the `tests-unchanged` that a `delivery.pack/2` pack gains on upgrade, so the output never under-reports. Each guard is described with the sentence already published in `docs/configuration-reference.md:231-237` (for example "Edits an existing test"). Finds show that they may change only the backlog. | Dana, Priya | Roadmap criterion 1 "guards"; `/2` upgrade [R§1] |
| M5 | **Hold policy in plain words** per act: either "ideas rated at or above high wait for your sign-off before they are applied", or, when there is none, "lands without asking you again, once you have approved the idea". The absent case is stated, never left as silence. | Dana | Roadmap criterion 1 "hold policy"; absence matters [R§1] |
| M6 | **"Checks and landing"**: states explicitly that this pack chooses no gate and no closer, so every workflow uses the project's own. See D1: this resolves a conflict between roadmap prose and the shipped format. The line exists so that a future format that lets a pack choose them will show the choice in the same place. | Dana | Roadmap criterion 1 "gates and closers it selects"; the format has no such field, so the honest answer is "none" [R§0.1] |
| M7 | **"What it may touch"**: a fixed statement, the same for every pack, that the pack's instructions run with everything the project's agent can already do (its tools, settings and connected services), that nothing in a pack narrows that, and where the project's own checks, guards and hold stop a change from landing. Reuses the `delivery preview` wording ("It can use every tool your setup allows", `OWN_SETUP` `preview-command.ts:80-83` [R§1]). For acts only, it also says that after a change lands the project's own follow-on steps run (a find skips them); verified by the architect (`afterFor`, `src/cli/after-landing.ts:20-23`; finds set `after: []`). | Dana | Roadmap criterion 2; no field can widen power [R§0.2] |
| M8 | **Criterion 2, answered two ways, from one list shared with `architecture.md` sections 3, 5 and 6.** (i) A positive statement printed every time: "Nothing in this pack widens what the agent may do beyond your project's defaults", followed by the dimensions that were compared (guards, hold, checks, landing, follow-on steps, agent options), and the permanent notice that the prompts themselves are not analysed and must be read. It is true exactly when no comparison row is wider; today no pack that loads can have a wider row, and the output says so rather than staying silent. The wider branch fires when a future format gains a key that can widen (Items 4, 7, 9). Stricter differences (added guards, a hold, skipped follow-on steps) are plain facts, not flags. (ii) **"Things to look at"**: notes, one sentence each saying where, for what is unusual but is not a widening against project defaults, namely: an act that lands without sign-off; a hold that stops only critical ideas; a hidden character in a prompt (control, bidirectional, zero-width, escape); a pack in the older `/2` format whose effective guards differ from what its file says. Any comparison row that is wider is also listed there. This is the whole list. When there is nothing to note: "Nothing unusual was found in what this command checks. That is not a guarantee about the instructions." Never "safe", "clean" or "passed". | Dana, Priya | Roadmap criterion 2; no field can widen power [R§0.2]; project default has no hold, so the first two notes are not widenings [R§1 "Hold policy"]; house tone [R§4] |
| M9 | A pack folder is refused as a whole (exit 2, no prompt text printed, nothing shown as accepted) when it holds: a symbolic link anywhere; a file or folder the format does not name; a prompt file that no workflow names; or a prompt that is not valid UTF-8 (the text shown must equal what the agent receives). Documentation and housekeeping files (`README*`, `LICENSE*`, `CHANGELOG*`, top-level `.git/`, `.gitignore`, `.gitattributes`, `.DS_Store`, `Thumbs.db`) are allowed as inert, are listed under "Folder" as "not read when the pack is used", and are never printed. Each refusal names the path and gives one plain sentence (section 5.2). No size cap. Exact closed set: `architecture.md` section 3. | Dana, Priya, J3 | Roadmap criterion 3; the loader never looks at stray files and follows symlinks today [R§3]; closing the set is the architect's `pack-folder.ts` |
| M10 | Manifest-level refusals stay as they are and are shown the same way by this command: every problem at once, each as `file: field sentence`, the existing "not part of the pack format: a pack holds only data" sentence for unknown keys [R§3]. Exit code 2 for any refusal, 0 for an account, including one with flags. | Priya | Existing behaviour [R§3]; exit conventions [R§2] |
| M11 | The output is legible to a non-author: plain lines, a fact per line, no box drawing, no colour carrying meaning, severity and flags always words, readable at 60 columns, in a pipe and by a screen reader; ordered with the short account first and the verbatim prompts last; headings that read as sentences; none of the words the existing vocabulary test forbids to owners. Exception: `--json` and the verbatim prompts, which are the pack's own. | Dana | Roadmap criterion 4; conventions of the pack and report UX [R§2]; `docs/superpowers/specs/2026-10-03-task-packs-design.md` "What a person sees" |
| M12 | `delivery packs inspect` is documented where owners look (the packs page and CLI reference) with a worked reading of a built-in, and the packs page says plainly that inspection is a reading aid and not a guarantee. | Dana | Roadmap criterion 4 |

### SHOULD

| # | Capability | Why |
|---|---|---|
| S1 | `--json`: the same facts as one document with a version field, including the pack hash [R§1], exit codes as above. | Priya: tooling; Item 3 will pin on the hash. Follows the `ctx.json` convention [R§2] |
| S2 | `--workflow <name>`: show one workflow in full, as a view filter over the same account; an unknown name is refused listing the pack's workflows. It is the only support J5 has beyond the full output, which stays complete. | Marcus: a bad-hour read (J5) |
| S3 | The pack hash printed in the human output as "Fingerprint", with a sentence saying it changes when any instruction changes. | It is the identity Item 3 pins [R§1, R§6]; costs one line |
| S5 | `delivery packs` lists, as its footer, how to inspect: "See exactly what a pack will do: delivery packs inspect <name>". | Discovery: Dana will not look for a new subcommand |
| S6 | `delivery review <pack>` for a pack the owner has never inspected does not change; but the refusal for an unlisted pack mentions inspect as the thing to do first. | The existing `packNotListed` text [R§2] is where Dana will be at the moment of doubt |
| S7 | Fixtures are named in the output ("not read when the pack is used; only by delivery packs check") with their file names and sizes. | `npm pack --dry-run` precedent: say what else is in the folder [R§5] |
| S8 | A short "Questions to ask before you use it" block after "Things to look at": who wrote it; do the instructions match the summary; does anything ask for something your project does not need. Fixed text. | Gives a non-technical reader something to do with the account |

### COULD

| # | Capability | Note |
|---|---|---|
| C1 | Inspect every pack the project lists in one call (`delivery packs inspect --all`). | After Item 3 packs multiply |
| C2 | Compare two packs or two versions of a pack. | This is Item 3's "owner sees what changed when updating"; build it there on the shared account structure |
| C3 | A Markdown or HTML rendering to hand to a colleague. | Reports already offer a durable copy [`personas.md`, Dana, Item 11]; add only on demand |
| C4 | Line numbers in the verbatim prompt for referencing in review. | Cheap, but adds noise for the first reader |

### Non-goals (with the owning roadmap item)

- Install from elsewhere, version pinning, recording what an owner approved, refusing a changed pack, update diffs: Item 3. Inspect prints the hash and a stable `--json` so Item 3 can build on it; it records nothing.
- Pack settings and the values that would apply: Item 4. The roadmap says inspection will show them (Item 4 criterion 4, roadmap :157); that is Item 4's addition to this command, and the output is laid out with room for a "Settings" section. The format today refuses `settings` with a specific sentence [R§3].
- Writing, scaffolding, validating and publishing a pack: Item 5. `delivery packs check` keeps that role.
- Editor support: Item 6.
- What a code plugin can do, installing and enabling plugins, packs carrying gates and closers: Items 7 to 9. When Item 9 lets a pack name a custom gate or closer, M6 is where it appears, and M8 gains a flag for it.
- Sandboxing or restricting the agent, or any claim that inspection makes a pack safe. Whether third-party code is contained is Item 7.
- Judging a pack's quality, or running it against a real agent to see what it does.
- Scanning prompt text for "dangerous" words or phrases (shell, URLs, credentials, "ignore previous instructions"). It is evadable and a quiet result reads as reassurance, which is false assurance; the control is the owner reading the verbatim text. One position across this document and `architecture.md`.
- A length cap on prompts, or flagging empty or very long ones: no persona goal needs it and the prompts are shown in full.

## 5. Key UX flows

### 5.1 The account, for a pack that is accepted

Illustrative, for the built-in `deprecations` (wording is a draft; mechanism is the architect's). Plain lines, no box drawing. The prompt text between the marker lines is the pack's own.

```text
Pack: Move off deprecated code (deprecations, version 1.0.0)
Fingerprint: 3f9a...c21 (changes if any instruction changes)
Source: built in to delivery-service

In short
  Finds places that still use code your team has marked as replaced, and moves them.
  It has 3 workflows (a find reads your project and adds ideas to your backlog; an act changes the project for one idea):
    scan   Looks through your project and adds ideas to your backlog. It changes nothing else.
    code   Code of the project's own that still calls the deprecated code.
    tests  A test file that still calls the deprecated code.
  An idea from the scan goes to "code" or "tests", and only after you approve it.

What it may touch
  This pack cannot give the agent extra powers. It also cannot take any away.
  Its instructions run with everything your own agent setup can do: your Claude Code
  settings, plugins, tools and connected services.
  What stops a bad change landing is your project's own checks, the guards below, and
  the sign-off step where a workflow has one.
  After a change lands, your project's own follow-on steps run.

How far each workflow goes before it asks you
  scan   May change only your backlog.
  code   Refused if it edits an existing test.
         Ideas rated high or critical wait for your sign-off before they are applied.
  tests  No extra guards. Lands without asking you again, once you have approved the idea.

Checks and landing
  This pack chooses no checks and no way of landing. Every workflow uses your project's own.

Does it widen what the agent may do?
  Nothing in this pack widens what the agent may do beyond your project's defaults.
  Compared: guards, sign-off, checks, landing, follow-on steps, agent options.
  This command does not analyse the instructions themselves. They are what the agent follows,
  so they are the part to read.

Things to look at
  1. "tests" lands without sign-off, whatever the idea's rating.
  Nothing else unusual was found in what this command checks.
  That is not a guarantee about the instructions.

Questions to ask before you use it
  Do you know who wrote it? Do the instructions below match the summary above?
  Does anything ask for something your project does not need?

Folder: pack.json, scan.md, code.md, tests.md, fixtures/ (6 files; not read when the pack is used,
only by "delivery packs check"). Also in the folder, not read when the pack is used: README.md

Instructions for the scan workflow (the pack's own words)
----------------------------------------------------------------
<pack text, verbatim>
----------------------------------------------------------------
Added by delivery-service to every scan, so the agent writes ideas in the right form
----------------------------------------------------------------
<harness text, once>
----------------------------------------------------------------

Instructions for the code workflow (the pack's own words)
...
```

Order is deliberate: a non-technical reader gets sentences, then limits, then flags, and the long text is last. Every statement above the first marker line derives from fields or fixed text, so it can be right without anyone interpreting prose. A hidden character is printed as, for example, `<U+202E>`, and the note about hidden characters says where.

### 5.2 Refusal for unnamed content

```text
Not read: ./their-pack
  ./their-pack/install.sh is not part of the pack format. A pack holds only data: a pack.json,
  the instruction files it names, and a fixtures folder (a README or licence file is also fine).
  It cannot bring a script of its own.
  Nothing from this pack was shown, run or sent to an agent.
  If you wrote this pack, remove the file. If someone else did, ask them why it is there.
```

```text
Not read: ./their-pack
  ./their-pack/scan.md is a link, not a file in the pack. A link can point anywhere, so what
  the agent is told could come from outside the pack folder; this command will not read it.
  Nothing from this pack was shown, run or sent to an agent.
```

```text
Not read: ./their-pack
  ./their-pack/code.md is not text this command can read safely as written (it is not valid
  UTF-8), so what you saw might differ from what the agent would be given.
  Nothing from this pack was shown, run or sent to an agent.
```

```text
Not read: ./their-pack
  ./their-pack/extra.md is not named by pack.json. No workflow uses it, so it is not part of
  the pack as the format defines it.
  Nothing from this pack was shown, run or sent to an agent.
```

Manifest problems keep their existing form (`pack.json: "tools" is not part of the pack format: a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check`), all listed together [R§3]. The refusal is the whole output: no partial account, because a partial account reads as an approval.

### 5.3 Empty and error states

| Situation | What the person sees |
|---|---|
| Folder does not exist, or has no `pack.json` | "No pack found at ./x: there is no pack.json there." Exit 2 |
| Name is neither built in nor listed in the project | The existing unknown-pack message that lists what is available, plus "or give the folder path" |
| Outside a project, built-in name | Works; "Source: built in" |
| Outside a project, listed-pack name | One sentence: names are looked up in the project's configuration; give a folder path instead |
| `pack.json` is not valid JSON, or the schema is one this build does not read | The existing sentences that name the formats readable [R§3] |
| `/2` pack | Account as for any pack, with the effective guards and a line "Written in the older format; read as if in the current one" (M4, M8) |
| Prompt contains hidden characters | Flag (c), where, how many; text shown with the characters visible |
| Pack has no acts (a find with `ideasFor` empty) | Refused by the existing cross-field rule [R§1]; shown in its existing words |
| Output piped or read by a screen reader | Same text; no colour, no cursor control; `--json` for machines |

## 6. Accessibility and plain language

- Vocabulary follows `docs/glossary.md`: a **pack** is the whole find-then-act package (glossary line 89); a **workflow** is one named piece of work in it. On first use in the output a workflow is explained in a plain sentence: "a find reads your project and adds ideas to your backlog; an act changes the project for one idea". The word "job" is not used for a workflow, because the glossary uses it for the whole pack. "Guard", "hold" and "gate" appear only with their plain sentence beside them, as in the configuration reference.
- Every flag and refusal begins with the thing at fault (the file, the workflow), so a screen reader reads the cause first.
- No sentence says a pack is safe, clean, verified or trusted. The vocabulary test is extended to forbid those words in this command's output.
- British English, no em-dashes, in all fixed strings.

## 7. Success metrics

No telemetry is proposed. Success is checkable in the repository:

1. For each built-in pack, a test reads the inspect output and finds: every workflow name; each act's guards in plain words and its hold or the "lands without asking" sentence; the "Checks and landing" line; the verbatim text of every prompt file byte for byte (except for the visible-escape rule); and the fingerprint equal to `Pack.hash`.
2. Inspect makes no agent call, spawns no process, writes nothing and asks no question: tested against a pack whose fixtures would fail loudly if run, and with the agent and process seams replaced by ones that throw.
3. Inspect works for an unlisted folder, in a directory with no project configuration.
4. Each refusal (stray file, symlinked prompt, unknown key, bad schema, missing file) is a test asserting the named file, the plain reason, exit code 2, and that no prompt text is printed.
5. A prompt containing a bidirectional override, a zero-width character and an escape sequence is printed with all three visible and flagged, and the raw bytes do not appear in the output.
6. The owner-vocabulary test passes on the output, and fails if "safe", "clean" or "verified" is added.
7. A comprehension fixture: for a stranger-pack fixture with a deliberately unsafe-looking prompt and no hold, the "In short", "How far", "Does it widen" and "Things to look at" sections alone (the text above the first prompt marker) contain what the pack is for, that it lands without sign-off, and the flag. Roadmap criterion 4 is thereby evidenced without a user study; the human reading remains a recorded observation, not a test.
8. `--json` output validates against a published schema and carries the same facts as the human output (a test compares the two).

## 8. Open decisions

- **D1. The roadmap says "the gates and closers it selects"; the format selects none.** The manifest has no such field and the workflows carry no `gate`, `agent`, `after` or `continue` [R§0.1]. Recommendation: treat the roadmap sentence as a stale premise from before the format was fixed, satisfy it by stating "none: your project's own" (M6), and keep the slot for Item 9. Cost: none. This should be raised with the owner when one exists; the roadmap text should be corrected when Item 9 is designed.
- **D2. Command shape.** `delivery packs inspect <pack>` follows `delivery packs check <path>` [R§2] and puts it where `delivery packs` already tells owners to look. Alternatives: a flag on `delivery packs` (`--inspect`), or on `delivery review` (`--preview` already shows one step of a listed pack [R§2]). Recommendation: the subcommand, because inspect must work before listing and `review` does not. `delivery preview` is kept for what the agent will be told in the project's context, with the project's agent options: a different question, so a different command.

## 9. Buy versus build, and operability

- **Commodity or ours?** Parsing and strictness are commodity and already ours (zod strict objects, `inspectPack`, `resolvePack`, `Pack.hash`) [R§5, R§6]. No library is added. A Markdown or terminal-width renderer is not justified for plain text [R§5]; control-character escaping is a few lines with an in-repo precedent [R§4].
- **Prior art in this estate beats a template.** Reuse: `delivery packs check`'s command shape, `--json` and exit-code conventions [R§2]; the existing refusal sentences [R§3]; `delivery preview`'s rule lines and `OWN_SETUP` wording [R§2]; the configuration reference's guard sentences. Output is built from fixed sentences, as the review UX is.
- **Alternatives named.** Chrome extension permission warnings and VS Code Workspace Trust show a closed declared-permission list; our format declares none, so the display is the prompts themselves [R§5]. GitHub Actions' advice, "read the source, pin the commit", is the accepted control for shared automation and is the model here: the value added is making the reading complete and legible, and the fingerprint is our commit SHA [R§5]. `npm pack --dry-run` supports listing what is in the folder. Terraform `plan` supports a separate read-only command ahead of the acting one (and Item 3's update diff). An LLM-written summary of a pack is rejected: a hostile prompt can steer its own summary.
- **Developing, running, observing.** A read-only command over one function is cheap to test with fixtures of each refusal and flag and cheap to run in CI over every built-in. Because it executes nothing, it is safe to run on hostile input; its one hazard is its own output, hence M3's visible escapes. The exact test seams and module layout are the architect's.

## 10. Risks

- **False comfort.** A person sees "Nothing unusual" and stops reading. Mitigation: that sentence always carries "not a guarantee"; the account puts the verbatim text in the output, not behind a flag; the packs page says inspection is a reading aid (M12).
- **A prompt that is long, subtle or in a language the reader does not read.** Inspection makes the reading possible, not easy. The flag list and "Questions to ask" are the help; a person who cannot assess it should ask someone who can.
- **Hidden-text attacks beyond the character classes covered.** The class list is finite; M3 chooses visible display over detection, which fails safe.
- **Drift between inspect, the loader and `packs check`.** If they disagree about what is a valid pack, a pack could be inspected as fine and refused at run (or the reverse). the architect's single-source rule (`architecture.md` section 3, folder check applied by inspection and install) addresses it; a test running all three over the same fixtures is recommended.
- **The command exists but nobody finds it.** S5 and S6 put it in the two places an owner meets a pack for the first time.
