import type { z } from "zod";

export type Issue = z.ZodError["issues"][number];

/** The value a file actually held at an issue's path, so a complaint can quote it back. */
export function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let here: unknown = raw;
  for (const step of path) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
}

/** Every issue on its own: zod reports several unknown keys in one issue, and each is its own problem to a person fixing the file. */
export const eachIssue = (error: z.ZodError): Issue[] =>
  error.issues.flatMap((issue): Issue[] => (issue.code === "unrecognized_keys" ? issue.keys.map((key) => ({ ...issue, keys: [key] })) : [issue]));

/** Where an issue sits in the file, dot-joined: an unknown key is named at its own place, not at the object that holds it. Null for the file as a whole. */
export function fieldOf(issue: Issue): string | null {
  const path = issue.code === "unrecognized_keys" ? [...issue.path, issue.keys[0] ?? ""] : issue.path;
  return path.length === 0 ? null : path.join(".");
}
