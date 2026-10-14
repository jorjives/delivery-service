// Slice 7: Write Your Own Pack and Prove It Without a Real Agent
// Source: docs/superpowers/specs/2026-10-03-task-packs-slices.md
// Recorded: 2026-10-09 against commit d0c7e34
//
// Drives the compiled `delivery` command as an extender would: copy the built-in code review
// pack, break a check kind, run `delivery packs check`, repair it, then `delivery review` it
// against a git copy of examples/code-review-example with the agent routed to the scripted agent.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../../src/cli/agent-session.js";
import { writeMockScript } from "../../src/mock-script.js";
import { BUILT_IN_PACKS } from "../../src/packs/manifest.js";
import { EXAMPLE_SCAN, exampleRepo, scanScript } from "../../src/packs/review-fixtures.js";
import { REPO_ROOT, runDelivery } from "../helpers.js";

const SENT_NOTHING = "Nothing was sent to a real agent";

/** A fresh copy of the built-in code review pack, named `my-review`, in its own scratch folder. */
function copyOfCodeReview(): { cwd: string; manifest: string; original: string } {
  const cwd = mkdtempSync(join(tmpdir(), "uat-packs-7-"));
  cpSync(join(BUILT_IN_PACKS, "code-review"), join(cwd, "my-review"), { recursive: true });
  const manifest = join(cwd, "my-review", "pack.json");
  return { cwd, manifest, original: readFileSync(manifest, "utf-8") };
}

function rewrite(cwd: string, file: string, content: string): void {
  writeFileSync(join(cwd, "my-review", file), content);
}

describe("UAT: write a pack of your own and prove it before pointing it at a real project", () => {
  it("names a made-up check kind, passes once fixed with nothing sent to an agent, then reviews from the pack", async () => {
    const { cwd, manifest, original } = copyOfCodeReview();

    // Step 2: a made-up check kind is named by file and field, with the allowed values.
    writeFileSync(manifest, original.replace('"pattern-absent"]', '"page-contains"]'));
    const broken = runDelivery(["packs", "check", "my-review"], { cwd });
    expect(broken.status).toBe(2);
    expect(broken.stdout).toContain("my-review/pack.json:");
    expect(broken.stdout).toContain('"scan.checks.1" is "page-contains"');
    expect(broken.stdout).toContain("anchor-gone, pattern-absent, dependency-absent");

    // Step 3: fixed, the scripted review, fix and cheat are reported.
    writeFileSync(manifest, original);
    const ok = runDelivery(["packs", "check", "my-review", "--yes"], { cwd });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("The scripted review found 2 problems");
    expect(ok.stdout).toContain('The scripted fix for "The total can go below zero" passed its check.');
    expect(ok.stdout).toContain('The scripted cheat for "A missing or broken settings file gives an unhelpful error" was refused');
    expect(ok.stdout).toContain(SENT_NOTHING);
    expect(ok.stdout).toContain("Ready to use: delivery review ./my-review");

    // Step 4: a real review runs from the pack's folder.
    const repo = exampleRepo("uat-packs-7-review-");
    const script = join(mkdtempSync(join(tmpdir(), "uat-packs-7-script-")), "mock.json");
    await writeMockScript(script, scanScript(EXAMPLE_SCAN));
    const env = { ...process.env, [TEST_MOCK_SCRIPT]: script };
    const review = runDelivery(["review", join(cwd, "my-review")], { cwd: repo, env });
    expect(review.status).toBe(0);
    expect(review.stdout).toMatch(/It found 3 problems\./);
  });
});

describe("AC: a manifest problem is named by file and field, in plain words", () => {
  it("names every missing file of a folder that is not a pack", () => {
    const { cwd } = copyOfCodeReview();
    const result = runDelivery(["packs", "check", "nope"], { cwd });
    expect(result.status).toBe(2);
    for (const file of ["nope/pack.json", "nope/fixtures/review.json", "nope/fixtures/fixes.json", "nope/fixtures/expect.json"]) {
      expect(result.stdout).toContain(`${file}: is missing`);
    }
  });
});

