import { describe, expect, it } from "vitest";
import {
  FileNotFound,
  CorruptCaseFile,
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
} from "../errors.js";
import { EXIT, Refusal, renderFailure, UNEXPECTED_FOOTER } from "./failures.js";

/** Harness vocabulary a person using the command should never have to learn. */
const JARGON = /worktree|envelope|surface|terminus|[A-Z]{2,}_[A-Z_]+/;

describe("EXIT", () => {
  it("gives every way the command ends its own code", () => {
    expect(EXIT).toEqual({ ok: 0, unexpected: 1, configuration: 2, agentRuntime: 3, escalated: 4, aborted: 5 });
  });
});

describe("renderFailure", () => {
  it("passes a refusal through as its own message and exit code", () => {
    expect(renderFailure(new Refusal("Tell me what to do.", EXIT.configuration))).toEqual({
      message: "Tell me what to do.",
      exitCode: EXIT.configuration,
    });
  });

  it.each([
    [new FileNotFound("/r/.delivery/runs/x", "/r/.delivery/runs/x/case.json"), EXIT.configuration, "/r/.delivery/runs/x/case.json"],
    [new CorruptCaseFile("/r/.delivery/runs/x", "bad json"), EXIT.unexpected, "Remove that folder to start afresh"],
    [new WriteFailure("/r/.delivery/runs/x", "ENOSPC"), EXIT.unexpected, "free disk space"],
    [new DuplicateIdError("adds numbers"), EXIT.configuration, '"adds numbers"'],
    [new GateModuleLoadFailure("./gates/g.js", "not found"), EXIT.configuration, "docs/writing-a-gate.md"],
    [new InvalidGateExport("./gates/g.js", "default", "no check()"), EXIT.configuration, "docs/writing-a-gate.md"],
    [new CloserModuleLoadFailure("./closers/c.js", "not found"), EXIT.configuration, "docs/writing-a-closer.md"],
    [new InvalidCloserExport("./closers/c.js", "default", "no close()"), EXIT.configuration, "docs/writing-a-closer.md"],
    [new ProvisioningFailure("/r/.delivery/runs/x", "fatal: invalid reference: main"), EXIT.configuration, "at least one commit"],
    [new InvalidRoleConfig("allowedTools", "must not be empty"), EXIT.configuration, "docs/configuring-a-role.md"],
    [new MockNotInstalled("/h/node_modules/.bin/claude-mock"), EXIT.configuration, "development checkout"],
    [new ImmutabilityViolation("/r/.delivery/runs/x", "baseline"), EXIT.unexpected, "This is a bug"],
    [new MissingBaseline("/r/.delivery/runs/x"), EXIT.unexpected, "This is a bug"],
    [new IllegalStateTransition("/r/.delivery/runs/x", "TRIAGE", "triage"), EXIT.unexpected, "This is a bug"],
    [new ParseError("unexpected token"), EXIT.unexpected, "This is a bug"],
  ])("renders %o in plain language with its mapped exit code", (err, exitCode, mentions) => {
    const rendered = renderFailure(err);
    expect(rendered.exitCode).toBe(exitCode);
    expect(rendered.message).toContain(mentions);
    expect(rendered.message).not.toContain(err.name);
    expect(rendered.message).not.toContain("    at ");
  });

  it("keeps harness vocabulary out of every rendering a user can act on", () => {
    const actionable = [
      new FileNotFound("/r/runs/x", "/r/runs/x/case.json"),
      new WriteFailure("/r/runs/x", "ENOSPC"),
      new DuplicateIdError("adds numbers"),
      new ProvisioningFailure("/r/runs/x", "fatal: invalid reference: main"),
    ];
    for (const err of actionable) expect(renderFailure(err).message).not.toMatch(JARGON);
  });

  it("names the run folder for a broken invariant, so a maintainer gets what they need", () => {
    expect(renderFailure(new MissingBaseline("/r/.delivery/runs/x")).message).toContain("attaching the run folder /r/.delivery/runs/x");
  });

  it("shows an unrecognised failure by its message with an honest footer, never a stack trace", () => {
    const err = new Error("ENOTDIR: not a directory, open '/r/.delivery/.gitignore'");
    expect(renderFailure(err)).toEqual({
      message: `ENOTDIR: not a directory, open '/r/.delivery/.gitignore'\n${UNEXPECTED_FOOTER}`,
      exitCode: EXIT.unexpected,
    });
    expect(UNEXPECTED_FOOTER).toBe("This is unexpected, please file an issue.");
  });

  it("renders a thrown non-Error the same honest way", () => {
    expect(renderFailure("boom")).toEqual({ message: `boom\n${UNEXPECTED_FOOTER}`, exitCode: EXIT.unexpected });
  });
});
