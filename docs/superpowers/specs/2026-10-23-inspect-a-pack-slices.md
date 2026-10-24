# Inspect a Pack Before Trusting It — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md`
> Next step: invoke writing-plans with this document

---

## Slice 1: Read a built-in pack in plain words

**Status:** ✅ Complete — 2026-10-23 — `52b38bf`
**Tests:** ✅ Recorded — 2026-10-23 — `a9972ec` — cli — 1 UAT + 9 AC, 0 skipped
**Delivers:** A project owner can ask what a built-in pack will do and get an account in plain sentences, followed by every instruction the pack gives the agent, without running anything.

**Operational note:** The command reads and writes nothing, calls no agent and runs no pack code, so it is safe on any pack. A check that every built-in pack can be read this way, and that what is shown matches what a run would use, belongs in the project's normal checks.

**Build note:** Reuse the loader that runs packs today so what is shown cannot differ from what runs; reuse the existing plain-language wording for guards and for the agent's own setup. Add no library for rendering.

### Prerequisites

- Packs for any workflow are delivered: built-in packs, including a non-review pack, can be listed and run
- Built-in packs can be named on the command line

### Acceptance Criteria

- [ ] Asking to inspect a built-in pack by name shows its title, version and a fingerprint that changes when any instruction changes
- [ ] The first part says in plain sentences what the pack is for and what each workflow in it does, and which workflows an idea may go to
- [ ] Each workflow shows, in words, how far it goes before it asks the owner: its guards (including any a pack in the older format gains on upgrade) and either its sign-off threshold or a plain statement that it lands without asking again once the idea is approved
- [ ] The account states that the pack chooses no checks and no way of landing, so the project's own are used
- [ ] The account states that the instructions run with everything the owner's agent setup can already do, that nothing in a pack narrows that, and that the project's own follow-on steps run after a change lands
- [ ] Every instruction is shown in full and unaltered, the pack author's words separate from the words delivery-service adds to every find
- [ ] Nothing is sent to an agent, no process is started, nothing is written and no question is asked
- [ ] The output reads at 60 columns with no colour or box drawing carrying meaning, with the short account first and the full instructions last
- [ ] The words "safe", "clean" and "verified" never appear

### UAT

**What you can now do:** See what a shipped pack will tell the agent to do, and how far it can go, before you run it.

**How to try it:**
1. In a project, ask to inspect the built-in `deprecations` pack by name.
2. Read the opening part and say aloud what the pack is for and how many workflows it has.
3. Find the line that says how far the "tests" workflow goes before it asks you.
4. Scroll to the end and read the full instructions the agent is given for one workflow.

**What you should see:** Plain sentences first, then limits, then the full instructions, with no change made to your project.

**Why this matters:** An owner can judge a pack from the output alone, before giving it any access.

---

## Slice 2: Be told what is unusual, and whether anything widens what the agent may do

**Status:** ✅ Complete — 2026-10-24 — `404f783`

**Delivers:** A project owner is told every time whether a pack widens what the agent may do beyond the project's defaults, and is pointed at the few things worth a second look, including hidden characters in instructions.

### Prerequisites

- A pack can be inspected by name and its workflows, limits and instructions are shown in plain words

### Acceptance Criteria

- [x] Every account states whether anything in the pack widens what the agent may do beyond the project's defaults, names the dimensions compared, and says the instructions themselves are not analysed and must be read
- [x] A "Things to look at" list is always present and is limited to: a workflow that lands without sign-off, a sign-off that stops only critical ideas, hidden characters in an instruction, and a pack in the older format whose effective guards differ from what its file says
- [x] Anything that would genuinely widen the agent's powers appears in the same list, so a future pack field that does so cannot pass unremarked
- [x] Added guards, a sign-off step or skipped follow-on steps are reported as plain facts, not as flags
- [x] When nothing is found the output says nothing unusual was found in what is checked and that this is not a guarantee about the instructions
- [x] Control, bidirectional, zero-width and escape characters are shown visibly, counted, and never printed raw; each occurrence is listed with where it is
- [x] The account never calls a pack safe, clean, verified or trusted

### UAT

**What you can now do:** Know at a glance whether a pack is asking for anything out of the ordinary.

**How to try it:**
1. Inspect the built-in `deprecations` pack and find the "Things to look at" section.
2. Read the note about a workflow that lands without sign-off.
3. Inspect a pack whose instruction file hides a text-direction control character.
4. Find the note that names the file and shows the hidden character as visible text.

**What you should see:** A short numbered list of what to look at, with the hidden character visible as plain text, and a reminder that this is not a guarantee.

**Why this matters:** The riskiest part of a shared pack is words an owner cannot see; this makes them visible and keeps the owner reading.

---

## Slice 3: Inspect any pack folder, and be refused plainly when it holds more than a pack should

**Tests:** ✅ Recorded — 2026-10-24 — `542a012` — cli — 2 UAT + 16 AC, 0 skipped

