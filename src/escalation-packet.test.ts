import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEntry, create, load, writeRef } from "./case-file.js";
import { buildEscalationPacket, resolveEscalationPacket, NO_PRIOR_ATTEMPTS, type PacketFacts } from "./escalation-packet.js";
import { EscalationPacket } from "./triage-role-config.js";
import type { EscalationCause } from "./ports.js";
import type { BudgetSet, GateRef } from "./schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};

const facts: PacketFacts = {
  evidence: "not ok 2 - beta",
  priorRationales: [],
  references: ["worker-1-0"],
  budgets: { ...budgets, correction: { used: 3, max: 3 } },
};

const authority = { kind: "authority", role: "worker" } satisfies EscalationCause;
const budget = {
  kind: "budget", population: "correction", budget: { used: 3, max: 3 }, detail: "no retry remains",
} satisfies EscalationCause;
const closeBudget = {
  kind: "budget", population: "close", budget: { used: 3, max: 3 }, detail: "no retry remains",
} satisfies EscalationCause;
const triageFailure = {
  kind: "triage_failure",
  rationale:
    "triage did not produce a usable verdict: triage session did not complete: the session ended without reporting a result. Escalating rather than guessing.",
} satisfies EscalationCause;
const repairGaveUp = { kind: "repair_gave_up" } satisfies EscalationCause;
const landedOutside = {
  kind: "landed_outside_closer",
  pullRequest: "https://github.com/example/project/pull/7",
  sessionKey: "worker-1-0",
} satisfies EscalationCause;
const all: EscalationCause[] = [authority, budget, closeBudget, triageFailure, repairGaveUp, landedOutside];

describe("buildEscalationPacket", () => {
  it.each(all.map((cause) => [cause.kind, cause] as const))(
    "builds a valid five-part packet for a %s escalation",
    (_kind, cause) => {
      const packet = buildEscalationPacket(cause, facts);
      expect(EscalationPacket.parse(packet)).toEqual(packet);
      expect(packet.evidence).toBe("not ok 2 - beta");
      expect(packet.references).toEqual(["worker-1-0"]);
    },
  );

  it("asks the operator the agent's question, word for word", () => {
    const packet = buildEscalationPacket({ kind: "decision", question: "Formal or casual greeting?" }, facts);
    expect(packet.decision).toBe("The agent needs your answer before it can go on. It asked: Formal or casual greeting?");
    expect(packet.why_now).toContain("a question goes straight to a person and is never retried");
  });

  it("shows the agent's question without anything that could drive the terminal", () => {
    const packet = buildEscalationPacket({ kind: "decision", question: "Formal?\u001B[2J\u0007" }, facts);
    expect(packet.decision).toBe("The agent needs your answer before it can go on. It asked: Formal?");
  });

  it("states a decision for a person, and a different one for each cause", () => {
    const decisions = all.map((cause) => buildEscalationPacket(cause, facts).decision);
    for (const decision of decisions) expect(decision).toMatch(/Decide (whether|how)/);
    expect(new Set(decisions).size).toBe(decisions.length);
    expect(buildEscalationPacket(authority, facts).decision).toContain("lacked authority");
    expect(buildEscalationPacket(triageFailure, facts).decision).toBe(
      "Triage could not reach a verdict. Decide how to proceed from the evidence below.",
    );
  });

  it("says plainly that no budget remains and shows it as used out of maximum", () => {
    const packet = buildEscalationPacket(budget, facts);
    expect(packet.decision).toContain("No correction budget remains (3/3 used).");
    expect(packet.why_now).toContain("The correction budget is spent (3/3 used)");
  });

  it("names every population by its label, with used/max, in why_now", () => {
    const packet = buildEscalationPacket(
      { kind: "budget", population: "gateMaintenance", budget: { used: 2, max: 2 }, detail: "d" },
      facts,
    );
    expect(packet.decision).toContain("No gate repair budget remains (2/2 used).");
    expect(packet.why_now).toContain(
      "Budgets used so far: correction 3/3, gate recheck 0/3, gate repair 0/2, session retry 0/5, close retry 0/3.",
    );
  });

  it("puts triage's own reason in why_now when its reply could not be used", () => {
    expect(buildEscalationPacket(triageFailure, facts).why_now).toContain(triageFailure.rationale);
  });

  it("tells a person the agent opened a pull request itself, and that nothing was landed", () => {
    const packet = buildEscalationPacket({ kind: "landed_outside_closer", pullRequest: "https://github.com/example/project/pull/7", sessionKey: "worker-1-0" }, facts);
    expect(packet.decision).toBe(
      "The agent opened a pull request for this task's branch itself: https://github.com/example/project/pull/7. Nothing has been landed by the harness. Decide whether to close that pull request or review and merge it yourself.",
    );
    expect(packet.why_now).toContain("A pull request was found open for the task's branch after session worker-1-0; landing belongs to the harness, so the task stops for you rather than being treated as merged.");
  });

  it("lists earlier triage rounds oldest first, or says there were none", () => {
    expect(buildEscalationPacket(authority, facts).dead_ends).toBe(NO_PRIOR_ATTEMPTS);
    expect(buildEscalationPacket(authority, { ...facts, priorRationales: ["first", "second"] }).dead_ends)
      .toBe("1. first\n2. second");
  });

  it("asks a person to resolve what blocked a close, or choose another, once no close retry remains", () => {
    const { decision } = buildEscalationPacket(closeBudget, facts);

    expect(decision).toBe(
      "No close retry budget remains (3/3 used), so the accepted work has not landed. " +
        "Decide whether to resolve what the closer reports below, such as a base branch that has moved on, " +
        "and close again, or choose a different close.",
    );
    // Accepted work is never sent back into the task.
    expect(decision).not.toMatch(/amend the task|abandon/);
  });

  it("never presents a stack trace or a bare internal code as a packet's message", () => {
    for (const cause of all) {
      const packet = buildEscalationPacket(cause, facts);
      for (const text of [packet.decision, packet.why_now]) {
        expect(text).not.toMatch(/\n\s+at\s/);
        expect(text).not.toMatch(/gateMaintenance|gateError|worker_escalate|gate_fail|gate_error|close_failure/);
        expect(text).toMatch(/^[A-Z][^]*[.?]$/);
      }
    }
  });
});

