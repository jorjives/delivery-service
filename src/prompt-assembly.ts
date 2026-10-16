import { isAbsolute } from "node:path";
import { z } from "zod";
import { deriveBudgetsFromLog, logTail, readRef, setbackOf, type Setback } from "./case-file.js";
import { NewFailure, countsNewAssertions, type BudgetSet, type CaseFile, type GateRef } from "./schema.js";
import type { RoleConfig } from "./role-config.js";
import { SharpenedBrief } from "./triage-role-config.js";
import { GATE_ERROR_EVIDENCE } from "./escalation-packet.js";
import type { GuardName } from "./guards.js";
import { activeGuards } from "./task-guards.js";

export interface PromptSetback extends Setback {
  /** Log-derived used/max per population at the moment of the setback. */
  budgets: BudgetSet;
  /** The worker's escalate rationale, the close report's detail, or the gate-error sentence; null for a gate failure. */
  detail: string | null;
  /** Rationales of every earlier triage round, oldest first. */
  priorRationales: string[];
}

/** The parts of the prompt that live behind refs rather than in the log itself. */
export interface PromptEvidence {
  /** The sharpened brief behind the latest dispatch's briefRef, or null. */
  brief: SharpenedBrief | null;
  newFailures: NewFailure[];
  /** The setback on the log tail, or null when the tail is not one. Rendered for triage only. */
  setback: PromptSetback | null;
}

/** One assembled request: the session's system prompt and its single user turn. */
export interface AssembledPrompt {
  systemPrompt: string;
  prompt: string;
}

/**
 * The ref shape `surface.ts` writes for an agent-path triage round. Exported so
 * `surface.ts` can ask the same question — "does this ref carry a usable
 * brief?" — with the same validation, rather than a second, weaker check.
 */
export const BriefRef = z.object({ artifact: SharpenedBrief });
const CloseDetail = z.object({ detail: z.string() });

/** A brief as the session it was written for reads it, one line per field. Exported so a report shows exactly what that session was told. */
export function briefLines(brief: SharpenedBrief): string[] {
  return [
    `Problem: ${brief.problem}`,
    `Dead ends: ${brief.dead_ends}`,
    `Scope: ${brief.scope}`,
    `References: ${brief.references.length === 0 ? "none" : brief.references.join(", ")}`,
    `Diagnosis (a hypothesis to test, not an established fact): ${brief.diagnosis}`,
  ];
}

/** Where the agent's work ends, in Autoloop's wording, which has held under the same conditions. Also the git hooks' refusal. */
export const LANDING_BOUNDARY =
  "Your branch is the deliverable. The harness merges or opens a PR after acceptance. Do not merge, push, or open a PR, even if a skill says to.";

/** How a command gate's output is read, in the agent's terms. */
const READ_AS: Record<"tap" | "junit" | "exitcode", string> = {
  tap: "each test's own result is read from its TAP output",
  junit: "each test's own result is read from its JUnit report",
  exitcode: "it passes or fails as a whole, by its exit code",
};

/** What each guard checks, as one clause of the Acceptance paragraph. */
const GUARD_WORDS: Record<GuardName, string> = {
  "tests-untouched": "no existing test deleted or renamed",
  "tests-unchanged": "no existing test edited",
  "check-untouched":
    "no change to how tests run (test-runner settings, CI files, the test command, .gitignore, and the Makefile or equivalent build file, since each can hide or redefine what the tests do)",
  "no-skips": "no new skip or only marker added to a test file",
  ignored: "no test setting, or test that switches others off, left out of git",
};

/** The check that judges the work, and how the agent can run it itself. */
const hooksOf = (gateRef: Extract<GateRef, { type: "command" }>): string => {
  const parts = [
    ...(gateRef.setup === undefined ? [] : [`Before it runs, \`${gateRef.setup}\` sets up`]),
    ...(gateRef.teardown === undefined ? [] : [`afterwards, \`${gateRef.teardown}\` tears down, whatever the result`]),
  ];
  return parts.length === 0 ? "" : ` ${parts.join("; ").replace(/^a/, "A")}.`;
};

function gateLines(gateRef: GateRef): string {
  if (gateRef.type === "command") {
    const counted = countsNewAssertions(gateRef) ? ", and a new check that fails counts against it" : "";
    return (
      `Your work is judged by the project's check: the command \`${gateRef.command}\`, run in this working copy, where ${READ_AS[gateRef.parseMode]}. ` +
      `You may read what it runs and run it yourself. A check that passed before your work must still pass${counted}.${hooksOf(gateRef)}`
    );
  }
  const where = isAbsolute(gateRef.modulePath) ? "" : " in the project's main folder";
  return `Your work is judged by the project's check: the module \`${gateRef.modulePath}\`${where}. You may read it. It is verified unchanged when your work is judged.`;
}

/** What will judge the work: the check, the guards in one paragraph, and where the work ends. Pure: read from the header alone. */
function acceptance(caseFile: CaseFile): string {
  const { on } = activeGuards(caseFile.header.taskDef);
  const guards =
    on.length === 0
      ? []
      : [`The harness also checks your change against the commit this task started from: ${on.map((name) => GUARD_WORDS[name]).join("; ")}. A failure names what it found.`, ""];
  return [gateLines(caseFile.header.gateRef), "", ...guards, LANDING_BOUNDARY].join("\n");
}

/**
 * Read what the log points at. The only I/O in this module, split out so that
 * `assemblePrompt` stays a pure function of its arguments and determinism is
 * something you can assert rather than hope for.
 */
