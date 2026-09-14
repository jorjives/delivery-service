import { describe, it, expect } from "vitest";
import * as testing from "./testing.js";
import { fakeAgentPort } from "./testing.js";
import * as index from "./index.js";
import type { AgentContext, SurfacePorts } from "./ports.js";

const ctx: AgentContext = { worktreePath: "/w", dir: "/d", sessionKey: "round-1-0" };

describe("fakeAgentPort", () => {
  it("answers each role with that role's own reply, handing it the session's context", async () => {
    const seen: string[] = [];
    const agent = fakeAgentPort({
      worker: (c) => {
        seen.push(`worker:${c.sessionKey}`);
        return Promise.resolve({ status: "completed", rationale: "did the work" });
      },
      "gate-maintenance": (c) => {
        seen.push(`gate-maintenance:${c.sessionKey}`);
        return Promise.resolve({ status: "incomplete", rationale: "hit the turn cap" });
      },
      triage: (c) => {
        seen.push(`triage:${c.sessionKey}`);
        return Promise.resolve({ status: "abort", rationale: "nothing to salvage", payload: { reason: "gone" } });
      },
    });

    expect(await agent.invoke({ role: "worker" }, ctx)).toEqual({ status: "completed", rationale: "did the work" });
    expect(await agent.invoke({ role: "gate-maintenance" }, ctx)).toEqual({ status: "incomplete", rationale: "hit the turn cap" });
    expect(await agent.invoke({ role: "triage" }, ctx)).toEqual({
      status: "abort",
      rationale: "nothing to salvage",
      payload: { reason: "gone" },
    });
    expect(seen).toEqual(["worker:round-1-0", "gate-maintenance:round-1-0", "triage:round-1-0"]);
  });

  it("needs a reply only for the roles a test exercises, and fits wherever an agent port is expected", async () => {
    // No cast: the double is assignable to the driver's agent port as it stands.
    const agent: SurfacePorts["agent"] = fakeAgentPort({
      worker: () => Promise.resolve({ status: "completed", rationale: "one reply is enough" }),
    });

    expect(await agent.invoke({ role: "worker" }, ctx)).toEqual({ status: "completed", rationale: "one reply is enough" });
  });

  it("fails naming a role it was given no reply for, and says the test must supply it", async () => {
    const agent = fakeAgentPort({
      worker: () => Promise.resolve({ status: "completed", rationale: "unused" }),
    });

    await expect(agent.invoke({ role: "triage" }, ctx)).rejects.toThrow(
      'fakeAgentPort was given no reply for the triage role: the test must supply a "triage" handler',
    );
    await expect(fakeAgentPort({}).invoke({ role: "gate-maintenance" }, ctx)).rejects.toThrow(
      'fakeAgentPort was given no reply for the gate-maintenance role: the test must supply a "gate-maintenance" handler',
    );
  });

  it("rejects, at compile time, a worker reply shaped like a triage verdict", () => {
    // Checked by `npm run lint` (tsc): if the double stopped correlating a role
    // with its own reply shape, this directive would be unused and tsc would fail.
    const build = () =>
      fakeAgentPort({
        // @ts-expect-error a worker cannot reply with triage's reroute verdict
        worker: () =>
          Promise.resolve({
            status: "reroute",
            rationale: "worth one more attempt",
            payload: { problem: "p", dead_ends: "d", scope: "s", references: [], diagnosis: "h" },
          }),
      });
    expect(build).toBeTypeOf("function");
  });
});

describe("the public testing entry point", () => {
  it("publishes the testing API and nothing else", () => {
    expect(Object.keys(testing).sort()).toEqual(["fakeAgentPort", "mockSessionEnvironment"]);
  });

  it("leaves the main entry point unchanged", () => {
    expect(Object.keys(index)).not.toContain("fakeAgentPort");
    expect(Object.keys(index)).not.toContain("mockSessionEnvironment");
  });
});
