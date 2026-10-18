import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { mockSessionEnvironment, promptsSent, readJournal, writeMockScript, type MockScript } from "./testing.js";
import { readAfter, recordAfter } from "./after-ledger.js";
import { runAgentPass } from "./after-agent.js";
import type { FenceRecord } from "./schema.js";

const OFF: FenceRecord = { mode: "off", devices: [], state: { present: false, reason: "turned off in your configuration" } };
const FOLLOW = ".delivery/backlog/20261018T090000Z-check-the-docs.md";

async function passWith(script: MockScript) {
  const repo = initTempRepo("after-agent-", { "package.json": "{}", "README.md": "hello\n" });
  const commit = git(repo, ["rev-parse", "HEAD"]);
  const ledger = join(mkdtempSync(join(tmpdir(), "after-agent-ledger-")), "after.jsonl");
  await recordAfter(ledger, { t: "batch", batch: "b1", branch: "delivery/main", base: "main", commit, landed: [{ run: "r1", item: "backlog:a.md", intent: "say hello" }], followUps: [], steps: [{ for: "project", label: "notes", step: { prompt: "Write release notes." } }] });
  const scriptPath = join(mkdtempSync(join(tmpdir(), "after-agent-script-")), "script.json");
  await writeMockScript(scriptPath, script);
  const journalPath = `${scriptPath}.journal.jsonl`;
  const result = await runAgentPass("Write release notes.", { state: (await readAfter(ledger))[0]!, index: 0 }, {
    repoPath: repo, env: process.env, session: mockSessionEnvironment({ scriptPath, journalPath }), fence: OFF,
  });
  return { repo, result, journalPath };
}

describe("an after agent pass", () => {
  it("keeps the new backlog items it wrote, discards every other change, and leaves nothing behind", async () => {
    const { repo, result } = await passWith({
      expectations: [{
        effects: [{ write: { path: FOLLOW, content: "---\nstatus: open\n---\nCheck the docs.\n" } }, { edit: { path: "README.md", old: "hello", new: "changed" } }],
        json: { status: "completed", rationale: "notes posted, one follow-up" },
      }],
    });
    expect(result).toEqual({ ok: true, items: [{ file: "20261018T090000Z-check-the-docs.md", text: "---\nstatus: open\n---\nCheck the docs.\n" }], discarded: ["README.md"] });
    expect(git(repo, ["show", "HEAD:README.md"])).toBe("hello");
    expect(git(repo, ["branch", "--list", "surface/*"])).toBe("");
    expect(git(repo, ["worktree", "list"]).split("\n")).toHaveLength(1);
  });

  it("is told what landed and that only new backlog items survive it", async () => {
    const { journalPath } = await passWith({ expectations: [{ json: { status: "completed", rationale: "done" } }] });
    const [prompt] = promptsSent(await readJournal(journalPath));
    expect(prompt).toContain("Write release notes.");
    expect(prompt).toContain("say hello (backlog:a.md)");
    expect(prompt).toContain("new item file in .delivery/backlog/");
  });

  it("does not work when the agent escalates, or when it edits an existing item or writes an invalid one", async () => {
    const escalated = await passWith({ expectations: [{ json: { status: "escalate", category: "decision", rationale: "no notes channel", question: "Where?" } }] });
    expect(escalated.result).toEqual({ ok: false, detail: "the agent did not finish: no notes channel" });
    const invalid = await passWith({ expectations: [{ effects: [{ write: { path: ".delivery/backlog/bad.md", content: "nope\n" } }], json: { status: "completed", rationale: "done" } }] });
    expect(invalid.result).toMatchObject({ ok: false, detail: expect.stringContaining("changed the backlog in a way it may not: .delivery/backlog/bad.md") });
  });
});
