import { z } from "zod";
import type { InstalledPack } from "../packs/install/installed.js";
import { missingSettings } from "../packs/settings.js";
import { isBuiltInPack, type Pack } from "../packs/manifest.js";
import { openSchema, type JsonSchema } from "../report/json-schema.js";
import type { DeliveryConfig } from "./config.js";

/** The name of the packs listing document, which names its own version. */
export const PACKS_LISTING_SCHEMA = "delivery.packs/1";

/** One pack the listing shows: its name, its manifest's version, title and summary where they can be read, where it came from, for an added pack its state, and the required settings it has no value for. */
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
  needs: z.array(z.string()),
});
export type PackRow = z.infer<typeof PackRow>;

/** Every pack `delivery packs` lists, in the order the plain list gives them, for automation to read. */
export const PacksListing = z.strictObject({
  schema: z.literal(PACKS_LISTING_SCHEMA),
  packs: z.array(PackRow),
});
export type PacksListing = z.infer<typeof PacksListing>;

/** The names of the required settings a pack has no value for, in declaration order: the setting names `missingSettings` reports. */
export function needsOf(pack: Pack, packSettings: DeliveryConfig["packSettings"]): string[] {
  return missingSettings(pack, packSettings?.[pack.manifest.name]).map(({ setting }) => setting);
}

/** The required settings an added pack has no value for: none unless its pack can be read, since a pack that cannot be read has nothing to name. */
export function installedNeeds(pack: InstalledPack, packSettings: DeliveryConfig["packSettings"]): string[] {
  return pack.state === "ok" || pack.state === "unapproved" ? needsOf(pack.pack, packSettings) : [];
}

/** The packs the plain list shows, as rows: the packs that are not added first, then each added pack with its state, and each row with the required settings it has no value for. Pure. */
export function packsListing(packs: readonly Pack[], installed: readonly InstalledPack[], packSettings: DeliveryConfig["packSettings"] = {}): PacksListing {
  const listed = packs
    .filter(({ origin }) => origin.kind !== "installed")
    .map(
      (pack): PackRow => ({
        name: pack.manifest.name,
        version: pack.manifest.version,
        title: pack.manifest.title,
        summary: pack.manifest.summary,
        source: { kind: isBuiltInPack(pack.dir) ? "built-in" : "folder", package: null },
        state: null,
        needs: needsOf(pack, packSettings),
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
      needs: installedNeeds(pack, packSettings),
    };
  });
  return { schema: PACKS_LISTING_SCHEMA, packs: [...listed, ...added] };
}

/** The JSON Schema of the packs listing document. */
export const packsListingSchema = (): JsonSchema => ({ ...openSchema(PacksListing), title: PACKS_LISTING_SCHEMA });
