import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS } from "../budgets.js";
import type { ResumeAction } from "../case-file.js";
import type { CaseFile, GateRef, HistoryEntry } from "../schema.js";
import { SurfaceState } from "../schema.js";
import { paint, pickingUp, putRight, RESUME_PHRASES, STEP_PHRASES, useColour } from "./output.js";

const ESC = "[";

describe("useColour", () => {
  const tty = { flag: true, env: {}, isTTY: true };

  it("colours a terminal by default", () => {
    expect(useColour(tty)).toBe(true);
  });

  it("prints no colour when --no-color is passed", () => {
    expect(useColour({ ...tty, flag: false })).toBe(false);
  });

  it("prints no colour when NO_COLOR is set to anything", () => {
    expect(useColour({ ...tty, env: { NO_COLOR: "1" } })).toBe(false);
  });

  it("treats an empty NO_COLOR as unset, as no-color.org says", () => {
    expect(useColour({ ...tty, env: { NO_COLOR: "" } })).toBe(true);
  });

  it("prints no colour when output is not a terminal", () => {
    expect(useColour({ ...tty, isTTY: false })).toBe(false);
    expect(useColour({ ...tty, isTTY: undefined })).toBe(false);
  });
});

describe("paint", () => {
  it("wraps the words in colour when colour is on, keeping the words", () => {
    const painted = paint(true, "done", "Done: it worked.");
    expect(painted).toContain(ESC);
    expect(painted).toContain("Done: it worked.");
  });

  it("returns the words unchanged when colour is off", () => {
    expect(paint(false, "stopped", "The run stopped.")).toBe("The run stopped.");
  });
});

describe("STEP_PHRASES", () => {
  it("has a phrase for every state", () => {
    expect(Object.keys(STEP_PHRASES).sort()).toEqual([...SurfaceState.options].sort());
  });

  it("never shows a raw state name", () => {
    for (const phrase of Object.values(STEP_PHRASES)) {
      for (const state of SurfaceState.options) expect(phrase).not.toContain(state);
      expect(phrase).not.toMatch(/[A-Z_]{3,}/);
    }
  });

  it("uses the design's words for the steps a person watches most", () => {
    expect(STEP_PHRASES.PROVISIONING).toBe("setting up");
    expect(STEP_PHRASES.PRE_GATING).toBe("checking the starting point");
    expect(STEP_PHRASES.AGENT_ACTIVE).toBe("the agent is working");
    expect(STEP_PHRASES.GATING).toBe("checking the agent's work");
    expect(STEP_PHRASES.GATE_MAINTENANCE).toBe("the agent is fixing something");
    expect(STEP_PHRASES.CLOSING).toBe("wrapping up");
    expect(STEP_PHRASES.CLOSED).toBe("done");
  });
});

const GATE: GateRef = { type: "command", command: "npm test", parseMode: "exitcode" };

/** A case file with the given log tail, which is what decides where a resumed run picks up. */
function caseFileEndingIn(tail: HistoryEntry | undefined): CaseFile {
  return {
    header: { surfaceId: "reverse-a-word-20260915T213012Z", taskDef: { intent: "reverse a word" }, gateRef: GATE, baseline: null, baseBranch: null },
    cursor: { state: "GATING", budgets: DEFAULT_BUDGETS, worktreeRef: "/tmp/copy" },
    history: tail ? [tail] : [],
  };
}

describe("what a resumed run says it is picking up", () => {
  it("says what happens next in the same words the step lines use", () => {
    const caseFile = caseFileEndingIn({ t: "terminus", attempt: 1, sessionKey: "worker-1-1", status: "completed", rationale: "added it" });
    expect(pickingUp(caseFile)).toBe("Picking up where it left off: checking the agent's work.");
  });

  it("has a phrase for a run that was stopped before anything was recorded", () => {
    expect(pickingUp(caseFileEndingIn(undefined))).toBe("Picking up where it left off: getting the agent going.");
  });

  it("never shows a raw state name, whatever the run was doing", () => {
    for (const phrase of Object.values(RESUME_PHRASES)) {
      expect(phrase).toBe(phrase.toLowerCase());
    }
  });

  it("has a phrase for every way a run can be picked up", () => {
    const actions: ResumeAction[] = ["start", "incomplete_terminus", "gate", "triage", "close", "act_on_verdict", "close_triage", "done"];
    for (const action of actions) expect(RESUME_PHRASES[action]).toBeTruthy();
  });
});

describe("what a resumed run says it put right", () => {
  it("leads with plain language, then the harness's own account of what it fixed", () => {
    expect(putRight("re-created the working copy")).toBe("Had to put something right: re-created the working copy.");
  });
});
