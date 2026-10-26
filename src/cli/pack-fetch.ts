import { PackIntegrityMismatch, PackSourceUnavailable, type PackAttempt } from "../errors.js";
import type { PackageSpec } from "../packs/install/pack-spec.js";
import type { FetchedPackage, PackSource } from "../packs/install/pack-source.js";

/**
 * The package as npm gives it, marked with the command that asked for it, so a refusal from npm reads as that command's refusal.
 * Every other error passes through unchanged.
 */
export async function fetchFor(source: PackSource, spec: PackageSpec, attempt: PackAttempt): Promise<FetchedPackage> {
  try {
    return await source.fetch(spec);
  } catch (err) {
    if (err instanceof PackSourceUnavailable) throw new PackSourceUnavailable(err.packageName, err.request, err.reason, err.detail, attempt);
    if (err instanceof PackIntegrityMismatch) throw new PackIntegrityMismatch(err.packageName, err.version, err.expected, err.actual, attempt);
    throw err;
  }
}