**Delivers:** A project owner or pack author can inspect a folder that is not yet in any project, and is refused with a plain explanation naming the file when the folder holds something the pack format does not name.

### Prerequisites

- A pack can be inspected by name and shown in plain words
- The pack's problems are already reported by file and field for pack checks

### Acceptance Criteria

- [ ] A folder path can be inspected whether or not the project lists it, and outside any project
- [ ] A project's own checks and landing are named in the account when a project is found, and described as not known when none is
- [ ] A folder holding a script, a hook, an unnamed file or folder, or an instruction file no workflow uses is refused whole, naming the path and why, with no instruction text shown
- [ ] A link anywhere in the folder, including the manifest itself, is refused and its content never shown
- [ ] An instruction file that is not valid text is refused and named
- [ ] README, licence and changelog files, and version-control or operating-system housekeeping files, are allowed, listed as not read when the pack is used, and never printed
- [ ] A problem in the manifest is shown alongside any folder problems, all at once, each by file; an unreadable or newer format is refused with a sentence that says which
- [ ] Any refusal ends with a non-zero exit and states that nothing from the pack was shown, run or sent to an agent
- [ ] Existing packs that carry a stray file keep running unchanged
- [ ] A folder that does not exist, or has no manifest, is reported plainly

### UAT

**What you can now do:** Check a pack a colleague sent you before you list it in your project.

**How to try it:**
1. Inspect a folder you have been given, outside your project.
2. Read the account.
3. Add a script file to a copy of the folder and inspect it again.
4. Read the refusal.

**What you should see:** The first run shows the account; the second says the script file is not part of a pack, names it, and shows nothing else from the pack.

**Why this matters:** A pack that cannot be fully described is never shown as if it were fine.

---

## Slice 4: Look at one workflow, or hand the account to a script

**Delivers:** An on-call engineer can read one workflow's instructions and limits in full, and a pack author or script can read the same account as a stable document.

**Operational note:** The machine-readable form carries a published version and a published list of keys, checked in the project's normal checks, so it can be relied on by later install and plugin work. The plain-text form carries no such promise.

**Build note:** Generate the published schema from the same definition that validates the account, as pack and report schemas already do; add no schema library.

### Prerequisites

- A pack can be inspected, flagged and refused in plain words
- Folder paths can be inspected

### Acceptance Criteria

- [ ] Asking for one workflow by name shows that workflow, its limits and its findings in full, with the pack identity and the standing notices, and drops the others
- [ ] An unknown workflow name is refused, listing the pack's workflows
- [ ] A machine-readable form returns the same facts as the plain account, including the pack fingerprint and raw instruction text
- [ ] A refusal in the machine-readable form says it was refused and lists each problem, with the same non-zero exit
- [ ] The machine-readable form names its version and validates against a published schema; adding a key is allowed within the version, removing or changing one is not
- [ ] Two runs on the same folder give identical output in both forms

### UAT

**What you can now do:** Read one workflow quickly when something from a pack needs your attention, and let tooling read the account.

**How to try it:**
1. Inspect the `deprecations` pack and ask to see only the "tests" workflow.
2. Read its limits and instructions.
3. Ask for the account in the machine-readable form and look for the fingerprint.
4. Ask for a workflow name that does not exist.

**What you should see:** One workflow in full, a document with the same facts and a fingerprint, and a plain refusal that lists the real workflow names.

**Why this matters:** A reader at a bad hour reads one page, and later install work has a stable record to compare.

---

## Slice 5: Find out inspection exists, and how to read it

**Delivers:** A project owner meeting a pack for the first time is pointed to inspection where they will be looking, and the documentation explains how to read the account and what it does not promise.

### Prerequisites

- Packs can be inspected in plain words, by workflow and as a document

### Acceptance Criteria

- [ ] The pack listing ends with a line telling the owner how to see exactly what a pack will do
- [ ] The refusal for running a pack the project does not list mentions inspecting it first
- [ ] The packs page and command reference describe inspection, with a worked reading of a built-in pack
- [ ] The documentation says plainly that inspection is a reading aid and not a guarantee, that it does not analyse the instructions, and what the folder rule allows and refuses
- [ ] The account includes the fixed block of questions to ask before using a pack, and names the fixture files it did not read, with sizes
- [ ] The owner-vocabulary check passes on the command's output and on the new documentation

### UAT

**What you can now do:** Discover inspection from the places you already look and learn how far to trust its output.

**How to try it:**
1. List the available packs and read the last line.
2. Try to run a pack your project does not list and read the message.
3. Open the packs page and find the worked reading of a built-in pack.
4. Read what it says inspection does not promise.

**What you should see:** Both the listing and the refusal point to inspection, and the documentation says it is a reading aid, not a guarantee.

**Why this matters:** A trust control nobody finds does nothing; this puts it at the moment of doubt.
