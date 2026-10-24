---
"delivery-service": minor
---

`delivery packs add <package>` adds a pack published on npm. It shows the exact version and the pack's full account, runs nothing from the package, and writes nothing until you say yes; then the pack is kept in `.delivery/packs/<name>/` with its version and fingerprint recorded in `.delivery/packs.lock.json`, both to be committed. Added packs are listed by `delivery packs` with their source and version, and run like any other pack.

Every use of an added pack first checks its kept files against the record, with no network, and refuses before anything is sent to an agent a pack that is missing, holds something the pack format does not allow, has changed, was not approved, or has no record entry, naming the file and the one command that fixes it.
