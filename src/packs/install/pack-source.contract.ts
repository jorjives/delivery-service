import { describe, expect, it } from "vitest";
import { PackIntegrityMismatch } from "../../errors.js";
import { packageTarball } from "./tarball.js";
import { sriOf, type PackSource } from "./pack-source.js";

/** What a contract run needs: a source and the means to put packages in it, or take the source offline. */
export interface PackSourceRig {
  source: PackSource;
  publish(name: string, version: string, tarball: Uint8Array, options?: { tags?: readonly string[] }): Promise<void>;
  unreachable(): Promise<void>;
  corrupt(name: string, version: string): Promise<void>;
}

const packageFor = (name: string, version: string): Uint8Array => packageTarball({ "pack.json": "{}" }, { name, version, "delivery-pack": "." });

/** The behaviour every pack source must have. A source's test file calls this once with its rig. */
export function packSourceContract(label: string, rig: () => Promise<PackSourceRig>): void {
  describe(`${label} pack source contract`, () => {
    it("resolves latest to the newest published version", async () => {
      const { source, publish } = await rig();
      await publish("docs-pack", "1.0.0", packageFor("docs-pack", "1.0.0"));
      await publish("docs-pack", "1.1.0", packageFor("docs-pack", "1.1.0"));
      expect(await source.fetch({ name: "docs-pack", request: "latest", typed: false })).toMatchObject({ version: "1.1.0" });
    });

    it("resolves an exact version", async () => {
      const { source, publish } = await rig();
      await publish("docs-pack", "1.0.0", packageFor("docs-pack", "1.0.0"));
      await publish("docs-pack", "1.1.0", packageFor("docs-pack", "1.1.0"));
      expect(await source.fetch({ name: "docs-pack", request: "1.0.0", typed: true })).toMatchObject({ version: "1.0.0" });
    });

    it("resolves a named tag", async () => {
      const { source, publish } = await rig();
      await publish("docs-pack", "1.0.0", packageFor("docs-pack", "1.0.0"), { tags: ["next"] });
      await publish("docs-pack", "1.1.0", packageFor("docs-pack", "1.1.0"));
      expect(await source.fetch({ name: "docs-pack", request: "next", typed: true })).toMatchObject({ version: "1.0.0" });
    });

    it("returns bytes whose integrity matches what was published", async () => {
      const { source, publish } = await rig();
      const bytes = packageFor("docs-pack", "1.0.0");
      await publish("docs-pack", "1.0.0", bytes);
      const fetched = await source.fetch({ name: "docs-pack", request: "1.0.0", typed: true });
      expect(sriOf(fetched.tarball)).toBe(fetched.integrity);
      expect(fetched.tarball).toEqual(bytes);
    });

    it("says the package is not found when no such package exists", async () => {
      const { source } = await rig();
      await expect(source.fetch({ name: "no-such-pack", request: "latest", typed: false })).rejects.toMatchObject({
        code: "PACK_SOURCE_UNAVAILABLE",
        reason: "not-found",
      });
    });

    it("says there is no such version when the package has no version or tag asked for", async () => {
      const { source, publish } = await rig();
      await publish("docs-pack", "1.0.0", packageFor("docs-pack", "1.0.0"));
      await expect(source.fetch({ name: "docs-pack", request: "9.0.0", typed: true })).rejects.toMatchObject({
        code: "PACK_SOURCE_UNAVAILABLE",
        reason: "no-version",
      });
    });

    it("says the source is unreachable when it cannot be reached", async () => {
      const { source, publish, unreachable } = await rig();
      await publish("docs-pack", "1.0.0", packageFor("docs-pack", "1.0.0"));
      await unreachable();
      await expect(source.fetch({ name: "docs-pack", request: "latest", typed: false })).rejects.toMatchObject({
        code: "PACK_SOURCE_UNAVAILABLE",
        reason: "unreachable",
      });
    });

    it("refuses bytes that do not match their published integrity", async () => {
      const { source, publish, corrupt } = await rig();
      await publish("docs-pack", "1.0.0", packageFor("docs-pack", "1.0.0"));
      await corrupt("docs-pack", "1.0.0");
      await expect(source.fetch({ name: "docs-pack", request: "1.0.0", typed: true })).rejects.toBeInstanceOf(PackIntegrityMismatch);
    });
  });
}
