import { describe, expect, it } from "vitest";
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
  PackSpecRefused,
  PackSourceUnavailable,
  PackIntegrityMismatch,
  PackLockInvalid,
  InstalledPackRefused,
} from "../errors.js";
import type { LockEntry } from "../packs/install/lock.js";
import { builtInPacks } from "../packs/manifest.js";
import { EXIT, Refusal, renderFailure, UNEXPECTED_FOOTER } from "./failures.js";
import { refusedLines } from "./installed-render.js";

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
    [new RunFileNotFound("/r/.delivery/supervised/x", "/r/.delivery/supervised/x/run.json"), EXIT.configuration, "/r/.delivery/supervised/x/run.json"],
    [new CorruptRunFile("/r/.delivery/supervised/x", "bad json"), EXIT.unexpected, "record of the run of several tasks"],
    [new WriteFailure("/r/.delivery/runs/x", "ENOSPC"), EXIT.unexpected, "free disk space"],
    [new DuplicateIdError("adds numbers"), EXIT.configuration, '"adds numbers"'],
    [new GateModuleLoadFailure("./gates/g.js", "not found"), EXIT.configuration, "docs/writing-a-gate.md"],
    [new InvalidGateExport("./gates/g.js", "default", "no check()"), EXIT.configuration, "docs/writing-a-gate.md"],
    [new CloserModuleLoadFailure("./closers/c.js", "not found"), EXIT.configuration, "docs/writing-a-closer.md"],
    [new InvalidCloserExport("./closers/c.js", "default", "no close()"), EXIT.configuration, "docs/writing-a-closer.md"],
    [new ProvisioningFailure("/r/.delivery/runs/x", "fatal: invalid reference: main"), EXIT.configuration, "at least one commit"],
    [new InvalidRoleConfig("allowedTools", "must not be empty"), EXIT.configuration, "docs/configuring-a-role.md"],
    [new MockNotInstalled("/h/node_modules/.bin/claude-mock"), EXIT.configuration, "The scripted agent comes with the harness: reinstall it, or run npm install in a checkout."],
    [new ImmutabilityViolation("/r/.delivery/runs/x", "baseline"), EXIT.unexpected, "This is a bug"],
    [new MissingBaseline("/r/.delivery/runs/x"), EXIT.unexpected, "This is a bug"],
    [new IllegalStateTransition("/r/.delivery/runs/x", "TRIAGE", "triage"), EXIT.unexpected, "This is a bug"],
    [new ParseError("unexpected token"), EXIT.unexpected, "This is a bug"],
    [new PackSpecRefused("github:a/b", "git"), EXIT.configuration, "looks like a git address"],
    [new PackSpecRefused("https://a.test/x.tgz", "web"), EXIT.configuration, "looks like a web address"],
    [new PackSpecRefused("./pack", "path"), EXIT.configuration, "folder or file on this machine"],
    [new PackSpecRefused("a b", "name"), EXIT.configuration, "is not an npm package name"],
    [new PackSourceUnavailable("docs-pack", "latest", "no-npm", ""), EXIT.configuration, "this needs npm to fetch the package, and npm was not found"],
    [new PackSourceUnavailable("docs-pack", "latest", "not-found", ""), EXIT.configuration, "npm has no package called docs-pack"],
    [new PackSourceUnavailable("docs-pack", "9.0.0", "no-version", ""), EXIT.configuration, "docs-pack has no version 9.0.0 on npm"],
    [new PackSourceUnavailable("docs-pack", "latest", "unreachable", ""), EXIT.configuration, "npm could not be reached"],
    [new PackSourceUnavailable("docs-pack", "latest", "failed", "EACCES"), EXIT.configuration, "npm could not fetch docs-pack (EACCES)"],
    [new PackIntegrityMismatch("docs-pack", "1.0.0", "sha512-a", "sha512-b"), EXIT.configuration, "does not match what npm published"],
    [new PackLockInvalid("/r/.delivery/packs.lock.json", "packs.x.version", "is missing"), EXIT.configuration, "record of added packs"],
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
      new RunFileNotFound("/r/supervised/x", "/r/supervised/x/run.json"),
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

  it("says which pack does not exist and lists the ones that do", () => {
    expect(renderFailure(new UnknownPack("nope", ["code"]))).toEqual({
      message: 'There is no pack called "nope". The packs available are: code. To use a pack folder of your own, list it under packs in delivery.config.json.',
      exitCode: EXIT.configuration,
    });
  });

  it("names the pack folder it cannot use", () => {
    expect(renderFailure(new InvalidPack("/p/pack.json", '"name" is missing'))).toEqual({
      message: 'I can\'t use the pack in /p/pack.json: "name" is missing.',
      exitCode: EXIT.configuration,
    });
  });

  it("refuses every unusable added pack at once, each with its state and its command, and exits as a set-up problem", async () => {
    const repo = "/r";
    const entry: LockEntry = {
      source: "npm",
      package: "@acme/delivery-pack-docs",
      request: "latest",
      version: "1.2.0",
      integrity: `sha512-${"A".repeat(86)}==`,
      fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
      approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
      files: {},
    };
    const pack = (await builtInPacks())[0];
    if (pack === undefined) throw new Error("the harness ships at least one pack");
    const missing = { name: "docs-drift", state: "missing" as const, entry };
    const unapproved = { name: "other", state: "unapproved" as const, entry: { ...entry, approved: `delivery.pack-hash/1:${"b".repeat(64)}` }, pack };
    const rendered = renderFailure(new InstalledPackRefused(repo, [missing, unapproved]));
    expect(rendered.exitCode).toBe(EXIT.configuration);
    expect(rendered.message).toContain(refusedLines(repo, missing)[0]);
    expect(rendered.message).toContain(refusedLines(repo, unapproved)[0]);
    expect(rendered.message).not.toMatch(JARGON);
  });

  it("names a damaged review and offers a fresh one, with no stack trace", () => {
    expect(renderFailure(new DamagedReview("/p/.delivery/packs/code-x/review.json"))).toEqual({
      message:
        "The saved review in /p/.delivery/packs/code-x/review.json can't be read back, usually because the harness was stopped while writing it. " +
        "Run the review again to make a new one, for example: delivery review code",
      exitCode: EXIT.unexpected,
    });
  });
});

describe("renderFailure for a restore", () => {
  it("leads with Not restored, and drops the add-only clause, when npm is missing", () => {
    expect(renderFailure(new PackSourceUnavailable("x", "1.2.0", "no-npm", "", "restore")).message).toBe(
      "Not restored: this needs npm to fetch the package, and npm was not found.",
    );
  });

  it("keeps the add wording by default", () => {
    expect(renderFailure(new PackSourceUnavailable("x", "1.2.0", "no-npm", "")).message).toBe(
      "Not added: this needs npm to fetch the package, and npm was not found. Runs of packs already added do not need npm.",
    );
  });
});
