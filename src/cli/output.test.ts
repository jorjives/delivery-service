import { describe, expect, it } from "vitest";
import { SurfaceState } from "../schema.js";
import { createProgress, paint, STEP_PHRASES, useColour } from "./output.js";

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

describe("createProgress", () => {
  it("writes one plain line per step", () => {
    const lines: string[] = [];
    const progress = createProgress((line) => lines.push(line), false);
    progress.step("PROVISIONING");
    progress.step("PRE_GATING");
    progress.step("AGENT_ACTIVE");
    expect(lines).toEqual(["- setting up", "- checking the starting point", "- the agent is working"]);
  });

  it("does not repeat a step that reads the same as the one before", () => {
    const lines: string[] = [];
    const progress = createProgress((line) => lines.push(line), false);
    progress.step("AGENT_ACTIVE");
    progress.step("AGENT_ACTIVE");
    progress.step("GATING");
    progress.step("AGENT_ACTIVE");
    expect(lines).toEqual(["- the agent is working", "- checking the agent's work", "- the agent is working"]);
  });

  it("prints no escape codes when colour is off", () => {
    const lines: string[] = [];
    createProgress((line) => lines.push(line), false).step("CLOSING");
    expect(lines.join("")).not.toContain(ESC);
  });
});
