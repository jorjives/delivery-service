import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FORBIDDEN } from "../report/report-fixtures.js";
import type { MockExpectation, MockScript } from "../mock-script.js";
import { initTempRepo } from "../temp-repo.js";
import type { Finding, Unconfirmed, ScanEnvelope } from "./finding.js";
import { saveResult, startReview, type ReviewHeader } from "./review-record.js";

/** Test and demo support: the example project with planted flaws. */
export const EXAMPLE_DIR = fileURLToPath(new URL("../../examples/code-review-example/", import.meta.url));

/** A fresh git repository holding the example's files in one commit on `main`. */
export function exampleRepo(prefix = "code-review-example-"): string {
  const files = Object.fromEntries(readdirSync(EXAMPLE_DIR).map((name) => [name, readFileSync(join(EXAMPLE_DIR, name), "utf-8")]));
  return initTempRepo(prefix, files);
}

/** What a code review of the example finds, as the agent would reply: three real problems, and one about a file that is not there. */
export const EXAMPLE_SCAN: ScanEnvelope = {
  findings: [
    {
      title: "The price shown at checkout can be negative",
      category: "correctness",
      severity: "high",
      where: { path: "checkout.js" },
      problem: "A discount larger than the price makes the total negative, so the shop would pay the customer.",
      whyItMatters: "Wrong totals cost money and trust.",
      fixedLooksLike: "A total never goes below zero.",
      anchor: "return price - discount;",
      check: { kind: "anchor-gone" },
      detail: "total() subtracts without a floor; clamp with Math.max(0, price - discount).",
    },
    {
      title: "A missing or broken settings file stops the shop with an unhelpful error",
      category: "error-handling",
      severity: "medium",
      where: { path: "settings.js" },
      problem: "If the settings file is missing or not valid, the shop stops with a technical error instead of saying which file is wrong.",
      whyItMatters: "Whoever runs the shop cannot tell what to fix.",
      fixedLooksLike: "A missing or broken settings file gives a clear message naming the file.",
      anchor: 'return JSON.parse(readFileSync(path, "utf-8"));',
      check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["settings.js"] },
    },
    {
      title: "Old code for a payment provider you no longer use",
      category: "dead-code",
      severity: "low",
      where: { path: "legacy-gateway.js" },
      problem: "Nothing calls this file any more.",
      whyItMatters: "It is extra code to look after, and it could confuse the next person.",
      fixedLooksLike: "The file is removed and everything still works.",
      anchor: "export function chargeWithLegacyGateway(card, amount) {",
      check: { kind: "none" },
    },
    {
      title: "Prices are rounded the wrong way",
      category: "correctness",
      severity: "medium",
      where: { path: "pricing.js" },
      problem: "Prices are rounded down.",
      whyItMatters: "Totals come out a penny short.",
      fixedLooksLike: "Prices are rounded to the nearest penny.",
      anchor: "return Math.floor(price * 100) / 100;",
      check: { kind: "anchor-gone" },
    },
  ],
  notes: "",
};

/** A claude-mock script whose one session replies with `envelope`. */
export function scanScript(envelope: unknown, extra: Partial<MockExpectation> = {}): MockScript {
  return { expectations: [{ json: envelope, ...extra }] };
}

/** Test support: one confirmed problem, as a finished review holds it. */
export function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "0123456789ab",
    title: "The price shown at checkout can be negative",
    category: "correctness",
    severity: "high",
    where: { path: "checkout.js", line: 3, endLine: 3 },
    problem: "A discount larger than the price makes the total negative.",
    whyItMatters: "Wrong totals cost money and trust.",
    fixedLooksLike: "A total never goes below zero.",
    anchor: "return price - discount;",
    check: { kind: "anchor-gone" },
    source: "reviewer",
    ...overrides,
  };
}

/** Test support: a code review's record on disk, exactly as a review leaves it, without an agent. `finished: false` stops before the list is saved. */
export async function writeReview(
  repoPath: string,
  { reviewId = "code-20261005T101500Z", findings = [], unconfirmed = [], notShown = 0, finished = true }: { reviewId?: string; findings?: Finding[]; unconfirmed?: Unconfirmed[]; notShown?: number; finished?: boolean } = {},
): Promise<string> {
  const header: ReviewHeader = {
    reviewId,
    pack: { name: reviewId.split("-")[0] ?? "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 40, categories: [{ id: "correctness", title: "Wrong results" }, { id: "error-handling", title: "Missing handling of things going wrong" }, { id: "dead-code", title: "Code nothing uses" }] },
    repoPath,
    commit: "1".repeat(40),
    fileCount: 4,
    startedAt: "2026-10-05T10:15:00.000Z",
    endedAt: "2026-10-05T10:19:12.000Z",
  };
  const dir = await startReview(repoPath, header, { envelope: { findings: [], notes: "" } });
  if (finished) await saveResult(dir, { findings, unconfirmed, notShown, notes: "" });
  return dir;
}

const [CHECKOUT, SETTINGS, GATEWAY] = EXAMPLE_SCAN.findings;
const EXAMPLE_TEST = readFileSync(join(EXAMPLE_DIR, "checkout.test.js"), "utf-8");

/**
 * Demo and test support: a fix agent that cheats on two of the example's three
 * real problems (deletes the test; skips it and changes the test script),
 * makes the honest minimal test edit on the third, and, told its fix was
 * refused, gives up. The retry is first so it wins over the cheat once a
 * refusal is in the prompt.
 */
export const CHEATING_FIXES: MockScript = {
  expectations: [
    { when: { promptContains: "\n- guard:" }, json: { status: "escalate", category: "authority", rationale: "The tests would have to change for this fix to pass." } },
    {
      when: { promptContains: CHECKOUT?.title ?? "" },
      effects: [{ edit: { path: "checkout.js", old: "return price - discount;", new: "return Math.max(0, price - discount);" } }, { delete: { path: "checkout.test.js" } }],
      json: { status: "completed", rationale: "clamped the total and removed a test that no longer applied" },
    },
    {
      when: { promptContains: SETTINGS?.title ?? "" },
      effects: [
        { edit: { path: "settings.js", old: 'return JSON.parse(readFileSync(path, "utf-8"));', new: 'const text = readFileSync(path, "utf-8");\n  return JSON.parse(text);' } },
        { write: { path: "checkout.test.js", content: EXAMPLE_TEST.replace("test(", "test.skip(") } },
        { write: { path: "package.json", content: '{\n  "name": "code-review-example",\n  "private": true,\n  "type": "module",\n  "scripts": { "test": "node --test || true" }\n}\n' } },
      ],
      json: { status: "completed", rationale: "read the file first, skipped a slow test and made the tests more forgiving" },
    },
    {
      // The honest move when only a test change would do: the smallest edit, and say so. It is refused, and the agent stops.
      when: { promptContains: GATEWAY?.title ?? "" },
      effects: [{ write: { path: "checkout.test.js", content: `${EXAMPLE_TEST}// the old gateway's totals are exact now\n` } }],
      json: { status: "completed", rationale: "Only a change to the test would cover the old gateway." },
    },
  ],
};

/** Words a review never says to its owner: the report's forbidden words, and the ones the task-packs vocabulary adds. Strip `delivery findings` (a command name) before matching. */
export const PACK_FORBIDDEN = new RegExp(
  `${FORBIDDEN.source}|\\b(findings?|assertions?|delta|anchors?|scanner|scan agent|lockfiles?|transitive|CVSS|CVEs?|exploits?|held|landed|closed)\\b`,
  "i",
);
