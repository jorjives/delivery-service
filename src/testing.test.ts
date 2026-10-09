import { describe, it, expect } from "vitest";
import * as testing from "./testing.js";
import * as index from "./index.js";

describe("the public testing entry point", () => {
  it("publishes the testing API and nothing else", () => {
    expect(Object.keys(testing).sort()).toEqual([
      "assertFullyConsumed",
      "checkPack",
      "expectEnvelope",
      "fakeAgentPort",
      "mockSessionEnvironment",
      "promptsSent",
      "readJournal",
      "runSupervisorAgainstMock",
      "runSurfaceAgainstMock",
      "writeMockScript",
    ]);
  });

  it("leaves the main entry point unchanged", () => {
    expect(Object.keys(index)).not.toContain("fakeAgentPort");
    expect(Object.keys(index)).not.toContain("mockSessionEnvironment");
  });
});
