import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_SECURITY_SCAN, exampleRepo, PAYMENTS_PASSWORD, scanScript } from "../packs/review-fixtures.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, ESCALATION, scriptFile, writeRunRecord } from "./command-fixtures.js";
import { SAVED_DATA, SAVED_TEXT } from "./saved-report.js";

const MASK = "pay-… (21 characters)";
const QUOTES_IT = { ...EXAMPLE_SECURITY_SCAN, findings: EXAMPLE_SECURITY_SCAN.findings.map((finding, index) => (index === 0 ? { ...finding, problem: `The password ${PAYMENTS_PASSWORD} is in payments.js.`, detail: `literal ${PAYMENTS_PASSWORD}` } : finding)) };

async function reviewed(): Promise<{ repo: string; review: string }> {
  const repo = exampleRepo("secret-output-");
  const { stdout } = await delivery(["review", "security"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: await scriptFile(scanScript(QUOTES_IT)) } });
  return { repo, review: stdout };
}

describe("a secret the review found, in every output", () => {
  it("is masked in the review, the list, one problem in full and its JSON", async () => {
    const { repo, review } = await reviewed();
    const outputs = [review];
    for (const args of [["findings"], ["findings", "1"], ["findings", "1", "--json"]]) {
      const { stdout, stderr } = await delivery(args, { cwd: repo });
      outputs.push(stdout + stderr);
    }
    for (const output of outputs) expect(output).not.toContain(PAYMENTS_PASSWORD);
    expect(outputs.join("\n")).toContain(MASK);
  });

  it("is masked in status, the report, its saved copy and escalation text", async () => {
    const { repo } = await reviewed();
    const runId = "fix-payments-20261006T110000Z";
    await writeRunRecord(repo, { runId, outcome: { kind: "escalated", source: "worker", reason: `saw ${PAYMENTS_PASSWORD}`, at: "2026-10-06T11:00:00.000Z" }, packet: { ...ESCALATION, evidence: `the password ${PAYMENTS_PASSWORD} is in payments.js` } });
    const outputs: string[] = [];
    for (const args of [["status", runId], ["status", runId, "--json"], ["report", runId, "--write"], ["report", "--json"]]) {
      const { stdout, stderr } = await delivery(args, { cwd: repo });
      outputs.push(stdout + stderr);
    }
    outputs.push(readFileSync(join(repo, SAVED_TEXT), "utf-8"), readFileSync(join(repo, SAVED_DATA), "utf-8"));
    for (const output of outputs) expect(output).not.toContain(PAYMENTS_PASSWORD);
    expect(outputs.join("\n")).toContain(MASK);
  });

  it("is masked in error text", async () => {
    const { repo } = await reviewed();
    const { stderr } = await delivery(["findings", PAYMENTS_PASSWORD], { cwd: repo });
    expect(stderr).not.toContain(PAYMENTS_PASSWORD);
    expect(stderr).toContain(MASK);
  });
});
