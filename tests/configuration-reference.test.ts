// The configuration reference is written by hand, so it can fall behind the schema the
// harness actually accepts. These tests read the names straight from the schemas and fail
// when the reference does not name one of them in the section that documents it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItemFrontMatter } from "../src/backlog.js";
import { GUARD_REFUSES } from "../src/guards.js";
import { AfterStep, Budgets, DeliveryConfig, SourceConfig, StepConfig, WorkflowConfig } from "../src/cli/config.js";
import { PRESET_NAMES } from "../src/cli/gate-presets.js";
import { CloserRef, FenceMode, GuardName, ItemCheck, SEVERITIES } from "../src/schema.js";
import { REPO_ROOT } from "./helpers.js";

const reference = readFileSync(join(REPO_ROOT, "docs/configuration-reference.md"), "utf-8");

/** The text under a heading, up to the next heading of the same or a higher level. */
function section(heading: string): string {
  const start = reference.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`the reference has no heading "${heading}"`);
  const level = /^#+/.exec(heading)?.[0].length ?? 2;
  const rest = reference.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`\\n#{1,${level}} `));
  return end === -1 ? rest : rest.slice(0, end);
}

const unnamed = (text: string, names: readonly string[]): string[] => names.filter((name) => !text.includes(`\`${name}\``));

describe("the configuration reference", () => {
  it("gives every setting the file accepts a heading of its own", () => {
    const missing = Object.keys(DeliveryConfig.shape).filter((key) => !reference.includes(`\n### \`${key}\`\n`));
    expect(missing).toEqual([]);
  });

  // What the reference must name, and the section it must name it in.
  const typeOf = (option: { shape: { type: { value: string } } }): string => option.shape.type.value;
  it.each([
    ["budget", "### `budgets`", Object.keys(Budgets.shape)],
    ["fence mode", "### `fence`", FenceMode.options],
    ["closer", "### `closer`", CloserRef.options.map(typeOf)],
    ["ready-made check", "## Ready-made checks", PRESET_NAMES],
    ["field of a workflow and of its steps", "## Workflows", [...Object.keys(WorkflowConfig.shape), ...Object.keys(StepConfig.shape)]],
    ["guard", "## Guards", GuardName.options],
    ["kind of work source", "## Work sources", SourceConfig.options.map(typeOf)],
    ["field of an after-landing step", "## After-landing steps", [...new Set(AfterStep.options.flatMap((option) => Object.keys(option.shape)))]],
    [
      "field of a backlog item, check kind and severity",
      "## Backlog items",
      [...Object.keys(ItemFrontMatter.shape), ...ItemCheck.options.map((option) => option.shape.kind.value), ...SEVERITIES],
    ],
  ] as const)("names every %s under %s", (_what, heading, names) => {
    expect(unnamed(section(heading), names)).toEqual([]);
  });

  it("words every guard in its table as the harness words it to an owner", () => {
    const rows = section("## Guards").split("\n").filter((line) => line.startsWith("| `"));
    for (const name of GuardName.options) {
      const row = rows.find((line) => line.startsWith(`| \`${name}\` |`));
      const refuses = row?.split("|")[3]?.trim() ?? "";
      const sentence = GUARD_REFUSES[name];
      expect(refuses.startsWith(sentence.charAt(0).toUpperCase() + sentence.slice(1))).toBe(true);
    }
  });
});
