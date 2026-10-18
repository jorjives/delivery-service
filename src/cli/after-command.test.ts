import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterLedgerPath, readAfter, recordAfter } from "../after-ledger.js";
import { ledgerPath } from "../item-ledger.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE } from "./command-fixtures.js";
import { dropped, nothingWaiting } from "./after-command.js";
import { EXIT } from "./failures.js";

async function withBatches() {
  const repo = initTempRepo("drop-after-", { "package.json": PACKAGE });
  const env = { XDG_STATE_HOME: mkdtempSync(join(tmpdir(), "drop-after-state-")) };
  const ledger = afterLedgerPath(ledgerPath(repo, env));
  const batch = (id: string) => ({
    t: "batch" as const, batch: id, branch: "delivery/main", base: "main", commit: "c", landed: [],
    followUps: [{ run: "r1", source: "tracker", file: `${id}.md`, text: "x" }],
    steps: [{ for: "follow-ups", label: "Raise follow-ups", step: { raise: true as const } }, { for: "project", label: "deploy", step: { run: "make deploy" } }],
  });
  await recordAfter(ledger, batch("b1"));
  await recordAfter(ledger, batch("b2"));
  return { repo, env, ledger };
}

describe("delivery drop-after", () => {
  it("drops the named batch's waiting steps, names the follow-ups left unraised, and leaves the other batch alone", async () => {
    const { repo, env, ledger } = await withBatches();
    const { exitCode, stdout } = await delivery(["drop-after", "b1"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(dropped(2));
    expect(stdout).toContain("b1.md");
    const [b1, b2] = await readAfter(ledger);
    expect(b1?.steps.map((s) => s.status)).toEqual(["skipped", "skipped"]);
    expect(b2?.steps.map((s) => s.status)).toEqual(["pending", "pending"]);
  });

  it("drops every waiting step when no batch is named, and says so when none is waiting", async () => {
    const { repo, env } = await withBatches();
    expect((await delivery(["drop-after"], { cwd: repo, env })).stdout).toContain(dropped(4));
    expect((await delivery(["drop-after"], { cwd: repo, env })).stdout).toContain(nothingWaiting);
  });

  it("refuses a batch that has nothing waiting", async () => {
    const { repo, env } = await withBatches();
    expect((await delivery(["drop-after", "nope"], { cwd: repo, env })).exitCode).toBe(EXIT.configuration);
  });
});