describe("resolveEscalationPacket", () => {
  let dir: string;
  const gateRef: GateRef = { type: "command", command: "true", parseMode: "exitcode" };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "packet-case-"));
    await create(dir, { surfaceId: "s-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  it("quotes the latest failed gate's newly-failing assertions verbatim", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, { t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0", status: "completed", rationale: "done" });
    await writeRef(dir, "gate-1-0-0", { id: "beta", baselineOutcome: "PASS", checkOutcome: "FAIL", detail: "expected hello, got hi" });
    await appendEntry(dir, { t: "gate", attempt: 1, status: "FAIL", newFailures: [{ id: "beta", detailRef: "gate-1-0-0" }] });

    const packet = await resolveEscalationPacket(dir, await load(dir), budget);

    expect(packet.evidence).toBe("beta: expected hello, got hi");
    expect(packet.references).toEqual(["worker-1-0"]);
  });

  it("quotes the worker's own escalate rationale", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "authority", rationale: "needs a deploy key I do not hold",
    });

    const packet = await resolveEscalationPacket(dir, await load(dir), authority);

    expect(packet.evidence).toBe("needs a deploy key I do not hold");
    expect(packet.dead_ends).toBe(NO_PRIOR_ATTEMPTS);
  });

  it("quotes the latest close report's detail", async () => {
    await writeRef(dir, "close-0", { status: "FAIL", detail: "the merge was refused" });
    await appendEntry(dir, { t: "close", status: "FAIL", detailRef: "close-0" });

    const packet = await resolveEscalationPacket(dir, await load(dir), triageFailure);

    expect(packet.evidence).toBe("the merge was refused");
  });

  it("counts earlier triage rounds as dead ends, but never the escalate round being reported", async () => {
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, { t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0", status: "escalate", category: "exhaustion", rationale: "stuck" });
    await appendEntry(dir, { t: "triage", afterAttempt: 1, trigger: "worker_escalate", verdict: "reroute", rationale: "first: retry", artifactRef: "triage-0" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 2, sessionKey: "worker-2-0" });
    await appendEntry(dir, { t: "terminus", role: "worker", attempt: 2, sessionKey: "worker-2-0", status: "escalate", category: "exhaustion", rationale: "still stuck" });
    await appendEntry(dir, { t: "triage", afterAttempt: 2, trigger: "worker_escalate", verdict: "escalate", rationale: "no more", artifactRef: "triage-1" });

    const packet = await resolveEscalationPacket(dir, await load(dir), triageFailure);

    expect(packet.dead_ends).toBe("1. first: retry");
    expect(packet.evidence).toBe("still stuck");
    expect(packet.references).toEqual(["worker-1-0", "worker-2-0"]);
    expect(packet.why_now).toContain("correction 1/3");
  });

  it("falls back to the budget's own detail when the log records no setback evidence", async () => {
    await appendEntry(dir, { t: "dispatch", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0" });
    await appendEntry(dir, { t: "terminus", role: "gate-maintenance", attempt: 1, sessionKey: "gate-maintenance-1-0", status: "completed", rationale: "fixed" });

    const packet = await resolveEscalationPacket(dir, await load(dir), {
      kind: "budget", population: "gateMaintenance", budget: { used: 1, max: 1 }, detail: "cat: report.tap: No such file",
    });

    expect(packet.evidence).toBe("cat: report.tap: No such file");
    expect(packet.references).toEqual(["gate-maintenance-1-0"]);
  });
});
