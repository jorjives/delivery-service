/**
 * UAT demo for Agent Mock Slice 1: Write an Agent Stand-in the Compiler Checks.
 *
 * 1. Drives a real surface (real temp git repo, real command gate) to its
 *    decision with a stand-in worker built from a single reply.
 * 2. Asks the same stand-in for a role it was given no reply for.
 * 3. Compiles, with the project's own TypeScript settings, a stand-in whose
 *    worker replies with a triage verdict, and prints what the compiler says.
 *
 * No network, no API key, no claude-mock.
 *
 * Usage: npm run demo:mock-slice-1
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";
import { create, load } from "../src/case-file.js";
import { initTempRepo } from "../src/temp-repo.js";
import { run } from "../src/surface.js";
import { deterministicRouter } from "../src/router.js";
import { noopCloser } from "../src/ports.js";
import { fakeAgentPort } from "../src/testing.js";
import type { SurfaceLocation, SurfacePorts } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const REPO_ROOT = path.join(import.meta.dirname, "..");

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";

/** The stand-in the demo would like to write, and the compiler refuses. */
const WRONG_SHAPE = `import { fakeAgentPort } from "../src/testing.js";

export const agent = fakeAgentPort({
  worker: () =>
    Promise.resolve({
      status: "reroute",
      rationale: "worth one more attempt",
      payload: { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "h" },
    }),
});
`;

/**
 * Type-check `source` as if it were a file in `demos/`, under tsconfig.json,
 * without writing it to disk. Returns tsc-style diagnostic lines.
 */
function compile(source: string): string[] {
  const virtual = path.join(REPO_ROOT, "demos", "wrong-shaped-stand-in.ts");
  const configPath = ts.findConfigFile(REPO_ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const { options } = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, REPO_ROOT);
  const host = ts.createCompilerHost(options);
  const readFromDisk = host.getSourceFile.bind(host);
  host.fileExists = (file) => file === virtual || ts.sys.fileExists(file);
  host.getSourceFile = (file, language, ...rest) =>
    file === virtual ? ts.createSourceFile(file, source, language) : readFromDisk(file, language, ...rest);
  const program = ts.createProgram([virtual], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(virtual)).map((d) => {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return `wrong-shaped-stand-in.ts line ${line}: error TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n  ")}`;
  });
}

async function main(): Promise<void> {
  console.log("=== Agent Mock Slice 1: an agent stand-in the compiler checks ===\n");

  console.log("--- 1. A surface driven to its decision by a stand-in worker ---");
  console.log("The stand-in supplies one reply, for the worker role, and no cast:\n");
  console.log("  fakeAgentPort({ worker: (ctx) => { write feature.txt; reply completed } })\n");
  const agent = fakeAgentPort({
    worker: (ctx) => {
      fs.writeFileSync(path.join(ctx.worktreePath, "feature.txt"), "the feature the task asked for\n");
      return Promise.resolve({ status: "completed", rationale: "wrote feature.txt" });
    },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock1-demo-case-"));
  const repoPath = initTempRepo("mock1-demo-repo-", { "report.tap": PASSING_TAP });
  const location: SurfaceLocation = {
    repoPath,
    worktreePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mock1-demo-tree-")), "wt"),
  };
  await create(dir, { surfaceId: "surface-1", taskDef: { intent: "add the feature" }, gateRef }, budgets);
  const ports: SurfacePorts = { agent, triage: deterministicRouter, closer: noopCloser };
  const result = await run(dir, location, ports);
  const worker = (await load(dir)).history.filter((e) => e.t === "terminus");
  console.log(`The surface ran to: ${result.state}`);
  console.log(`Worker sessions:    ${worker.length}`);
  console.log(`Outcome:            ${result.outcome?.kind ?? "none"}\n`);

  console.log("--- 2. The same stand-in asked for a role it was given no reply for ---");
  try {
    await agent.invoke({ role: "triage" }, { worktreePath: location.worktreePath, dir, sessionKey: "triage-1-0" });
    console.log("Unexpected: the triage role answered.");
  } catch (err) {
    console.log(`The test fails with: ${(err as Error).message}\n`);
  }

  console.log("--- 3. A stand-in whose worker replies with a triage verdict ---");
  console.log("Source handed to the TypeScript compiler, with this project's tsconfig.json:\n");
  console.log(WRONG_SHAPE.replace(/^/gm, "  "));
  const diagnostics = compile(WRONG_SHAPE);
  console.log(diagnostics.length > 0 ? "The compiler reports:\n" : "Unexpected: it compiled.\n");
  for (const line of diagnostics) console.log(`  ${line}`);
  console.log("\nIt is a compile error, not a passing run: the stand-in never gets to run.");
}

await main();
