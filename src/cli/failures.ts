import {
  FileNotFound,
  CorruptCaseFile,
  RunFileNotFound,
  CorruptRunFile,
  ImmutabilityViolation,
  WriteFailure,
  ParseError,
  DuplicateIdError,
  GateModuleLoadFailure,
  InvalidGateExport,
  CloserModuleLoadFailure,
  InvalidCloserExport,
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
  MockNotInstalled,
  InvalidPack,
  UnknownPack,
  DamagedReview,
} from "../errors.js";
import { messageOf } from "../gate-support.js";

/**
 * How the command ends, as a number a script can act on without reading text:
 * "needs a person" (escalated) is distinct from "broke" (unexpected) and from
 * "set up wrong" (configuration, agent runtime). `ok` is a closed run, and
 * also help or version.
 */
export const EXIT = {
  ok: 0,
  unexpected: 1,
  configuration: 2,
  agentRuntime: 3,
  escalated: 4,
  aborted: 5,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * The command declining to go on: something about the user's setup, never a
 * bug. The message is the whole of what they see, so it names the one missing
 * thing and how to fix it. `field` is the config setting it is about, when it
 * is about one, so `validate --json` can name it.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly field?: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

/** What reaches the terminal for a failure: one plain-language message, and the code to exit with. */
export interface RenderedFailure {
  message: string;
  exitCode: ExitCode;
}

export const UNEXPECTED_FOOTER = "This is unexpected, please file an issue.";

const KNOWN_ERRORS = [
  FileNotFound,
  CorruptCaseFile,
  RunFileNotFound,
  CorruptRunFile,
  ImmutabilityViolation,
  WriteFailure,
  ParseError,
  DuplicateIdError,
  GateModuleLoadFailure,
  InvalidGateExport,
  CloserModuleLoadFailure,
  InvalidCloserExport,
  MissingBaseline,
  ProvisioningFailure,
  IllegalStateTransition,
  InvalidRoleConfig,
  MockNotInstalled,
  InvalidPack,
  UnknownPack,
  DamagedReview,
] as const;
type KnownError = InstanceType<(typeof KNOWN_ERRORS)[number]>;

function isKnown(err: unknown): err is KnownError {
  return KNOWN_ERRORS.some((Known) => err instanceof Known);
}

/** A broken harness invariant: the user did nothing wrong, and the run folder is what a maintainer needs. */
function bug(detail: string, runFolder?: string): RenderedFailure {
  const attach = runFolder ? `, attaching the run folder ${runFolder}` : "";
  return {
    message: `Something went wrong inside the harness: ${detail}\nThis is a bug: please file an issue${attach}.`,
    exitCode: EXIT.unexpected,
  };
}

/**
 * One plain-language rendering per harness error, keyed on its `code`. The
 * switch has no default, so a new error class added to KNOWN_ERRORS does not
 * compile until it has a rendering here.
 */
function renderKnown(err: KnownError): RenderedFailure {
  switch (err.code) {
    case "FILE_NOT_FOUND":
      return {
        message: `I couldn't find that run's record (${err.filePath}). Start a new run with \`delivery run --task "..."\`.`,
        exitCode: EXIT.configuration,
      };
    case "CORRUPT_CASE_FILE":
      return {
        message: `The saved run in ${err.surfaceDir} can't be read back, usually because the harness was stopped while writing it. Remove that folder to start afresh.`,
        exitCode: EXIT.unexpected,
      };
    case "RUN_FILE_NOT_FOUND":
      return {
        message: `I couldn't find the record of that run of several tasks (${err.filePath}).`,
        exitCode: EXIT.configuration,
      };
    case "CORRUPT_RUN_FILE":
      return {
        message: `The record of the run of several tasks in ${err.runDir} can't be read back, usually because the harness was stopped while writing it. Remove that folder to start afresh.`,
        exitCode: EXIT.unexpected,
      };
    case "WRITE_FAILURE":
      return {
        message: `I couldn't save the run's record in ${err.surfaceDir}. Check there is free disk space and that you can write to that folder.`,
        exitCode: EXIT.unexpected,
      };
    case "DUPLICATE_ID":
      return {
        message: `The check's output names the same test ("${err.duplicateId}") more than once, so its results can't be told apart. Give each test a unique name.`,
        exitCode: EXIT.configuration,
      };
    case "GATE_MODULE_LOAD_FAILURE":
    case "INVALID_GATE_EXPORT":
      return {
        message: `Couldn't load the custom gate at \`${err.modulePath}\` (${err.detail}). Check the path, and that it exports what docs/writing-a-gate.md describes.`,
        exitCode: EXIT.configuration,
      };
    case "CLOSER_MODULE_LOAD_FAILURE":
    case "INVALID_CLOSER_EXPORT":
      return {
        message: `Couldn't load the custom closer at \`${err.modulePath}\` (${err.detail}). Check the path, and that it exports what docs/writing-a-closer.md describes.`,
        exitCode: EXIT.configuration,
      };
    case "PROVISIONING_FAILURE":
      return {
        message: `I couldn't set up a working copy of the repository (${err.detail}). Check it is a git repository with at least one commit, and that you can write to it.`,
        exitCode: EXIT.configuration,
      };
    case "INVALID_ROLE_CONFIG":
      return {
        message: `A role setting is invalid: ${err.field} ${err.detail}. See docs/configuring-a-role.md.`,
        exitCode: EXIT.configuration,
      };
    case "MOCK_NOT_INSTALLED":
      return {
        message: `${err.message} Scripted test runs only work inside a development checkout of the harness.`,
        exitCode: EXIT.configuration,
      };
    case "INVALID_PACK":
      return { message: `I can't use the review in ${err.filePath}: ${err.detail}.`, exitCode: EXIT.configuration };
    case "UNKNOWN_PACK":
      return {
        message:
          `There is no review called "${err.packName}". The reviews available are: ${err.available.join(", ")}. ` +
          "To use a review from a folder of your own, give its path, such as ./my-review.",
        exitCode: EXIT.configuration,
      };
    case "DAMAGED_REVIEW":
      return {
        message:
          `The saved review in ${err.filePath} can't be read back, usually because the harness was stopped while writing it. ` +
          "Run the review again to make a new one, for example: delivery review code",
        exitCode: EXIT.unexpected,
      };
    case "IMMUTABILITY_VIOLATION":
    case "MISSING_BASELINE":
    case "ILLEGAL_STATE_TRANSITION":
      return bug(err.message, err.surfaceDir);
    case "PARSE_ERROR":
      return bug(err.message);
  }
}

/**
 * Every failure the command can meet, as the one message and exit code the
 * user sees. Never a stack trace: a refusal and a known harness error each have
 * their own wording, and anything else is shown by its message with an honest
 * footer, because pretending to understand it would mislead.
 */
export function renderFailure(err: unknown): RenderedFailure {
  if (err instanceof Refusal) return { message: err.message, exitCode: err.exitCode };
  if (isKnown(err)) return renderKnown(err);
  return { message: `${messageOf(err)}\n${UNEXPECTED_FOOTER}`, exitCode: EXIT.unexpected };
}
