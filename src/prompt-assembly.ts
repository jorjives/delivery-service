import { z } from "zod";
import { readRef } from "./case-file.js";
import { NewFailure } from "./schema.js";
import type { CaseFile } from "./schema.js";
import type { RoleConfig } from "./role-config.js";

/** The parts of the prompt that live behind refs rather than in the log itself. */
export interface PromptEvidence {
  /** The distilled brief a triage reroute left behind, or null on a first attempt. */
  brief: unknown;
  /** The gate's newly-failing assertions, resolved from their detail refs. */
  newFailures: NewFailure[];
}

/** One assembled request: the session's system prompt and its single user turn. */
export interface AssembledPrompt {
  systemPrompt: string;
  prompt: string;
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

  const dispatch = history.find((entry) => entry.t === "dispatch");
  const brief = dispatch?.briefRef ? await readRef(dir, dispatch.briefRef) : null;

  return { brief, newFailures };
}

/**
 * The five slots of `docs/agent-interface.md`, in fixed order, split across the
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
  roleCfg: RoleConfig,
  evidence: PromptEvidence,
): AssembledPrompt {
  const domain = caseFile.header.domainPrompt;

  const systemPrompt = domain
    ? `${roleCfg.systemPromptFragment}\n\n${domain}`
    : roleCfg.systemPromptFragment;

  const brief =
    evidence.brief === null
      ? "No distilled brief — work from the task and the gate evidence below."
      : JSON.stringify(evidence.brief, null, 2);

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
    "## Reply format",
    envelopeInstruction,
    "",
  ].join("\n");

  return { systemPrompt, prompt };
}
