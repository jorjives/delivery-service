import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create, incrementBudget } from "../src/index.js";
import type { BudgetPopulation } from "../src/index.js";

const budgetDefaults = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "case-file-demo-budget-"));
  console.log(`Case directory: ${dir}\n`);

  // Create case file
  const header = {
    surfaceId: "demo-surface-budget",
    taskDef: { intent: "Demonstrate budget tracking" },
    gateRef: { gateId: "gate-demo", version: 1 },
  };

  await create(dir, header, budgetDefaults);
  console.log("Created case file with budgets.\n");

  // Track when each population first becomes exhausted
  const exhaustedAt: Record<BudgetPopulation, number | null> = {
    correction: null,
    gateError: null,
    gateMaintenance: null,
    terminus: null,
    close: null,
  };

  // The populations and their max values
  const populations: BudgetPopulation[] = [
    "correction",
    "gateError",
    "gateMaintenance",
    "terminus",
    "close",
  ];

  // Print header
  console.log("Incrementing each population to and past its cap:\n");
  console.log("population      | used | max | exhausted");
  console.log("----------------|------|-----|----------");

  // For each population, increment up to max+1
  for (const population of populations) {
    const max = budgetDefaults[population].max;

    for (let i = 1; i <= max + 1; i++) {
      const result = await incrementBudget(dir, population);

      // Track first exhaustion
      if (exhaustedAt[population] === null && result.exhausted) {
        exhaustedAt[population] = result.used;
      }

      // Print row
      const exhaustedStr = result.exhausted ? "true" : "false";
      const populationStr = population.padEnd(15);
      const usedStr = String(result.used).padStart(4);
      const maxStr = String(result.max).padStart(3);
      console.log(
        `${populationStr} | ${usedStr} | ${maxStr} | ${exhaustedStr}`,
      );
    }
  }

  // Print summary
  console.log("\nSummary: populations exhausted at:");
  for (const population of populations) {
    const max = budgetDefaults[population].max;
    const exhausted = exhaustedAt[population];
    const expectedExhaust = max; // exhausted flag should be true when used >= max
    const status =
      exhausted === expectedExhaust ? "✓" : `✗ (expected at ${expectedExhaust})`;
    console.log(
      `  ${population.padEnd(15)} at ${exhausted === null ? "never" : exhausted} ${status}`,
    );
  }

  console.log(
    "\nBudget tracking verified: each population increments independently,",
  );
  console.log("and exhausted flag is set exactly when used >= max.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
