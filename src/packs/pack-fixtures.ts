import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { isEnoent } from "../journal.js";
import { packProblems, type PackProblem } from "./manifest.js";

/** Where each part of a pack's fixtures lives, relative to the pack's folder. */
export const FIXTURES = { project: "fixtures/project", review: "fixtures/review.json", fixes: "fixtures/fixes.json", expect: "fixtures/expect.json" } as const;
type FixturePart = keyof typeof FIXTURES;

/** What each part holds, said when it is missing. */
const HOLDS: Record<FixturePart, string> = {
  project: "the small project the scripted review reads and the scripted fixes change",
  review: "the scripted review's reply, as a claude-mock script",
  fixes: "the scripted fixes, honest and cheating, as a claude-mock script",
  expect: "what the scripted run must show: the problems found, the fixes that pass and the cheats that are refused",
};

const Title = z.string().trim().min(1, "must not be empty");

/** What a pack's scripted run must show. Titles are the handle, exactly as the scripted review writes them. */
export const FixtureExpectations = z
  .strictObject({
    found: z.array(Title).min(1, "must name at least one problem"),
    fixed: z.array(Title).min(1, "must name at least one problem whose scripted fix passes its check"),
    refused: z.array(Title).min(1, "must name at least one problem whose scripted cheat is refused"),
  })
  .superRefine((expected, ctx) => {
    if (new Set(expected.found).size !== expected.found.length) ctx.addIssue({ code: "custom", path: ["found"], message: "must not name the same problem twice" });
    for (const key of ["fixed", "refused"] as const) {
      expected[key].forEach((title, index) => {
        if (!expected.found.includes(title)) ctx.addIssue({ code: "custom", path: [key, index], message: 'names a problem "found" does not list' });
      });
    }
    expected.fixed.forEach((title, index) => {
      if (expected.refused.includes(title)) ctx.addIssue({ code: "custom", path: ["fixed", index], message: 'names a problem "refused" also names: one scripted fix cannot both pass and be refused' });
    });
  });
export type FixtureExpectations = z.infer<typeof FixtureExpectations>;

/** A claude-mock script, as far as the pack check needs to know: claude-mock checks the rest of it itself. */
const MockScriptShape = z.looseObject({ expectations: z.array(z.unknown()).min(1, "must script at least one reply") });

export interface PackFixtures {
  /** The project's files, by their path inside it. */
  project: Record<string, string>;
  reviewScript: string;
  fixesScript: string;
  expect: FixtureExpectations;
}

const missing = (file: string, part: FixturePart): PackProblem => ({ file, field: null, message: `is missing: it holds ${HOLDS[part]}` });

/** A JSON fixture file's text and parsed value, or what is wrong with it. */
async function jsonFixture<T>(dir: string, part: FixturePart, schema: z.ZodType<T>): Promise<{ text: string; value: T } | PackProblem[]> {
  const file = join(dir, FIXTURES[part]);
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return [missing(file, part)];
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [{ file, field: null, message: "is not valid JSON" }];
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { text, value: parsed.data } : packProblems(file, parsed.error, raw);
}

async function projectFiles(dir: string): Promise<Record<string, string> | PackProblem[]> {
  const root = join(dir, FIXTURES.project);
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [missing(root, "project")];
    throw err;
  }
  const files = entries.filter((entry) => entry.isFile());
  if (files.length === 0) return [{ file: root, field: null, message: `is empty: it holds ${HOLDS.project}` }];
  const pairs = await Promise.all(files.map(async (entry) => [relative(root, join(entry.parentPath, entry.name)), await readFile(join(entry.parentPath, entry.name), "utf-8")] as const));
  return Object.fromEntries(pairs.sort(([a], [b]) => a.localeCompare(b)));
}

/** Read a pack's fixtures, naming every problem with them by file and field. */
export async function readFixtures(dir: string): Promise<{ ok: true; fixtures: PackFixtures } | { ok: false; problems: PackProblem[] }> {
  const [project, review, fixes, expect] = await Promise.all([projectFiles(dir), jsonFixture(dir, "review", MockScriptShape), jsonFixture(dir, "fixes", MockScriptShape), jsonFixture(dir, "expect", FixtureExpectations)]);
  const problems = [project, review, fixes, expect].flatMap((part) => (Array.isArray(part) ? part : []));
  if (Array.isArray(project) || Array.isArray(review) || Array.isArray(fixes) || Array.isArray(expect)) return { ok: false, problems };
  return { ok: true, fixtures: { project, reviewScript: review.text, fixesScript: fixes.text, expect: expect.value } };
}
