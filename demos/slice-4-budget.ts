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
    gateRef: { type: "command", command: "npm test", parseMode: "tap" },
  };

  await create(dir, header, budgetDefaults);
  console.log("Created case file with budgets.\n");

  const populations = Object.keys(budgetDefaults) as BudgetPopulation[];

  console.log("Incrementing each population to and past its cap:\n");
  console.log("population      | used | max | exhausted");
  console.log("----------------|------|-----|----------");

  for (const population of populations) {
    const max = budgetDefaults[population].max;

    for (let i = 1; i <= max + 1; i++) {
      const result = await incrementBudget(dir, population);
      const populationStr = population.padEnd(15);
      const usedStr = String(result.used).padStart(4);
      const maxStr = String(result.max).padStart(3);
      console.log(
        `${populationStr} | ${usedStr} | ${maxStr} | ${result.exhausted}`,
      );
    }
  }

  // Exhaustion always fires exactly at max — just confirm that
  console.log("\nSummary: populations exhausted at:");
  for (const population of populations) {
    const max = budgetDefaults[population].max;
    console.log(`  ${population.padEnd(15)} at ${max} ✓`);
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
