import type { StepConfig, WorkflowConfig } from "../cli/config.js";

type Relation = "same" | "stricter" | "wider";

const GATE_DIMENSION = "its own gate";
const AFTER_DIMENSION = "follow-on steps of its own";

/** The two dimensions a check or a landing can widen: the gate a step chooses, and the follow-on steps a workflow names. */
export const CHECKS_AND_LANDING_DIMENSIONS: readonly string[] = [GATE_DIMENSION, AFTER_DIMENSION];

/**
 * How each key a pack's workflow can set compares with what the project's own workflow gets when it overrides nothing.
 * Typed over every key, so a key added to a step or a workflow fails the build until someone decides whether it widens.
 */
const STEP_KEYS: { [K in keyof StepConfig]-?: (step: StepConfig) => { relation: Relation; dimension: string } } = {
  name: () => ({ relation: "same", dimension: "" }),
  prompt: () => ({ relation: "same", dimension: "" }),
  continue: () => ({ relation: "same", dimension: "" }),
  gate: ({ gate }) => ({ relation: gate === undefined ? "same" : "wider", dimension: GATE_DIMENSION }),
  agent: ({ agent }) => ({ relation: agent === undefined ? "same" : "wider", dimension: "its own agent options" }),
  guards: ({ guards }) => {
    const off = (guards?.off ?? []).length > 0;
    return { relation: off ? "wider" : guards?.add === undefined ? "same" : "stricter", dimension: "a guard turned off" };
  },
};

const WORKFLOW_KEYS: { [K in keyof WorkflowConfig]-?: (workflow: WorkflowConfig) => { relation: Relation; dimension: string } } = {
  steps: () => ({ relation: "same", dimension: "" }),
  hold: ({ hold }) => ({ relation: hold === undefined ? "same" : "stricter", dimension: "" }),
  // Steps run after a change lands are the project's; a pack that names its own runs commands the project did not choose.
  after: ({ after }) => ({ relation: after === undefined ? "same" : after.length === 0 ? "stricter" : "wider", dimension: AFTER_DIMENSION }),
};

/** The ways a workflow widens what the agent may do beyond the project's defaults, each named once. Empty when it widens nothing. */
export function wideningsOf(workflow: WorkflowConfig): string[] {
  const found = [
    ...workflow.steps.flatMap((step) => Object.values(STEP_KEYS).map((compare) => compare(step))),
    ...Object.values(WORKFLOW_KEYS).map((compare) => compare(workflow)),
  ];
  return [...new Set(found.filter(({ relation }) => relation === "wider").map(({ dimension }) => dimension))];
}
