// The configuration reference is written by hand, so it can fall behind the schema the
// harness actually accepts. These tests read the names straight from the schemas and fail
// when the reference does not name one of them in the section that documents it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ItemFrontMatter } from "../src/backlog.js";
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

  it("names every budget", () => {
    expect(unnamed(section("### `budgets`"), Object.keys(Budgets.shape))).toEqual([]);
  });

  it("names every fence mode", () => {
    expect(unnamed(section("### `fence`"), FenceMode.options)).toEqual([]);
  });

  it("names every closer", () => {
    expect(unnamed(section("### `closer`"), CloserRef.options.map((option) => option.shape.type.value))).toEqual([]);
  });

  it("names every ready-made check", () => {
    expect(unnamed(section("## Ready-made checks"), PRESET_NAMES)).toEqual([]);
  });

  it("names every field of a workflow and of its steps", () => {
    expect(unnamed(section("## Workflows"), [...Object.keys(WorkflowConfig.shape), ...Object.keys(StepConfig.shape)])).toEqual([]);
  });

  it("names every guard", () => {
    expect(unnamed(section("## Guards"), GuardName.options)).toEqual([]);
  });

  it("names every kind of work source", () => {
    expect(unnamed(section("## Work sources"), SourceConfig.options.map((option) => option.shape.type.value))).toEqual([]);
  });

  it("names every field of an after-landing step", () => {
    const fields = [...new Set(AfterStep.options.flatMap((option) => Object.keys(option.shape)))];
    expect(unnamed(section("## After-landing steps"), fields)).toEqual([]);
  });

  it("names every field of a backlog item, every check kind and every severity", () => {
    const text = section("## Backlog items");
    expect(unnamed(text, Object.keys(ItemFrontMatter.shape))).toEqual([]);
    expect(unnamed(text, ItemCheck.options.map((option) => option.shape.kind.value))).toEqual([]);
    expect(unnamed(text, SEVERITIES)).toEqual([]);
  });
});
