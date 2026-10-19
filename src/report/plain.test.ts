import { describe, expect, it } from "vitest";
import type { OutcomeCause } from "../schema.js";
import { completedWords, landedWords, plainOf, RETRY_WORDS, whereTheWorkIs, type PlainFacts } from "./plain.js";
import { FORBIDDEN } from "./report-fixtures.js";

const facts = (cause: OutcomeCause | null, over: Partial<PlainFacts> = {}): PlainFacts => ({
  runId: "fix-the-footer-20261001T020100Z",
  cause,
  agentStuck: false,
  attempts: 3,
  limit: null,
  agentSaid: "I could not do it.",
  listed: true,
  item: null,
  ...over,
});

/** Every cause a record can hold, with every refinement that changes the words. */
const EVERY_CAUSE: OutcomeCause[] = [
  { kind: "authority", role: "worker" },
  { kind: "authority", role: "gate-maintenance" },
  { kind: "triage_escalated" },
  { kind: "session_not_run", role: "worker" },
  { kind: "session_not_run", role: "gate-maintenance" },
  { kind: "triage_abort" },
  { kind: "repair_gave_up" },
  { kind: "triage_failure" },
  { kind: "provisioning" },
  { kind: "budget", population: "correction" },
  { kind: "budget", population: "terminus" },
  { kind: "budget", population: "gateError" },
  { kind: "budget", population: "gateMaintenance" },
  { kind: "budget", population: "close" },
  { kind: "budget" },
  { kind: "landed_outside_closer", pullRequest: "https://github.com/example/project/pull/7" },
  { kind: "decision", question: "Formal or casual greeting?" },
];

describe("who a stopped task is for", () => {
  it.each([
    [{ kind: "authority", role: "worker" }, "needs_your_decision", "owner"],
    [{ kind: "triage_escalated" }, "needs_your_decision", "owner"],
    [{ kind: "session_not_run", role: "worker" }, "needs_your_decision", "owner"],
    [{ kind: "budget", population: "correction" }, "failed_after_attempts", "owner"],
    [{ kind: "budget", population: "terminus" }, "failed_after_attempts", "owner"],
    [{ kind: "triage_abort" }, "abandoned", "owner"],
    [{ kind: "budget", population: "gateError" }, "needs_an_engineer", "engineer"],
    [{ kind: "budget", population: "gateMaintenance" }, "needs_an_engineer", "engineer"],
    [{ kind: "budget", population: "close" }, "needs_an_engineer", "engineer"],
    [{ kind: "repair_gave_up" }, "needs_an_engineer", "engineer"],
    [{ kind: "triage_failure" }, "needs_an_engineer", "engineer"],
    [{ kind: "provisioning" }, "needs_an_engineer", "engineer"],
    [{ kind: "landed_outside_closer", pullRequest: "https://github.com/example/project/pull/7" }, "needs_your_decision", "owner"],
  ] as const)("puts %j in %s, for the %s", (cause, group, audience) => {
    expect(plainOf(facts(cause))).toMatchObject({ group, audience });
  });

  it("gives a stop with no recorded cause to nobody, with no advice", () => {
    expect(plainOf(facts(null))).toMatchObject({ group: "stopped", audience: "unknown", next: [] });
  });

  it("gives no advice either for a cause too incomplete to explain", () => {
    expect(plainOf(facts({ kind: "budget" }))).toMatchObject({ group: "stopped", audience: "unknown", next: [] });
  });
});

describe("a question the agent asked the operator", () => {
  it("puts it under needs your decision, and says how to answer it on an ad hoc run", () => {
    const plain = plainOf(facts({ kind: "decision", question: "Formal or casual greeting?" }, { listed: false }));
    expect(plain.group).toBe("needs_your_decision");
    expect(plain.sentence).toBe("Needs your answer. The agent asked: Formal or casual greeting?");
    expect(plain.next).toEqual(['Run the task again with your answer in its wording: delivery run --task "the reworded task"']);
  });
});

describe("a question holding terminal control sequences", () => {
  it("is shown without them", () => {
    expect(plainOf(facts({ kind: "decision", question: "Formal?\u001B[2J" })).sentence).toBe("Needs your answer. The agent asked: Formal?");
  });
});

