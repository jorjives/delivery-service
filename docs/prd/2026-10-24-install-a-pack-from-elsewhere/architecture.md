# Architecture: Install a pack from elsewhere, pinned

Roadmap Item 3 (`docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`, "Item 3: Install a pack from elsewhere, pinned", lines 122-144). Builds on Item 2 (`docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md`; house style `docs/prd/2026-10-23-inspect-a-pack/architecture.md`). Facts about the tree are read from the code at HEAD (file named in each claim). "R§n" cites `research.md` in this folder. Scope is `review-log.md` "Selected phase". Wording the owner reads is the product designer's; this document fixes behaviour, states and data, and says where wording is needed.

## 1. Position in one paragraph

An installed pack is a **vendored folder in the project, pinned by a committed record**. `delivery packs add` fetches a package from the npm registry (no registry of ours), reads it in memory without extracting it to disk, keeps only the pack folder, shows the Item 2 inspection, asks the owner to approve that exact fingerprint, then writes the folder under `.delivery/packs/<name>/` and one entry in `.delivery/packs.lock.json`. Every later command loads installed packs from that folder with no network, and refuses any pack whose content no longer matches the record or whose record is not approved. `delivery packs update` fetches the new version into staging, shows what changed (meaning first, then the text diff), and replaces the folder only on approval. The fetch source is a port with an npm adapter and an in-memory fake, so every behaviour is testable offline. Packs stay data: nothing fetched is executed, imported or installed.

## 2. Constraints and where they come from

| Constraint | Source |
|---|---|
| A pack can be added from a public source, not only a local folder | Roadmap Item 3, criterion 1 (line 128) |
| The version is recorded; later runs use it until a deliberate update | Item 3, criterion 2 (lines 129-130) |
| The owner sees what changed on update | Item 3, criterion 3 (line 131) |
| A pack changed since approved is refused until the owner approves the change | Item 3, criterion 4 (lines 132-133) |
| Same workflow name in two packs is reported plainly, as for local packs | Item 3, criterion 5 (line 134); existing sentence `packWorkflowClash`, `src/cli/pack-workflows.ts:6` |
| Discovery uses an existing package ecosystem; no registry is hosted | Item 3 Constraints (line 141); Roadmap "Decisions reversed" (lines 33-38); "Not in this roadmap" (lines 58-61) |
| Start from task-packs COULD 23 (`delivery-pack` package field, `delivery packs add`, trust prompts) | Item 3 Notes (lines 143-144); `docs/superpowers/specs/2026-10-03-task-packs-design.md` lines 151-153 |
| Packs remain data only in this phase | Roadmap Context (lines 16-18); Item 1 Constraints (line 87) |
| Inspection precedes install; prompt injection is the real risk | Roadmap Item 2 Notes (lines 117-118) |
| The folder check is called by install, not by the run-time loader, so existing `/2` packs with a stray file keep running | Inspect spec line 79 and D4 (line 183) |
| Install's record is the input to later comparison; `--json` was built for it; compare-two-versions belongs to Item 3 | Inspect spec line 127, C2 (line 69), section 11 (line 192) |
| "Archive formats arrive with install" | Inspect spec line 143 |
| Workflow-name clash reporting stays in the loader until install | Inspect spec line 200 |
| "Record the manifest hash and version ... re-ask on change" for packs from elsewhere | Task-packs spec lines 782-783 and 863-864 |
| No hosted registry; distribution is folders and npm packages | Task-packs spec lines 860-861, 893, 935-936 |
| Item 8 reuses "version is recorded, updating shows what changed" for plugins, so the record and diff must not be pack-specific in shape | Roadmap Item 8 (lines 245-256) via R§0 |
| Item 5 requires "a published pack installs (Item 3) with no extra steps"; Item 3's package layout is Item 5's publish contract | Roadmap Item 5 (line 184) |
| Sessions run with permissions bypassed, so a pack's words run with all the agent's powers | `src/agent-invoke.ts:246-247`; Inspect spec line 15 |

Not constraints (current behaviour or assumption only, no governing document): the byte and entry caps in 7.3; `.delivery/` as the home of the vendored folder and record (precedent: `.delivery/backlog/` is committed, `src/run-location.ts:64-68`); the `delivery-pack` field being required; the `--approve <fingerprint>` flag form. These are decisions in section 3, flagged in section 18.

## 3. Decisions

Each is a right-choice check, not the easy choice.

