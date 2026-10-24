---
"delivery-service": minor
---

`delivery packs add <package>` adds a pack published on npm. It shows the exact version and the pack's full account, runs nothing from the package, and writes nothing until you say yes; then the pack is kept in `.delivery/packs/<name>/` with its version and fingerprint recorded in `.delivery/packs.lock.json`, both to be committed. Added packs are listed by `delivery packs` with their source and version, and run like any other pack.
