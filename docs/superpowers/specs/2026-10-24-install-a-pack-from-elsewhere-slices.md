# Install a Pack from Elsewhere, Pinned — Slice Scope

> Based on spec: `docs/superpowers/specs/2026-10-24-install-a-pack-from-elsewhere-design.md`
> Next step: invoke writing-plans with this document
> Written unattended: the clarifying-question and user-review steps were skipped. The ordering follows the spec's journeys J1 to J7.

---

## Slice 1: Add a pack from npm and run it

**Status:** ✅ Complete — 2026-10-24 — `cd2acc6`
**Tests:** ✅ Recorded — 2026-10-24 — `5131f37` — cli — 5 UAT + 11 AC, 0 skipped

**Delivers:** A project owner can add a pack published on npm, read exactly what it will do, accept it, and run it, with nothing from the package ever executed.

**Operational note:** Adding needs the `npm` tool on the machine; running does not. The two files that record and hold the pack must be committed rather than ignored by the project's own ignore rule. Every behaviour must be testable offline through a replaceable fake of the package source.

**Build note:** Reuse npm itself to find and download the package, a maintained tar reader for parsing only (nothing is unpacked straight to disk), and the existing pack reader, inspection and fingerprint. Do not write a registry client or an archive extractor.

### Prerequisites

- Packs can be inspected before they are trusted (Item 2), including the fingerprint
- Packs from a local folder can be selected and run from project configuration

### Acceptance Criteria

- [ ] Asking to add a package shows the exact version found, says nothing from the package is run, and shows the full pack account an owner sees from inspection, before anything is written
- [ ] Nothing is written until the owner says yes; saying no, or giving no answer, leaves the project unchanged
- [ ] After yes, the owner is told which two items to commit, and both are kept by the project's version control rather than ignored
- [ ] The added pack's workflows appear in the pack list with its source and version, and can be run
- [ ] A package that does not say it holds a pack, or points to a missing pack folder, is refused with the reason and nothing is written
- [ ] A pack folder holding anything the pack format does not name is refused with the file named; other files in the package are listed as not part of the pack and are not kept
- [ ] Addresses that are not plain npm package names (git, web or local paths) are refused with a plain explanation
- [ ] A package with an install script does not run it: no file the script would create appears
- [ ] Adding a pack already added at the same content says so and changes nothing
- [ ] Output reads at 60 columns, no colour carries meaning, and never calls a pack safe, trusted or verified
- [ ] A missing `npm`, an unknown package, an unknown version and an unreachable registry each give a plain sentence and change nothing

### UAT

**What you can now do:** Add a pack that someone else published and use it in your project.

**How to try it:**
1. Choose a pack package prepared for the demo and ask delivery to add it.
2. Read the account it shows: the version, what the pack is for, how far each workflow goes before it asks you, and the instructions in full.
3. Answer no, then check that nothing in your project changed.
4. Ask to add it again and answer yes.
5. Look at the pack list, and start one of the pack's workflows in preview.

**What you should see:** Nothing changes after no. After yes, a short message naming the two items to commit, the pack in the list with its version and source, and the workflow previewing as normal.

**Why this matters:** An owner can use a pack written elsewhere only after reading what it will tell the agent, which is the main risk of sharing.

---

## Slice 2: The same pack on every machine and every run

**Tests:** ✅ Recorded — 2026-10-24 — `8a31ee5` — cli — 3 UAT + 12 AC, 0 skipped

**Delivers:** An owner or colleague who runs an added pack always gets the version that was accepted, with no network, and is stopped plainly if the pack no longer matches.

### Prerequisites

- A pack from npm can be added and appears in the pack list with a recorded version

### Acceptance Criteria

- [ ] A fresh copy of the project with no network access runs the added pack and the pack list says it is as approved
- [ ] A newer version appearing on npm does not change what runs
- [ ] Changing one character of a kept instruction, deleting a file from the kept pack, or adding a stray file stops the run before anything is sent to an agent, naming the pack, its state and the file
- [ ] A kept pack with no matching entry in the record is refused with a plain explanation, and a leftover working folder from an interrupted add does not cause a refusal
- [ ] A pack whose record entry exists but whose files are missing is refused with the state named
- [ ] Each refusal names the single command that fixes it
- [ ] Restoring fetches the recorded version again, checks it matches what was accepted, and puts the pack back; if npm now serves different contents for that version it refuses and changes nothing
- [ ] A pack whose files differ from the record cannot be approved where it stands; the owner is told to restore it or update it
- [ ] A pack whose record says it was not approved can be approved after the owner has read the full account
- [ ] A project that only uses local folder packs behaves exactly as before

### UAT

**What you can now do:** Trust that an added pack is the one you accepted, and get it back if it changes.

**How to try it:**
1. In the project from the first slice, open the added pack's instruction file and change a word.
2. Try to run one of the pack's workflows.
3. Read the message, then follow the command it names to restore the pack.
4. Run the workflow again in preview.
5. Look at the pack list.

