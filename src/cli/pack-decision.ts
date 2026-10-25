import { realpathSync } from "node:fs";
import { relative, sep } from "node:path";
import { z } from "zod";
import { Change } from "../packs/install/compare.js";
import { DiffLine } from "../packs/install/file-diff.js";
import { sortKeys } from "../packs/install/lock.js";
import { Inspection } from "../packs/inspection.js";
import { openSchema, type JsonSchema } from "../report/json-schema.js";
import type { CommandContext } from "./context.js";
import { EXIT, type ExitCode, renderFailure } from "./failures.js";
import { renderInspection } from "./packs-inspect-render.js";

/** The name of the decision document, which names its own version. */
export const PACK_DECISION_SCHEMA = "delivery.pack-decision/1";

/** What a command decided, as automation reads it: one document, with every fact the command found, and the message a person would read. */
export const PackDecision = z.strictObject({
  schema: z.literal(PACK_DECISION_SCHEMA),
  command: z.enum(["add", "update", "approve"]),
  outcome: z.enum(["added", "updated", "approved", "unchanged", "needs-approval", "fingerprint-differs", "refused"]),
  pack: z.string().nullable(),
  package: z.object({ name: z.string(), version: z.string() }).nullable(),
  /** The bare hash of the pack's fingerprint, as the account prints it. */
  fingerprint: z.string().nullable(),
  previous: z.object({ version: z.string(), fingerprint: z.string() }).nullable(),
  account: Inspection.nullable(),
  notInPack: z.object({ ignored: z.array(z.object({ path: z.string(), bytes: z.number().int() })), declares: z.array(z.enum(["scripts", "bin", "dependencies"])) }).nullable(),
  changes: z.array(Change).nullable(),
  files: z.array(z.object({ path: z.string(), status: z.enum(["changed", "added", "removed", "unchanged"]), added: z.number().int(), removed: z.number().int(), lines: z.array(DiffLine) })).nullable(),
  message: z.string(),
});
export type PackDecision = z.infer<typeof PackDecision>;

/** The facts a command can set before it ends; each one not set is null in the document. */
export type DecisionFacts = Pick<PackDecision, "pack" | "package" | "fingerprint" | "previous" | "account" | "notInPack" | "changes" | "files">;

/** How a command writes what it decided: the plain lines a person reads, or under `--json` one document, and nothing else. */
export interface DecisionOutput {
  /** The repository the command works in, so its paths are told relative to it. */
  repository(path: string): void;
  /** Lines a person reads as the command goes; under `--json` they are dropped, because the document holds the same facts. */
  plain(lines: readonly string[]): void;
  /** The account of the pack: rendered as plain lines, or set as a fact with its paths made relative under `--json`. `configName` names the config file the owner's values come from. */
  account(inspection: Inspection, configName?: string): void;
  /** Facts for the document; nothing is written for them in plain mode. */
  facts(part: Partial<DecisionFacts>): void;
  /** The last thing the command says: its outcome and the lines a person reads. Returns the exit code. */
  end(outcome: PackDecision["outcome"], lines: readonly string[], exit: ExitCode): ExitCode;
}

/** A path relative to the first root it is under, with forward slashes, and "." for a root itself. A path under none is relative to the first root. */
function relativeTo(path: string, roots: readonly string[]): string {
  const root = roots.find((candidate) => path === candidate || path.startsWith(candidate + sep)) ?? roots[0] ?? ".";
  const shown = relative(root, path).split(sep).join("/");
  return shown === "" ? "." : shown;
}

/** The account with its two machine paths made relative to the repository, given in each spelling it may be known by. Pure. */
export function relativeAccount(inspection: Inspection, root: string | readonly string[]): Inspection {
  const roots = typeof root === "string" ? [root] : root;
  return {
    ...inspection,
    pack: { ...inspection.pack, source: { ...inspection.pack.source, path: relativeTo(inspection.pack.source.path, roots) } },
    project: { ...inspection.project, path: inspection.project.path === null ? null : relativeTo(inspection.project.path, roots) },
  };
}

/** The text with the root taken out: `root/` goes, and any other mention of the root becomes `.`. */
export function scrubRoot(text: string, root: string): string {
  return text.split(root + "/").join("").split(root).join(".");
}

/**
 * Run one command's body with its output: the plain lines a person reads, or, under `--json`, one decision document. A
 * refusal under `--json` is a document too, with exit 2; any other fault is thrown as it is. The body must say how it ends.
 */
export async function withDecisionOutput(ctx: CommandContext, command: PackDecision["command"], body: (out: DecisionOutput) => Promise<ExitCode>): Promise<ExitCode> {
  // Until the repository is known, the paths are told relative to the folder the command was run in.
  let roots: readonly string[] = [ctx.cwd];
  const facts: Partial<DecisionFacts> = {};
  let ended = false;
  const scrub = (text: string): string => roots.reduce((shown, root) => scrubRoot(shown, root), text);

  const out: DecisionOutput = {
    repository(path) {
      if (ctx.json) roots = [...new Set([path, realpathSync(path)])];
    },
    plain(lines) {
      if (!ctx.json) for (const line of lines) ctx.writeLine(line);
    },
    account(inspection, configName) {
      if (ctx.json) facts.account = relativeAccount(inspection, roots);
      else for (const line of renderInspection(inspection, configName)) ctx.writeLine(line);
    },
    facts(part) {
      Object.assign(facts, part);
    },
    end(outcome, lines, exit) {
      ended = true;
      if (!ctx.json) {
        for (const line of lines) ctx.writeLine(line);
        return exit;
      }
      const decision: PackDecision = {
        schema: PACK_DECISION_SCHEMA,
        command,
        outcome,
        pack: facts.pack ?? null,
        package: facts.package ?? null,
        fingerprint: facts.fingerprint ?? null,
        previous: facts.previous ?? null,
        account: facts.account ?? null,
        notInPack: facts.notInPack ?? null,
        changes: facts.changes ?? null,
        files: facts.files ?? null,
        message: scrub(lines.map((line) => line.trim()).filter((line) => line !== "").join(" ")),
      };
      ctx.writeLine(JSON.stringify(sortKeys(decision), null, 2));
      return exit;
    },
  };

  let exit: ExitCode;
  try {
    exit = await body(out);
  } catch (err) {
    if (!ctx.json) throw err;
    // Only a refusal the owner can act on is a document; anything else is a fault, and is thrown as it is.
    const failure = renderFailure(err);
    if (failure.exitCode !== EXIT.configuration) throw err;
    return out.end("refused", failure.message.split("\n"), EXIT.configuration);
  }
  if (ctx.json && !ended) throw new Error("the command ended without saying what it decided");
  return exit;
}

/** The JSON Schema of the decision document, as it is published. */
export const packDecisionSchema = (): JsonSchema => ({ ...openSchema(PackDecision), title: PACK_DECISION_SCHEMA });
