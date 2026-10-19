import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import type { ItemCheck, Severity } from "../schema.js";
import type { MockScript } from "../mock-script.js";
import { initTempRepo } from "../temp-repo.js";

/** Test and demo support: the example project with planted flaws. */
export const EXAMPLE_DIR = fileURLToPath(new URL("../../examples/code-review-example/", import.meta.url));

/** A fresh git repository holding an example's files in one commit on `main`: the code-review example unless `dir` names another. */
export function exampleRepo(prefix = "code-review-example-", dir = EXAMPLE_DIR): string {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const files = Object.fromEntries(entries.map((entry) => { const path = join(entry.parentPath, entry.name); return [relative(dir, path), readFileSync(path, "utf-8")]; }));
  return initTempRepo(prefix, files);
}

/** One idea a scripted scan writes: its file in the backlog, and the item it becomes. */
export interface ScriptedIdea {
  file: string;
  title: string;
  severity: Severity;
  workflow: string;
  check: ItemCheck;
  body: string;
}

/** The text of an idea file, as the scan writes it. */
export function ideaText({ severity, workflow, check, title, body }: ScriptedIdea): string {
  return `---\n${stringify({ status: "idea", workflow, severity, check })}---\n# ${title}\n\n${body}\n`;
}

/** A scan session that writes these ideas and says it is done. */
export const ideasScript = (ideas: readonly ScriptedIdea[]): MockScript => ({
  expectations: [{ effects: ideas.map((idea) => ({ write: { path: `.delivery/backlog/${idea.file}`, content: ideaText(idea) } })), json: { status: "completed", rationale: `added ${ideas.length} ideas` } }],
});

/** What a code review of the example finds: three real problems, and one about a file that is not there. */
export const EXAMPLE_IDEAS: ScriptedIdea[] = [
  {
    file: "20260101T000000Z-checkout-price-negative.md",
    title: "The price shown at checkout can be negative",
    severity: "high",
    workflow: "code:fix",
    check: { kind: "anchor-gone", path: "checkout.js", anchor: "return price - discount;" },
    body: "A discount larger than the price makes the total negative, so the shop would pay the customer.\n\n## Why it matters\n\nWrong totals cost money and trust.\n\n## What fixed looks like\n\nA total never goes below zero.",
  },
  {
    file: "20260101T000100Z-settings-error.md",
    title: "A missing or broken settings file stops the shop with an unhelpful error",
    severity: "medium",
    workflow: "code:fix",
    check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["settings.js"] },
    body: "If the settings file is missing or not valid, the shop stops with a technical error instead of saying which file is wrong.\n\n## Why it matters\n\nWhoever runs the shop cannot tell what to fix.\n\n## What fixed looks like\n\nA missing or broken settings file gives a clear message naming the file.",
  },
  {
    file: "20260101T000200Z-legacy-gateway.md",
    title: "Old code for a payment provider you no longer use",
    severity: "low",
    workflow: "code:fix",
    check: { kind: "anchor-gone", path: "legacy-gateway.js", anchor: "export function chargeWithLegacyGateway(card, amount) {" },
    body: "Nothing calls this file any more.\n\n## Why it matters\n\nIt is extra code to look after, and it could confuse the next person.\n\n## What fixed looks like\n\nThe file is removed and everything still works.",
  },
  {
    file: "20260101T000300Z-price-rounding.md",
    title: "Prices are rounded the wrong way",
    severity: "medium",
    workflow: "code:fix",
    check: { kind: "anchor-gone", path: "pricing.js", anchor: "return Math.floor(price * 100) / 100;" },
    body: "Prices are rounded down.\n\n## Why it matters\n\nTotals come out a penny short.\n\n## What fixed looks like\n\nPrices are rounded to the nearest penny.",
  },
];

/** The password planted in the example's payments.js: what no output may ever show. */
export const PAYMENTS_PASSWORD = "pay-live-7Hq2xV9rLm4K";

/** The critical password idea a security review of the example finds. */
export const PAYMENTS_IDEA: ScriptedIdea = {
  file: "20260101T000000Z-payments-password.md",
  title: "A password for the payments service is written in the code",
  severity: "critical",
  workflow: "security:fix",
  check: { kind: "anchor-gone", path: "payments.js", anchor: `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, scope: "repo", sensitive: true },
  body: "The password the shop uses to take payments is written into payments.js.\n\n## Why it matters\n\nAnyone who can read this code can use the payments service as you, including people who should not see it, such as past contractors.\n\n## What fixed looks like\n\nThe password is not in the code, and the code reads it from somewhere private instead. The password has already been seen by everyone with access to the project: change it at the payments provider. Only a person can do that.",
};

/** What a security review of the example finds: a critical password in the code, and a library version with a known weakness. */
export const EXAMPLE_SECURITY_IDEAS: ScriptedIdea[] = [
  PAYMENTS_IDEA,
  {
    file: "20260101T000100Z-minimist-version.md",
    title: "An old version of the minimist library with a known weakness",
    severity: "medium",
    workflow: "security:fix",
    check: { kind: "dependency-absent", package: "minimist", version: "1.2.5" },
    body: "The project installs minimist 1.2.5, which lets specially made input change how every object in the program behaves.\n\n## Why it matters\n\nSomeone who controls that input could make the shop misbehave in ways that are hard to spot. Nothing in the shop passes outside input to it today.\n\n## What fixed looks like\n\nminimist is at version 1.2.6 or later.",
  },
];

/** Test and demo support: the no-tests example with planted flaws and no tests. */
export const NO_TESTS_DIR = fileURLToPath(new URL("../../examples/no-tests-example/", import.meta.url));

/** What a code review of the no-tests example finds: two problems with a specific check, and one whose check is its file's own anchor. */
export const NO_TESTS_IDEAS: ScriptedIdea[] = [
  {
    file: "20260101T000000Z-discount-percent.md",
    title: "A discount is taken off a hundred times over",
    severity: "high",
    workflow: "code:fix",
    check: { kind: "anchor-gone", path: "invoice.js", anchor: "return total - total * discountPercent;" },
    body: "The discount is a percentage, but it is subtracted as if it were a fraction, so a 10% discount takes off ten times the total.\n\n## Why it matters\n\nInvoices come out wrong, and can go below zero.\n\n## What fixed looks like\n\nA 10% discount takes off a tenth of the total.",
  },
  {
    file: "20260101T000100Z-settings-error.md",
    title: "A missing or broken settings file stops the program with an unhelpful error",
    severity: "medium",
    workflow: "code:fix",
    check: { kind: "pattern-absent", pattern: "JSON\\.parse\\(readFileSync\\(", paths: ["settings.js"] },
    body: "If the settings file is missing or not valid, the program stops with a technical error instead of saying which file is wrong.\n\n## Why it matters\n\nWhoever runs it cannot tell what to fix.\n\n## What fixed looks like\n\nA missing or broken settings file gives a clear message naming the file.",
  },
  {
    file: "20260101T000200Z-csv-export.md",
    title: "Old export code nothing uses",
    severity: "low",
    workflow: "code:fix",
    check: { kind: "anchor-gone", path: "csv-export.js", anchor: "export function invoiceToCsv(lines) {" },
    body: "Nothing calls this file any more.\n\n## Why it matters\n\nIt is extra code to look after, and it could confuse the next person.\n\n## What fixed looks like\n\nThe file is removed and everything still works.",
  },
];