describe("a question for an item from a work source", () => {
  it("says how to answer it, and to carry on with the sources", () => {
    const plain = plainOf(facts({ kind: "decision", question: "Formal?" }, { item: "backlog:x.md" }));
    expect(plain.next).toEqual(['Answer it: delivery answer backlog:x.md "your answer"', "Then run: delivery run --sources"]);
  });
});

describe("what kind of stop it was, in fixed words", () => {
  it("says the agent would not go on without the owner's say-so", () => {
    expect(plainOf(facts({ kind: "authority", role: "worker" })).sentence).toBe(
      "Needs your decision. The agent stopped and said it could not go on without your say-so.",
    );
  });

  it("counts how many times the agent tried when the check still fails", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { attempts: 4 })).sentence).toBe(
      "Failed after 4 attempts. The agent tried 4 times and the check you set up still does not pass.",
    );
  });

  it("says one attempt as one", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { attempts: 1 })).sentence).toBe(
      "Failed after 1 attempt. The agent tried once and the check you set up still does not pass.",
    );
  });

  it("says the agent gave up when that, not the check, was the last setback", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { agentStuck: true })).sentence).toBe(
      "Failed after 3 attempts. The agent tried 3 times and said it could not finish the task.",
    );
  });

  it("says a usage limit was reached, and which, in those words", () => {
    expect(plainOf(facts({ kind: "budget", population: "terminus" }, { limit: "spend" })).sentence).toBe(
      "Stopped because a usage limit was reached: the spending limit has been reached.",
    );
    expect(plainOf(facts({ kind: "budget", population: "terminus" }, { limit: "rate" })).sentence).toBe(
      "Stopped because a usage limit was reached: the AI service is limiting requests.",
    );
  });

  it("tells the owner a broken check is not her decision", () => {
    expect(plainOf(facts({ kind: "repair_gave_up" })).sentence).toBe(
      "The check you set up could not be repaired automatically. This is a problem with the setup, not a decision for you.",
    );
  });

  it("carries the agent's own words through untouched, and their absence as null", () => {
    expect(plainOf(facts({ kind: "authority", role: "worker" }, { agentSaid: "Removing it breaks 3 links." })).agentSaid).toBe("Removing it breaks 3 links.");
    expect(plainOf(facts({ kind: "provisioning" }, { agentSaid: null })).agentSaid).toBeNull();
  });
});

describe("a task the agent opened a pull request for itself", () => {
  const PR = "https://github.com/example/project/pull/7";

  it("says plainly what happened and that the work was not landed", () => {
    expect(plainOf(facts({ kind: "landed_outside_closer", pullRequest: PR })).sentence).toBe(
      "Needs your attention. The agent opened a pull request for this task itself, so its work was not landed by the harness.",
    );
  });

  it("names the pull request in what to do next", () => {
    expect(plainOf(facts({ kind: "landed_outside_closer", pullRequest: PR })).next).toEqual([`Look at the pull request the agent opened: ${PR}. Close it, or review and merge it yourself.`]);
  });
});

describe("what to do about a stopped task", () => {
  it("has the owner say yes or no in the list, then run", () => {
    expect(plainOf(facts({ kind: "authority", role: "worker" })).next).toEqual([
      "Decide. To say yes, add the permission to the task wording. To say no, remove the task from your list.",
      "Run: delivery run",
    ]);
  });

  it("has the owner reword or remove a task that failed, then run", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" })).next).toEqual(["Reword the task, or remove it from your list.", "Run: delivery run"]);
  });

  it("has a task that is not on a list typed again with its new wording", () => {
    expect(plainOf(facts({ kind: "budget", population: "correction" }, { listed: false })).next).toEqual([
      'Reword the task and run it again: delivery run --task "the reworded task"',
    ]);
  });

  it("has the owner wait out a usage limit, then run that task on its own before the list", () => {
    expect(plainOf(facts({ kind: "budget", population: "terminus" }, { limit: "rate" })).next).toEqual([
      "Wait until the limit no longer applies.",
      'Run this task again on its own: delivery run --task "the task, exactly as it is written"',
      "Then carry on with your list: delivery run",
    ]);
  });

  it("gives the owner one line to pass to an engineer, naming the run", () => {
    expect(plainOf(facts({ kind: "repair_gave_up" })).next).toEqual([
      "Pass this to whoever maintains your checks: delivery status fix-the-footer-20261001T020100Z",
    ]);
  });

  it.each(EVERY_CAUSE)("never sends a finished task to `delivery resume`, nor to a bare re-run of an unchanged list: %j", (cause) => {
    for (const listed of [true, false]) {
      for (const limit of [null, "rate"] as const) {
        const { next } = plainOf(facts(cause, { listed, limit }));
        expect(next.join("\n")).not.toContain("delivery resume");
        // `delivery run` on a list retells an unchanged task, so it is only ever a later step, after one that changes something.
        expect(next[0] ?? "").not.toMatch(/delivery run$/);
      }
    }
  });
});

