import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { publishedKeys } from "../report/json-schema.js";
import { FINDINGS_SCHEMA, findingsDocument, findingsSchema } from "./findings-document.js";
import { UNDECIDED, type FindingState } from "./fix-state.js";
import type { SavedReview } from "./review-record.js";
import { sampleFinding } from "./review-fixtures.js";
import { CANNOT_BE_CHECKED, CHECK_LEVEL, NO_TESTS_LEVEL } from "./render.js";

const review: SavedReview = {
  dir: "/d",
  header: {
    reviewId: "code-20261005T101500Z",
    pack: { name: "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 40, categories: [{ id: "correctness", title: "Wrong results" }] },
    repoPath: "/home/dana/shop",
    commit: "abcdef0123456789abcdef0123456789abcdef01",
    fileCount: 84,
    startedAt: "2026-10-05T10:15:00.000Z",
    endedAt: "2026-10-05T10:19:12.000Z",
  },
  result: { findings: [sampleFinding(), sampleFinding({ id: "111111111111", title: "Old payment code", severity: "low", check: { kind: "none" } })], unconfirmed: [], notShown: 2, notes: "" },
};
const fixed: FindingState = { ...UNDECIDED, state: "fixed", fix: { run: "fix-a-20261005T110000Z", standing: "closed", closer: "merge-back", plain: null, rounds: [], branch: "surface/fix-a", base: "main", said: "Clamped." } };
const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("the findings document", () => {
  it("gives every problem with its state, its check's kind and level, and a pointer to its fix's run", () => {
    expect(findingsDocument(review, [fixed, UNDECIDED])).toEqual({
      schema: "delivery.findings/1",
      review: { id: "code-20261005T101500Z", pack: "code", title: "Code review", commit: "abcdef0123456789abcdef0123456789abcdef01", startedAt: "2026-10-05T10:15:00.000Z", endedAt: "2026-10-05T10:19:12.000Z" },
      problems: [
        {
          number: 1,
          id: "0123456789ab",
          title: "The price shown at checkout can be negative",
          category: "correctness",
          severity: "high",
          where: { path: "checkout.js", line: 3, endLine: 3 },
          state: "fixed",
          words: "fixed and merged",
          check: { kind: "anchor-gone", level: "checked: the flagged code is gone" },
          refused: false,
          cause: null,
          fix: { run: "fix-a-20261005T110000Z", branch: "surface/fix-a", base: "main", closer: "merge-back" },
        },
        {
          number: 2,
          id: "111111111111",
          title: "Old payment code",
          category: "correctness",
          severity: "low",
          where: { path: "checkout.js", line: 3, endLine: 3 },
          state: "proposed",
          words: "not yet decided",
          check: { kind: "none", level: "tests only: no check of this specific problem" },
          refused: false,
          cause: null,
          fix: null,
        },
      ],
      unconfirmed: 0,
      notShown: 2,
    });
  });

  it("never carries the flagged text or a check's pattern, which may hold a secret", () => {
    const text = JSON.stringify(findingsDocument({ ...review, result: { ...review.result, findings: [sampleFinding({ check: { kind: "pattern-absent", pattern: "pay-live-[0-9]+", paths: ["a.js"] } })] } }, [UNDECIDED]));
    expect(text).not.toContain("return price - discount;");
    expect(text).not.toContain("pay-live-");
  });

  it("is accepted by its published schema, read back as a consumer would", () => {
    const schema = findingsSchema();
    expect(Object.keys(schema)).toEqual([FINDINGS_SCHEMA]);
    expect(z.fromJSONSchema(schema[FINDINGS_SCHEMA]).safeParse(overTheWire(findingsDocument(review, [fixed, UNDECIDED]))).error).toBeUndefined();
  });

  it("gives each problem's level as the owner reads it in a project with no tests", () => {
    const header = { ...review.header, noTests: true as const };
    const saved: SavedReview = { dir: "/d", header, result: { findings: [sampleFinding(), sampleFinding({ id: "222222222222", check: { kind: "none" } })], unconfirmed: [], notShown: 0, notes: "" } };
    expect(findingsDocument(saved, [UNDECIDED, UNDECIDED]).problems.map((p) => p.check.level)).toEqual([`${CHECK_LEVEL["anchor-gone"]}; ${NO_TESTS_LEVEL}`, CANNOT_BE_CHECKED]);
  });
});

/** The stability promise: `findings-published-keys.txt` is every key and name `delivery.findings/1` has published. A line may never be removed or changed. */
describe("the findings document's stability promise", () => {
  const promised = readFileSync(new URL("./findings-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
  const current = Object.entries(findingsSchema()).flatMap(([name, format]) => publishedKeys(format, name));

  it("keeps every key and name ever published, each the kind of value it was", () => {
    expect(promised.filter((line) => !current.includes(line))).toEqual([]);
  });

  it("puts every key and name published now under the promise: add its line to findings-published-keys.txt", () => {
    expect(current.filter((line) => !promised.includes(line))).toEqual([]);
  });
});
