import { describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEnvironment } from "../agent-invoke.js";
import { mockSessionEnvironment, resolveMockExecutable } from "../mock-session.js";
import { initTempRepo } from "../temp-repo.js";
import { completes, delivery, PACKAGE, RUN_TIMEOUT, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { RULE } from "./preview-command.js";

// `delivery run` gets its agent from agentSession; this file hands it the
// scripted agent with a recorder in front, so the real queue path runs
// unchanged and what it sends can be read back.
const wiring = vi.hoisted(() => ({ session: undefined as SessionEnvironment | undefined }));
vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: async () => {
    if (wiring.session === undefined) throw new Error("no session wired for this test");
    return wiring.session;
  },
}));

/**
 * The scripted agent, with everything the harness sends it copied to
 * `capture` on the way in. claude-mock's journal records only the task turn;
 * the instructions travel in the SDK's opening `initialize` request, so the
 * wire is the only place to read them.
 * ponytail: a tee in front of stdin. If claude-mock journals the initialize request upstream, re-vendor and read the journal instead.
 */
function recordingSession(scriptPath: string, capture: string): SessionEnvironment {
  const wrapper = join(mkdtempSync(join(tmpdir(), "preview-wire-")), "claude");
  writeFileSync(wrapper, `#!/bin/sh\ntee -a '${capture}' | '${process.execPath}' '${resolveMockExecutable()}' "$@"\n`);
  chmodSync(wrapper, 0o755);
  return { ...mockSessionEnvironment({ scriptPath, journalPath: `${scriptPath}.journal.jsonl` }), pathToClaudeCodeExecutable: wrapper };
}

interface Sent {
  systemPrompt: string;
  prompt: string;
}

interface Frame {
  type?: string;
  request?: { subtype?: string; systemPrompt?: string[] };
  message?: { content?: Array<{ type?: string; text?: string }> | string };
}

/** Each session's instructions and its one turn, in the order the sessions started. */
function sessionsSent(capture: string): Sent[] {
  const frames = readFileSync(capture, "utf-8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Frame);
  const systemPrompts = frames.flatMap((f) =>
    f.type === "control_request" && f.request?.subtype === "initialize" ? [(f.request.systemPrompt ?? []).join("")] : [],
  );
  const prompts = frames.flatMap((f) => {
    const content = f.type === "user" ? f.message?.content : undefined;
    if (content === undefined) return [];
    // Text blocks only, joined as claude-mock's own promptOf joins them.
    return [typeof content === "string" ? content : content.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n")];
  });
  return systemPrompts.map((systemPrompt, i) => ({ systemPrompt, prompt: prompts[i] ?? "" }));
}

/** The instructions a preview printed: everything between its two rules. */
function framed(stdout: string): string {
  const block = stdout.split(`${RULE}\n`)[1];
  if (block === undefined) throw new Error(`no framed instructions in:\n${stdout}`);
  return block;
}

const DOMAIN = "A small internal tool that greets people by name. All user-facing messages are written in French.";
// Distinct in their first five words: runIdFor slugs a run directory from
// that many leading words plus a second-granularity timestamp, and this
// two-task run can land in the same clock second, so a shared prefix here
// would collide on one run directory.
const FIRST = "add a hello function that greets a name, with a test";
const SECOND = "add a goodbye function that farewells a name, with a test";

describe("what delivery preview prints is what a real run sends", () => {
  it(
    "matches, byte for byte, the instructions and the task turn each run's first session was sent",
    async () => {
      const repo = initTempRepo("preview-matches-run-", {
        "package.json": PACKAGE,
        "delivery.config.json": JSON.stringify({ domain: DOMAIN, tasks: [FIRST, SECOND] }),
      });
      const next = await delivery(["preview"], { cwd: repo });
      const second = await delivery(["preview", "--queue-index", "2"], { cwd: repo });
      expect(next.exitCode).toBe(EXIT.ok);
      expect(second.exitCode).toBe(EXIT.ok);

      const capture = join(mkdtempSync(join(tmpdir(), "preview-capture-")), "wire.jsonl");
      wiring.session = recordingSession(await scriptFile(completes), capture);
      const run = await delivery(["run"], { cwd: repo });
      expect(run.exitCode).toBe(EXIT.ok);

      const sent = sessionsSent(capture);
      expect(sent).toHaveLength(2);
      const [toFirst, toSecond] = sent as [Sent, Sent];
      expect(toFirst.systemPrompt).toContain(DOMAIN);
      expect(framed(next.stdout)).toBe(`${toFirst.systemPrompt}\n\n${toFirst.prompt}\n`);
      expect(framed(second.stdout)).toBe(`${toSecond.systemPrompt}\n\n${toSecond.prompt}\n`);
    },
    RUN_TIMEOUT * 2,
  );
});
