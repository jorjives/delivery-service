import { describe, expect, it } from "vitest";
import { parsePackageSpec } from "./pack-spec.js";

describe("parsePackageSpec", () => {
  it.each([
    ["docs-pack", { name: "docs-pack", request: "latest", typed: false }],
    ["docs-pack@1.2.0", { name: "docs-pack", request: "1.2.0", typed: true }],
    ["@acme/docs-pack", { name: "@acme/docs-pack", request: "latest", typed: false }],
    ["@acme/docs-pack@^1.2.0", { name: "@acme/docs-pack", request: "^1.2.0", typed: true }],
    ["docs-pack@next", { name: "docs-pack", request: "next", typed: true }],
    ["JSONStream", { name: "JSONStream", request: "latest", typed: false }],
  ])("reads %s as a registry package", (text, spec) => expect(parsePackageSpec(text)).toEqual(spec));

  it.each([
    ["git+https://example.com/x.git", "git"], ["github:acme/docs", "git"], ["acme/docs", "git"], ["x.git", "git"],
    ["https://example.com/x.tgz", "web"],
    ["./pack", "path"], ["/abs/pack", "path"], ["~/pack", "path"], ["file:../x", "path"], ["x-1.0.0.tgz", "path"],
    ["-x", "name"], ["a b", "name"], ["npm:other@1", "name"], ["a\0b", "name"], ["@acme", "name"], ["", "name"],
  ])("refuses %s as %s", (text, looksLike) => {
    expect(() => parsePackageSpec(text)).toThrow(expect.objectContaining({ code: "PACK_SPEC_REFUSED", spec: text, looksLike }));
  });
});