describe("the owner's vocabulary", () => {
  it.each(EVERY_CAUSE)("keeps the harness's own words out of every sentence and step: %j", (cause) => {
    for (const listed of [true, false]) {
      for (const agentStuck of [true, false]) {
        for (const limit of [null, "rate", "spend"] as const) {
          const plain = plainOf(facts(cause, { listed, agentStuck, limit, runId: "run-1" }));
          expect([plain.sentence, ...plain.next].join("\n")).not.toMatch(FORBIDDEN);
        }
      }
    }
  });

  it("names the five kinds of retry without them", () => {
    expect(RETRY_WORDS).toEqual({
      correction: "agent corrections",
      gateError: "check re-runs",
      gateMaintenance: "check repairs",
      terminus: "agent restarts",
      close: "hand-off retries",
    });
  });
});

describe("where the work is", () => {
  it("says how each way of landing work left a delivered task", () => {
    expect(landedWords("merge-back", "surface/x", "main")).toBe("merged into main");
    expect(landedWords("commit-to-branch", "surface/x", "main")).toBe("committed on branch surface/x");
    expect(landedWords("open-pr", "surface/x", "main")).toBe("on branch surface/x, with a pull request open");
    expect(landedWords("custom", "surface/x", "main")).toBe("your own closer handled this task; check what it did");
  });

  it("says a task on the delivery branch landed there", () => {
    expect(landedWords("delivery-branch", "surface/x", "delivery/main")).toBe("landed on delivery/main");
    expect(completedWords("delivery-branch", 2)).toBe("completed and landed on the delivery branch");
  });

  it("says what completed meant when every delivered task landed the same way", () => {
    expect(completedWords("merge-back", 3)).toBe("completed and merged");
    expect(completedWords("commit-to-branch", 3)).toBe("completed and committed to their own branches");
    expect(completedWords("commit-to-branch", 1)).toBe("completed and committed to its own branch");
    expect(completedWords("open-pr", 3)).toBe("completed, each with a pull request open");
    expect(completedWords("open-pr", 1)).toBe("completed, with a pull request open");
    expect(completedWords("custom", 3)).toBe("completed");
  });

  it("claims only what the way of landing work guarantees for a stopped task", () => {
    expect(whereTheWorkIs("merge-back", "main")).toBe("this task's changes were not added to main.");
    expect(whereTheWorkIs("custom", "main")).toBe("your own closer was told this task stopped; check what it did.");
    expect(whereTheWorkIs("open-pr", null)).toBe("not recorded.");
  });
});

it("tells the owner a held fix waits for their sign-off, and how to give it", () => {
  const plain = plainOf({ runId: "r", cause: { kind: "held" }, agentStuck: false, attempts: 1, limit: null, agentSaid: null, listed: false, item: "backlog:x.md" });
  expect(plain.group).toBe("needs_your_decision");
  expect(plain.sentence).toBe("Waiting for your sign-off. The fix is finished and passes its checks, but the problem it fixes is serious, so it does not land until you say so.");
  expect(plain.next).toEqual(["Read what it changed: delivery backlog backlog:x.md", "Land it: delivery sign-off backlog:x.md", "Or set it aside: delivery reject backlog:x.md"]);
});
