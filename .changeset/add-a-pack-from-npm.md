---
"delivery-service": minor
---

`delivery packs add <package>` adds a pack published on npm. It shows the exact version and the pack's full account, runs nothing from the package, and writes nothing until you say yes; then the pack is kept in `.delivery/packs/<name>/` with its version and fingerprint recorded in `.delivery/packs.lock.json`, both to be committed. Added packs are listed by `delivery packs` with their source and version, and run like any other pack.

Every use of an added pack first checks its kept files against the record, with no network, and refuses before anything is sent to an agent a pack that is missing, holds something the pack format does not allow, has changed, was not approved, or has no record entry, naming the file and the one command that fixes it.

`delivery packs` says whether each added pack is as approved, and names the command for one that is not.

`delivery packs restore <name>` fetches the recorded version again and puts the pack back when it matches what was approved.

`delivery packs approve <name>` approves an added pack whose record says it was not approved, after showing its full account; a pack whose files differ from the record must be restored or updated instead.

Adding a pack whose name, or whose workflow's name, is already used is refused before anything is written. The refusal names both sides and the one thing to do to keep the new pack, usually `delivery packs remove <name>`. A clash that appears later, when packs load, is named the same way wherever packs load.

`delivery packs remove <name>` takes an added pack out: it names the workflows that will stop existing, then deletes its kept files and its entry in the record; it changes nothing while your configuration still names one of its workflows. Commit the deleted folder and the record together, so the pack is gone for everyone.
