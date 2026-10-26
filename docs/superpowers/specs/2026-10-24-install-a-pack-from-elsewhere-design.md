---
seeded_by: []
---

# Delivery Service: Install a Pack from Elsewhere, Pinned: Design

> **Status:** ✅ Complete — 2026-10-25 — all 5 slices delivered

> **Roadmap:** `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md` — Item 3
> **Status:** Draft, awaiting slicing
> **Created:** 2026-10-24
> **Builds on:** inspect a pack (`docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md`), packs for any workflow (`docs/superpowers/specs/2026-10-23-packs-for-any-workflow-design.md`), task packs (`docs/superpowers/specs/2026-10-03-task-packs-design.md`, COULD 23).
> **Audit trail:** `docs/prd/2026-10-24-install-a-pack-from-elsewhere/` (`research.md` cited as R§n, `product-design.md` as P§n, `architecture.md` as A§n, `review-log.md`, `spec-review.md`). Where this document and an approved artefact differ in detail, the artefact wins.

## 1. Problem

A pack that is not built in is a folder path in `delivery.config.json`. It has no source, no version and no memory of what the owner approved. Whatever is in the folder runs: `loadPack` has no expected-hash check, and the manifest `version` is author-asserted and unbound to content (R§1.3, R§6.7). Sessions run with permissions bypassed (`src/agent-invoke.ts:246-247`), so a pack's words run with every power the agent has (P§1).

Item 2 made a pack readable before it runs. Item 3 makes it **stay what was read**: a pack someone else wrote arrives from somewhere, is read once, accepted once, and is then the same pack on every machine and every run until the owner chooses otherwise.

Opportunity: roadmap Item 3 criteria (lines 122-144) and the phase goal that a project owner can find a pack, see what it does, install it at a pinned version and run it. Item 5 (publish) and Items 7 to 9 (code plugins) reuse its record and its "updating shows what changed" behaviour.

Personas (team-derived, not human-confirmed; `docs/personas.md`): **Dana Okafor**, non-technical project owner; **Priya Shah**, extender who publishes packs; **Marcus Webb**, on-call engineer who needs to know which pack text an agent was given.

## 2. Scope

Roadmap Item 3 only. Not settings or adapting a pack (Item 4), publishing (Item 5), editor support (Item 6) or code plugins (Items 7 to 9).

### Derived minimum scope (assumed, not human-confirmed)

Derived from the five Item 3 success criteria and its constraint, not confirmed by a human. It is a floor, not a ceiling; the MUST tier below is what lets each persona finish their journey.

1. Add from a public package source (an npm package).
2. Record the exact version and a content fingerprint.
3. Runs use only the recorded version until a deliberate update.
4. A deliberate update shows what changed before it applies.
5. A pack that changed since approval is refused until the owner approves the change.
6. Duplicate workflow names are reported plainly, as for local packs.

### Capability tiers (full wording in P§4)

**MUST** (P§4 M1 to M17): `delivery packs add` with the full Item 2 account before any write (M1); approval bound to the fingerprint, with `--approve <fingerprint>` where nothing can ask and no blanket `--yes` (M2); the record (M3); a committed kept copy so runs need no network (M4); a state check on every use, refusing before any agent call (M5); `update` as the only way a version moves (M6) with a four-part change report (M7); `restore` (M8); `approve` for the unapproved state only (M9); clash reporting naming both sources (M10); the package is never run (M11); packs stay data, closed set applies (M12); `delivery-pack` field identifies a pack (M13); `delivery packs` lists source, version and state (M14); `remove` (M15); plain, 60-column, colour-free output (M16); documentation (M17).

**SHOULD** (S1 to S5): `--json` on add, update, approve and packs; a note for kept files the fingerprint does not cover; the "upgrade delivery-service" refusal for unreadable formats; the `delivery-pack` npm keyword documented as the discovery convention; wording for network and tool failures.