- **D1. Source: the npm registry only, by registry spec.** Meets the constraint (existing ecosystem, versions immutable once published, R§4.1). Git and plain-archive sources are not built: git adds clone hardening and a mutable-tag story (R§4.2), an archive adds trust-on-first-use with no ecosystem to search. The port (4.1) keeps them addable. A git, tarball-URL, `file:` or directory spec is refused (7.1), because npm runs `prepare` for them (R§4.1, S4).
- **D2. Fetch with the `npm` command, not `pacote`, and not our own registry client.** `npm pack --ignore-scripts` fetches the existing tarball and uses the owner's own npm configuration (private registry, scopes, proxy) for free. `pacote` has 17 direct dependencies and an `engines.node` narrower than this repo's `>=22` (R§5). A hand-written registry client would reimplement authentication and configuration. Cost: `npm` must be on PATH; absence is a plain error, and no run needs it (section 9).
- **D3. Read the tarball in memory; never extract it to disk.** The `tar` library's streaming parser reports entries; our code validates each, keeps only the pack folder's regular files, and writes them itself to staging. No library writes to the filesystem on untrusted paths, so path traversal, links and modes are our validation of values, not an extraction library's defence. `tar` is bought for parsing only (the one part of this that is a commodity and easy to get subtly wrong).
- **D4. The pack lives vendored in the project, committed.** Chosen over a cache outside the repo: the folder is reviewable in a pull request, identical on every machine with no fetch, and loads through the same reading code as a local folder. A cache would need a restore step on every fresh clone and a network at run time, which fails "the same pack on every machine and every run" whenever the registry is down. Cost: prompt files in the repository; accepted (a pack is a few text files).
- **D5. The record is a separate committed file, `.delivery/packs.lock.json`, not `delivery.config.json`.** The config may be code (`.js`), and `ConfigLookup.dataOnly` already treats non-JSON config as unreadable as data (`src/cli/config.ts:506-512`); a command cannot safely rewrite it. A separate file also leaves the `packs` key, config schema and Item 6's editor schema untouched. The record is the list of installed packs: no second entry in config is needed. Installed packs load in addition to `packs` folders.
- **D6. The approval key is the pack fingerprint (`Pack.hash`), not the version and not the tarball hash.** `version` is author-asserted and not tied to content (R§1.3). `Pack.hash` is what the owner sees in the inspection and covers exactly what runs (manifest and prompts). The tarball `integrity` is transport and provenance: recorded, and checked on restore, never the thing approved. Fingerprint is recorded with an algorithm label (`delivery.pack-hash/1:`), because the hash order differs by format and `upgradeV2` exists (R§6.9).
- **D7. Approval is bound to a fingerprint.** Interactive: the inspection is shown, then a confirmation. Non-interactive: `--approve <fingerprint>` must equal the fetched one. This cannot approve content other than what was reviewed. It differs from the estate's `--yes` in `packs check` (`src/cli/packs-check-command.ts:11`) on purpose: `--yes` there guards fixture execution of a folder the owner already holds; here an unattended "yes" would approve unseen prompts, the very risk Item 2 exists for.
- **D8. No named approver and no timestamp in the record.** The commit that changes the file is the audit trail (author, time, review); a clock in the file would make output vary between runs of the same input. Nothing governing requires them (R§8.9). Flagged in section 18.
- **D9. A hand-edited vendored folder is not approvable in place.** The only ways forward from a changed folder are `restore` (re-fetch the recorded version, integrity-checked) and `update`. Approving local edits would mean a pack that matches no published artefact; an owner who wants to change a pack uses a local folder in `packs`. Keeps the state machine small (6.3).
- **D10. Name identity is the manifest `name`.** It is already the project's identity for a pack (the `<pack>:<workflow>` prefix, `builtInPackClash`, `src/cli/pack-workflows.ts:8,20-37`). The record is keyed by it, so two installed packs cannot share a name by construction. The npm package name is recorded beside it. A clash is found at `add` (before anything is written) and again at load. Aliasing an installed pack to another name is not built (section 17).
- **D11. Package layout: a `delivery-pack` field in the package's `package.json`, required.** Value is the path of the pack folder inside the package (`"."` or `"packs/review"`), per COULD 23. Required, so that adding a random npm package is refused with a reason instead of failing on a missing manifest; also the signal for discovery (`npm search keywords:delivery-pack`, documented, nothing built). `package.json` is read in memory as data, and is not kept.

## 4. Components

### 4.1 The fetch port

```ts
/** What the owner asked to install: a registry package name and an optional version, range or tag. */
interface PackageSpec { name: string; request: string }          // request: "latest" | "1.2.3" | "^1.2" | tag

interface FetchedPackage {
  name: string;          // npm package name as the source resolved it
  version: string;       // exact version
  integrity: string;     // SRI string for the tarball, as the source reports it
  tarball: Uint8Array;   // the tarball bytes, already held in memory (cap in 7.3)
}

interface PackSource {
  fetch(spec: PackageSpec): Promise<FetchedPackage>;   // throws PackSourceError
}
```

