import { createHash } from "node:crypto";
import { PackIntegrityMismatch } from "../../errors.js";
import type { PackageSpec } from "./pack-spec.js";

/** A package as a source hands it over: what was resolved, the integrity npm published for it, and the tarball bytes. */
export interface FetchedPackage {
  name: string;
  version: string;
  integrity: string;
  tarball: Uint8Array;
}

/** Where a pack's package comes from. The npm adapter is the real one; the fake stands in for it in tests. */
export interface PackSource {
  fetch(spec: PackageSpec): Promise<FetchedPackage>;
}

/** The Subresource Integrity string of some bytes, as npm publishes it. */
export function sriOf(bytes: Uint8Array): string {
  return "sha512-" + createHash("sha512").update(bytes).digest("base64");
}

/** The fetched package, unchanged, when its bytes match the integrity published for it; otherwise refused. */
export function checkedIntegrity(fetched: FetchedPackage): FetchedPackage {
  const actual = sriOf(fetched.tarball);
  if (actual !== fetched.integrity) throw new PackIntegrityMismatch(fetched.name, fetched.version, fetched.integrity, actual);
  return fetched;
}