**COULD** (C1 to C9): git and archive sources, a search command, provenance display, publish age and newest-version display (needs a metadata call the fetch does not make), keeping the copy out of git, `--as` aliasing, update-all reporting, a publisher allowlist.

### Non-goals

A hosted registry or marketplace; our own signing or paid tier (roadmap lines 58-61); pack settings (Item 4); writing and publishing (Item 5); packs that carry code (Items 7 to 9); automatic updates or any network call during a run; judging or scanning a pack or calling it safe; recording who approved and when as separate data; multi-person approval; private registries as a promised path; git, tarball-URL and local-package sources (A§17).

## 3. Architecture (A§1 to A§12)

An installed pack is a **vendored folder in the project, pinned by a committed record**.

- **Source:** the npm registry only (A§D1). A `PackSource` port with an npm adapter (`npm pack --ignore-scripts` via `execFile`, in a fresh scratch folder, spec validated first) and an in-memory fake, sharing one contract suite (A§4.1). Git, `file:`, URL and directory specs are refused by shape (A§7.1).
- **Reading:** the tarball is parsed in memory with the `tar` library as a parser only, never extracted; entry rules and caps (A§7.3); only the pack folder named by the package's `delivery-pack` field is kept; `package.json` is read as data and dropped; the existing `readPackFolder` closed-set check runs on the staged result (A§4.2).
- **Store and record:** `.delivery/packs/<name>/` holds the pack; `.delivery/packs.lock.json` (schema `delivery.packs-lock/1`) records source, package, request, exact version, tarball integrity, fingerprint and approved fingerprint (A§6.1). Folder is written first, record last, so the record is never ahead of the folder (A§4.3). `DELIVERY_IGNORE` (`src/run-location.ts:62-68`) is widened so both paths are committed.
- **Approval key:** the pack fingerprint (`Pack.hash`) with a labelled algorithm (`delivery.pack-hash/1:`), not the version and not the tarball hash (A§D6).
- **Load:** `projectPacks` gains installed packs after built-ins and listed folders (A§4.4). Each load checks, in order, folder present, closed set, name equals the record key, fingerprint equals the record, approved equals fingerprint. States: ok, missing, invalid, changed, unapproved (A§6.3), plus **unrecorded**: a folder under `.delivery/packs/` with no record entry (the crash state after `add`) is refused at load (detection scans `.delivery/packs/` and excludes `.staging/`, which is ignored and removed on next use, A§4.3), exit 2, with "Add it again, or remove the folder" (P§5.6), and is never loaded silently (decision at assembly, resolving A§4.3 against A§11 and P§5.6; `add` run again replaces it). Nothing network-bound or spawned on the run path.
- **Update:** fetch into staging, `comparePacks` over two Item 2 inspections with a direction per change, then a `git diff --no-index` text diff passed through the hidden-character escaper, then approval bound to the new fingerprint (A§4.5, A§5.3). A hand-edited folder is never approvable in place; the ways out are `restore` and `update` (A§D9, A§5.3a), which is how roadmap criterion 4 is met.
- **Commands:** `add`, `update`, `restore`, `remove`, `approve` and the existing `packs` (A§4.6). Exit 0 on success or a declined approval, exit 2 on any refusal, exit 1 on an unexpected fault.
- **Errors:** typed errors with plain renderings in the exhaustive switch in `src/cli/failures.ts` (A§8).
- **Configuration:** `delivery.config.json` is unchanged (A§D5, A§10); the record is the list of installed packs. The Item 2 inspection `source.kind` widens to `installed`.

## 4. UX and key flows (P§3, P§5)

