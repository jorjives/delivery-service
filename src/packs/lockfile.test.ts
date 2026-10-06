import { describe, expect, it } from "vitest";
import { lockfileHas } from "./lockfile.js";

const V3 = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { minimist: "1.2.5" } },
    "node_modules/minimist": { version: "1.2.5" },
    "node_modules/a/node_modules/left-pad": { version: "1.0.0" },
    "node_modules/@scope/pkg": { version: "2.0.0" },
  },
});
const V1 = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: "1.0.0", dependencies: { minimist: { version: "0.0.8" } } } } });

describe("whether an npm lockfile installs a version", () => {
  it("finds it at the top or nested, scoped or not, in a v2 or v3 lockfile", () => {
    expect(lockfileHas(V3, "minimist", "1.2.5")).toBe(true);
    expect(lockfileHas(V3, "left-pad", "1.0.0")).toBe(true);
    expect(lockfileHas(V3, "@scope/pkg", "2.0.0")).toBe(true);
  });

  it("says no for another version, or for a name that only ends the same", () => {
    expect(lockfileHas(V3, "minimist", "1.2.6")).toBe(false);
    expect(lockfileHas(V3, "pad", "1.0.0")).toBe(false);
  });

  it("reads a v1 lockfile's nested dependencies", () => {
    expect(lockfileHas(V1, "minimist", "0.0.8")).toBe(true);
    expect(lockfileHas(V1, "minimist", "1.2.5")).toBe(false);
  });

  it("cannot say for text that is not a lockfile", () => {
    expect(lockfileHas("not json", "minimist", "1.2.5")).toBeUndefined();
    expect(lockfileHas("[]", "minimist", "1.2.5")).toBeUndefined();
    expect(lockfileHas("{}", "minimist", "1.2.5")).toBeUndefined();
  });
});
