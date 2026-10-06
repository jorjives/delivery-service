import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_MOCK_SCRIPT } from "../cli/agent-session.js";
import { delivery, RUN_TIMEOUT, scriptFile } from "../cli/command-fixtures.js";
import { EXIT } from "../cli/failures.js";
import { NEEDS_YOU } from "./render.js";
import type { MockScript } from "../mock-script.js";
import { CHEATING_FIXES, EXAMPLE_SCAN, EXAMPLE_SECURITY_SCAN, PAYMENTS_PASSWORD, SECURITY_FIXES, exampleRepo, scanScript } from "./review-fixtures.js";

describe("CHEATING_FIXES", () => {
  const [retry, checkout, settings, gateway, ...rest] = CHEATING_FIXES.expectations;
  const [c, s, g] = EXAMPLE_SCAN.findings;

  it("has one retry expectation, then three cheats", () => {
    expect(rest).toEqual([]);
    expect(retry?.when?.promptContains).toBe("\n- guard:");
    expect(retry?.json).toMatchObject({ status: "escalate" });
  });

  it("matches each cheat by its problem title", () => {
    expect([checkout, settings, gateway].map((e) => e?.when?.promptContains)).toEqual([c?.title, s?.title, g?.title]);
  });

  it("deletes the checkout test", () => {
    expect(checkout?.effects).toContainEqual({ delete: { path: "checkout.test.js" } });
  });

  it("skips the test and changes the test script for settings", () => {
    const writes = (settings?.effects ?? []).flatMap((e) => ("write" in e ? [e.write] : []));
    expect(writes.find((w) => w.path === "checkout.test.js")?.content).toContain("test.skip(");
    expect(writes.find((w) => w.path === "package.json")?.content).toContain("|| true");
  });

  it("makes only a minimal test edit for the gateway", () => {
    expect(gateway?.effects).toHaveLength(1);
    expect(gateway?.effects?.[0]).toMatchObject({ write: { path: "checkout.test.js" } });
  });
});

describe("SECURITY_FIXES", () => {
  it(
    "has scripted security fixes the whole walkthrough runs on: the password held then merged, the library merged at once, the password never shown",
    async () => {
      const repo = exampleRepo("security-walkthrough-");
      const outputs: string[] = [];
      const run = async (args: string[], script?: MockScript) => {
        const result = await delivery(args, { cwd: repo, env: script === undefined ? {} : { [TEST_MOCK_SCRIPT]: await scriptFile(script) } });
        outputs.push(result.stdout + result.stderr);
        return result;
      };
      await run(["review", "security"], scanScript(EXAMPLE_SECURITY_SCAN));
      await run(["findings", "approve", "--all"]);
      expect((await run(["fix"], SECURITY_FIXES)).stdout).toContain("1. A password for the payments service is written in the code (critical): waiting for your sign-off");
      expect(readFileSync(join(repo, "package-lock.json"), "utf-8")).toContain('"version": "1.2.6"');
      await run(["findings", "1", "--changes"]);
      expect((await run(["findings", "sign-off", "1"])).exitCode).toBe(EXIT.ok);
      const after = (await run(["findings"])).stdout;
      expect(after).toContain("(critical): fixed and merged");
      expect(after).toContain(`${NEEDS_YOU}\n  Problem 1: The password has already been seen`);
      expect(readFileSync(join(repo, "payments.js"), "utf-8")).not.toContain(PAYMENTS_PASSWORD);
      for (const output of outputs) expect(output).not.toContain(PAYMENTS_PASSWORD);
    },
    RUN_TIMEOUT * 3,
  );
});
