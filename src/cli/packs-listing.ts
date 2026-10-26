import { z } from "zod";
import type { InstalledPack } from "../packs/install/installed.js";
import { isBuiltInPack, type Pack } from "../packs/manifest.js";
import { openSchema, type JsonSchema } from "../report/json-schema.js";

/** The name of the packs listing document, which names its own version. */
export const PACKS_LISTING_SCHEMA = "delivery.packs/1";

/** One pack the listing shows: its name, its manifest's version, title and summary where they can be read, where it came from, and for an added pack its state. */
export const PackRow = z.strictObject({
  name: z.string(),
  version: z.string().nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  source: z.object({
    kind: z.enum(["built-in", "folder", "installed"]),
    package: z.object({ name: z.string(), version: z.string() }).nullable(),
  }),
  state: z.enum(["ok", "unapproved", "missing", "invalid", "changed", "newer-format", "unrecorded"]).nullable(),
});
export type PackRow = z.infer<typeof PackRow>;

/** Every pack `delivery packs` lists, in the order the plain list gives them, for automation to read. */
export const PacksListing = z.strictObject({
  schema: z.literal(PACKS_LISTING_SCHEMA),
  packs: z.array(PackRow),
});
export type PacksListing = z.infer<typeof PacksListing>;

/** The packs the plain list shows, as rows: the packs that are not added first, then each added pack with its state. Pure. */
export function packsListing(packs: readonly Pack[], installed: readonly InstalledPack[]): PacksListing {
  const listed = packs
    .filter(({ origin }) => origin.kind !== "installed")
    .map(
      ({ dir, manifest }): PackRow => ({
        name: manifest.name,
        version: manifest.version,
        title: manifest.title,
        summary: manifest.summary,
        source: { kind: isBuiltInPack(dir) ? "built-in" : "folder", package: null },
        state: null,
      }),
    );
  const added = installed.map((pack): PackRow => {
    const manifest = pack.state === "ok" || pack.state === "unapproved" ? pack.pack.manifest : null;
    const npm = pack.state === "unrecorded" ? null : { name: pack.entry.package, version: pack.entry.version };
    return {
      name: pack.name,
      version: manifest?.version ?? null,
      title: manifest?.title ?? null,
      summary: manifest?.summary ?? null,
      source: { kind: "installed", package: npm },
      state: pack.state,
    };
  });
  return { schema: PACKS_LISTING_SCHEMA, packs: [...listed, ...added] };
}

/** The JSON Schema of the packs listing document. */
export const packsListingSchema = (): JsonSchema => ({ ...openSchema(PacksListing), title: PACKS_LISTING_SCHEMA });