- **Add (J1):** nothing is written until the owner has seen the exact version, the statement that nothing from the package is run, and the whole Item 2 account; then one question. Without a terminal the command prints the account and refuses with exit 2, naming `--approve <fingerprint>`, which succeeds only for the fingerprint the package has. An add of a package already recorded at the same fingerprint reports "already added, nothing to do" and exits 0 without writing; at a different fingerprint it refuses and points to `update` (A§5.1).
- **Run elsewhere (J2):** a fresh clone runs the pack with no network; `delivery packs` shows "As approved."
- **Update (J3):** a headline, then what changed in owner terms with direction (sign-off, guards, workflows, checks and landing, widening), then changed files, then changed lines with a legend, then one question. Declining changes nothing. If the fetched fingerprint equals the recorded one, even under a different version, nothing is written and the output says plainly that the pack is already at this content, naming both versions (decision at assembly, resolving the A§5.3 step 3 contradiction; the record never states a version the owner was not asked about).
- **Changed since approval (J4):** the run is refused before any agent call, naming the pack, state and file, with the one command that fixes it.
- **Clash (J5), not a pack or too much (J6), remove (J7):** refusals begin with the thing at fault, name both sources where relevant, and leave the project unchanged. A pack name used twice, or equal to a built-in's, is refused in the same way, with a pack-name sentence (P§4 M10, A§6.4). `remove` names the workflows that will stop existing, and refuses (exit 2, nothing changed) while the project's configuration still names a workflow of the pack (P§4 M15, A§5.4).

Output rules (P§4 M16, P§6): plain lines at 60 columns, no colour carrying meaning, British English, the words "safe", "trusted", "verified" and "clean" never describe a pack, and pinning is described as keeping review stable, not as safety.

## 5. Buy-vs-build decisions (A§14, P§9)

| Capability | Decision | Rationale |
|---|---|---|
| Discovery and hosting | Buy: npm registry; `delivery-pack` field and keyword | Roadmap constraint (line 141); no registry hosted |
| Resolve, download, auth, proxy | Buy: the `npm` command, `--ignore-scripts` | Reuses the owner's npm configuration; `pacote` has 17 direct dependencies and a narrower Node range (R§5) |
| Tarball parsing | Buy: `tar`, parser only | Commodity with a security history; filesystem writes stay in validated code |
| Integrity | `node:crypto` SHA-512 over npm's reported value | One call |
| Version and range resolution | Buy: npm itself, inside `npm pack` | We never evaluate a range; we record the exact result (A§14) |
| Closed-set check, inspection, fingerprint | Reuse estate: `readPackFolder`, `inspectionOf`, `Pack.hash` | One validation path; the owner already sees the fingerprint |
| Version comparison | Build, thin: `comparePacks` over two inspections | Over our own format; typed direction table follows `widening.ts` |
| Text diff | Reuse estate: `git diff --no-index` through `git-exec.ts` | Git already required |
| Record schema, writes, locking, prompt | Reuse estate: zod and `publishedKeys`, `atomicWriteJson`, `proper-lockfile`, `@inquirer/prompts` | Existing patterns |
| Lockfile convention | Reuse prior art: committed record, deliberate update, verify on use | Universal across npm, Cargo, Terraform, Go (R§4.4) |
| Signatures, provenance, typosquat detection | Not provided | Roadmap excludes signed distribution; can be added behind the port |
| Test registry | Build, thin: in-memory fake and a throwaway local HTTP server | Deterministic; no service to run |

## 6. Operability / DX (A§15)

**Environment:** the existing `delivery` CLI and library (Node 22 or later, TypeScript, zod 4, git). New runtime need: the `npm` command, only for `add`, `update` and `restore`. One new runtime dependency, `tar`. No service, no credential of ours, no network at run time.

**Harness:** the existing gate (lint, build, vitest) runs every new suite offline: command tests in process; the fake source exported from `src/testing.ts`; a source contract suite every adapter calls once; a real-`npm` test against a throwaway local registry server.

**Local-run story:** an owner adds, reads the account, approves and commits two paths. A teammate pulls and runs with nothing fetched. An update is an ordinary pull request with a record change and a folder diff. CI needs `--approve <fingerprint>` for `add` and `update` and nothing for runs.