- The port returns bytes; reading them is a separate pure step (4.2). So the fake needs no filesystem and the adversarial tests are bytes in, refusals out.
- **npm adapter** (`src/packs/install/npm-source.ts`): runs the `npm` named by `DELIVERY_NPM` or `npm` (the `DELIVERY_TEST_SYSTEMCTL` precedent, `CONTRIBUTING.md` lines 60-63) through `execFile` with an argument list and a cleaned environment, in a fresh empty scratch folder (so no project `.npmrc`, `package.json` or workspace can steer it; the owner's user-level npm configuration still applies). It runs `npm pack <name>@<request> --json --ignore-scripts --pack-destination <scratch>`, reads the reported `name`, `version`, `integrity` and file name, reads the tarball into memory, recomputes SHA-512 itself with `node:crypto` and refuses on mismatch with what npm reported, and removes the scratch folder. Timeout and output bounds are set.
- **Fake** (`src/packs/install/fake-source.ts`, exported from `src/testing.ts` beside `fakeAgentPort`, `CONTRIBUTING.md` line 101): an in-memory registry `name -> version -> files`, builds tarball bytes with the same `tar` library, resolves `latest`, exact and range requests, and can be told to return a wrong integrity, an unreachable error, a mutated version (same version, different bytes) or a hostile archive.
- **Contract suite** `src/packs/install/pack-source.contract.ts`, excluded from the build as `backend.contract.ts` is (`CONTRIBUTING.md` line 68). Every adapter test file adds one `packSourceContract(...)` call. The npm adapter runs it against a real `npm` pointed (`npm_config_registry`) at a throwaway local HTTP server that serves a packument and tarballs, so the real client is tested offline.

### 4.2 Reading a package

Pure, in `src/packs/install/package-archive.ts`: `readPackage(bytes) -> { ok: true; metadata; packFiles; ignored } | { ok: false; problems }`.

- Streams entries through the `tar` parser (decompression and header parsing only; nothing written).
- Entry rules in 7.3. Strips the single leading `package/` folder npm adds.
- Parses `package.json` as JSON with a size cap; requires the `delivery-pack` field (D11); validates it as a relative, normalised path inside the package.
- Keeps the regular files under that path, relative to it, whichever layout the publisher chose, so the same pack content gives the same vendored folder and fingerprint. With `"delivery-pack": "packs/review"` files outside that folder are dropped. With `"."` the pack folder is the package root: `package.json` is dropped (it is metadata, read in memory) and every other file is held to the closed set, so README, licence and changelog files are kept (they are outside the fingerprint, which covers manifest and prompts only), and any other file (source, tests, `.npmignore`) is refused; a publisher who wants extras uses a subfolder or the package's `files` list. Everything outside the pack folder is counted in `ignored` (names and sizes), not kept, not read, and reported to the owner as "in the package, not part of the pack". A package declaring `scripts`, `bin` or `dependencies` is reported the same way: delivery-service does not run or install them.
- Then the kept files are written to staging and **the existing `readPackFolder` runs on staging**, so the same closed set as inspection applies (inspect spec D4, section 5.1). One refusal path, no second parser.

### 4.3 The installed-pack store and record

`src/packs/install/lock.ts`: reads, validates (zod, like the pack format) and writes `.delivery/packs.lock.json`; one reader for the whole product. Writes are `atomicWriteJson`-style (`src/journal.ts:25-37`) under `proper-lockfile` (already a dependency; `src/repo-lock.ts` precedent), keys sorted, so two machines produce the same bytes and diffs are small.

`src/packs/install/store.ts`: the vendored folder `.delivery/packs/<name>/`. Replaced by writing a staging folder inside `.delivery/packs/.staging/` (same filesystem), then renaming it into place. Two paths cannot change in one atomic step, so the order is fixed: **folder first, record last** (the record is written with an atomic rename). A crash before the folder rename leaves the old state plus a staging folder that is ignored and removed on the next use. A crash between the two writes leaves the new folder with the old record: on `update` the pack is next reported `changed` (fingerprint differs from the record), refused safely, and recovered by `restore` (back to the approved bytes) or by running `update` again; on `add` the folder has no record entry, so it is not loaded, and running `add` again replaces it. The record is therefore never ahead of the folder.

### 4.4 Loading installed packs (the seam)

`projectPacks(config, configDir)` (`src/cli/pack-workflows.ts:15-17`) returns built-ins then listed folders. It gains the installed packs: built-ins, listed folders, installed packs, in that order. It needs the repository root (the record is at `<repo>/.delivery/`), which `loadConfigAndPacks` already has as `lookup.repoPath` (`src/cli/config.ts:544-549`); `projectPacks` takes it as a parameter. Every command that resolves workflows already goes through this seam (R§1.1), including `delivery packs`, `review`, `run` and `inspect <name>`. No second path.

`loadInstalledPack(entry)` performs, in order, and stops at the first failure for that pack (all packs' failures are collected and shown together):

1. The folder exists (else state `missing`).
2. `readPackFolder` succeeds (closed set + strict format). A stray file or a link added by hand is refused (state `invalid`).
3. The manifest `name` equals the record's key.
4. `delivery.pack-hash/1:` + `Pack.hash` equals `entry.fingerprint` (else state `changed`).
5. `entry.approved` equals `entry.fingerprint` (else state `unapproved`).

The returned `Pack` holds the prompt text in memory (`WorkflowConfig` embeds it, `src/packs/manifest.ts:217,221-224`), so what was verified is what runs; the folder is not read again during a run. A session that edits the vendored folder mid-run (the agent has the repository) is caught at the next load. `withWorkflowsOf` (`pack-workflows.ts:20-37`) then applies the existing name-clash rules to the whole set.

`Pack` gains `origin` (`{ kind: "folder" } | { kind: "installed"; package; version; request }`), set only by the installed loader. The Item 2 inspection's `pack.source.kind` widens to `"installed"` (R§1.4); `pack-inspection-published-keys.txt` and the schema version policy of Item 2 section 8 apply (additive key, minor within `/1`, or `/2` if the project's rule says an enum widening is breaking; decided in the plan against the existing published-keys test).

### 4.5 Comparing two versions

`src/packs/install/compare.ts`, pure: `comparePacks(before: Inspection, after: Inspection) -> Change[]` over two Item 2 `Inspection` documents (stable, versioned JSON, `src/packs/inspection.ts:291-314`). It reports, per workflow: added, removed, kind changed, prompt changed (yes/no; text in the diff), guards added or removed, hold changed, hold removed (a flagged direction), `after` changed; and flag changes: findings gained or lost, `widens` false to true. Ordering is fixed. Each change has a `direction` (`narrower`, `wider`, `neutral`) from the same typed table idea as `src/packs/widening.ts`, so the update screen can lead with "this version removes the hold on `fix`". The wording of each is the product designer's.

The text diff is the second layer: `git diff --no-index --no-ext-diff --no-textconv --no-color` between the old folder and the staged folder, run through `src/git-exec.ts` (git is already a hard dependency, R§2), with the working folder set to a parent of two sibling folders so paths print short. Every output line passes through the existing hidden-character escaper (`src/packs/hidden-characters.ts`, `inspection` M3) before it is printed; a changed prompt that adds a right-to-left override is thereby visible in the diff. Files outside the fingerprint (fixtures, documentation) appear in the file list (added, removed, changed, sizes), labelled "not read when the pack is used", with the text diff available for them too.

### 4.6 Commands (`src/cli/packs-*-command.ts`, wired in `program.ts` beside `packs check`)

| Command | Does | Writes |
|---|---|---|
| `delivery packs add <package>[@request] [--approve <fingerprint>]` | fetch, read, check clashes, inspect, approve, install | folder + record |
| `delivery packs update <name> [@request] [--approve <fingerprint>]` | fetch into staging, compare, approve, replace | folder + record |
| `delivery packs restore <name>` | re-fetch the recorded version; require recorded integrity; replace folder | folder |
| `delivery packs remove <name>` | delete folder and record entry | folder + record |
| `delivery packs approve <name> [--approve <fingerprint>]` | for state `unapproved` only: inspect current folder, confirm, set `approved` | record |
| `delivery packs` (existing) | lists installed packs with version and state | nothing |

`add` and `update` with `--json` print one document (the inspection, the changes, the outcome) and require `--approve` (no prompt can be asked). `update <name>` with no request re-resolves the request recorded in the entry. `update` never changes the recorded `request` unless one is given. Exit 0 on success or a declined approval (nothing written, as `packs check` treats a declined trust, `src/cli/packs-check-command.ts` comment on exit codes); exit 2 on any refusal (the estate's configuration code, `src/cli/failures.ts:31-38`).

## 5. Flows

### 5.1 Add

1. Validate the spec (7.1). Refuse non-registry forms before running anything.
2. If the record already has an entry for that package: at the same fetched fingerprint, report "already added, nothing to do" and exit 0 without writing; at a different fingerprint, refuse and point to `update`.
3. `source.fetch(spec)`. Compare reported integrity with our own SHA-512.
4. `readPackage` then write staging then `readPackFolder`. Any problem: refuse, all problems at once, nothing kept, nothing shown (the Item 2 rule: no partial account).
5. Clash check against built-ins, listed folders, installed packs and the project's own workflows, using `withWorkflowsOf` over the would-be set. A clash refuses with the existing sentences, extended to name both sources (6.4). Nothing written.
6. Item 2 inspection of the staged pack, printed (no new renderer; `source` line says package, exact version, integrity).
7. Approval (D7). Declined or unavailable: remove staging, exit 0 or 2 per 4.6.
8. Call `prepareDeliveryDir` (so `.delivery/.gitignore` has the widened rule in projects created before this item), replace the folder, then write the record entry (order in 4.3). Print the exact version and fingerprint recorded and the files to commit (`.delivery/packs.lock.json`, `.delivery/packs/<name>/`).

### 5.2 Run (any command that loads packs)

No network, no `npm`, no `tar`. `loadInstalledPack` (4.4). A failure refuses the command that needed workflows, naming the pack, its state and the one command that fixes it (`restore`, `update`, `approve`, `remove`). It does not silently skip the pack or fall back to anything.

### 5.3 Update

1. Resolve the request (recorded, or given).
2. Fetch into staging; same steps 3-4 of add.
3. If the fetched fingerprint equals the recorded one: report "already at this content" and write nothing, even if the version differs (the record is updated only for version/integrity if the owner confirms, otherwise untouched; decided: version and integrity are rewritten only with approval, so the record never says a version the owner did not see).
4. Clash check (5.1 step 5).
5. Show, in order: the one-line identity change (version, fingerprint); `comparePacks` changes with direction; flags gained or lost; the file list change; then the text diff. Findings the new version gains (Item 2's flags) are printed inline after the change summary; `--full` prints the whole inspection of the new version inline. Staging is removed when the command ends, so nothing printed points at it; after install, `delivery packs inspect <name>` shows the installed pack.
6. Approval bound to the **new** fingerprint. Then replace the folder, then write the record (`version`, `integrity`, `fingerprint`, `approved`), in the order and with the crash behaviour of 4.3.

### 5.3a How criterion 4 is met

Roadmap criterion 4: "a pack that has changed since the owner approved it is refused until they approve the change". Meaning here: any pack whose content differs from what was approved is refused at load (states `changed`, `unapproved`, 6.3). The change is approved through `update` (the owner sees what changed against the installed copy, then approves the new fingerprint), or `restore` returns the folder to the approved bytes. A change made in place (hand edit, merge damage, an agent session) is never approved where it stands (D9): there is no approved basis to show a diff against offline, and an approvable in-place edit would be a pack matching no published artefact. `approve` exists only for a record whose own `approved` field lags its `fingerprint`.

### 5.4 Restore, remove, approve

- **Restore:** fetch the recorded `name@version`; the fetched integrity must equal the recorded `integrity` and the resulting fingerprint the recorded one; else refuse (`PackChangedAtSource`, a published version that moved: the registry's guarantee was broken, worth stating plainly). Replaces the folder. No approval needed: it re-creates what was approved.
- **Remove:** deletes folder and entry (folder first, then record, the reverse of install: a crash leaves the entry `missing`, refused safely, and `remove` run again completes). Offered as the remedy for a clash. Refuses (exit 2, nothing changed) while the project's configuration still names a workflow of the pack, after listing the workflows that would stop existing (the project's own `workflows` and `tasks` are read through the same config seam as a run).
- **Approve:** only for `unapproved` (record says `approved` differs from `fingerprint`, which arises from a hand-edited or badly merged record); full inspection, confirmation, set `approved := fingerprint`. A pack in state `changed` is refused: restore or update (D9).

## 6. Data model

### 6.1 The record: `.delivery/packs.lock.json`

```
{
  "schema": "delivery.packs-lock/1",
  "packs": {
    "<manifest name>": {
      "source": "npm",
      "package": "@scope/name",
      "request": "^1.2.0",                 // what the owner asked for; the default is "latest"
      "version": "1.2.3",                  // exact; the only thing runs use
      "integrity": "sha512-...",           // tarball, as the registry reported and we verified
      "fingerprint": "delivery.pack-hash/1:<64 hex>",   // of the vendored folder
      "approved": "delivery.pack-hash/1:<64 hex>"       // the fingerprint the owner approved
    }
  }
}
```

- zod strict object; `source` is a literal `"npm"` today so that a later source adds a member (discriminated union) without migrating existing entries (Item 8 reuse, roadmap lines 245-256, can add `kind`).
- JSON Schema generated from the zod source, `publishedKeys` file and a stability test, as for the pack format and the inspection (`src/packs/pack-published-keys.txt`). It is published because editors, CI and Item 8 read it.
- A record with an unknown `schema` is refused in the same shape as a newer pack format (`newerFormat`, `src/packs/manifest.ts:238-239`): upgrade the harness.
- Absent file means no installed packs; it is not created until the first add. `.delivery/.gitignore` (`DELIVERY_IGNORE`, `src/run-location.ts:64-68`) is rewritten on every `prepareDeliveryDir`; it changes to keep `packs/`, `packs/**` and `packs.lock.json` beside `backlog/`, so the committed files are not ignored. This is a deliberate edit to an existing rule, with a test (`!` rules for both). `.delivery/` is mostly harness scratch (runs, locks), but it already holds one committed thing, the backlog, which sets the precedent that the project's own durable files live there beside ignored state; one visible home for harness-managed project data beats a second top-level folder. The rule is rewritten only when `prepareDeliveryDir` runs, so `add` and `restore` call it first; a project that never ran it has no `.delivery/` and gets it created. Product design agrees (`product-design.md`: vendored copy and record under `.delivery/`, committed, visible in a pull request).

### 6.2 The vendored folder

`.delivery/packs/<manifest name>/` holds exactly the pack folder from the package, as `readPackFolder` accepts it. `package.json` is not kept. Names are `Slug`-safe (`src/packs/pack-format.ts:19`), so a manifest name cannot be a path.

### 6.3 States of an installed pack

| State | Meaning | Load | Ways out |
|---|---|---|---|
| ok | folder valid, fingerprint equals record, approved equals fingerprint | loads | update, remove |
| missing | folder absent | refused | restore, remove |
| invalid | folder fails `readPackFolder` (stray file, link, bad manifest) | refused | restore, remove |
| changed | folder valid but its fingerprint is not the record's | refused | restore, update, remove |
| unapproved | record's `approved` differs from its `fingerprint` | refused | approve, update, remove |

### 6.4 Clash reporting

The loader keeps its three existing sentences (`src/cli/pack-workflows.ts:6-12`). Two gaps (R§1.5) are closed: the pack-vs-pack clash names **both** origins (a local folder path, or `package@version`), and a pack name used twice (installed vs listed folder, installed vs installed) is reported as a pack-name clash with the existing wording pattern of `builtInPackClash`, not only via a shared workflow name. The remedy sentence differs by origin: for a local folder "rename"; for an installed pack "remove it (`delivery packs remove <name>`) or rename your own". Exact words: product designer.

## 7. Fetch isolation and security

### 7.1 Spec validation (before any process runs)

The spec is `[@scope/]name[@request]`. Accept a registry name (the npm name grammar) and a request of exact version, range, or tag. Refuse anything else, by shape: any `:` (so `git+`, `file:`, `http:`, `github:`), a `/` other than the scope separator (so `user/repo`, paths), a leading `.` or `~`, whitespace, NUL, a leading `-` (so a spec cannot be read as an option). The spec is passed after `--`.

### 7.2 No code runs on fetch

- `npm pack` of a registry spec downloads the published tarball and does not run lifecycle scripts; `--ignore-scripts` and `npm_config_ignore_scripts=true` are set anyway, and the spec filter excludes the git and directory forms that run `prepare`/`prepack` (R§4.1; the claim that a registry `npm pack` runs no script is UNVERIFIED by us without the flag, hence the flag).
- The tarball is never extracted by npm or by us as a tree (D3), never imported, `require`d, or executed. `package.json` is parsed as JSON. `pack.json` is parsed as JSON and zod-checked. Prompts are read as UTF-8 text.
- Fixtures inside the pack are not run at add or update. `delivery packs check` keeps its own trust confirmation (R§1.4). Inspection executes nothing (Item 2 section 7).
- `dependencies` of the package are never fetched (`npm pack` does not install them).
- The data-only rule needs no new code: the strict pack format already refuses any key that could carry a tool, command or code (`DATA_ONLY`, `src/packs/manifest.ts:110-111`), and the closed set refuses any script file in the folder (`NOT_IN_A_PACK`, `src/packs/pack-folder.ts:116,206`).

### 7.3 Archive entry rules (4.2)

Refused, whole package, with the entry named: an entry that is not a regular file or a directory (symlink, hardlink, device, FIFO, anything else); a path that is absolute, contains `..`, a backslash, a NUL, a drive prefix, or normalises to a different string; two paths that collide when case-folded; a path outside the single `package/` root npm writes. Caps, enforced while streaming so a bomb is stopped, not unpacked: compressed tarball 10 MiB; expanded 20 MiB; 2,000 entries; `package.json` 256 KiB; any kept file 2 MiB. **These numbers are assumptions** (no governing document); they are constants with the refusal message stating the cap, and tests pin the behaviour at the boundary. A pack legitimately larger than these is a signal worth a human decision, not a silent success.

### 7.4 Threats and controls

| Threat | Control |
|---|---|
| Prompt injection in a shared pack (the primary risk) | Mandatory Item 2 inspection before approval; approval bound to the fingerprint; update diff leads with meaning and shows changed text with hidden characters made visible. Not claimed solved: output keeps Item 2's "not a guarantee" notice. |
| Version republished or registry serves different bytes | Exact version + recorded integrity + fingerprint; restore refuses any mismatch. npm versions are immutable (R§4.1); the record detects a violation anyway. |
| Malicious new version (account takeover) | Never picked up silently: runs use the record only; update is deliberate and shows the change before the fingerprint is approved. Owner may set `min-release-age` in their own npm configuration; the adapter does not override it. |
| Lifecycle scripts, native code in the package | Never run (7.2); files outside the pack folder are dropped and reported; script files inside the folder are refused by the closed set. |
| Path traversal, links, bombs in the archive | 7.3; nothing written until entries validated; writes only to staging paths composed from validated relative names. |
| Typosquatted or impersonating package | Name shown prominently in the approval; manifest name and package name both shown; clash with an existing pack name refused. Not preventable beyond that (R§6.4); stated in the docs. |
| Spec injection into the `npm` command line | 7.1; `execFile` with an argument list and `--`; no shell. |
| Tamper after approval (by hand, by the agent in its session, by a merge) | Fingerprint verified on every load (4.4); the loaded `Pack` is the verified in-memory copy. |
| Hash algorithm drift between harness versions | Algorithm labelled in the record; golden-vector tests pin `delivery.pack-hash/1` for `/2` and `/3` packs including the shared-prompt double-hash order (R§1.3). A harness that changes the algorithm adds `/2` and keeps `/1`. |
| Secrets sent to the registry | None sent by us; the owner's npm configuration decides what npm authenticates with (a documented consequence of D2). |
| Concurrent `add` in two shells | `proper-lockfile` around the record read-modify-write; staging names are random. |

Residual, stated: a pinned approved pack with a subtle prompt can still misdirect the agent. Containment of the agent is Item 7's question, not this one's (inspect spec section 11).

## 8. Error model

Typed errors in `src/errors.ts` style (`code`, fields), each with a plain rendering in the exhaustive switch in `src/cli/failures.ts` (`renderKnown`; a new class does not compile without it, `failures.ts:105-109`). Pack problems use the existing `PackProblem` (`{ file, field, message }`). All map to exit 2 except an unexpected fault (exit 1).

| Error | Raised when | Exit | Remedy named |
|---|---|---|---|
| `PackSpecRefused` | 7.1 | 2 | the accepted forms |
| `PackSourceUnavailable` | `npm` missing, network down, registry error, timeout, package or version not found (`reason` field) | 2 | check network or name; installed packs still run |
| `PackArchiveRefused` | 7.3, no `delivery-pack` field, bad path | 2 | the entry and rule |
| `PackIntegrityMismatch` | our hash differs from npm's report, or from the record on restore | 2 | retry; if it persists, the published version moved |
| `InvalidPack` (existing) | `readPackFolder` problems on staging | 2 | per problem |
| `PackNotApproved` | non-interactive without `--approve`, or `--approve` differs from fetched fingerprint | 2 | rerun with the fingerprint printed |
| `InstalledPackRefused` | load states `missing`, `invalid`, `changed`, `unapproved` (6.3), `state` field | 2 | the one command for that state |
| `PackLockInvalid` | record unreadable, wrong schema, newer schema | 2 | file and field |
| `Refusal` clash errors (existing, extended) | 6.4 | 2 | rename or remove |

A failure before the folder is replaced (spec, fetch, archive, integrity, clash, declined approval) leaves the project exactly as before: staging is removed in `finally`. A crash between the folder and record writes (4.3) leaves the state described there, never an approved-looking mismatch.

## 9. Offline behaviour

- **Run, review, inspect, packs list, validate:** no network, no `npm`, no `tar`. They need only the committed files. A machine that has never reached the registry runs an installed pack identically to the machine that installed it. This is the design's answer to criterion 2 on every machine.
- **add, update, restore:** need `npm` and the registry. Offline they fail with `PackSourceUnavailable` and change nothing. A failed update never stops existing runs.
- **Fresh clone:** the vendored folder arrives with the repository. If `.delivery/packs/` was dropped by an ignore rule, the pack is `missing` and `restore` re-fetches it with integrity checked.

## 10. Configuration and schema changes

- `delivery.config.json`: **none**. `packs` stays a list of local folders (`src/cli/config.ts:209`). No new config key.
- New published schema `delivery.packs-lock/1` (6.1) with published-keys file.
- Item 2's inspection schema: `pack.source.kind` gains `"installed"` with `package`, `version`, `integrity` (4.4).
- `.delivery/.gitignore` rule widened (6.1); `add` calls `prepareDeliveryDir` so projects created earlier get it.
- `delivery packs --json` rows gain `origin` and `state` (additive).
- Changeset: minor (new commands, new file, additive schema).

## 11. Non-functional requirements

Measured by tests where a number is given.

- **Determinism:** same inputs produce byte-identical record, vendored folder and `--json` output (sorted keys, fixed ordering, no timestamps or machine paths in either file).
- **Run-time cost:** loading N installed packs reads only local files; no process is spawned. Test: process spawning mocked to fail on any run-path command.
- **Crash safety:** the record is never ahead of its folder. A crash leaves either the old state, or a state that is refused safely at load (`changed` after an update, an unrecorded folder after an add, `missing` after a remove) and recovered by `restore`, `update`, a repeated `add` or a repeated `remove` (4.3, 5.4). Test: a failure injected between each step of add, update and remove; after each, the next load either works on the old state or refuses with the named state, and the named command restores a loadable project.
- **No network on load:** test with the source port replaced by one that throws.
- **Bounded resources:** caps in 7.3; fetch timeout (120 s, assumption) and output bound.
- **Compatibility:** projects without the record behave as today (record absent is the empty set); `/2` packs install with the closed set applied (it applies to install, not to the run-time loader for local folders).
- **Portability:** Node >= 22 (`package.json` engines), no `pacote` engine narrowing.
- **Accessibility and language:** British English, plain sentences, no colour carrying meaning; inherits Item 2 rules (inspect spec M11).

## 12. Telemetry

None. The product emits no telemetry today and Item 2 chose none (inspect spec section 3). Observable evidence stays in the repository: the record, the vendored folder and git history. The run record gains the installed pack's name, exact version and fingerprint (SHOULD): this is what "later runs use that version" is checked by afterwards. Where in the run record it goes is not verified here (a grep of `src/cli/` finds no run-record field for the pack hash; `src/cli/pack-check.ts:109` reports it only for `packs check`); the plan locates it.

## 13. Testing strategy (red first, intended behaviour)

All offline, through existing machinery (`CONTRIBUTING.md` lines 15-23, 36-68): in-process commands via `CommandContext`; the fake source; the scripted agent only where a claim concerns a run.

- **Criterion 1, add:** fake source with a valid package; `add --approve <fp>` writes the folder and entry; the pack appears in `delivery packs` and `delivery review <name> --preview` shows its workflows. Package without `delivery-pack`, with a non-registry spec, with a link entry, with `../` path, with a script file in the pack folder, with a stray file: each refused with the file named and nothing written (snapshot of the project tree before and after).
- **Criterion 2, pin:** after `add`, publish a newer version to the fake and a mutated copy of the same version; `delivery run`/`review` loads the recorded bytes; with the source replaced by one that throws on any call, every run-path command still works. Fresh clone simulated by copying the two committed paths only.
- **Criterion 3, update:** fake v1 to v2 with prompt text change, a removed hold, a new guard, a new hidden character, an added fixture file: `comparePacks` lists each with direction; the rendered text leads with the hold removal; the text diff escapes the hidden character; declining writes nothing; a v2 with identical fingerprint writes nothing.
- **Criterion 4, changed since approved:** edit one byte of a vendored prompt: load refuses with state `changed` naming the pack and `restore`/`update`; `restore` repairs it; edit the record's `approved`: `unapproved` until `approve`. A stray file and a link in the vendored folder: `invalid`. Agent-written edit during a scripted run: the run continues on the in-memory copy, the next load refuses.
- **Criterion 5, clash:** installed pack whose workflow name equals a local pack's, a built-in's, the project's own workflow, and another installed pack's: each reported with both origins; `add` writes nothing in those cases; load also refuses if the clash arises later. `remove` clears it.
- **Approval binding:** `--approve` with a wrong fingerprint refused; interactive decline writes nothing; no `--approve` and no TTY refused (the `packs check` precedent, `src/cli/packs-check-command.ts:11`).
- **Fingerprint stability:** golden vectors for `/2` and `/3` packs (and a shared prompt) fix `delivery.pack-hash/1`.
- **Archive safety (pure tests, bytes in):** each rule in 7.3 at and over its cap, including a compression bomb that is stopped before it is expanded; case-fold collision; duplicate entries.
- **Adapter contract** (`packSourceContract`): resolves latest, exact, range; unknown package and version; unreachable; wrong integrity; same-version-different-bytes. Run on the fake always, and on the npm adapter against the local HTTP registry with a real `npm`. A package carrying `postinstall` that writes a marker file: the marker never exists after `add`. A spec such as `github:x/y` never reaches the process (spawn mocked to fail).
- **Record:** schema validated, published-keys test, unknown and newer schema refused, byte-stable rewrite, concurrent `add` serialised.
- **Shown equals run:** the inspection printed at `add` for the staged folder equals the inspection of the loaded installed pack (reuses Item 2's anti-drift test shape).
- **`DELIVERY_IGNORE`:** the `.delivery/.gitignore` it writes ignores run state and keeps the two committed paths (`git check-ignore` in a temporary repository).

Not provable by tests: that a pack is benign, and that the registry is honest on first add (trust on first use is the npm lockfile model, R§4.4).

## 14. Buy-vs-build ledger

| Capability | Decision | Alternative | Rationale |
|---|---|---|---|
| Discovery and hosting of packs | buy: the npm registry; `delivery-pack` field and `keywords` for `npm search` | Hosted registry; git list; our index file | Roadmap constraint (line 141); task-packs lines 893, 935-936 |
| Resolving a request to a version, downloading, registry auth and proxy | buy: the `npm` command via `execFile` (`npm pack --ignore-scripts`) | `pacote` (17 direct dependencies, `engines.node` narrower than ours, R§5); own HTTPS client | Reuses the owner's npm configuration; no dependency or engine change; mirrors the existing `execFile` pattern for git (`src/git-exec.ts`) |
| Tarball parsing (gzip, tar headers) | buy: `tar` (parser only, no extraction) | Own tar parser; system `tar -x` | Header and long-name parsing is a commodity with a security history; using only the parser keeps filesystem writes in our validated code |
| Tarball integrity | reuse platform: `node:crypto` SHA-512 over npm's SRI string | `ssri` | One call; npm's reported value is also kept for comparison |
| Version/range resolution | buy: npm itself (resolution happens inside `npm pack`) | `semver` | We never evaluate a range; we record the exact result |
| Closed-set and strict-format check on fetched content | reuse-estate: `readPackFolder`, `readPack` | Archive-level manifest check | The folder check was built to be called by install (inspect spec line 79); one validation path |
| Showing what a pack will do | reuse-estate: Item 2 `inspectionOf` and renderer | New install-time view | Same facts the owner approved |
| Content fingerprint | reuse-estate: `Pack.hash`, with a labelled algorithm | A second hash of the folder | The owner already sees it; it covers what runs (R§1.3) |
| Comparing two versions' meaning | build, thin: `comparePacks` over two `Inspection` documents with a typed direction table | Generic JSON-diff library; a policy engine | The comparison is over our own format and must classify direction; the typed table follows `widening.ts` |
| Text diff of changed files | reuse-estate: `git diff --no-index` via `git-exec.ts` | `diff`/jsdiff library; own LCS | Git is already required; output escaped by the existing escaper |
| Record format and schema | reuse-estate: zod 4, `z.toJSONSchema`, `publishedKeys` | Hand-written schema; TOML or YAML | Same pattern as pack format and inspection |
| Record writes and locking | reuse-estate: `atomicWriteJson` pattern, `proper-lockfile` | Own lock files | Existing dependency, existing pattern (`src/repo-lock.ts`) |
| Approval prompt | reuse-estate: `@inquirer/prompts` confirm as in `packs check` | Own prompt; a TUI | Existing; fingerprint-bound flag replaces `--yes` (D7) |
| Lockfile-and-verify convention | reuse prior art, not code: npm/Cargo/Terraform committed record + deliberate update + verify on use (R§4.4) | Cache without a record | Convention is universal; Terraform's content hash independent of archive format matches `Pack.hash` |
| Signature and provenance verification | not provided, by decision | `npm audit signatures`, Sigstore | Roadmap excludes signed distribution (line 60); provenance proves origin, not benign content (R§4.5); can be added behind the port |
| Fake registry for tests | build, thin: in-memory fake + local HTTP server | Verdaccio | No service to run; a 40-line server in the test is deterministic |
| Package-name typosquat detection | not provided | Reputation or similarity services | Hosted service; out of scope; mitigated by showing names in the approval |
| Pack settings, aliasing, publishing | out of scope | n/a | Items 4, 5 |

Nothing commodity is hand-rolled without a row above. The two custom rows (`comparePacks`, fake registry) are over our own format and tests.

## 15. Operability / DX

**Environment.** The existing one: the `delivery` CLI and library (Node >= 22, TypeScript ESM, zod 4, git). New runtime need: the `npm` command, only for `add`, `update` and `restore`, which ships with the usual Node distributions (not verified for every install route, R§2). One new runtime dependency, `tar`, used as a parser. No service, no credential of ours, no network at run time.

**Harness.** The project gate (lint, build, vitest) is unchanged and runs all tests offline. New suites follow existing shapes: command tests in process; the fake source exported from `src/testing.ts` for adopters writing their own tests (as `fakeAgentPort` is); a contract suite that every source adapter calls once (as `backendContract`); a real-`npm` test against a throwaway local registry server so the adapter is exercised without the internet.

**Local-run story.** An owner runs `delivery packs add <package>`, reads the inspection, approves, and commits two paths. A teammate pulls and runs; nothing is fetched. An update is a branch with a record change and a folder diff that the owner and reviewers read as an ordinary pull request. A pack author publishes a package with a `delivery-pack` field (Item 5 documents it). CI runs commands without a TTY and so needs `--approve <fingerprint>` for `add` and `update`, and nothing for runs.

**Deploy target.** The npm package `delivery-service`, by the existing changeset flow (minor). Nothing is hosted; the registry is a third party's.

**Failure modes.** Every failure is a plain sentence naming the pack and one next command, never a stack trace (section 8). An interrupted add or update leaves the previous state. A removed `npm`, a downed registry or a deleted registry package never stops a run of an installed pack. A package unpublished later does not matter after install (the pack is in the repository); `restore` would fail with `PackSourceUnavailable`.

## 16. Surfaces touched

New: `src/packs/install/` (port, npm adapter, fake, archive reader, lock, store, compare), `src/cli/packs-add-command.ts`, `-update-`, `-restore-`, `-remove-`, `-approve-`, errors in `src/errors.ts`, renderings in `src/cli/failures.ts`, schema + published-keys file, `docs` additions (packs page, CLI reference, troubleshooting, a worked "install and update" page). Changed: `projectPacks` and `loadConfigAndPacks` (`src/cli/pack-workflows.ts`, `src/cli/config.ts`), clash sentences (`pack-workflows.ts`), `Pack` (`origin`), inspection `source.kind`, `DELIVERY_IGNORE` (`src/run-location.ts`), `src/testing.ts` exports, `delivery packs` rows and hint (`packs-command.ts`), `package.json` (one dependency).

## 17. Not in this item

Git, tarball-URL and local-package sources; signature or provenance verification; settings and adapting a pack (Item 4); aliasing an installed pack to another name; publishing and scaffolding (Item 5); code in packs and plugin enabling (Items 7-9); bulk update across packs, update notifications, `outdated` listing; a search command (npm search suffices); `--as` aliasing (product S1, now COULD) and update with no name reporting all packs (product S4, now COULD); pack dependencies on other packs; editor support for the record (Item 6 may consume the published schema); an organisation allowlist.

## 18. Assumptions and open points

No metadata call: the port has only `fetch`. Showing a version's publish age or "newest is X" for a range or tag would need `npm view <spec> time --json` (feasible, verified by the critic's run) as a second port method and contract case; it is not built, and product-design marks it COULD C5.

For the product designer (wording and states they own): screen order of the update (meaning first, then flags, files, text diff); the sentence per state in 6.3; the clash sentences naming two origins (6.4); the approval question and the `--approve` message; how `packs` lists installed packs and states.

Assumptions no governing document settles, flagged for the operator: (1) the caps and timeout in 7.3 and section 11; (2) `.delivery/` as the home of vendored packs and the record, with the ignore rule widened; (3) `delivery-pack` required; (4) no approver or timestamp in the record (D8); (5) `--approve <fingerprint>` instead of `--yes` (D7); (6) a hand-edited installed pack is not approvable in place (D9); (7) npm-only source (D1). Unverified: that `npm pack` of a registry spec runs no lifecycle script (mitigated by the flag and the spec filter); that `npm` ships with every supported Node install route; whether widening the inspection `source.kind` enum is additive under Item 2's published-keys policy; where the run record can carry the pack fingerprint.
