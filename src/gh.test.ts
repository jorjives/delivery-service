import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";
import { ghAccess, ghFailureOf, ghReason, runGh, type GhFailure } from "./gh.js";

const failure = (over: Partial<GhFailure>): GhFailure => ({ missing: false, exitCode: 1, stderr: "", ...over });

describe("gh failures", () => {
  it.each([
    [failure({ missing: true, exitCode: null }), "missing"],
    [failure({ exitCode: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login" }), "signed-out"],
    [failure({ stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)" }), "signed-out"],
    [failure({ stderr: "GraphQL: operator does not have the correct permissions to execute 'CreatePullRequest'" }), "forbidden"],
    [failure({ stderr: "HTTP 403: Resource not accessible by integration" }), "forbidden"],
    [failure({ stderr: "error connecting to api.github.com" }), "offline"],
    [failure({ stderr: "GraphQL: Could not resolve to a Repository with the name 'x/y'." }), null],
  ] as const)("classifies %j as %s", (f, expected) => {
    expect(ghAccess(f)).toBe(expected);
  });

  it("quotes gh's first line with any token or credentialed URL redacted", () => {
    expect(ghReason(failure({ stderr: "\n  push to https://x:ghp_abc123@github.com failed\nmore" }))).toBe("push to https://[redacted]@github.com failed");
    expect(ghReason(failure({}))).toBe("gh gave no reason");
  });

  it("runs gh from the given environment's PATH, and reports a missing gh as missing", async () => {
    const standIn = createGhStandIn();
    // The stand-in is a `#!/usr/bin/env node` script, so node's own directory must stay on PATH.
    expect(await runGh(["pr", "list", "--head=x", "--state=open", "--json=url"], { cwd: standIn.binDir, env: { PATH: `${standIn.binDir}:${dirname(process.execPath)}` } })).toBe("[]");
    const err = await runGh(["pr", "list"], { cwd: standIn.binDir, env: { PATH: "/nonexistent" } }).catch((e: unknown) => e);
    expect(ghFailureOf(err)).toMatchObject({ missing: true });
  });
});
