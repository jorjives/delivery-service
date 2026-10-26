import { posix } from "node:path";
import { z } from "zod";
import { SEVERITIES } from "../schema.js";
import { hasHidden } from "./hidden-characters.js";

export const SETTING_TYPES = ["text", "path", "paths", "severity"] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const NO_BRACES = "must not hold {{ or }}";
export const ONE_LINE = "must be one line of plain text, with no line break, tab or hidden character";
export const TEXT_MAX = "must be at most 200 characters";
export const NOT_ABSOLUTE = "must be a path inside the project, not one starting with /";
export const FORWARD_SLASHES = "must use / between folders";
export const NO_PARENT = "must not leave the project";
export const NO_GIT = "must not name .git";
export const writtenAs = (normal: string) => `must be written as "${normal}"`;
export const PATHS_MIN = "must list at least one path";
export const PATHS_MAX = "must list at most 32 paths";
export const PATHS_UNIQUE = "must not list a path twice";
export const EMPTY = "must not be empty";
export const NOT_TEXT = "must be text in quotes";
export const NOT_PATH = "must be one path in quotes";
export const NOT_PATHS = 'must be a list of paths, such as ["docs"]';
export const NOT_SEVERITY = "must be one of critical, high, medium or low";

const BRACES = /\{\{|\}\}/;

/** One line of plain text: no hidden character (line break and tab included), no template braces. */
const plainLine = (notString: string) =>
  z
    .string({ error: notString })
    .refine((text) => !hasHidden(text), { message: ONE_LINE })
    .refine((text) => !BRACES.test(text), { message: NO_BRACES });

export const TextValue = plainLine(NOT_TEXT)
  .trim()
  .min(1, { message: EMPTY })
  .max(200, { message: TEXT_MAX });

export const SeverityValue = z.enum(SEVERITIES, { error: NOT_SEVERITY });

export const PathValue = plainLine(NOT_PATH)
  .min(1, { message: EMPTY })
  .superRefine((value, ctx) => {
    const segments = value.split("/");
    const refuse = (message: string) => ctx.addIssue({ code: "custom", message, input: value });
    if (value.includes("\\")) return refuse(FORWARD_SLASHES);
    if (posix.isAbsolute(value)) return refuse(NOT_ABSOLUTE);
    if (segments.includes("..")) return refuse(NO_PARENT);
    if (segments.includes(".git")) return refuse(NO_GIT);
    const normal = posix.normalize(value).replace(/(.)\/$/, "$1");
    if (normal !== value) return refuse(writtenAs(normal));
  });

export const PathsValue = z
  .array(PathValue, { error: NOT_PATHS })
  .min(1, { message: PATHS_MIN })
  .max(32, { message: PATHS_MAX })
  .refine((paths) => new Set(paths).size === paths.length, { message: PATHS_UNIQUE });

export type SettingValue = string | string[];

const SCHEMAS: Record<SettingType, z.ZodType<SettingValue>> = {
  text: TextValue,
  path: PathValue,
  paths: PathsValue,
  severity: SeverityValue,
};

/** The value rule for a setting of this declared type, used for both pack defaults and owner values. */
export function settingValueSchema(declaration: { type: SettingType }): z.ZodType<SettingValue> {
  return SCHEMAS[declaration.type];
}

/** A string as written; a list joined with a comma and a space, in the order given. */
export function renderSettingValue(value: SettingValue): string {
  return typeof value === "string" ? value : value.join(", ");
}
