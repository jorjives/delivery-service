import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fakePackSource, type FakePackSource } from "../packs/install/fake-source.js";
import { packPackage } from "../packs/install/install-fixtures.js";
import { EXIT } from "./failures.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { packsAddCommand } from "./packs-add-command.js";

/** Test support: `@acme/delivery-pack-docs` 1.2.0 (`tarball`, by default the fixture pack) added to `repo` with a yes, as `delivery packs add` keeps it. Returns the source it came from. */
export async function addedDocsDrift(repo: string, tarball: Uint8Array = packPackage()): Promise<FakePackSource> {
  const source = fakePackSource();
  source.publish("@acme/delivery-pack-docs", "1.2.0", tarball);
  const { ctx } = context(repo);
  const exit = await packsAddCommand("@acme/delivery-pack-docs", ctx, scriptedAsk({ confirm: true }).ask, source);
  if (exit !== EXIT.ok) throw new Error(`the fixture pack did not add: exit ${exit}`);
  return source;
}

/** Every path under `repo` except `.git`, with a directory's marker or a file's bytes, so a test can prove nothing changed. */
export function tree(repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(repo, { recursive: true }).map(String)) {
    if (rel === ".git" || rel.startsWith(".git/")) continue;
    const path = join(repo, rel);
    out[rel] = statSync(path).isDirectory() ? "<folder>" : readFileSync(path).toString("base64");
  }
  return out;
}
