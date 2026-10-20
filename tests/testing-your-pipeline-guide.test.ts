// Agent Mock design, capability 8: the testing API ships with a "testing your
// delivery pipeline" guide, followable without reading harness source. This runs
// the guide's own worked tests the way the guide tells a reader to, so they
// cannot drift from the API they teach.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, runTsx, sectionOf, snippetFrom } from "./helpers.js";
import { cleanGitEnv } from "../src/git-env.js";
import { MockNotInstalled } from "../src/errors.js";
import {
  DEFAULT_BUDGETS,
  DID_NOT_COMPLETE,
  deterministicRouter,
  gateMaintenanceRoleConfig,
  triageRoleConfig,
  workerRoleConfig,
} from "../src/index.js";
import { withoutCredentials } from "../src/mock-session.js";
import {
  assertFullyConsumed,
  expectEnvelope,
  fakeAgentPort,
  runSupervisorAgainstMock,
  type JournalEvent,
  type MockScript,
  type ScriptedTask,
} from "../src/testing.js";

const guide = readFileSync(join(REPO_ROOT, "docs/testing-your-pipeline.md"), "utf-8");

/** Credentials the guide promises its examples never need: stripped from the child, not trusted to be absent. */
const env = withoutCredentials(cleanGitEnv());

const snippet = (name: string) => snippetFrom(guide, name);

// A reader installs the package and imports it by name, so the snippets are staged
// in a scratch folder where `delivery-service` resolves to this checkout through its
// own `exports` map: the same two entry points an installed copy offers, `dist/` and
// all. The package.json makes the scratch files ES modules, as a reader's would; the
// tsconfig type-checks them with the repository's own compiler options.
const scratch = mkdtempSync(join(tmpdir(), "pipeline-guide-"));
writeFileSync(join(scratch, "package.json"), JSON.stringify({ type: "module" }));
mkdirSync(join(scratch, "node_modules"));
// A link, not a copy: `exports` is what is being exercised. The existing afterAll's
// rmSync unlinks it rather than following it into the checkout, so leave that as it is.
symlinkSync(REPO_ROOT, join(scratch, "node_modules", "delivery-service"), "dir");
if (!existsSync(join(REPO_ROOT, "dist", "index.d.ts"))) {
  throw new Error("dist is missing or has no types: run `npm run build` (npm test does this for you)");
}
writeFileSync(
  join(scratch, "tsconfig.json"),
  JSON.stringify({
    extends: join(REPO_ROOT, "tsconfig.json"),
    include: ["*.ts"],
    compilerOptions: { typeRoots: [join(REPO_ROOT, "node_modules", "@types")] },
  }),
);
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function stage(name: string): string {
  const source = snippet(name);
  if (!source.includes('from "delivery-service')) {
    throw new Error(`${name} does not import the harness from "delivery-service"`);
  }
  const path = join(scratch, name);
  writeFileSync(path, source); // staged verbatim: the scratch folder resolves the package by name
  return path;
}

/** Run a staged worked test as the guide says to, with no credentials in reach. */
function runWorkedTest(name: string): string {
  expect(guide).toContain(`npx tsx --test ${name}`);
  const { stdout, status } = runTsx(["--test", stage(name)], env);
  expect(stdout).toContain("ℹ fail 0");
  expect(status).toBe(0);
  return stdout;
}

