import { expect, it } from "vitest";
import type { WorkflowConfig } from "../cli/config.js";
import { wideningsOf } from "./widening.js";

const step = { name: "do", prompt: "Do it." };

it("finds nothing wider in a plain step", () => {
  expect(wideningsOf({ steps: [step] })).toEqual([]);
});

it("treats added guards, a hold and no follow-on steps as stricter, never wider", () => {
  const config: WorkflowConfig = { steps: [{ ...step, guards: { add: ["tests-unchanged"] } }], hold: "high", after: [] };
  expect(wideningsOf(config)).toEqual([]);
});

it("names a guard turned off as a widening", () => {
  expect(wideningsOf({ steps: [{ ...step, guards: { off: ["no-skips"] } }] })).toEqual(["a guard turned off"]);
});

it("names a gate chosen by the pack as a widening", () => {
  expect(wideningsOf({ steps: [{ ...step, gate: { type: "command", command: "true", parseMode: "exitcode" } }] })).toEqual(["its own gate"]);
});

it("names agent options set by the pack as a widening", () => {
  expect(wideningsOf({ steps: [{ ...step, agent: { model: "x" } }] })).toEqual(["its own agent options"]);
});

it("names follow-on steps of its own as a widening", () => {
  expect(wideningsOf({ steps: [step], after: [{ run: "make deploy" }] })).toEqual(["follow-on steps of its own"]);
});

it("names each dimension once, however many steps widen it", () => {
  const off = { ...step, guards: { off: ["no-skips" as const] } };
  expect(wideningsOf({ steps: [off, off] })).toEqual(["a guard turned off"]);
});
