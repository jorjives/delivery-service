import { z } from "zod";
import { deriveBudgetsFromLog, logTail, readRef, setbackOf, type Setback } from "./case-file.js";
import { NewFailure, type BudgetSet, type CaseFile } from "./schema.js";
import type { RoleConfig } from "./role-config.js";
import { SharpenedBrief } from "./triage-role-config.js";

export interface PromptSetback extends Setback {
  /** Log-derived used/max per population at the moment of the setback. */
  budgets: BudgetSet;
  /** The worker's escalate rationale or the close report's detail; null for gate triggers. */
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

/** The ref shape `surface.ts` writes for an agent-path triage round. */
const BriefRef = z.object({ artifact: SharpenedBrief });
const CloseDetail = z.object({ detail: z.string() });

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

  return {
    ...setback,
    budgets: deriveBudgetsFromLog(caseFile.history, caseFile.cursor.budgets),
    detail,
    priorRationales: caseFile.history.flatMap((e) => (e.t === "triage" ? [e.rationale] : [])),
  };
}

/**
 * The five slots of `docs/agent-interface.md` plus, for triage only, a `## Setback` slot
 * between the gate evidence and the reply format, in fixed order, split across the
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
  const domain = caseFile.header.domainPrompt;

  const systemPrompt = domain
    ? `${roleCfg.systemPromptFragment}\n\n${domain}`
    : roleCfg.systemPromptFragment;

  const brief =
    evidence.brief === null
      ? "No distilled brief — work from the task and the gate evidence below."
      : [
          `Problem: ${evidence.brief.problem}`,
          `Dead ends: ${evidence.brief.dead_ends}`,
          `Scope: ${evidence.brief.scope}`,
          `References: ${evidence.brief.references.length === 0 ? "none" : evidence.brief.references.join(", ")}`,
          `Diagnosis (a hypothesis to test, not an established fact): ${evidence.brief.diagnosis}`,
        ].join("\n");

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

  const prompt = [
    "## Task",
    JSON.stringify(caseFile.header.taskDef, null, 2),
    "",
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
