---
"delivery-service": minor
---

`delivery packs add <package>` adds a pack published on npm. It shows the exact version and the pack's full account, runs nothing from the package, and writes nothing until you say yes; then the pack is kept in `.delivery/packs/<name>/` with its version and fingerprint recorded in `.delivery/packs.lock.json`, both to be committed. Added packs are listed by `delivery packs` with their source and version, and run like any other pack.

`delivery packs add` takes `--approve <fingerprint>` for jobs with no terminal: without it, nothing can be asked, so the account is shown and the add is refused, naming your own command with the pack's fingerprint; a different fingerprint is refused. `--json` gives the outcome as one `delivery.pack-decision/1` document with the same facts, keys sorted and paths relative to the repository.

Every use of an added pack first checks its kept files against the record, with no network, and refuses before anything is sent to an agent a pack that is missing, holds something the pack format does not allow, has changed, was not approved, or has no record entry, naming the file and the one command that fixes it.

`delivery packs` says whether each added pack is as approved, and names the command for one that is not.

`delivery packs restore <name>` fetches the recorded version again and puts the pack back when it matches what was approved.

`delivery packs update <name> [request]` is the only way an added pack moves to another version: it shows what changes first (in short, then file by file and line by line, with hidden characters shown), writes nothing until you say yes, and says so plainly when npm has nothing newer or the newer version has the same content. Commit the record and the folder together. `delivery packs update` follows the same rule, bound to the new version's fingerprint; the refusal names your own command, and a version published since you read the change is refused because its fingerprint differs. The recorded request is never changed unless you give one.

`delivery packs approve <name>` approves an added pack whose record says it was not approved, after showing its full account; a pack whose files differ from the record must be restored or updated instead.

`delivery packs approve` shows the account with nobody to ask too, and takes `--approve <fingerprint>` in the same way; `--json` gives its outcome as one `delivery.pack-decision/1` document.

Adding a pack whose name, or whose workflow's name, is already used is refused before anything is written. The refusal names both sides and the one thing to do to keep the new pack, usually `delivery packs remove <name>`. A clash that appears later, when packs load, is named the same way wherever packs load.

`delivery packs remove <name>` takes an added pack out: it names the workflows that will stop existing, then deletes its kept files and its entry in the record; it changes nothing while your configuration still names one of its workflows. Commit the deleted folder and the record together, so the pack is gone for everyone.

A pack kept in, or published in, a newer pack format than this delivery-service reads is refused with the sentence that says to upgrade delivery-service, and the record is left as it is.

`delivery packs --json` is now the versioned `delivery.packs/1` document: every pack the plain list shows, with its source, version and, for an added pack, its state; like the plain list, it no longer refuses when an added pack cannot be used.

The packs page gains an "Add a pack from elsewhere" section, and every example in it is what the commands print.