describe("AC: a pack whose scripted run does not match its expectations fails the check", () => {
  it("fails when the scripted review does not yield an expected problem", () => {
    const { cwd } = copyOfCodeReview();
    rewrite(cwd, "fixtures/expect.json", JSON.stringify({ found: ["Imaginary problem", "The total can go below zero", "A missing or broken settings file gives an unhelpful error"], fixed: ["The total can go below zero"], refused: ["A missing or broken settings file gives an unhelpful error"] }));
    const result = runDelivery(["packs", "check", "my-review", "--yes"], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('the scripted review did not find "Imaginary problem"');
    expect(result.stdout).toContain(SENT_NOTHING);
  });

  it("fails when a seeded cheat is expected to be fixed instead of refused", () => {
    const { cwd } = copyOfCodeReview();
    const found = ["The total can go below zero", "A missing or broken settings file gives an unhelpful error"];
    rewrite(cwd, "fixtures/expect.json", JSON.stringify({ found, fixed: found, refused: [] }));
    const result = runDelivery(["packs", "check", "my-review"], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('"refused" must name at least one problem whose scripted cheat is refused');
  });

  it("fails when no seeded fix passes its check", () => {
    const { cwd } = copyOfCodeReview();
    const found = ["The total can go below zero", "A missing or broken settings file gives an unhelpful error"];
    rewrite(cwd, "fixtures/expect.json", JSON.stringify({ found, fixed: [], refused: found }));
    const result = runDelivery(["packs", "check", "my-review"], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('"fixed" must name at least one problem whose scripted fix passes its check');
  });
});

describe("AC: exit codes follow delivery validate", () => {
  it("exits 0 for a ready pack and 2 for one that is not", () => {
    const { cwd } = copyOfCodeReview();
    expect(runDelivery(["packs", "check", "my-review", "--yes"], { cwd }).status).toBe(0);
    expect(runDelivery(["packs", "check", "nope"], { cwd }).status).toBe(runDelivery(["validate"], { cwd }).status);
  });
});

describe("AC: the pack schema and --json", () => {
  it("prints the pack format's JSON Schema", () => {
    const result = runDelivery(["packs", "--schema"], { cwd: REPO_ROOT });
    expect(result.status).toBe(0);
    const schema = JSON.parse(result.stdout) as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["name", "version", "scan", "fix"]));
  });

  it("gives packs and packs check as JSON documents, saying nothing was sent to an agent", () => {
    const { cwd } = copyOfCodeReview();
    const list = JSON.parse(runDelivery(["packs", "--json"], { cwd }).stdout) as { packs: Array<{ name: string }> };
    expect(list.packs.map((pack) => pack.name)).toEqual(expect.arrayContaining(["code", "security"]));
    const check = JSON.parse(runDelivery(["packs", "check", "my-review", "--json", "--yes"], { cwd }).stdout) as {
      ready: boolean;
      sentToAgent: boolean;
      run: { fixed: string[] };
    };
    expect(check.ready).toBe(true);
    expect(check.sentToAgent).toBe(false);
    expect(check.run.fixed).toEqual(["The total can go below zero"]);
  });

  it("gives review and findings as JSON documents that record the pack's version and content hash", async () => {
    const repo = exampleRepo("uat-packs-7-json-");
    const script = join(mkdtempSync(join(tmpdir(), "uat-packs-7-json-script-")), "mock.json");
    await writeMockScript(script, scanScript(EXAMPLE_SCAN));
    const env = { ...process.env, [TEST_MOCK_SCRIPT]: script };
    const review = runDelivery(["review", "code", "--json"], { cwd: repo, env });
    expect(review.status).toBe(0);
    expect(() => JSON.parse(review.stdout)).not.toThrow();
    const findings = JSON.parse(runDelivery(["findings", "--json"], { cwd: repo, env }).stdout) as {
      review: { packVersion: string; packHash: string };
    };
    expect(findings.review.packVersion).toBe("1.1.0");
    expect(findings.review.packHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("AC: a pack cannot give the review agent tools or commands", () => {
  it("refuses a manifest that adds tools or a command", () => {
    const { cwd, manifest, original } = copyOfCodeReview();
    const pack = JSON.parse(original) as { scan: Record<string, unknown> };
    pack.scan.tools = ["Write"];
    pack.scan.command = "x.sh";
    writeFileSync(manifest, JSON.stringify(pack));
    const result = runDelivery(["packs", "check", "my-review"], { cwd });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('"scan.tools" is not part of the pack format');
    expect(result.stdout).toContain('"scan.command" is not part of the pack format');
    expect(result.stdout).toContain("cannot give the agent tools or commands");
  });
});

describe("AC: both built-in packs pass the same check", () => {
  it.each(["code-review", "security-review"])("passes the pack check for %s", (folder) => {
    const result = runDelivery(["packs", "check", join(BUILT_IN_PACKS, folder), "--yes"], { cwd: REPO_ROOT });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(SENT_NOTHING);
  });
});
