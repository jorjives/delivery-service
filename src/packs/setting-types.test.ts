import { describe, expect, it } from "vitest";
import {
  EMPTY,
  FORWARD_SLASHES,
  NOT_ABSOLUTE,
  NOT_PATH,
  NOT_PATHS,
  NOT_SEVERITY,
  NOT_TEXT,
  NO_BRACES,
  NO_GIT,
  NO_PARENT,
  ONE_LINE,
  PATHS_MAX,
  PATHS_MIN,
  PATHS_UNIQUE,
  TEXT_MAX,
  renderSettingValue,
  settingValueSchema,
  writtenAs,
  type SettingType,
} from "./setting-types.js";

const ok = (type: SettingType, value: unknown) => settingValueSchema({ type }).safeParse(value).success;
const why = (type: SettingType, value: unknown) => settingValueSchema({ type }).safeParse(value).error?.issues[0]?.message;

describe("setting value rules", () => {
  it.each([["text", "Use the new client."], ["path", "docs"], ["path", "."], ["path", "src/api"], ["paths", ["docs", "src/api"]], ["severity", "high"]] as const)("accepts a %s of %j", (type, value) => expect(ok(type, value)).toBe(true));
  it.each([
    ["text", "a{{b", NO_BRACES], ["text", "a}}b", NO_BRACES], ["path", "do{{cs", NO_BRACES],
    ["text", "two\nlines", ONE_LINE], ["path", `rtl${String.fromCodePoint(0x202e)}`, ONE_LINE], ["text", `zero${String.fromCodePoint(0x200b)}w`, ONE_LINE],
    ["text", "x".repeat(201), TEXT_MAX],
    ["path", "/etc", NOT_ABSOLUTE], ["path", "docs\\api", FORWARD_SLASHES], ["path", "../up", NO_PARENT], ["path", "docs/../../up", NO_PARENT],
    ["path", ".git/hooks", NO_GIT], ["path", "a/.git", NO_GIT],
    ["path", "./docs", writtenAs("docs")], ["path", "docs/", writtenAs("docs")], ["path", "docs//api", writtenAs("docs/api")],
    ["paths", [], PATHS_MIN], ["paths", Array.from({ length: 33 }, (_, i) => `d${i}`), PATHS_MAX], ["paths", ["docs", "docs"], PATHS_UNIQUE],
  ] as const)("refuses a %s of %j: %s", (type, value, message) => expect(why(type, value)).toBe(message));
  it.each([["paths", "docs", NOT_PATHS], ["text", 5, NOT_TEXT], ["text", true, NOT_TEXT], ["path", ["docs"], NOT_PATH], ["severity", "urgent", NOT_SEVERITY], ["path", "", EMPTY], ["text", "  ", EMPTY]] as const)("refuses a %s given %j, the wrong kind of value", (type, value, message) => expect(why(type, value)).toBe(message));
  it("never words a refusal with the word valid", () => {
    for (const [type, value] of [["text", 5], ["paths", "docs"], ["severity", "urgent"], ["path", null]] as const)
      expect(why(type, value)).not.toMatch(/valid/i);
  });
  it("renders a list joined with a comma and space, in the order given", () => expect(renderSettingValue(["b", "a"])).toBe("b, a"));
  it("renders a string as written", () => expect(renderSettingValue("docs")).toBe("docs"));
});
