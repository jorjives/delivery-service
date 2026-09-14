import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "./case-file.js";
import { createAgentPort, type RoleConfigs } from "./agent-invoke.js";
import { mockSessionEnvironment } from "./mock-session.js";
import { readJournal, writeMockScript, type JournalEvent, type MockScript } from "./mock-script.js";
import { resolveCloser } from "./resolve-closer.js";
import { run, type RunResult } from "./surface.js";
import type { AgentPort, SurfaceLocation, TriagePort } from "./ports.js";
import type { BudgetSet, CloserRef, CreateHeader } from "./schema.js";

/** Everything one scripted surface run needs: the project's own configuration, and what the agent will do. */
export interface ScriptedSurfaceRun {
  /** An existing, empty directory for the surface's case file. */
  dir: string;
  /** `repoPath`: a real git repository the surface branches from and closes into. `worktreePath`: where its worktree is created. */
  location: SurfaceLocation;
  /** The task, with the gate and closer named as data. Pinned in the case file, then resolved from there, as in a live run. */
  header: CreateHeader & { closerRef: CloserRef };
  budgets: BudgetSet;
  /** The pinned configuration each role is invoked with, through the real invocation path. */
  roleConfigs: RoleConfigs;
  /**
   * Which triage the surface uses, given the scripted agent port the run builds:
   * `() => deterministicRouter`, or `createAgentTriage` so triage's own replies
   * come from the same script.
   */
  triage: (agent: AgentPort) => TriagePort;
  /** What the scripted agent does and replies. Every session re-reads it from the start. */
  script: MockScript;
}

export interface ScriptedSurfaceResult {
  /** Where the surface ended, and its recorded outcome. */
  result: RunResult;
  /** Every event claude-mock journalled across the run's sessions, in order. */
  journal: JournalEvent[];
}

/**
 * Run one surface to its end against the vendored claude-mock, with the
 * production driver, agent port, gate and closer resolution and provisioning,
 * unchanged. Nothing here decides a transition: any retry or escalation
 * observed is the driver's own. No network, no API key.
 *
 * Whether the script was fully used is not checked here, because a script may
 * hold expectations for a branch this run never takes: call
 * `assertFullyConsumed(journal, script)` when it should have been.
 */
export async function runSurfaceAgainstMock(input: ScriptedSurfaceRun): Promise<ScriptedSurfaceResult> {
  const { dir, location, header, budgets, roleConfigs, triage, script } = input;
  const scratch = await mkdtemp(join(tmpdir(), "scripted-surface-"));
  const scriptPath = join(scratch, "mock.json");
  const journalPath = join(scratch, "journal.jsonl");
  await writeMockScript(scriptPath, script);
  await create(dir, header, budgets);

  const agent = createAgentPort(roleConfigs, mockSessionEnvironment({ scriptPath, journalPath }));
  const result = await run(dir, location, {
    agent,
    triage: triage(agent),
    closer: resolveCloser(header.closerRef, location.repoPath),
  });
  return { result, journal: await readJournal(journalPath) };
}
