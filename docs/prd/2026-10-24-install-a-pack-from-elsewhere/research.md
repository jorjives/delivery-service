# Research: Install a pack from elsewhere, pinned (roadmap Item 3)

Researcher: `researcher`. Date: 2026-10-24. Paths are relative to the repo root. `R§n` below means section n of this file. Claims about the repo cite file:line (read on 2026-10-24); claims about the outside world cite a URL in section 9. Where I could not verify something, it is marked UNVERIFIED.

## 0. What the governing documents say (opened and read)

Roadmap `docs/superpowers/specs/2026-10-22-pluggable-architecture-roadmap.md`:

- Item 3 (lines 122-144). Delivers: "A project owner can add a pack published by someone else and get the same pack on every machine and every run." Five criteria (lines 127-134): add from a public source "not only a local folder"; version recorded and later runs use it "until the owner deliberately updates it"; owner "sees what changed when updating"; a pack "that has changed since the owner approved it is refused until they approve the change"; same workflow name in two packs "reported plainly, as for local packs". Dependency: Item 2. Constraint (line 141): "Discovery uses an existing package ecosystem; no registry is hosted." Notes (143-144): task-packs COULD 23 "sketches this (a `delivery-pack` package field, `delivery packs add`, trust prompts). Start from it." Detail level: brief.
- Context (lines 31-38), "Decisions reversed": reverses the CLI/config spec non-goal of a plugin distribution mechanism, promotes COULD 23 into Items 3, 8 and 9, "keeps the hosted-registry non-goal (task-packs spec) and the no-runtime-registry decision (gate and closer specs): discovery goes through an existing package ecosystem, and loading stays explicit."
- "Not in this roadmap" (58-61): "A hosted registry or marketplace; paid or signed distribution". So signed distribution (our own signing scheme) is out of scope; consuming ecosystem signatures is a separate question (R§4.5).
- Phase 1 is data only (line 87, Item 1 constraint "Packs remain data only in this phase"). Code-bearing packs are Item 9 (lines 268-288), behind Item 8 (plugins, "Installing a plugin does not run it; it is enabled explicitly", lines 245-256).
- Item 5 (lines 175-194) depends on Item 3 and says "A published pack installs (Item 3) with no extra steps" (line 184). So Item 3's publish format is the contract Item 5 documents.
- Item 8 (lines 245-256) reuses "The version is recorded, and updating shows what changed" for plugins, so Item 3's record and update-diff should be reusable, not pack-specific.
- Deferred section (420-429): nothing on distribution; it lists answer-only tasks, sandbox backends, dashboard plugins, gate presets.

Inspect spec `docs/superpowers/specs/2026-10-23-inspect-a-pack-design.md` (Item 2, complete):