**What you should see:** The first run is refused, naming the pack and the file and saying nothing was sent to an agent. After restoring, the workflow previews and the list says the pack is as approved.

**Why this matters:** Sharing is only usable if "I read this" and "this is what runs" stay true.

---

## Slice 3: Clashes reported plainly, and taking a pack out

**Delivers:** An owner who adds a pack whose name or workflow names clash with something already in the project is told plainly what clashes and how to resolve it, and can remove an added pack.

### Prerequisites

- A pack from npm can be added, and is refused when it no longer matches its record
- Workflow-name clash reporting exists for local packs

### Acceptance Criteria

- [ ] Adding a pack with a workflow name already used by another pack, a folder pack, a built-in pack or the project's own workflows is refused before anything is written, naming both sources
- [ ] A pack name already used, or equal to a built-in pack's, is refused in the same way
- [ ] The message names one action the owner can take without editing the other pack, which is removing the pack that holds the first use
- [ ] A clash that appears later (for example from a configuration change) is reported when the packs load
- [ ] Removing a pack names the workflows that will stop existing and then deletes its kept files and its record entry
- [ ] Removal is refused, changing nothing, while the project's configuration still names one of the pack's workflows
- [ ] Removing a pack that is not installed names the packs that are

### UAT

**What you can now do:** Resolve two packs that want the same name, and take a pack out cleanly.

**How to try it:**
1. Add a second prepared demo pack that has a workflow with the same name as the first.
2. Read the refusal.
3. Remove the first pack as the message suggests, then add the second.
4. Look at the pack list.

**What you should see:** The first attempt is refused with both packs named and nothing changed. After removal the second pack adds and the list shows only it.

**Why this matters:** Owners can combine packs from several authors without hand-editing anything.

---

## Slice 4: Update a pack and see what changed first

**Delivers:** An owner can move an added pack to a newer version only on purpose, after seeing what changed in plain terms and in the text itself.

### Prerequisites

- A pack from npm can be added, pinned and restored
- Clashes are reported when a pack is added

### Acceptance Criteria

- [ ] Updating looks up the newer version and changes nothing until the owner says yes; declining or being unable to ask changes nothing
- [ ] The report starts with the old and new versions and fingerprints, then says in owner terms what changed: sign-off added or removed, guards added or removed, workflows added or removed, checks and landing, and whether the agent may now do more, each with its direction
- [ ] The report then lists which instruction files changed, were added or removed, and then shows the changed lines with a legend, with hidden or direction-changing characters made visible
- [ ] The report states that its summary does not cover what the instructions say
- [ ] After yes, runs use the new version, and the record and kept files are both updated
- [ ] When nothing newer exists, or the newer version has the same content, the owner is told so plainly and nothing is written
- [ ] An update that would add a clashing workflow, or that cannot be read, is refused with the record unchanged
- [ ] An update is the way to accept a changed pack: the owner sees the change before accepting it

### UAT

**What you can now do:** Take a newer version of a shared pack knowingly.

**How to try it:**
1. Publish a newer version of the demo pack in which one workflow no longer waits for sign-off.
2. Ask delivery to update the pack and read the report.
3. Answer no and check the pack list still shows the old version.
4. Ask again, answer yes, and check the list.

**What you should see:** The report leads with the missing sign-off, then the changed files and lines. After no the old version stays; after yes the list shows the new version.

**Why this matters:** A new version is the moment a shared pack can become riskier, so the owner must see the change before it takes effect.

---

## Slice 5: Add and update from automation, with output scripts can read, and documentation

**Delivers:** A team can add and update packs from automated jobs without a person present, read the same facts as data, and learn the whole flow from the documentation.

### Prerequisites

- Packs can be added, updated, restored and removed by a person at a terminal

### Acceptance Criteria

- [ ] With nobody to ask, adding prints the account and refuses, naming how to accept; accepting needs the exact fingerprint of the pack, and a different fingerprint is refused
- [ ] The same rule applies to updating, bound to the new fingerprint
- [ ] The pack list, add, update and approve can give their facts as versioned data matching the plain output
- [ ] A pack in a format this build cannot read is refused with the "upgrade delivery-service" sentence and the record is left untouched
- [ ] The documentation has an "Add a pack from elsewhere" section with a worked add, update and refusal, says plainly that pinning keeps review stable and does not make a pack safe, and names the keyword publishers use so owners can search npm themselves
- [ ] Every example in the documentation matches what the commands print

### UAT

**What you can now do:** Use shared packs in automated jobs and follow the documentation from start to finish.

**How to try it:**
1. Run the add command from a script with no terminal and read the refusal.
2. Run it again giving the fingerprint shown.
3. Ask for the pack list as data.
4. Follow the documentation's worked example in a fresh project.

**What you should see:** The first run refuses and shows the account; the second adds the pack; the data matches the plain list; the documentation example works as written.

**Why this matters:** Teams run delivery from automation, and the approval must still be tied to what a person read.
