import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../../tests/helpers.js";
import { ledgerPath, readItemLedger } from "../item-ledger.js";
import type { MockScript } from "../mock-script.js";
import { ideasScript, type ScriptedIdea } from "../packs/review-fixtures.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { delivery, docsProject, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";

const PAGE = "docs/api.md";
const ORIGINAL = "# API\n\nRun the old build with `npm run legacy-build`.\n\nCall `render()` to draw a page.\n";
const STALE_LINE = "Run the old build with `npm run legacy-build`.";

const IDEA: ScriptedIdea = {
  file: "20261026T120000Z-old-build-line.md",
  title: "The API page still gives the old build command",
  severity: "medium",
  workflow: "docs:fix",
  check: { kind: "anchor-gone", path: PAGE, anchor: STALE_LINE },
  body: "The API page tells readers to run a build that no longer exists.",
};

const FIXES: MockScript = {
  expectations: [
    {
      when: { promptContains: IDEA.title },
      effects: [{ write: { path: PAGE, content: "# API\n\nCall `render()` to draw a page.\n" } }],
      json: { status: "completed", rationale: "removed the stale line" },
    },
  ],
};

/** A fresh docs project, with the owner's `packSettings` when given, taken through review, approve and run, each command with its own scripted agent. */
async function ranDocs(packSettings?: Record<string, unknown>) {
  const repo = docsProject(packSettings);
  const state = mkdtempSync(join(tmpdir(), "pack-hold-state-"));
  const env = async (script: MockScript) => ({ XDG_STATE_HOME: state, [TEST_MOCK_SCRIPT]: await scriptFile(script) });
  const step = async (args: string[], script: MockScript) => delivery(args, { cwd: repo, env: await env(script) });
  for (const [args, script] of [[["review", "docs"], ideasScript([IDEA])], [["approve", "--all"], FIXES]] as const) {
    const { exitCode, stdout, stderr } = await step([...args], script);
    expect(exitCode, stdout + stderr).toBe(EXIT.ok);
  }
  // The run ends needing a person when the idea is held, so its exit code is not "ok"; the ledger below says what happened.
  await step(["run", "--sources", "--max", "1"], FIXES);
  return { repo, ledger: await readItemLedger(ledgerPath(repo, await env(FIXES))) };
}

describe("delivery run on a docs pack's fix, with its hold from a setting", () => {
  it("lands a fix the default high does not hold", async () => {
    const { repo, ledger } = await ranDocs();
    expect(ledger.get(`backlog:${IDEA.file}`)?.lastClass).toBe("delivered");
    expect(git(repo, ["show", `delivery/main:${PAGE}`])).toBe("# API\n\nCall `render()` to draw a page.");
  }, RUN_TIMEOUT * 4);

  it("holds a fix the owner's medium reaches, and leaves the page as it was", async () => {
    const { repo, ledger } = await ranDocs({ docs: { "hold-from": "medium" } });
    expect(ledger.get(`backlog:${IDEA.file}`)).toMatchObject({ parked: "held" });
    expect(git(repo, ["show", `delivery/main:${PAGE}`])).toBe(ORIGINAL.trimEnd());
  }, RUN_TIMEOUT * 4);
});
