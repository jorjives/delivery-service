import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackIntegrityMismatch, PackSourceUnavailable } from "../../errors.js";
import type { PackageSpec } from "./pack-spec.js";
import { checkedIntegrity, type FetchedPackage, type PackSource } from "./pack-source.js";
import { ARCHIVE_CAPS } from "./package-archive.js";

const NPM_TIMEOUT_MS = 120_000;
const NPM_OUTPUT_LIMIT = 1 << 20;
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH"]);
const SILENT = "npm stopped without saying why";
/** npm's EINTEGRITY summary names the digest it wanted and the digest it got. */
const WANTED_AND_GOT = /wanted (sha512-\S+) but got (sha512-\S+)\./;

/** npm's own failure object: its error code and its one-line summary. */
interface NpmError {
  code: string;
  summary: string;
}

/** The first package npm packed: what it resolved to and where its tarball landed in the scratch folder. */
interface PackedEntry {
  name: string;
  version: string;
  integrity: string;
  filename: string;
}

interface NpmRun {
  stdout: string;
  stderr: string;
  missing: boolean;
  failed: boolean;
}

/** The npm error in one stream's text, read as a whole or line by line, or null when that text holds none. npm versions differ in which stream carries it. */
function npmErrorIn(text: string): NpmError | null {
  for (const candidate of [text.trim(), ...text.split("\n").filter((line) => line.startsWith("{"))]) {
    try {
      const error = (JSON.parse(candidate) as { error?: { code?: unknown; summary?: unknown } } | null)?.error;
      if (typeof error?.code === "string") {
        return { code: error.code, summary: typeof error.summary === "string" ? error.summary : "" };
      }
    } catch {
      // Not JSON; try the next line.
    }
  }
  return null;
}

/** The first packed entry, or null when npm's output is not the array a successful `npm pack --json` prints. */
function packedEntryOf(stdout: string): PackedEntry | null {
  try {
    const first = (JSON.parse(stdout) as Partial<Record<keyof PackedEntry, unknown>>[] | null)?.[0];
    if (typeof first?.name === "string" && typeof first.version === "string" && typeof first.integrity === "string" && typeof first.filename === "string") {
      return { name: first.name, version: first.version, integrity: first.integrity, filename: first.filename };
    }
  } catch {
    // Not JSON.
  }
  return null;
}

/** Runs `npm pack` for the spec into the scratch folder, with install scripts off and the owner's registry settings kept. */
function runNpm(env: NodeJS.ProcessEnv, scratch: string, spec: PackageSpec): Promise<NpmRun> {
  return new Promise((resolve) => {
    execFile(
      env.DELIVERY_NPM || "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", scratch, "--", `${spec.name}@${spec.request}`],
      {
        cwd: scratch,
        env: { ...env, npm_config_ignore_scripts: "true", npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" },
        timeout: NPM_TIMEOUT_MS,
        maxBuffer: NPM_OUTPUT_LIMIT,
      },
      (error, stdout, stderr) => resolve({ stdout, stderr, missing: error?.code === "ENOENT", failed: error !== null }),
    );
  });
}

/** The refusal for an npm error, by its code. */
function refusalFor(spec: PackageSpec, npmError: NpmError | null): Error {
  const summary = npmError?.summary || SILENT;
  const code = npmError?.code;
  if (code === "E404") return new PackSourceUnavailable(spec.name, spec.request, "not-found", summary);
  if (code === "ETARGET") return new PackSourceUnavailable(spec.name, spec.request, "no-version", summary);
  if (code !== undefined && UNREACHABLE_CODES.has(code)) return new PackSourceUnavailable(spec.name, spec.request, "unreachable", summary);
  if (code === "EINTEGRITY") {
    const [, expected = "", actual = ""] = WANTED_AND_GOT.exec(summary) ?? [];
    return new PackIntegrityMismatch(spec.name, spec.request, expected, actual);
  }
  return new PackSourceUnavailable(spec.name, spec.request, "failed", summary);
}

/** Packs the spec with npm into `scratch` and returns the package, its tarball checked against the integrity npm published. */
async function packWith(env: NodeJS.ProcessEnv, spec: PackageSpec, scratch: string): Promise<FetchedPackage> {
  const run = await runNpm(env, scratch, spec);
  if (run.missing) throw new PackSourceUnavailable(spec.name, spec.request, "no-npm", "");
  if (run.failed) throw refusalFor(spec, npmErrorIn(run.stdout) ?? npmErrorIn(run.stderr));

  const entry = packedEntryOf(run.stdout);
  if (entry === null) throw new PackSourceUnavailable(spec.name, spec.request, "failed", SILENT);

  const tarball = await readFile(join(scratch, entry.filename));
  if (tarball.length > ARCHIVE_CAPS.compressed) {
    throw new PackSourceUnavailable(spec.name, spec.request, "failed", `the package is larger than ${ARCHIVE_CAPS.compressed / 2 ** 20} MiB`);
  }
  return checkedIntegrity({ name: entry.name, version: entry.version, integrity: entry.integrity, tarball });
}

/** A pack source that fetches through the owner's own npm, so version resolution and registry settings are npm's. Nothing from the package runs. */
export function npmSource(env: NodeJS.ProcessEnv): PackSource {
  return {
    async fetch(spec) {
      const scratch = await mkdtemp(join(tmpdir(), "delivery-npm-"));
      try {
        return await packWith(env, spec, scratch);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  };
}
