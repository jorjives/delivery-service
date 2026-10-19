import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleRepo, ideaText, PAYMENTS_IDEA, PAYMENTS_PASSWORD, type ScriptedIdea } from "../packs/review-fixtures.js";
import { delivery, ESCALATION, writeRunRecord } from "./command-fixtures.js";
import { SAVED_DATA, SAVED_TEXT } from "./saved-report.js";

const MASK = "pay-… (21 characters)";
const QUOTES_IT: ScriptedIdea = { ...PAYMENTS_IDEA, body: `The password ${PAYMENTS_PASSWORD} is in payments.js.` };

/** A repository whose backlog holds the sensitive idea that flags the password, as a scan leaves it. */
function withSecretIdea(prefix: string): string {
  const repo = exampleRepo(prefix);
  mkdirSync(join(repo, ".delivery", "backlog"), { recursive: true });
  writeFileSync(join(repo, ".delivery", "backlog", QUOTES_IT.file), ideaText(QUOTES_IT));
  return repo;
}

describe("a secret an idea flags, in every output", () => {
  it("is masked where an idea is named back to you, as an error names it", async () => {
    const repo = withSecretIdea("secret-output-");
    const { stderr } = await delivery(["approve", PAYMENTS_PASSWORD], { cwd: repo });
    expect(stderr).not.toContain(PAYMENTS_PASSWORD);
    expect(stderr).toContain(MASK);
  });

  it("is masked in status, the report, its saved copy and escalation text", async () => {
    const repo = withSecretIdea("secret-output-run-");
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
});

describe("a repository other than the working folder", () => {
  it("masks that repository's secrets", async () => {
    const repo = withSecretIdea("secret-output-other-");
    const elsewhere = mkdtempSync(join(tmpdir(), "secret-output-cwd-"));
    const { stderr } = await delivery(["approve", PAYMENTS_PASSWORD, "--repo", repo], { cwd: elsewhere });
    expect(stderr).not.toContain(PAYMENTS_PASSWORD);
    expect(stderr).toContain(MASK);
  });
});