export async function resolveEvidence(dir: string, caseFile: CaseFile): Promise<PromptEvidence> {
  const history = [...caseFile.history].reverse();

  const gate = history.find((entry) => entry.t === "gate");
  const parsedFailures = await Promise.all(
    (gate?.newFailures ?? []).map((failure) =>
      readRef(dir, failure.detailRef).then((raw) => NewFailure.safeParse(raw)),
    ),
  );
  const newFailures = parsedFailures.flatMap((p) => (p.success ? [p.data] : []));

  // A deterministic reroute's ref has no artefact; that dispatch has no brief.
  const dispatch = history.find((entry) => entry.t === "dispatch");
  const briefRef = dispatch?.briefRef ? BriefRef.safeParse(await readRef(dir, dispatch.briefRef)) : undefined;
  const brief = briefRef?.success ? briefRef.data.artifact : null;

  return { brief, newFailures, setback: await resolveSetback(dir, caseFile) };
}

/** The setback on the log tail, with the evidence and history triage reads. */
async function resolveSetback(dir: string, caseFile: CaseFile): Promise<PromptSetback | null> {
  const tail = logTail(caseFile);
  const setback: Setback | undefined = setbackOf(tail);
  if (!setback) return null;

  let detail: string | null = null;
  if (tail?.t === "terminus") detail = tail.rationale;
  if (tail?.t === "close") {
    const report = CloseDetail.safeParse(await readRef(dir, tail.detailRef));
    detail = report.success ? report.data.detail : null;
  }
  if (tail?.t === "gate" && tail.status === "ERROR") detail = GATE_ERROR_EVIDENCE;

  return {
    ...setback,
    budgets: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
    detail,
    priorRationales: caseFile.history.flatMap((e) => (e.t === "triage" ? [e.rationale] : [])),
  };
}

/**
 * The slots of `docs/agent-interface.md`: task, acceptance (worker and gate maintenance),
 * brief, gate evidence, setback (triage only) and reply format, in fixed order, split across the
 * two fields the SDK takes. The project supplies content — the task, the domain
 * fragment — never the structure: if a project could reorder or drop a slot it
 * could tell a worker not to emit an envelope, and INCOMPLETE_TERMINUS would
 * stop meaning "the session produced nothing usable".
 *
 * Pure: no clock, no randomness, no I/O, and no `sessionKey`. The same case file
 * yields a byte-identical request, so a reconstructed session after a crash is
 * the same session.
 */
export function assemblePrompt(
  caseFile: CaseFile,
  roleCfg: RoleConfig<unknown>,
  evidence: PromptEvidence,
): AssembledPrompt {
  const systemPrompt = [roleCfg.systemPromptFragment, caseFile.header.domainPrompt, caseFile.header.agent?.append]
    .filter((part): part is string => part !== undefined && part !== "")
    .join("\n\n");

  const brief =
    evidence.brief === null
      ? "No distilled brief — work from the task and the gate evidence below."
      : briefLines(evidence.brief).join("\n");

  const gateEvidence =
    evidence.newFailures.length === 0
      ? "No failing assertions recorded yet."
      : evidence.newFailures
          .map((f) => `- ${f.id} (${f.baselineOutcome} -> ${f.checkOutcome})\n  ${f.detail}`)
          .join("\n");

  const envelopeInstruction = [
    "End your turn by emitting a JSON object matching this schema exactly:",
    "",
    JSON.stringify(z.toJSONSchema(roleCfg.envelopeSchema), null, 2),
    "",
    "Emit no other status. A reply that does not match this schema is treated as",
    "no reply at all, and the attempt is recorded as incomplete.",
  ].join("\n");

  // Triage alone reads the setback; every other role's prompt stays exactly as it was.
  const setbackSlot = roleCfg.role === "triage" ? ["## Setback", renderSetback(evidence.setback), ""] : [];

  // The roles that change the work are told what will judge it; triage changes nothing and judges nothing.
  const acceptanceSlot = roleCfg.role === "triage" ? [] : ["## Acceptance", acceptance(caseFile), ""];

  const prompt = [
    "## Task",
    JSON.stringify(caseFile.header.taskDef, null, 2),
    "",
    ...acceptanceSlot,
    "## Brief",
    brief,
    "",
    "## Gate evidence",
    gateEvidence,
    "",
    ...setbackSlot,
    "## Reply format",
    envelopeInstruction,
    "",
  ].join("\n");

  return { systemPrompt, prompt };
}

export const NO_PRIOR_TRIAGE = "No prior triage rounds on this surface.";

/** Fixed population order, so the rendering never depends on object key order. */
const POPULATIONS = ["correction", "gateError", "gateMaintenance", "terminus", "close"] as const;

function renderSetback(setback: PromptSetback | null): string {
  if (setback === null) return "No setback is recorded on the log tail.";
  return [
    `Trigger: ${setback.trigger}${setback.category ? ` (${setback.category})` : ""}`,
    "",
    "Remaining budgets (used/max):",
    ...POPULATIONS.map((p) => `- ${p}: ${setback.budgets[p].used}/${setback.budgets[p].max}`),
    "",
    "Setback evidence:",
    setback.detail ?? "The newly-failing assertions are listed under Gate evidence above.",
    "",
    "Earlier triage rounds (oldest first):",
    setback.priorRationales.length === 0
      ? NO_PRIOR_TRIAGE
      : setback.priorRationales.map((r) => `- ${r}`).join("\n"),
  ].join("\n");
}