- Line 15: sessions run with permissions bypassed (cites `src/agent-invoke.ts:246-247`; I confirmed `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true` at `src/agent-invoke.ts:246-247`). Prompt injection is the risk.
- Line 79 and D4 (line 183): the folder check `src/packs/pack-folder.ts` is "called by inspection now and by install (Item 3) later, not by the run-time loader", so existing /2 packs with a stray file keep running.
- Line 127: `--json` is "for tooling and for Item 3's approval record".
- Line 143: "Archive formats arrive with install" (the folder check was built for folders only; tarballs are Item 3's new input).
- Line 148: names prior art "GitHub Actions' 'read the source, pin the commit' (the fingerprint is our commit SHA)".
- Lines 192, 200: Item 3 owns "Install from elsewhere, version pinning, recording approvals, refusing a changed pack, update diffs"; inspect "records nothing". "Compare two packs or versions (belongs to Item 3)" is C2 (line 69). Workflow-name clash reporting "stays in the loader (`packWorkflowClash`) until install" (line 200).

Task-packs spec `docs/superpowers/specs/2026-10-03-task-packs-design.md`:

- COULD 23 (lines 151-153): "Third-party pack discovery and distribution (npm packages declaring a `delivery-pack` field; `delivery packs add`; trust prompts). Packs carrying code modules, behind an explicit trust confirmation."
- Line 782-783: for code-bearing packs, "need a trust confirmation, record content hashes in `review.json`, and re-ask on change."
- Lines 860-861: "npm packages declaring a `delivery-pack` field; `delivery packs` lists built-ins, local paths and installed packages. No hosted registry."
- Line 893 build-vs-buy row: "Pack distribution | Reuse (platform): folders and npm packages | A hosted registry; git submodules | Registry is a non-goal; npm already versions and hosts."
- Line 935-936: "Third-party packs deploy as a folder in a repository or an npm package; nothing is hosted."
- Lines 863-864 (`delivery.pack/1` bullet): "the manifest hash and version are recorded per review, so a result is reproducible and a changed pack is visible."

CLI/config spec `docs/superpowers/specs/2026-09-14-cli-and-configuration-design.md:613` lists "A plugin distribution mechanism" as a non-goal; the roadmap reverses it (above).

Note: `docs/task-packs.md` is the user guide "Review your project"; it is not a design document and says nothing about distribution (it points at `packs` in config at line 123).

## 1. Current code: how a pack is loaded, fingerprinted and inspected

### 1.1 Reference from project config

- `packs: z.array(Written).optional()` in the config schema: `src/cli/config.ts:209` ("Pack folders of the project's own, relative to this file"). The user-facing text: `src/cli/config.ts:294-295` ("a list of folders of packs of your own, relative to this file"). `docs/configuration-reference.md:163-172` documents it.
- Resolution: `projectPacks` (`src/cli/pack-workflows.ts:15-17`) returns built-ins, then `loadPack(resolve(configDir, dir))` for each listed entry. There is no other form: an entry is a path string only. No version, no source, no hash.
- `loadConfigAndPacks` (`src/cli/config.ts:544-549`) is the single seam: finds the config, `projectPacks`, then `withWorkflowsOf`. Every command that needs workflows goes through it (`delivery packs` uses it at `src/cli/packs-command.ts:21`).
- A run pins the prompt: the pack's `WorkflowConfig` (prompt text embedded in `steps[].prompt`) is what runs (`src/packs/manifest.ts:217,221-224`; inspect spec line 138 "The pinned `WorkflowConfig` is what runs").
- `delivery review <name-or-path>`: `resolvePack` (`src/packs/manifest.ts:329-332`): a string containing a separator or starting with a dot is a folder; otherwise a name among the packs (built-in by default). So a path argument bypasses `packs` in config.

### 1.2 Loader

- `readPack(dir)` (`src/packs/manifest.ts:247-302`) reads `pack.json`, checks `schema` against `PACK_SCHEMAS_READ = ["delivery.pack/2","delivery.pack/3"]` (`src/packs/pack-format.ts:8`; current format `PACK_SCHEMA = "delivery.pack/3"` at `pack-format.ts:12`), validates strictly, reads each named prompt once as UTF-8 (`manifest.ts:152-167`, `NOT_UTF8` at 146), builds workflows. `loadPack` (305-310) throws `InvalidPack` on the first problem.
- Unknown keys are refused with `DATA_ONLY` (`manifest.ts:110-111`, used at 117): "a pack holds only data, so it cannot give the agent tools or commands, or bring code of its own for its check". This is the existing "data only" enforcement and it holds for any installed pack.
- A pack in a newer format than the harness reads is refused with `newerFormat` (`manifest.ts:238-239`): "upgrade delivery-service to read this pack". Relevant to pinning: a pinned pack can be refused after a harness downgrade, and a harness upgrade can add formats (the `/2` pack is upgraded in memory by `upgradeV2`, `manifest.ts:272-276`).
- Built-ins: `BUILT_IN_PACKS` is `packs/` beside `src/` or `dist/` (`manifest.ts:135`); `isBuiltInPack(dir)` is true only when the folder is directly inside it (138-140). Built-ins ship in the npm package (`package.json` `files`: `dist`, `packs`, ...).

### 1.3 Fingerprint (`Pack.hash`)

- `packHash(raw, texts)` (`manifest.ts:231-235`): SHA-256 over the raw `pack.json` text, then for each prompt text `"\0"` plus the text. Hex digest.
- Order: a `/2` pack hashes prompts "in the order it wrote them, scan then fix; a /3 pack in the sorted order of its workflow names" (`manifest.ts:297-300`). Two prompts shared by workflows are hashed once per workflow (loop over workflows, not unique prompts). Behaviour to preserve if a recorded hash is to stay valid across harness versions.
- What it does not cover: `fixtures/`, README/licence/changelog, `.git/`, housekeeping files. Only the manifest and the prompts that will run. Those uncovered files are never given to the agent by the engine, but they are in the folder (R§1.4). So `Pack.hash` is a hash of what runs; it is not a hash of the folder.
- Inspection prints it in two 32-character halves (`src/cli/packs-inspect-render.ts:65-66`) and carries it in `--json` as `pack.hash` (`src/packs/inspection.ts:294-303`; also `pack-check.ts:109`). Docs: `docs/packs.md:63` ("the fingerprint changes if any instruction changes").
- The manifest `version` is author-asserted text (`inspection.ts:350`); nothing ties it to the hash. A pack can change prompts and keep `version`. So version alone cannot be the pin; the hash must be.

### 1.4 Folder check and inspection

- `readPackFolder(dir)` (`src/packs/pack-folder.ts:215-237`): refuses a missing folder, a file, no `pack.json`; walks entries without following links (`entriesOf` 155-172); refuses links and special files (`IS_A_LINK`, `NOT_PLAIN`, lines 111-112; top-level link stops the loader being run, 224-225); holds every entry to a closed set (`judge`, 187-207): `pack.json`, named prompts, `fixtures/`, documentation names (`DOCUMENTATION` regex 125), housekeeping (`HOUSEKEEPING` 127), top-level `.git/` allowed (194). Anything else is refused (`NOT_IN_A_PACK`, 116). No size cap (inspect spec line 51, M9).
- The check only reads a folder on disk: no archive handling. An extracted npm tarball or git checkout can be passed to it; a tarball itself cannot.
- `inspectionOf(pack, project, files)` (`src/packs/inspection.ts:342-364`) is pure; builds `Inspection` with `pack.source: { kind: "built-in" | "folder", path }` (`inspection.ts:301,355`). The enum has no kind for an installed pack; Item 3 will need to widen it (and `pack-inspection-published-keys.txt` is a published key list that tests pin; see `src/packs/pack-inspection-published-keys.txt`, 144 lines). UNVERIFIED which test enforces it.
- CLI: `delivery packs inspect <name|path>` (`src/cli/packs-inspect-command.ts`: `isPackPath` then `readPackFolder`). `delivery packs` lists packs (`src/cli/packs-command.ts:38-50`); output lines end "To use a pack folder of your own, list it under packs in delivery.config.json." (line 34).
- `delivery packs check` runs a pack's fixtures against the scripted agent, with a trust confirmation for a pack the user did not write (`src/cli/packs-check-command.ts:11,86-107`), in a "sandboxed environment" that `src/cli/packs-check-command.ts:58-59` states "is not a sandbox against a hostile pack, only against an accidental credential" leak. Prior art for an interactive trust prompt in the estate.

### 1.5 Duplicate workflow names

- `withWorkflowsOf` (`src/cli/pack-workflows.ts:20-37`) throws `Refusal(..., EXIT.configuration, "packs")` with:
  - `builtInPackClash(name, manifestFile)` (line 8-9) when a listed pack has a built-in's name;
  - `builtInWorkflowClash(workflow, builtIn)` (11-12) when the project's own workflow collides with a built-in pack's;
  - `packWorkflowClash(name)` (line 6): "Two things define the workflow "<name>": rename your own workflow, or the pack, so each name is used once."
- Workflow names are `<pack>:<local>` (`manifest.ts:202`). So two packs collide only if they share the pack name (and local workflow name); two installed packs from different publishers with the same `name` is the realistic collision. Gaps for Item 3: `packWorkflowClash` does not name the two sources, and the same pack name listed twice (local folder vs installed) is not detected as a pack-name clash unless one is built-in; it is caught only incidentally via the shared workflow names. With installed packs, the sentence "rename ... the pack" is not actionable (the owner cannot rename a pinned third-party pack without editing it). That is a design question for product-designer, not a fact I can resolve.

### 1.6 Existing plugin loading

`loadPlugin`/`guardMethod` (`src/plugin-loader.ts:21-91`) load custom gates and closers by module path against the repo root and guard calls. Code-only; irrelevant to data packs and out of scope until Items 7-9 (roadmap lines 47-48 and 222-288).

## 2. Does the project already use npm and git tooling?

- Package: `package.json` name `delivery-service`, `bin.delivery`, `files` includes `dist`, `packs`; `engines.node >=22`; `package-lock.json` committed; `.npmrc` sets `install-links=true` (copies `file:` deps; used for `vendor/claude-mock`). `npm test` is the single gate (`package.json` scripts; task-packs spec line 938).
- The project's own `delivery.config.json` reinstalls itself globally via `make reinstall` and checks `$HOME/.local/lib/node_modules/delivery-service/...` (`delivery.config.json` `after` block), so the author's harness is an npm global install. The docs assume both global and project-local installs (`docs/writing-a-pack.md:18-28`, "$(npm root -g)" and "$(npm root)").
- npm is not a declared runtime dependency; the harness needs Node >= 22 only. Node's official distributions bundle npm, but I did not verify that every supported install route does (UNVERIFIED). Local toolchain here: node v24.16.0, npm 11.13.0, git 2.43.0.
- Git is a hard dependency already: `src/git-exec.ts` (`execFile` with a per-folder queue), `src/git-env.ts` (`cleanGitEnv`); task-packs spec line 877 says "git is already a hard dependency". `gh` is used for GitHub (`src/gh.ts`).
- Runtime dependencies (`package.json`): `@anthropic-ai/claude-agent-sdk`, `@inquirer/prompts` (already used for prompts, task-packs spec line 890), `commander`, `proper-lockfile`, `yaml`, `zod`, `@jorj/claude-mock`. No `pacote`, `tar`, `ssri`, `semver` as direct dependencies. (`node_modules` is absent in this worktree, so I read `package.json` and `package-lock.json`: `node_modules/semver` exists in the lockfile at line 4441, transitively; `tar`/`pacote` do not appear as `node_modules/tar` or `"name": "pacote"` entries.)
- CI exists (`.github/workflows/ci.yml`, `docs.yml`, `release.yml`). Release uses changesets (`@changesets/cli`). I grepped `release.yml` for `provenance`, `npm publish` and `id-token` and found none, so I could not confirm whether the project publishes with provenance (UNVERIFIED; it matters only for the project's own package, not for Item 3).
- The only existing "approve" and prompt mechanics: `@inquirer/prompts` confirm in `packs check` (`packs-check-command.ts:98-103`, option to skip with `--yes`, line 11 comment "for a non-interactive run, where nothing can ask").

## 3. Where state would live (facts, not a recommendation)

- The project config file is `delivery.config.json` (JSON, zod, strict-ish; `CONFIG_KEYS` listed at `src/cli/config.ts:21`). `packs` is a list of strings only (config.ts:209). Changing its element type is a config-format change; unknown keys are refused by the config reader (error text lists the keys at config.ts:21; behaviour on unknown keys UNVERIFIED but implied by that message). Editors/other tools also read `delivery.config.json` (Item 6 will publish a schema, roadmap line 214-216: "the project configuration is validated only by its in-code definition").
- Packs already have a published JSON Schema generated from zod (`packSchema`, `pack-format.ts:86`; `inspectionSchema`, `inspection.ts:387-389`; published keys files in `src/packs/`). A new lockfile or record would naturally follow the same pattern (`delivery.<thing>/1` schema identifier).
- A committed lockfile is the convention in every ecosystem surveyed (R§4). The repo already commits `package-lock.json`.

## 4. Package ecosystems and how they pin and verify

### 4.1 npm registry (tarballs)

- `package-lock.json` records per package `resolved` (for the registry: a tarball URL) and `integrity` ("A `sha512` or `sha1` Standard Subresource Integrity string for the artifact that was unpacked in this location"); for legacy v1 git entries the integrity field "is the commit sha" [S1].
- I ran it (npm 11.13.0, `npm pack is-odd@3.0.1 --json --ignore-scripts`): the output gives `shasum`, `integrity` (sha512 SRI), `filename`, `size`, `unpackedSize` and a `files` list with path, size and mode. `npm view is-odd@3.0.1 dist --json` returns `integrity`, `shasum`, `tarball` URL, `fileCount`, `unpackedSize`, and registry `signatures` (ECDSA keyid) before download. So both inspection-before-download metadata and a content hash exist with no code of ours.
- Published versions are immutable: "Registry data is immutable, meaning once published, a package cannot change", and `package@version` can never be reused after unpublish [S2]. Dist-tags (`latest`, etc.) are mutable pointers, so a tag is not a pin; an exact version plus integrity is. A maintainer account takeover can still publish a new version, but cannot alter an existing one.
- npm provenance: `npm audit signatures` verifies registry signatures and Sigstore attestations; npm states provenance "does not guarantee the package has no malicious code" [S3]. Optional; many packages lack it.
- Install-time code execution: `preinstall`/`install`/`postinstall` (and `prepare`, etc.) run on install; for git deps `prepare` also runs before packaging [S4]. `npm pack <spec>` for a git or directory spec runs `prepack`/`prepare` [S4, S5] (for a registry spec it fetches the existing tarball, which I observed by running it with `--ignore-scripts`, so I did not prove script-free behaviour without the flag: UNVERIFIED). `--ignore-scripts` exists (default false) [S6].
- Policy knobs exist: `min-release-age` (default null; "only versions that were available more than the given number of days ago will be installed"), `allow-git` (default "all"; `none` blocks git deps), `before`, `save-exact` [S6]. pnpm: v10 disables dependency postinstall by default; `minimumReleaseAge` defaults to 1440 minutes (1 day) in the version the docs describe; `blockExoticSubdeps` keeps git/tarball transitive deps out [S7].
- Real incidents on this surface: Shai-Hulud worm via install scripts [S8, secondary sources]; ClawHavoc malicious "skills" in the OpenClaw registry (341 of 2,857 audited skills, secondary report) [S9].

Fit: very good for the "existing package ecosystem" constraint; npm is the same ecosystem the harness itself ships in (task-packs spec lines 893, 935). A pack package is a tarball containing `pack.json`, prompts, docs and fixtures; no code needed. Registry-published pack needs the publisher to have an npm account, which is the same bar Item 5 already implies ("A published pack installs (Item 3) with no extra steps", roadmap line 184).

### 4.2 Git (tags, SHAs, URLs)

- Git tags are mutable. GitHub's hardening guide: "Pin references to actions to a commit SHA"; a tag "can be moved or deleted if a bad actor gains access to the repository" [S10]. The tj-actions/changed-files compromise (March 2025) retroactively repointed version tags to a malicious commit; SHA pinning was the recommended mitigation [S11, secondary reports differing on the exact tag range].
- GitHub immutable releases lock a release's tag to a commit and its assets, with an attestation; it is opt-in per repo or organisation [S12].
- Cargo records git deps as `source = "git+URL#<full commit>"` in `Cargo.lock` [S13]. Claude Code plugin marketplaces accept `ref` (branch or tag) and `sha` (full 40-char commit); when both are set it "checks out `sha`" [S14].
- A git source gives the whole repo (history, other files). The pack folder may be a subdirectory (Claude Code's `git-subdir` source uses sparse checkout [S14]). Git fetch by SHA is not supported by every server (CodeCommit noted in [S14]).
- The harness already requires git (R§2), so a git source adds no new binary. What it would add is cloning untrusted repositories: hooks are not run on clone, but `.git/` content and submodules/LFS config come with it. Whether to use `git clone` hardening flags (e.g. disabling hooks, `core.symlinks`) is an architecture question; UNVERIFIED here.

### 4.3 Plain tarball or archive URL

- Claude Code's `archive` source (zip over HTTPS) pins with `sha256` and warns when a fetch helper is used without one [S14]. Cargo checksums the `.crate` file with SHA-256 [S15]. Go's `go.sum` plus the checksum database (a Merkle tree) means "even the author of a module can't move their tags around or otherwise change the bits associated with a specific version from one day to the next without the change being detected" [S16]. That guarantee needs a transparency service; for a bare URL we only get trust on first use plus a recorded hash.

### 4.4 Lockfile and approval conventions (surveyed)

| Ecosystem | What is recorded | When it changes | Verified on use |
| --- | --- | --- | --- |
| npm | version, `resolved`, `integrity` sha512 [S1] | on install/update; lockfile is committed | yes, mismatch aborts (pacote `EINTEGRITY`, [S17]) |
| pnpm | lockfile, optional registry-qualified keys [S7] | on install; "Commit your lockfile" | yes |
| Cargo | exact version; git commit; registry `cksum` SHA-256 of `.crate` [S13, S15] | `cargo update` is deliberate | yes |
| Go | `go.sum` hashes; global sum database [S16] | `go get`; default `-mod=readonly` since 1.16 reports an error rather than editing [S18] | yes |
| Terraform | `version`, `constraints`, `hashes` (`h1:` SHA-256 of contents; `zh:` of the zip) [S19] | only `init -upgrade` selects newer; "Review those changes and commit them" | yes, fails if none match |
| GitHub Actions | pin by full commit SHA; verify it comes from the action's own repo not a fork [S10] | by hand | n/a (git object model) |
| Claude Code plugins | `ref` and `sha`; `npm` version; `archive` `sha256` [S14] | by marketplace owner | `sha256` yes; `sha` via checkout |

Common shape: a committed file records the exact resolved identifier plus a content hash; "update" is a separate, deliberate command; verification is on every use; the diff of the file is the review artefact. Terraform's content hash (`h1:`) is deliberately independent of archive format, which matches our `Pack.hash` being independent of how the pack arrived (R§1.3).

### 4.5 Signatures

npm registry signatures and Sigstore provenance exist and `pacote` can verify them given registry keys [S3, S17]. The roadmap excludes "paid or signed distribution" as a feature we build (line 60). Consuming npm's existing signatures is not forbidden by that line but gives weak assurance: signatures prove the registry served it, and provenance proves build origin, not benign content [S3].

## 5. Buy versus build

Candidates for the fetch/verify/extract step, with facts:

1. **Shell out to `npm`** (`npm pack <spec> --json --ignore-scripts --pack-destination <dir>`, `npm view <spec> dist --json`). Zero new dependency in `package.json`; the harness already uses `execFile` for git (`src/git-exec.ts`). Output gives `integrity`, `shasum`, `files` list (observed). Requires `npm` on PATH (R§2 UNVERIFIED for all install routes), and its behaviour depends on the user's `.npmrc`/registry config and env (credentials, scopes, `min-release-age`), which is both a feature (private registries work) and a determinism risk. Git and directory specs run `prepare`/`prepack` [S4]; a policy of only accepting registry specs (or passing `--ignore-scripts`) is needed. Does not extract; extraction needs `tar` (system) or a library.
2. **`pacote`** (npm's own fetcher, ISC): `manifest`, `packument`, `tarball`, `extract`, `resolve`; takes an `integrity` option and raises `EINTEGRITY` on mismatch; `allowGit`/`allowRemote`/`allowFile`/`allowDirectory`/`allowRegistry` restrict spec types; `before` option filters by publish date; can verify signatures and attestations [S17]. Extraction masks modes via umask and handles root ownership [S17]. Caveats from `npm view pacote` (2026-10-24): version 22.0.1, `engines.node` `^22.22.2 || ^24.15.0 || >=26.0.0` (narrower than this repo's `>=22`), 17 direct dependencies including `tar`, `sigstore`, `@npmcli/git`, `@npmcli/run-script`, `cacache`. That is a large new dependency tree for a harness that currently has 7 runtime dependencies. For git specs it runs `prepare` [S17] unless `allowGit: "none"`.
3. **Hand-rolled** (fetch the registry JSON, download the tarball, verify sha512 with `node:crypto`, extract with `tar`): the registry protocol and `dist.integrity` are simple, but safe extraction (path traversal, links, device files, size bombs, modes) is exactly the part libraries exist for. Note `readPackFolder` already refuses links and non-plain files after extraction (R§1.4), which is a second line of defence; it does not stop a path-traversal write during extraction.
4. **Git only** (`git clone` + `git checkout <sha>` using the existing `src/git-exec.ts`): no new dependency; pin = full commit SHA, which is a content hash of the tree (SHA-1 or SHA-256 per repo; SHA-1 collision resistance is weaker, UNVERIFIED how much that matters for this threat model). The checkout needs `readPackFolder` (already handles `.git/`, line 194).
5. **Existing delivery pieces to reuse**: `readPackFolder` (closed-set folder check), `Pack.hash` (content fingerprint), `inspectionOf` + `--json` (approval record input), `withWorkflowsOf` (clash detection), `@inquirer/prompts` (confirm), `zod` and the schema-publishing pattern (record format).

Wardley view (per the user's CLAUDE.md "avoid hand-rolling"): fetching, content-addressing and tarball extraction are commodity (npm, pacote, tar, git). Judging what a pack will do (inspection, closed set, fingerprint) is the genuine, already-built differentiator. The record (what was approved, which hash) and update diff are custom to our pack format and have no off-the-shelf equivalent.

## 6. Supply-chain risks specific to this feature

1. **Prompt injection by a data-only pack** is the primary risk (roadmap lines 117-118; inspect spec line 15): the agent has bypassed permissions (`src/agent-invoke.ts:246-247`). Pinning does not make a pack safe; it makes review stable.
2. **Install scripts / lifecycle hooks** in the package tarball (npm `postinstall` etc. [S4]). A pack is data, so the tarball never needs them. A tarball with a `scripts` field in `package.json` and a `.js` file is already refused by the closed set (`NOT_IN_A_PACK`, `pack-folder.ts:116,206`), if the tarball is extracted to a folder and checked; but `package.json` itself is not in the closed set (README/licence/changelog and `pack.json` only), so a standard npm tarball always contains `package.json` and would be refused as written. This is a concrete gap Item 3 must resolve: either the closed set learns about `package.json` for an installed pack (as metadata only, never executed), or the pack is stored without it. Fact: `judge()` returns `refuse(NOT_IN_A_PACK)` for any other top-level name (`pack-folder.ts:206`), and `package.json` matches none of the allowed names (`pack-folder.ts:125-127,199-205`). I did not run it; this is from reading the code (UNVERIFIED by execution).
3. **Tag/version mutation**: git tags mutable [S10, S11]; npm versions immutable but dist-tags mutable [S2]. Pin to exact version + integrity, or full commit SHA.
4. **Dependency confusion / typosquatting / name impersonation**: ClawHub evidence of typosquatted skills [S9]. The harness's own collision rule treats pack `name` as an identity within a project (`builtInPackClash`, `pack-workflows.ts:8`); an installed pack's manifest `name` is author-chosen, not tied to the npm name. Mapping (npm name vs manifest name) is a design decision.
5. **Account takeover and new-version attack**: a pinned version is safe from later republish; the risk is at first add and at update. Mitigations that exist elsewhere: release-age delay (`min-release-age`, pnpm `minimumReleaseAge`) [S6, S7], provenance [S3], show-the-diff on update (Terraform) [S19].
6. **Archive extraction attacks** (traversal, links, bombs): library responsibility [S17]; `readPackFolder` rejects links (`pack-folder.ts:111,163`) but works on an already extracted tree. No size cap in the folder check (inspect spec line 51).
7. **Silent drift**: `Pack.hash` is not checked when a listed folder is loaded (`loadPack` has no expected-hash argument: `manifest.ts:305-310`). A folder edited after approval is run unchecked today. Criterion 4 requires a verify-on-load step that does not exist.
8. **Hash coverage**: `Pack.hash` excludes fixtures and docs (R§1.3). An approval keyed only to `Pack.hash` accepts changes to files the agent is never given. Acceptable for "what runs", but the installed copy's integrity (tarball sha512 or commit SHA) covers everything; both can be recorded.
9. **Format drift between harness versions**: the fingerprint depends on hash-order rules per format (`manifest.ts:297-300`) and on `upgradeV2` upgrades (`manifest.ts:272-276`), so a harness change to either would invalidate recorded hashes. Item 3 should treat the hash algorithm as versioned.
10. **Offline and CI**: determinism "on every machine and every run" implies runs must not touch the network; an installed copy must be on disk (committed or restorable from the lockfile with integrity check). Both conventions exist: npm restores from lockfile into `node_modules` (not committed); Go and Terraform similar. Whether to vendor the pack into the repo (committed folder, reviewable in diffs, no network) or cache it outside is open. A committed vendored folder fits the existing `packs: ["./folder"]` model with zero loader change; Claude Code plugins use a cache [S14] (UNVERIFIED location details).

## 7. Prior art for sharing prompt and skill bundles

- **Claude Code plugin marketplaces** (closest analogue; Anthropic documentation): a marketplace is a `marketplace.json` listing plugins; plugin sources are relative path, `github`, `url`, `git-subdir`, `npm`, `archive`, `command`; git sources pin with `ref` and `sha`; `archive` pins with `sha256`; the `npm` source is "fetched with your npm client and unpacked without running install scripts" and "The package's install scripts... never run, and its dependencies aren't installed during the fetch" [S14]. `claude plugin validate`. Admin allowlists `strictKnownMarketplaces`/`blockedMarketplaces` [S14]. Reserved names stop impersonation of official marketplaces (the reserved-name list includes `npm`, `github`, `cargo`) [S14]. A plugin can carry hooks, so Claude Code's trust problem is bigger than ours; the `npm` source behaviour is directly reusable as a design pattern (no scripts, no deps).
- **Agent Skills** (agentskills.io): a skill is a folder with `SKILL.md` (name, description, optional `license`, `compatibility`, `metadata` with `version`, `allowed-tools`) and optional `scripts/`, `references/`, `assets/`; validated by `skills-ref`; the spec defines no distribution, pinning or integrity [S20]. So the format is shareable but unpinned; each host invents its own.
- **Security record**: PromptArmor showed a malicious marketplace plugin using a hook to exfiltrate files via indirect prompt injection [S9 secondary]; ClawHavoc found hundreds of malicious skills in an open registry [S9 secondary]; a Snyk study claimed prompt injection in 36% of tested skills (not verified against the primary report). These are secondary summaries from one web search; treat figures as indicative only.
- **GitHub Actions** (shared automation steps run with secrets): guidance is pin by SHA and audit source before use [S10]; the tj-actions incident is the cautionary case [S11].
- **Terraform providers / Go modules / Cargo**: lock with content hashes, update only deliberately, review the lock diff [S15, S16, S19].
- Within our estate: `delivery packs check`'s trust confirmation (R§1.4) and `delivery packs inspect` (Item 2) are the two prior approval primitives.

## 8. Open points the design must decide (facts to inform, not decisions)

1. Source types: npm spec only; npm + git; npm + git + archive URL. Cost grows: git adds clone hardening; archive adds a hash-on-first-use story.
2. The pin: exact version + sha512 integrity (npm), full commit SHA (git), `sha256` (archive), and `Pack.hash` as the harness-level fingerprint. Which is the approval key and which is transport integrity?
3. Where the record lives: inside `delivery.config.json` (changes `packs` element type, `src/cli/config.ts:209`), or a separate committed lock file. Item 6 (editor schema) and Item 8 (plugins reuse "version recorded, updating shows what changed", roadmap line 252) both read this decision.
4. Where the installed copy lives and whether runs ever touch the network (R§6.10).
5. The closed-set check vs `package.json` in an npm tarball (R§6.2).
6. Update diff: a text diff of prompts plus the `Inspection` delta (widening flags, guards, hold) is feasible because `Inspection` is a stable JSON document (`inspection.ts:291-314`); inspect spec C2 (line 69) put "compare two packs or versions" in Item 3.
7. Clash reporting for installed packs (R§1.5): who can rename a pinned pack; how a project maps an installed pack to a local alias, if at all.
8. Whether `delivery review <path>` and `delivery run --workflow` should accept an installed pack by name without `packs` listing (today a name resolves only among listed + built-in, `manifest.ts:329-339`).
9. Approval record: who approved and when is not a repo fact today; `--json` was built to feed it (inspect spec line 127). Whether the record holds only hashes or also a person and time is open; no governing document I read decides it.

## 9. Sources

Repo files cited inline. External (fetched 2026-10-24; tool-summarised pages, so quotes are the fetch tool's extracts of the pages):

- S1 https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
- S2 https://docs.npmjs.com/policies/unpublish
- S3 https://docs.npmjs.com/generating-provenance-statements
- S4 https://docs.npmjs.com/cli/v11/using-npm/scripts
- S5 https://docs.npmjs.com/cli/v11/commands/npm-pack (plus my local run of `npm pack is-odd@3.0.1 --json --ignore-scripts` and `npm view is-odd@3.0.1 dist --json`, npm 11.13.0)
- S6 https://docs.npmjs.com/cli/v11/using-npm/config
- S7 https://pnpm.io/supply-chain-security
- S8 https://lilting.ch/en/articles/pnpm-11-minimum-release-age-default-shai-hulud-defense and https://snyk.io/pt-BR/articles/npm-security-best-practices-shai-hulud-attack/ (secondary; web search results, not opened in full)
- S9 https://www.antiy.net/p/clawhavoc-analysis-of-large-scale-poisoning-campaign-targeting-the-openclaw-skill-market-for-ai-agents/ ; https://promptarmor.substack.com/p/hijacking-claude-code-via-injected ; https://thehackernews.com/2026/02/openclaw-integrates-virustotal-scanning.html (secondary; web search results, not opened in full; figures unverified)
- S10 https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- S11 https://orca.security/resources/blog/github-action-tj-actions-changed-files-compromised/ and https://thehackernews.com/2025/03/github-action-compromise-puts-cicd.html (secondary; sources disagree on tag range)
- S12 https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/immutable-releases
- S13 https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html
- S14 https://code.claude.com/docs/en/plugins/marketplace-reference.md and https://code.claude.com/docs/en/plugin-marketplaces
- S15 https://doc.rust-lang.org/cargo/reference/registry-index.html
- S16 https://go.dev/blog/module-mirror-launch
- S17 https://github.com/npm/pacote (README); `npm view pacote` run locally 2026-10-24
- S18 https://go.dev/ref/mod (first 100,000 characters only read; the `go.sum` verification sections were truncated, so only the `-mod=readonly` default is cited)
- S19 https://developer.hashicorp.com/terraform/language/files/dependency-lock
- S20 https://agentskills.io/specification
