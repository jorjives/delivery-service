/**
 * UAT demo for Slice 4: Gate Resolution
 *
 * Resolves four gate references through the one door the harness uses — a
 * command ref, a custom ref, a custom ref with a bad module path, and a
 * command ref naming an unsupported parse mode — and runs `baseline` on each
 * resolved gate.
 *
 * Usage: npx tsx demos/gate-interface-slice-4-resolution.ts
 */
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGate } from "../src/resolve-gate.js";
import type { GateContext } from "../src/command-gate.js";
import type { GateRef, GateReport } from "../src/schema.js";

function printReport(label: string, report: GateReport): void {
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${report.status}`);
  if (report.detail) console.log(`Detail: ${report.detail}`);
  for (const a of report.assertions) {
    console.log(`  [${a.outcome}] ${a.id} — ${a.detail}`);
  }
}

async function runBaseline(label: string, ref: GateRef, worktreePath: string): Promise<void> {
  const ctx: GateContext = { worktreePath, taskDef: {}, gateRef: ref };
  printReport(label, await resolveGate(ref, worktreePath).baseline(ctx));
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-gate-demo-"));

  // A custom gate module for the custom-type reference to load.
  fs.writeFileSync(
    path.join(tmp, "licence-gate.mjs"),
    [
      "const report = async (ctx) => ({",
      '  status: "PASS",',
      "  assertions: [",
      '    { id: "licence:present", outcome: "PASS", detail: `checked ${ctx.worktreePath}` },',
      "  ],",
      "});",
      "export default { baseline: report, check: report };",
    ].join("\n"),
  );

  await runBaseline(
    "command ref (tap) — resolves and runs",
    {
      type: "command",
      command: "printf '1..2\\nok 1 - alpha\\nnot ok 2 - beta\\n'",
      parseMode: "tap",
    },
    tmp,
  );

  await runBaseline(
    "custom ref — resolves and runs",
    { type: "custom", modulePath: "./licence-gate.mjs" },
    tmp,
  );

  await runBaseline(
    "custom ref with a bad module path — resolution fails as a report",
    { type: "custom", modulePath: "./no-such-gate.mjs" },
    tmp,
  );

  await runBaseline(
    "command ref with an unsupported parse mode — resolution fails as a report",
    { type: "command", command: "true", parseMode: "xunit" } as unknown as GateRef,
    tmp,
  );

  console.log("\nAll four references were handled without throwing.");
}

await main();