describe("the 'testing your delivery pipeline' guide", () => {
  it("says when to use each stand-in, and how to assert what was sent and that the script was used", () => {
    const choosing = sectionOf(guide, "## Choosing a stand-in", "## Worked example: the happy path");
    for (const row of ["| What it runs |", "| Cost |", "| Proves your role configuration |", "| Right for |"]) {
      expect(choosing).toContain(row);
    }
    expect(choosing).toContain("`fakeAgentPort`");
    expect(choosing).toContain("`runSurfaceAgainstMock`");
    expect(guide).toContain("promptsSent(journal)");
    expect(guide).toContain("assertFullyConsumed(journal, script)");
    for (const event of ["matched", "unmatched", "effect_failed", "finished"]) expect(guide).toContain(`"${event}"`);
    expect(guide).not.toContain("—"); // no em-dashes in outward-facing copy
  });

  it("says its examples need no network, no API key and no global setup", () => {
    const needs = sectionOf(guide, "## What you need", "## Choosing a stand-in");
    expect(needs).toContain("npm install");
    expect(needs).toMatch(/no global setup/);
    expect(needs).toMatch(/no\s+network/);
    expect(needs).toMatch(/no API key/);
  });

  it("runs its worked happy-path test as written, and it passes", () => {
    const stdout = runWorkedTest("happy-path.test.ts");
    expect(stdout).toContain("✔ a scripted worker's change is judged by the real gate and landed by the real closer");
    expect(stdout).toContain("ℹ pass 1");
    expect(guide).toContain("ℹ pass 1");
  }, 60_000);

  it("quotes the consumption check's failure exactly as assertFullyConsumed words it", () => {
    const script: MockScript = { expectations: [{ when: { promptContains: "add a greting file" } }] };
    const journal: JournalEvent[] = [{ session_id: "s1", event: "unmatched", prompt: "## Task" }];
    let message = "";
    try {
      assertFullyConsumed(journal, script);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    for (const line of message.split("\n")) expect(guide).toContain(line);
  });

  it("quotes each authoring mistake's message exactly as the testing API words it", async () => {
    const wrong = sectionOf(guide, "## When the test itself is wrong", "## Next steps");
    expect(wrong).toContain(`throw \`${new MockNotInstalled("<path>").message}\``);

    const missingRole = await fakeAgentPort({})
      .invoke({ role: "triage" }, { worktreePath: "/w", dir: "/d", sessionKey: "k" })
      .then(() => "", (err: unknown) => (err as Error).message);
    expect(missingRole).toMatch(/triage/);
    expect(wrong).toContain(missingRole);

    let malformed = "";
    try {
      expectEnvelope(workerRoleConfig, { status: "completed", rationale: "" });
    } catch (err) {
      malformed = (err as Error).message;
    }
    const [heading = ""] = malformed.split("\n");
    expect(heading).toMatch(/worker/);
    expect(wrong).toContain(heading);

    const wrongSetup = (slots: number, tasks: ScriptedTask[]): Promise<string> =>
      runSupervisorAgainstMock({
        repoPath: "/nowhere",
        slots,
        tasks,
        budgets: DEFAULT_BUDGETS,
        roleConfigs: { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig },
        triage: () => deterministicRouter,
      }).then(() => "", (err: unknown) => (err as Error).message);
    const hello: ScriptedTask = {
      header: {
        surfaceId: "hello",
        taskDef: { intent: "add a hello file" },
        gateRef: { type: "command", command: "true", parseMode: "exitcode" },
        closerRef: { type: "merge-back" },
      },
      script: { expectations: [] },
    };
    const noSlots = await wrongSetup(0, [hello]);
    expect(noSlots).toMatch(/slots/);
    expect(wrong).toContain(noSlots);
    const sharedId = await wrongSetup(2, [hello, hello]);
    expect(sharedId).toMatch(/surfaceId/);
    expect(wrong).toContain(sharedId);
  });

  it("type-checks every snippet it tells a reader to save", () => {
    for (const name of ["fake-agent.ts", "happy-path.test.ts", "misbehaviour.test.ts", "several-tasks.test.ts"]) stage(name);
    let errors = "";
    try {
      execFileSync("npx", ["tsc", "-p", join(scratch, "tsconfig.json")], { cwd: REPO_ROOT, encoding: "utf-8", stdio: "pipe" });
    } catch (err) {
      errors = (err as { stdout?: string }).stdout || String(err);
    }
    expect(errors).toBe("");
  }, 60_000);

  it("runs its worked misbehaviour test as written, and both cases pass", () => {
    const stdout = runWorkedTest("misbehaviour.test.ts");
    expect(stdout).toContain("✔ a worker that escalates for authority stops the surface at once");
    expect(stdout).toContain("✔ a change the gate rejects goes back to the worker, and only the passing attempt lands");
    expect(stdout).toContain("ℹ pass 2");
    expect(guide).toContain("ℹ pass 2");
  }, 60_000);

  it("explains how to choose which of several tasks reaches a step first", () => {
    const several = sectionOf(guide, "## Testing several tasks at once", "## When a reply ends as incomplete");
    for (const term of [
      "`runSupervisorAgainstMock`",
      "`slots`",
      "`delayMs`",
      "`concurrency`",
      "own `journal`",
      "`surface/<surfaceId>`",
      "`main has moved on`",
      "Swap the two delays",
    ]) {
      expect(several).toContain(term);
    }
  });

  it("runs its worked several-tasks test as written, and it passes", () => {
    const stdout = runWorkedTest("several-tasks.test.ts");
    expect(stdout).toContain(
      "✔ two tasks reach the merge together: the first to answer is merged, the other is refused because the base moved on",
    );
    expect(stdout).toContain("ℹ pass 1");
  }, 60_000);

  it("lists each way a reply ends as incomplete, with the rationale the harness records", () => {
    const incomplete = sectionOf(guide, "## When a reply ends as incomplete", "## What the scripted agent cannot prove");
    for (const reason of [DID_NOT_COMPLETE.errored, DID_NOT_COMPLETE.noEnvelope, DID_NOT_COMPLETE.wrongShape]) {
      expect(incomplete).toContain(`worker session did not complete: ${reason}`);
    }
    for (const scripted of ["`promptContains`", "`reply`", "`json`", "`fail: { message }`"]) expect(incomplete).toContain(scripted);
    expect(incomplete).toContain('"unmatched"');
    expect(incomplete).toContain("terminus budget exhausted (<used>/<max>): ");
  });

  it("says plainly that the scripted agent cannot prove what your own settings allow, without pointing at source an installed copy lacks", () => {
    const limits = sectionOf(guide, "## What the scripted agent cannot prove", "## When the test itself is wrong").replace(/\s+/g, " ");
    expect(limits).toContain("The scripted agent cannot show what your own Claude Code settings allow or refuse.");
    expect(limits).toContain("`permissions.deny`");
    expect(guide).not.toMatch(/src\/[a-z-]+\.(test\.)?ts/);
  });

  it("does not document the contributor-only DELIVERY_TEST_MOCK_SCRIPT seam for adopters", () => {
    expect(guide).not.toContain("DELIVERY_TEST_MOCK_SCRIPT");
  });

  it("names tsx among what you need", () => {
    expect(sectionOf(guide, "## What you need", "## Choosing a stand-in")).toContain("`tsx`");
  });

  it("is where the role guide's offline quick start points", () => {
    const roleGuide = readFileSync(join(REPO_ROOT, "docs/configuring-a-role.md"), "utf-8");
    expect(sectionOf(roleGuide, "## Trying it offline", "## Triage")).toContain(
      "[Testing your delivery pipeline](testing-your-pipeline.md)",
    );
  });
});
