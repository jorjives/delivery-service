import { describe, expect, it } from "vitest";
import { noBackend, platformOf, selectBackend, TEST_PLATFORM } from "./backend.js";
import { systemdBackend } from "./systemd.js";

describe("selectBackend", () => {
  it("uses systemd on Linux", () => expect(selectBackend("linux")).toBe(systemdBackend));
  it.each(["darwin", "win32", "freebsd"])("has no backend on %s, saying so in its probe", async (platform) =>
    expect(await selectBackend(platform).probe({})).toEqual({ ok: false, reason: noBackend(platform) }));
  it("says the platform in the spec's words", () => expect(noBackend("darwin")).toBe("darwin has no scheduler backend yet"));
  it("lists nothing and removes nothing where there is no backend", async () => {
    expect(await selectBackend("darwin").list("/w/app", {})).toEqual([]);
    expect(await selectBackend("darwin").remove("/w/app", "nightly", {})).toBe(false);
  });
  it("reads the platform from the contributor seam, else the host", () => {
    expect(platformOf({ [TEST_PLATFORM]: "darwin" })).toBe("darwin");
    expect(platformOf({})).toBe(process.platform);
  });
});