**Deploy target:** the existing `delivery-service` npm package through the changeset flow (minor). Nothing hosted.

**Failure modes:** every failure is a plain sentence naming the pack and one next command. An interrupted add or update leaves the previous state or a state refused safely at load and recoverable by `restore`, `update`, a repeated `add` or a repeated `remove` (A§4.3, A§11). A missing `npm`, a down registry or an unpublished package never stops a run of an installed pack.

**Determinism:** same inputs give a byte-identical record, vendored folder and `--json` output: sorted keys, fixed ordering, no timestamps or machine paths (A§11).

**Verification:** success is checkable in the repository with a fixture tarball and the scripted agent: add writes nothing before yes; pin holds when a newer version appears; a fresh clone runs with no network; one-byte tamper is refused before any agent call; `restore` and `update` recover; clashes name both sources; a `postinstall` marker is never written; Item 1 and Item 2 fixtures still pass (P§7, A§13).

## 7. Security (A§7)

Spec validated by shape before any process runs; no code from the package runs, is imported or is installed; archive entries are validated (links, traversal, collisions, caps) before anything is written; fingerprint verified on every load and the verified in-memory copy is what runs; approval is bound to a fingerprint. Residual, stated: a pinned and approved pack with a subtle prompt can still misdirect the agent; containment is Item 7's question, and first-add and update acceptance are the attack points (P§10, R§6.5).

## 8. Assumptions and open points

Assumed, not settled by a governing document (A§18, P§8):

1. The size caps and fetch timeout (compressed tarball 10 MiB, expanded 20 MiB, 2,000 entries, `package.json` 256 KiB, kept file 2 MiB, 120 s) are constants chosen here.
2. `.delivery/` as the home of vendored packs and the record, with the ignore rule widened (precedent: committed `.delivery/backlog/`).
3. The `delivery-pack` field is required.
4. No approver or timestamp in the record; version control is the audit trail.
5. `--approve <fingerprint>` replaces `--yes`.
6. A hand-edited installed pack is not approvable in place.
7. npm-only source.
8. A run needs no network (an owner-facing reading of "every machine and every run").

Unverified: that `npm pack` of a registry spec runs no lifecycle script without the flag (mitigated by the flag and the spec filter); that `npm` ships with every supported Node install route; whether widening the inspection `source.kind` enum is additive under Item 2's published-keys policy (decided in the plan); where the run record can carry the pack fingerprint (the plan locates it).

Reconciliations made at assembly: two decisions deliberately **supersede** older artefact text, so slicing must not revive it. (a) A§4.3 "not loaded" for a folder with no record entry is superseded by the `unrecorded` refusal, and A§6.3's state table gains `unrecorded`. (b) The parenthetical in A§5.3 step 3 (version and integrity rewritten with approval when the fingerprint is unchanged) is superseded by "no write". P§3 J1 and P§10 mention the publish age of a version on add; P§4 C5 and A§18 put the age display out of this item (no metadata call in the port), so the age display is **not** part of this design. `--as` aliasing and update-all reporting are COULD, not built (A§17); `remove` is the remedy for a clash.

## 9. What this design does not include

Git, tarball-URL, `file:` and local-package sources; signature or provenance verification; pack settings and adapting a pack (Item 4); aliasing an installed pack; publishing and scaffolding (Item 5); code in packs and plugin enabling (Items 7 to 9); bulk update, update nags, an `outdated` listing, a search command; pack dependencies on other packs; editor support for the record (Item 6 may consume the published schema); an organisation allowlist; a hosted registry; any claim that a pack is safe.

## 10. Unresolved critic disagreements

None. Both artefacts were APPROVED by the critic: product design after one REVISE round, architecture after two (`review-log.md`). The two open points raised by spec review (`spec-review.md`) were decided at assembly and are recorded in section 8 and in `review-log.md` under "Assembly decisions".
