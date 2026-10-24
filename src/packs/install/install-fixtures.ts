import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPack } from "../manifest.js";
import { fileDigests, fingerprintedFiles } from "./digests.js";
import { fingerprintOf, type LockEntry } from "./lock.js";
import type { PackageFile } from "./package-archive.js";
import { writePackFiles } from "./store.js";
import { packageTarball } from "./tarball.js";

/** The find's instructions, as the fixture pack writes them: plain ASCII, so the account shows them exactly. */
export const SCAN_TEXT = [
  "Read the project and find calls to code it has marked as replaced.",
  "Each call you find is one idea: name the file and the line it is on.",
  "Write one idea for each call. Change no file.",
  "Keep each idea short, in plain words.",
].join("\n");

/** The act's instructions, as the fixture pack writes them. */
export const CODE_TEXT = [
  "Read the file named in the idea.",
  "Point the call at the code that replaces the old code.",
  "Change nothing else, and keep the tests passing.",
].join("\n");

export interface PackPackageOptions {
  /** The pack's name in its pack.json. Default `docs-drift`. */
  name?: string;
  /** The package's npm name. Default `@acme/delivery-pack-docs`. */
  packageName?: string;
  /** The package's version. Default `1.2.0`. */
  version?: string;
  /** The folder the pack sits in, relative to the package root, as `delivery-pack` names it. Default `.`. */
  field?: string;
  /** Files to add to the package, by their path from the package root, such as `README.md` or `pack/install.sh`. */
  extra?: Record<string, string>;
  /** package.json fields to set over the defaults. An `undefined` value drops the field. */
  packageJson?: Record<string, unknown>;
  /** pack.json fields to set over the default manifest, such as `workflows`. */
  manifest?: Record<string, unknown>;
}

/** A valid `delivery.pack/3` manifest: a find that offers an idea to the act `code`. */
const manifest = (name: string): Record<string, unknown> => ({
  schema: "delivery.pack/3",
  name,
  version: "1.0.0",
  title: "Document drift",
  summary: "Finds calls to code the project has marked as replaced.",
  workflows: {
    scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] },
    code: { kind: "act", summary: "Code of the project that calls the replaced code.", prompt: "code.md" },
  },
});

/** An npm package holding one pack, as `packageTarball` builds it: the pack under `field`, and the package.json naming it. */
export function packPackage(options: PackPackageOptions = {}): Uint8Array {
  const field = options.field ?? ".";
  const folder = field === "." ? "" : `${field}/`;
  const files: Record<string, string> = {
    [`${folder}pack.json`]: JSON.stringify({ ...manifest(options.name ?? "docs-drift"), ...options.manifest }),
    [`${folder}scan.md`]: SCAN_TEXT,
    [`${folder}code.md`]: CODE_TEXT,
    ...options.extra,
  };
  const packageJson = {
    name: options.packageName ?? "@acme/delivery-pack-docs",
    version: options.version ?? "1.2.0",
    "delivery-pack": field,
    ...options.packageJson,
  };
  return packageTarball(files, packageJson);
}

/**
 * A lock entry for a pack holding `files`: the true fingerprint and file digests, approved as installed, from npm at
 * `1.2.0`. `fields` override any of it. The pack is read from a temporary folder, which is removed before this returns.
 */
export async function entryFor(files: readonly PackageFile[], fields: Partial<LockEntry> = {}): Promise<LockEntry> {
  const temp = await mkdtemp(join(tmpdir(), "entry-for-"));
  try {
    const dir = join(temp, "pack");
    await writePackFiles(dir, files);
    const read = await readPack(dir);
    if (!read.ok) throw new Error("the fixture pack must read");
    const fingerprint = fingerprintOf(read.pack);
    return {
      source: "npm",
      package: "@acme/delivery-pack-docs",
      request: "latest",
      version: "1.2.0",
      integrity: "sha512-" + "A".repeat(86) + "==",
      fingerprint,
      approved: fingerprint,
      files: await fileDigests(dir, fingerprintedFiles(read.pack)),
      ...fields,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
