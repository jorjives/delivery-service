# Triage and Deterministic Router — Slice 2: Every Escalation Hands a Human a Decision, Not Internal State

> **Status:** ✅ Complete — 2026-09-11 — `8c13b87`
> **For agentic workers:** REQUIRED SUB-SKILL: Use jorj-skills:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Slice:** 2 of `docs/superpowers/specs/2026-09-10-triage-and-router-slices.md`
**Spec:** `docs/superpowers/specs/2026-09-10-triage-and-router-design.md`

**Goal:** Every surface that reaches `ESCALATED`, whatever caused it, stores a five-part `EscalationPacket` (decision, verbatim evidence, dead ends, why now, session references) that `outcome.packetRef` points at; and triage output that is unusable, or illegal for its setback, always escalates with a plain-English reason and never acts.

**Architecture:** A new `src/escalation-packet.ts` holds a pure `buildEscalationPacket(cause, facts)` and an async `resolveEscalationPacket(dir, caseFile, cause)` that reads the verbatim evidence from refs, mirroring the `resolveEvidence`/`assemblePrompt` split. `TriageVerdict` gains an in-memory `cause`, so the deterministic router and `toTriageVerdict` say why they escalated without doing I/O. `surface.ts`'s `escalate()` becomes the single place a surface escalates from: every escalation writes its packet to the ref `escalation` and records `packetRef` in the outcome. `triage()` also writes the packet into the round's ref before appending the entry, so a resumed escalation finds it there.

**Tech Stack:** TypeScript (ESM, Node ≥22), zod v4, vitest, `@anthropic-ai/claude-agent-sdk` 0.3.x, `claude-mock` (sibling project, resolved from `PATH`).

## Global Constraints

- Node ≥22, TypeScript, the existing `eslint`/`typescript-eslint` strict config, `vitest`. **No new dependency of any kind.**
- **Buy-vs-build (spec):** the packet is validated with the existing zod `EscalationPacket` schema. A deterministic packet is built by one pure function over the case file: "an agent call to restate known facts costs money for no judgement". No second schema library, no agent call to write a packet the harness can build.
- **Operability/DX (Slice 1 Operational note, still binding):** the demo depends on `claude-mock` on `PATH`, says so plainly and exits non-zero when it is absent. `claude-mock` does not enforce `allowedTools`; no demo line or doc may claim otherwise.
- **Packet text is prose.** Never a stack trace or an exception message. Budget populations appear by label (`correction`, `gate recheck`, `gate repair`, `session retry`, `close retry`), never by their camelCase keys, and setback triggers appear as words ("a close failure"), never as codes, in `decision` and `why_now`.
- **A budget packet says it plainly:** `No <label> budget remains (<used>/<max> used).`
- **The safe outcome is always escalate.** Unusable or illegal triage output never defaults to a reroute.
- **A failed close ends only in `retry_close`, `escalate` or `abort`** (`legalVerdicts.close_failure`).
- **Determinism:** a packet is a pure function of the case file and its refs, with no clock and no randomness. A re-run after a crash rewrites the same packet at the same key.
- **No side effect before the single `TriageEntry` append** except the round's ref write, which now also carries the packet and which a re-run overwrites at the same key.
- **`outcome.reason` strings do not change.** Existing unit and UAT tests assert on them (`budgetExhausted(...)`, the worker's rationale).
- **`status` at the SDK boundary, `verdict` in the case file:** `toTriageVerdict` stays the only translation point.
- Worker and gate-maintenance prompts are unchanged.
- Run commands from the worktree root. Targeted tests only: `npx vitest run <file> -t "<name>"`. Typecheck: `npx tsc --noEmit`.

## Scaffolding Impact

- `src/index.ts` public exports: the packet builder, resolver, labels and `EscalationCause` → Task 2.
- `src/router.ts` module comment ("no brief or escalation-packet synthesis (Item 5's concern)") goes stale once the router names escalation causes → Task 3.
- `docs/single-surface-control-flow.md` case-file sketch: the `outcome?` line lists `{kind, source, reason, at}`; it gains `packet_ref?` → Task 4.
- `package.json`: new `demo:triage-slice-2` script → Task 5.
- `eslint.config.js`: no change. `demos/*.ts` and `tests/triage-and-router/*.ts` are already matched; the new demo and the UAT phase's test bring the default-project count to 51 against a ceiling of 60. Task 5 lints the demo to prove it.
- `docs/agent-interface.md`: none. It already says an `escalate` carries an `EscalationPacket`; the envelope is unchanged.
- `docs/configuring-a-role.md`: none. The Triage chapter belongs to Slice 3.
- `README.md`, `CONTRIBUTING.md`: none. No new command beyond the demo script, no env var, no build step.

**Decisions recorded (unattended run; each departs from the spec's sketch for a stated reason):**

1. **The surface writes the packet, at its one escalation point; there is no `withPacket` inside `createAgentTriage`.** The slice promises a packet "whatever caused it". An authority escalation never reaches `TRIAGE` in the surface (`deriveStateFromEntry` sends an authority terminus straight to `ESCALATED`), and the terminus and gate-repair caps escalate outside triage altogether. A port-level `withPacket` would also leave a deterministic-only harness, or any extender's `TriagePort`, with no packets.
2. **`buildEscalationPacket(cause, facts)` lives in `src/escalation-packet.ts`, not in `triage-role-config.ts` taking a `TriageInput`.** Verbatim evidence sits behind refs (the newly-failing assertion detail, the close report detail), so a pure function over `TriageInput` cannot reach it. The I/O is split into `resolveEscalationPacket`, the same shape as `resolveEvidence` beside `assemblePrompt`.
3. **`TriageVerdict.cause?: EscalationCause`**, in memory only and never persisted, lets the router and `toTriageVerdict` name why they escalated. Without it the surface would re-derive the cause from budgets and duplicate the router's trigger-to-population table.
4. **`CaseFileOutcome.packetRef?: string`**, optional so older case files stay valid. The packet is always at ref `escalation` (a surface escalates at most once) and the outcome names it, so a reader finds the packet from `case.json` alone, triage or no triage. A triage-caused escalation also keeps the same packet as its round ref's `artifact`, as the spec requires. Both are written from one object in one advance.
5. **The authority decision does not embed the worker's rationale.** That rationale appears verbatim as the packet's `evidence`, immediately after the decision; embedding it as well duplicated it and broke the sentence's punctuation.
6. **Pulled forward from Slice 3:** `needsJudgement` engages the agent for `close_failure` with exactly one close slot left. This slice's UAT drives "a failed close where the triage agent wrongly answers retry the worker", which cannot happen unless triage is asked about a close failure at all. Last-slot `gate_fail`, `gate_error` judgement and `recheck_gate` stay in Slice 3.
7. **Tidy first (Task 1):** resuming a triage `escalate` whose outcome was never written currently credits the outcome to `worker` with the reason "the session escalated". It is fixed before the packet work depends on that path.
8. **The illegal-verdict rationale names the setback in words** ("after a close failure"), not as a trigger code ("a close_failure setback"). Verdict names stay, because they are the vocabulary a reader acts on.
9. **A `TriagePort` that escalates with neither a packet nor a cause** gets the triage-failure packet, with its rationale in `why_now`. No port in this codebase does that; the fallback exists so the "every escalation has a packet" invariant cannot be broken by an extender.

**Not in this slice:** last-slot `gate_fail` judgement, `gate_error` judgement and `recheck_gate`, threading a `GateRepairBrief` to gate maintenance, the Triage guide chapter, and Dana's plain-language summary (COULD).

---

## Task 1: Resuming a triage escalate credits triage, with its own rationale

Tidy first. `advance()` routes an `ESCALATED` tail with no outcome to `escalateFromTail(…, "worker")`, which only understands a terminus tail. A triage `escalate` recorded just before a crash therefore resumes as `source: "worker"`, `reason: "the session escalated"`. Task 4 makes that path write a packet, so it must be right first.

**Files:**
- Modify: `src/surface.ts` (`escalateFromTail`, and the `ESCALATED` case comment in `advance`)
- Modify: `src/surface.test.ts` (add `writeRef` to the `./case-file.js` import; one new test)

**Interfaces:**
- Consumes: `logTail` (`case-file.ts`), `escalate` (private, `surface.ts`).
- Produces: no signature changes. `escalateFromTail(dir, caseFile, location, ports, source)` credits a `triage` tail to `"triage"` with the tail's rationale.

- [ ] **Step 0: Install dependencies if the worktree has no `node_modules`**

Run: `test -d node_modules || npm ci`
Expected: completes; `git status` stays clean.

- [ ] **Step 1: Write the failing test**

In `src/surface.test.ts`, add `writeRef` to the existing `./case-file.js` import. Inside `describe("the AGENT_ACTIVE edge", …)`, directly after the test `"resumes an authority escalate recorded before the outcome was written"`, add:

```ts
  it("resumes a triage escalate recorded before the outcome was written, crediting triage", async () => {
    // The crash window between appending an escalate triage entry and writing the outcome.
    const ports = portsWith(unusedAgent());
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "exhaustion", rationale: "stuck for good",
    });
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "no retry can help" });
    await appendEntry(dir, {
      t: "triage", afterAttempt: 1, trigger: "worker_escalate",
      verdict: "escalate", rationale: "no retry can help", artifactRef: "triage-0",
    });

    const result = await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, ports);

    expect(result).toEqual({ state: "ESCALATED", done: true });
    expect((await load(dir)).outcome).toMatchObject({ source: "triage", reason: "no retry can help" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/surface.test.ts -t "resumes a triage escalate"`
Expected: FAIL, the outcome has `source: "worker"` and `reason: "the session escalated"`.

- [ ] **Step 3: Write minimal implementation**

In `src/surface.ts`, replace `escalateFromTail` and its doc comment:

```ts
/**
 * Terminal escalation for a log tail that already records one: an authority
 * terminus, a repair session's escalate, or a triage escalate whose outcome was
 * never written. The reason is the tail's own rationale, and a triage tail is
 * credited to triage, exactly as the live run would have credited it.
 */
function escalateFromTail(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);
  if (tail?.t === "triage") {
    return escalate(dir, caseFile, location, ports, "triage", tail.rationale);
  }
  return escalate(
    dir, caseFile, location, ports, source,
    tail?.t === "terminus" ? tail.rationale : "the session escalated",
  );
}
```

In `advance()`, replace the comment on `case "ESCALATED":` with:

```ts
      // The crash window between recording an escalation (an authority-class
      // terminus, or a triage escalate) and writing the outcome: resume onto
      // the terminal edge, not into a throw.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/surface.test.ts -t "resume"`
Expected: PASS, including the existing authority-resume and resume-parity tests.

- [ ] **Step 5: Commit**

```bash
git add src/surface.ts src/surface.test.ts
git commit -m "Credit a resumed triage escalation to triage, with its rationale

A triage escalate recorded just before a crash resumed through a helper
that only understood a worker terminus, so the outcome blamed the worker
and gave a generic reason. The resume now reads the triage tail the same
way the live run would have, which the escalation packet work relies on.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: A packet a person can act on, built from the case file

**Files:**
- Create: `src/escalation-packet.ts`
- Create: `src/escalation-packet.test.ts`
- Modify: `src/ports.ts` (add `EscalationCause`)
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `deriveBudgetsFromLog`, `readRef` (`case-file.ts`); `NewFailure`, `Budget`, `BudgetPopulation`, `BudgetSet`, `CaseFile`, `HistoryEntry` (`schema.ts`); `EscalationPacket` type (`triage-role-config.ts`); `TriageInput` type (`ports.ts`).
- Produces (`src/ports.ts`):

```ts
/** Why a surface escalated, when no agent wrote the packet. The surface builds the packet from it. */
export type EscalationCause =
  | { kind: "authority"; role: "worker" | "gate-maintenance" }
  | { kind: "repair_gave_up" }
  | { kind: "budget"; population: BudgetPopulation; budget: Budget; detail: string }
  | { kind: "triage_failure"; rationale: string };
```

- Produces (`src/escalation-packet.ts`):
  - `POPULATION_LABELS: Record<BudgetPopulation, string>`
  - `SETBACK_LABELS: Record<TriageInput["trigger"], string>`
  - `NO_PRIOR_ATTEMPTS = "No prior attempts were triaged."`
  - `interface PacketFacts { evidence: string; priorRationales: string[]; references: string[]; budgets: BudgetSet }`
  - `buildEscalationPacket(cause: EscalationCause, facts: PacketFacts): EscalationPacket`
  - `resolveEscalationPacket(dir: string, caseFile: CaseFile, cause: EscalationCause): Promise<EscalationPacket>`

- [ ] **Step 1: Write the failing tests**

Create `src/escalation-packet.test.ts`:

```ts
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
const triageFailure = {
  kind: "triage_failure",
  rationale:
    "triage did not produce a usable verdict: triage session did not complete: the session ended without reporting a result. Escalating rather than guessing.",
} satisfies EscalationCause;
const repairGaveUp = { kind: "repair_gave_up" } satisfies EscalationCause;
const all: EscalationCause[] = [authority, budget, triageFailure, repairGaveUp];

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

  it("lists earlier triage rounds oldest first, or says there were none", () => {
    expect(buildEscalationPacket(authority, facts).dead_ends).toBe(NO_PRIOR_ATTEMPTS);
    expect(buildEscalationPacket(authority, { ...facts, priorRationales: ["first", "second"] }).dead_ends)
      .toBe("1. first\n2. second");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/escalation-packet.test.ts`
Expected: FAIL, `./escalation-packet.js` does not exist.

- [ ] **Step 3: Write the implementation**

`src/ports.ts`: change the first import to `import type { Budget, BudgetPopulation, BudgetSet, CaseFile } from "./schema.js";` and add the `EscalationCause` block from Produces directly above `export interface TriageInput`.

Create `src/escalation-packet.ts`:

```ts
import { z } from "zod";
import { deriveBudgetsFromLog, readRef } from "./case-file.js";
import { NewFailure, type BudgetPopulation, type BudgetSet, type CaseFile, type HistoryEntry } from "./schema.js";
import type { EscalationCause, TriageInput } from "./ports.js";
import type { EscalationPacket } from "./triage-role-config.js";

/** Budget populations as a person reads them. Key order is the order they are listed in. */
export const POPULATION_LABELS: Record<BudgetPopulation, string> = {
  correction: "correction",
  gateError: "gate recheck",
  gateMaintenance: "gate repair",
  terminus: "session retry",
  close: "close retry",
};

/** Setback triggers as a person reads them. */
export const SETBACK_LABELS: Record<TriageInput["trigger"], string> = {
  gate_fail: "a gate failure",
  gate_error: "a gate error",
  worker_escalate: "a worker escalation",
  close_failure: "a close failure",
};

const ROLE_LABELS = { worker: "worker", "gate-maintenance": "gate repair session" } as const;

export const NO_PRIOR_ATTEMPTS = "No prior attempts were triaged.";
const NO_EVIDENCE = "No setback evidence is recorded in the case file.";
const GATE_ERROR_EVIDENCE = "The gate could not run to completion; its error output is not kept in the case file.";
const GATE_FAIL_EVIDENCE = "The gate failed without recording which assertions broke.";

const CloseDetail = z.object({ detail: z.string().min(1) });

/** What a packet says beyond its cause: all of it read from the case file. */
export interface PacketFacts {
  /** Verbatim: the failing assertions, the session's own rationale, or the close report's detail. */
  evidence: string;
  /** Rationales of the triage rounds before this escalation, oldest first. */
  priorRationales: string[];
  /** Session keys of every dispatch, for pulling a transcript. */
  references: string[];
  budgets: BudgetSet;
}

/**
 * The packet a person reads at ESCALATED when no agent wrote one. Pure: the
 * decision and the reason are fixed sentences per cause, everything else is
 * quoted from the case file, so the same log always yields the same packet.
 */
export function buildEscalationPacket(cause: EscalationCause, facts: PacketFacts): EscalationPacket {
  return {
    decision: decisionFor(cause),
    evidence: facts.evidence,
    dead_ends:
      facts.priorRationales.length === 0
        ? NO_PRIOR_ATTEMPTS
        : facts.priorRationales.map((rationale, i) => `${i + 1}. ${rationale}`).join("\n"),
    why_now: `${reasonFor(cause)} Budgets used so far: ${budgetLine(facts.budgets)}.`,
    references: facts.references,
  };
}

function decisionFor(cause: EscalationCause): string {
  switch (cause.kind) {
    case "authority":
      return `The ${ROLE_LABELS[cause.role]} stopped because it judged it lacked authority. Decide whether to grant that authority or take the action yourself.`;
    case "repair_gave_up":
      return "The gate repair session gave up. Decide whether to repair the check yourself, amend the task, or abandon it.";
    case "budget":
      return `No ${POPULATION_LABELS[cause.population]} budget remains (${cause.budget.used}/${cause.budget.max} used). Decide whether to continue manually, amend the task, or abandon it.`;
    case "triage_failure":
      return "Triage could not reach a verdict. Decide how to proceed from the evidence below.";
  }
}

function reasonFor(cause: EscalationCause): string {
  switch (cause.kind) {
    case "authority":
      return `The ${ROLE_LABELS[cause.role]} reported that it lacks the authority to go on; an authority limit goes straight to a person and is never retried.`;
    case "repair_gave_up":
      return "The gate repair session escalated: it judged it could not get the check running again.";
    case "budget":
      return `The ${POPULATION_LABELS[cause.population]} budget is spent (${cause.budget.used}/${cause.budget.max} used), so the harness cannot try again.`;
    case "triage_failure":
      return `Triage's reply could not be acted on: ${cause.rationale}`;
  }
}

function budgetLine(budgets: BudgetSet): string {
  return (Object.keys(POPULATION_LABELS) as BudgetPopulation[])
    .map((p) => `${POPULATION_LABELS[p]} ${budgets[p].used}/${budgets[p].max}`)
    .join(", ");
}

/**
 * Read what the packet quotes, then build it. The only I/O in this module.
 *
 * An escalate triage round is the escalation being reported, not an earlier
 * dead end, so it is left out; that also makes the packet identical whether it
 * is built just before that round's entry is appended or just after.
 */
export async function resolveEscalationPacket(
  dir: string,
  caseFile: CaseFile,
  cause: EscalationCause,
): Promise<EscalationPacket> {
  const { history } = caseFile;
  const fallback = cause.kind === "budget" ? cause.detail : NO_EVIDENCE;
  return buildEscalationPacket(cause, {
    evidence: (await evidenceOf(dir, history)) || fallback,
    priorRationales: history.flatMap((e) => (e.t === "triage" && e.verdict !== "escalate" ? [e.rationale] : [])),
    references: history.flatMap((e) => (e.t === "dispatch" ? [e.sessionKey] : [])),
    budgets: deriveBudgetsFromLog(history, caseFile.cursor.budgets),
  });
}

/** Verbatim evidence from the latest setback in the log, or undefined when there is none. */
async function evidenceOf(dir: string, history: HistoryEntry[]): Promise<string | undefined> {
  const setback = history.findLast(
    (e) =>
      (e.t === "terminus" && e.status !== "completed") ||
      (e.t === "gate" && e.status !== "PASS") ||
      (e.t === "close" && e.status !== "DONE"),
  );
  if (setback?.t === "terminus") return setback.rationale;
  if (setback?.t === "gate") {
    const parsed = await Promise.all(
      setback.newFailures.map((f) => readRef(dir, f.detailRef).then((raw) => NewFailure.safeParse(raw))),
    );
    const lines = parsed.flatMap((p) => (p.success ? [`${p.data.id}: ${p.data.detail}`] : []));
    if (lines.length > 0) return lines.join("\n");
    return setback.status === "ERROR" ? GATE_ERROR_EVIDENCE : GATE_FAIL_EVIDENCE;
  }
  if (setback?.t === "close") {
    const report = CloseDetail.safeParse(await readRef(dir, setback.detailRef));
    return report.success ? report.data.detail : "The closer reported a failure and left no detail.";
  }
  return undefined;
}
```

`src/index.ts`: add

```ts
export { buildEscalationPacket, resolveEscalationPacket, POPULATION_LABELS, SETBACK_LABELS, NO_PRIOR_ATTEMPTS } from "./escalation-packet.js";
export type { PacketFacts } from "./escalation-packet.js";
```

and add `EscalationCause` to the `./ports.js` type export list.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/escalation-packet.test.ts` then `npx tsc --noEmit`
Expected: PASS; typecheck clean (the exhaustive `switch`es compile with no default).

- [ ] **Step 5: Commit**

```bash
git add src/escalation-packet.ts src/escalation-packet.test.ts src/ports.ts src/index.ts
git commit -m "Build escalation packets from the case file, with no agent call

A person handed an escalation needs the decision being asked of them, the
evidence verbatim, what was already tried, why it stopped now and which
sessions to read, not a rationale string. When no agent wrote that packet,
the harness can: the decision and reason are fixed sentences per cause,
and everything else is quoted from the log and its refs, so the same case
file always yields the same packet and costs nothing to produce.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Triage says why it escalated, and a failed close cannot be retried as a worker

**Files:**
- Modify: `src/ports.ts` (`TriageVerdict.cause`)
- Modify: `src/router.ts` (causes on both escalations; module comment)
- Modify: `src/router.test.ts`
- Modify: `src/triage.ts` (`needsJudgement` for `close_failure`; causes and plain setback wording in `toTriageVerdict`)
- Modify: `src/triage.test.ts`

**Interfaces:**
- Consumes: `EscalationCause` (`ports.ts`, Task 2), `SETBACK_LABELS` (`escalation-packet.ts`, Task 2), `DID_NOT_COMPLETE` (`agent-invoke.ts`).
- Produces (`src/ports.ts`), added to `TriageVerdict`:

```ts
  /**
   * In memory only: why an `escalate` verdict escalated, when no agent wrote a
   * packet. The surface builds the packet a person reads from it. Never persisted.
   */
  cause?: EscalationCause;
```

- `deterministicRouter` sets `cause` on its two escalations; `toTriageVerdict` sets `{ kind: "triage_failure", rationale }` on its two failure branches. No signature changes.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("deterministicRouter", …)` in `src/router.test.ts`:

```ts
  it("names an authority limit as the cause of its escalation", async () => {
    expect((await deterministicRouter.triage(input("worker_escalate", fresh, "authority"))).cause)
      .toEqual({ kind: "authority", role: "worker" });
  });

  it.each([
    ["gate_fail", "correction"],
    ["gate_error", "gateMaintenance"],
    ["close_failure", "close"],
    ["worker_escalate", "correction"],
  ] as [TriageInput["trigger"], keyof BudgetSet][])("names the spent %s population (%s) as the cause of an at-cap escalation",
    async (trigger, population) => {
      const verdict = await deterministicRouter.triage(input(trigger, atCap(population)));
      expect(verdict.cause).toMatchObject({
        kind: "budget",
        population,
        budget: { used: fresh[population].max, max: fresh[population].max },
      });
    },
  );

  it("gives no cause for a verdict that is not an escalation", async () => {
    expect((await deterministicRouter.triage(input("gate_fail"))).cause).toBeUndefined();
  });
```

In `src/triage.test.ts`, add `import { DID_NOT_COMPLETE } from "./agent-invoke.js";`. In the existing test `"escalates a verdict that is not legal for the trigger, naming the verdict, trigger and legal set"`, rename it to `"escalates a verdict that is not legal for the trigger, naming the verdict, setback and legal set"` and replace `expect(verdict.rationale).toContain("worker_escalate");` with `expect(verdict.rationale).toContain("after a worker escalation");`. Then append:

```ts
const packet = {
  decision: "Decide whether to amend the task.",
  evidence: "not ok 2 - beta",
  dead_ends: "attempt 1 edited the template",
  why_now: "one slot left",
  references: ["worker-1-0"],
};

describe("a failed close", () => {
  const failedClose = (closeUsed: number) =>
    input({ trigger: "close_failure", category: undefined, remainingBudgets: budgets(0, closeUsed) });

  it("engages the agent only on its last close slot", () => {
    expect(needsJudgement(failedClose(2))).toBe(true);
    expect(needsJudgement(failedClose(1))).toBe(false);
    expect(needsJudgement(failedClose(3))).toBe(false);
  });

  it.each(["reroute", "fix_the_gate"] as const)(
    "escalates a %s answer instead, naming the verdict and the verdicts allowed",
    (status) => {
      const verdict = toTriageVerdict({ status, rationale: "try again", payload: brief }, failedClose(2));
      expect(verdict.verdict).toBe("escalate");
      expect(verdict.rationale).toBe(
        `triage answered ${status}, which is not allowed after a close failure ` +
          "(allowed: retry_close, escalate, abort). Escalating rather than acting on it.",
      );
      expect(verdict.artifact).toBeUndefined();
      expect(verdict.cause).toEqual({ kind: "triage_failure", rationale: verdict.rationale });
    },
  );

  it.each([
    { status: "retry_close", rationale: "flaky", payload: brief },
    { status: "escalate", rationale: "stop", payload: packet },
    { status: "abort", rationale: "infra", payload: { reason: "disk full" } },
  ] as TriageTerminus[])("acts on a legal $status answer", (reply) => {
    expect(toTriageVerdict(reply, failedClose(2)).verdict).toBe(reply.status);
  });

  it("asks the agent on the last slot, and escalates its 'retry the worker' answer", async () => {
    const agent = triageAgent({ status: "reroute", rationale: "retry the worker", payload: brief });
    const verdict = await createAgentTriage(agent).triage(failedClose(2));
    expect(agent.calls).toHaveLength(1);
    expect(verdict.verdict).toBe("escalate");
  });
});

describe("unusable triage output", () => {
  it.each(Object.values(DID_NOT_COMPLETE))(
    "escalates in plain English, never a retry, when %s",
    (reason) => {
      const verdict = toTriageVerdict(
        { status: "incomplete", rationale: `triage session did not complete: ${reason}` },
        input({}),
      );
      expect(verdict.verdict).toBe("escalate");
      expect(verdict.rationale).toBe(
        `triage did not produce a usable verdict: triage session did not complete: ${reason}. Escalating rather than guessing.`,
      );
      expect(verdict.rationale).not.toMatch(/Error|\n\s+at\s/);
      expect(verdict.cause).toEqual({ kind: "triage_failure", rationale: verdict.rationale });
    },
  );

  it("keeps the agent's own packet when it escalates, with no cause to rebuild one from", async () => {
    const agent = triageAgent({ status: "escalate", rationale: "no retry will help", payload: packet });
    const verdict = await createAgentTriage(agent).triage(input({}));
    expect(verdict).toEqual({ verdict: "escalate", rationale: "no retry will help", artifact: packet });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/router.test.ts src/triage.test.ts`
Expected: FAIL. `cause` is undefined; the rationale still says "a worker_escalate setback"; `needsJudgement(failedClose(2))` is false.

- [ ] **Step 3: Write the implementation**

`src/ports.ts`: add the `cause` field from Produces to `TriageVerdict`, after `artifact`.

`src/router.ts`: replace the authority return and the at-cap return:

```ts
    if (input.trigger === "worker_escalate" && input.category === "authority") {
      return Promise.resolve({
        verdict: "escalate",
        rationale: "authority limit: the worker reported no retry can resolve this",
        cause: { kind: "authority", role: "worker" },
      });
    }

    const { budget, helpful } = rules[input.trigger];
    const { used, max } = input.remainingBudgets[budget];

    if (used >= max) {
      const detail = `no retry remains for a ${input.trigger} setback`;
      return Promise.resolve({
        verdict: "escalate",
        rationale: budgetExhausted(budget, { used, max }, detail),
        cause: { kind: "budget", population: budget, budget: { used, max }, detail },
      });
    }
```

and replace the `deterministicRouter` doc comment with:

```ts
/**
 * The built-in `TriagePort`: a lookup table with no agent call. It never writes
 * a brief or a packet; when it escalates it names the cause (`cause`), and the
 * surface builds the escalation packet a person reads from that. It reads
 * nothing but the trigger, the escalate category, and the log-derived budgets
 * the caller computed immediately before calling it.
 */
```

The `outcome.reason` text (`rationale`) is unchanged.

`src/triage.ts`: add `import { SETBACK_LABELS } from "./escalation-packet.js";`. Replace `needsJudgement`'s body and doc comment:

```ts
/**
 * Whether a real decision exists that an agent could change. A stuck worker
 * with a correction slot left is one: triage may judge a retry worthwhile and
 * say what to try. The last close slot is another: a clean escalation may beat
 * one more long-shot close. Once a population is spent, no judgement changes
 * the outcome, so no agent is asked a question whose only answer is escalate.
 */
export function needsJudgement({ trigger, category, remainingBudgets: b }: TriageInput): boolean {
  const left = (x: Budget) => x.max - x.used;
  switch (trigger) {
    case "worker_escalate":
      return category !== "authority" && left(b.correction) > 0;
    case "close_failure":
      return left(b.close) === 1;
    case "gate_fail":
    case "gate_error":
      return false;
  }
}
```

Replace the two failure branches of `toTriageVerdict`:

```ts
  if (terminus.status === "incomplete") {
    const rationale = `triage did not produce a usable verdict: ${terminus.rationale}. Escalating rather than guessing.`;
    return { verdict: "escalate", rationale, cause: { kind: "triage_failure", rationale } };
  }
  const legal = legalVerdicts[input.trigger];
  if (!legal.has(terminus.status)) {
    const rationale =
      `triage answered ${terminus.status}, which is not allowed after ${SETBACK_LABELS[input.trigger]} ` +
      `(allowed: ${[...legal].join(", ")}). Escalating rather than acting on it.`;
    return { verdict: "escalate", rationale, cause: { kind: "triage_failure", rationale } };
  }
```

The legal branch is unchanged: an agent's `escalate` carries its packet as `artifact` and no `cause`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/router.test.ts src/triage.test.ts` then `npx tsc --noEmit`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ports.ts src/router.ts src/router.test.ts src/triage.ts src/triage.test.ts
git commit -m "Name why triage escalated, and ask it about a failed close's last slot

The surface can only write a person a useful packet if it knows why the
escalation happened, so the router and the verdict translation now say so
(an authority limit, a spent budget, or triage output that could not be
used) without doing any I/O themselves. A failed close on its last slot is
put to the triage agent, and an answer that is illegal for a close, such
as retrying the worker, escalates with a reason naming it and the verdicts
that were allowed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The surface stores a packet on every escalation

**Files:**
- Modify: `src/schema.ts` (`CaseFileOutcome.packetRef`)
- Modify: `src/surface.ts` (`escalate`, `escalateFromTail`, `dispatchSession`, `dispatchGateMaintenance`, `incompleteTerminus`, `triage`; two new private helpers)
- Modify: `src/surface.test.ts` (new `describe("escalation packets")`)
- Modify: `docs/single-surface-control-flow.md` (case-file `outcome?` line)

**Interfaces:**
- Consumes: `resolveEscalationPacket` (Task 2), `EscalationCause` and `TriageVerdict.cause` (Tasks 2 and 3), `EscalationPacket` (`triage-role-config.ts`), `NO_PRIOR_ATTEMPTS` (Task 2), `DID_NOT_COMPLETE` (`agent-invoke.ts`).
- Produces:
  - `src/schema.ts`: `CaseFileOutcome` gains `packetRef: z.string().optional()`.
  - `src/surface.ts` (private): `escalate(dir, caseFile, location, ports, source, reason, packet: EscalationPacket): Promise<AdvanceResult>` writes ref `escalation` and sets `outcome.packetRef = "escalation"`; `packetFor(dir: string, cause: EscalationCause): Promise<EscalationPacket>`; `packetForVerdict(dir: string, caseFile: CaseFile, verdict: TriageVerdict): Promise<EscalationPacket>`. No exported signature changes.

- [ ] **Step 1: Write the failing tests**

In `src/surface.test.ts` add imports: `EscalationPacket` from `./triage-role-config.js` (alongside `triageRoleConfig`); `NO_PRIOR_ATTEMPTS` from `./escalation-packet.js`; `DID_NOT_COMPLETE` added to the `./agent-invoke.js` import. Then add after `describe("triage by agent", …)`:

```ts
describe("escalation packets", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "surface-case-"));
    await create(dir, { surfaceId: "surface-1", taskDef: { intent: "x" }, gateRef }, budgets);
  });

  /** The packet the outcome points at, validated as the five-part shape. */
  async function storedPacket(): Promise<EscalationPacket> {
    const { outcome } = await load(dir);
    expect(outcome).toMatchObject({ kind: "escalated", packetRef: "escalation" });
    return EscalationPacket.parse(await readRef(dir, outcome?.packetRef ?? "escalation"));
  }

  const brief = {
    problem: "p", dead_ends: "attempt 1 looked in the wrong module", scope: "s", references: ["worker-1-0"], diagnosis: "h",
  };
  const agentPacket = {
    decision: "Decide whether to grant access to the translations service.",
    evidence: "I cannot reach the translations service",
    dead_ends: "attempt 1 searched the handlers",
    why_now: "a retry would repeat the same search",
    references: ["worker-1-0"],
  };
  const stuck = (): Promise<Terminus> =>
    Promise.resolve({ status: "escalate", category: "exhaustion", rationale: "I cannot reach the translations service" });

  it("stores the triage agent's own packet, in the round's ref and where the outcome points", async () => {
    const agent = sessionAgent(stuck, () =>
      Promise.resolve({ status: "escalate", rationale: "no retry will help", payload: agentPacket }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("ESCALATED");

    expect(await storedPacket()).toEqual(agentPacket);
    expect(await readRef(dir, "triage-0")).toMatchObject({ artifact: agentPacket });
  });

  it("builds an authority escalation's packet with no agent call, quoting the worker", async () => {
    const agent = scriptedAgent([
      { status: "escalate", category: "authority", rationale: "needs a deploy key I do not hold" },
    ]);
    const ports = portsWith(agent); // any triage call rejects
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await run(dir, location, ports);

    const packet = await storedPacket();
    expect(packet.decision).toContain("lacked authority");
    expect(packet.evidence).toBe("needs a deploy key I do not hold");
    expect(packet.dead_ends).toBe(NO_PRIOR_ATTEMPTS);
    expect(packet.why_now).toContain("never retried");
    expect(packet.references).toEqual(["worker-1-0"]);
    expect(agent.calls).toEqual(["worker:worker-1-0"]);
  });

  it("builds a packet saying no correction budget remains, quoting the failing assertion", async () => {
    await updateCursor(dir, { budgets: { ...budgets, correction: { used: 0, max: 1 } } });
    const agent = sessionAgent((_role, ctx) => {
      writeFileSync(join(ctx.worktreePath, "report.tap"), FAILING_TAP);
      return Promise.resolve({ status: "completed", rationale: "changed it" });
    }); // no triage function: the deterministic router decides, and any agent triage call rejects
    const ports = portsWithTriage(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("ESCALATED");

    const packet = await storedPacket();
    expect(packet.decision).toContain("No correction budget remains (1/1 used).");
    const gate = (await load(dir)).history.findLast((e) => e.t === "gate");
    const detailRef = gate?.t === "gate" ? gate.newFailures[0]?.detailRef : undefined;
    const failure = (await readRef(dir, detailRef ?? "missing")) as { id: string; detail: string };
    expect(packet.evidence).toBe(`${failure.id}: ${failure.detail}`);
    expect(packet.dead_ends).toMatch(/^1\. gate_fail: reroute/);
    expect(packet.references).toEqual(["worker-1-0", "worker-2-0"]);
    expect(await readRef(dir, "triage-1")).toMatchObject({ artifact: packet });
  });

  it("builds a packet saying no session retry budget remains", async () => {
    await updateCursor(dir, { budgets: { ...budgets, terminus: { used: 0, max: 2 } } });
    const agent = scriptedAgent([{ status: "incomplete", rationale: "worker session did not complete: hit the turn cap" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    await run(dir, location, ports);

    const packet = await storedPacket();
    expect(packet.decision).toContain("No session retry budget remains (2/2 used).");
    expect(packet.evidence).toBe("worker session did not complete: hit the turn cap");
  });

  it("builds a packet saying no gate repair budget remains when the gate never runs", async () => {
    const agent = scriptedAgent([{ status: "completed", rationale: "claims to have fixed it" }]);
    const ports = portsWith(agent);
    const location = await provisioned(dir, { "seed.txt": "hello\n" }, ports);

    await run(dir, location, ports);

    const packet = await storedPacket();
    expect(packet.decision).toContain("No gate repair budget remains (2/2 used).");
    expect(packet.references).toEqual(expect.arrayContaining(["gate-maintenance-1-0", "gate-maintenance-2-0"]));
  });

  it("builds a packet when triage's reply cannot be used, and never retries the worker", async () => {
    const agent = sessionAgent(stuck, () =>
      Promise.resolve({ status: "incomplete", rationale: `triage session did not complete: ${DID_NOT_COMPLETE.wrongShape}` }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: noopCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("ESCALATED");

    const packet = await storedPacket();
    expect(packet.decision).toBe("Triage could not reach a verdict. Decide how to proceed from the evidence below.");
    expect(packet.why_now).toContain(DID_NOT_COMPLETE.wrongShape);
    expect(packet.evidence).toBe("I cannot reach the translations service");
    expect((await load(dir)).history.filter((e) => e.t === "dispatch")).toHaveLength(1);
    expect(await readRef(dir, "triage-0")).toMatchObject({ artifact: packet });
  });

  it("escalates a failed close that triage answers with 'retry the worker', and never reroutes", async () => {
    await updateCursor(dir, { budgets: { ...budgets, close: { used: 0, max: 1 } } });
    const refusingCloser: SurfacePorts["closer"] = {
      close: (_ctx, outcome) =>
        Promise.resolve(
          outcome.kind === "accepted"
            ? { status: "FAIL", detail: "the merge was refused" }
            : { status: "DONE", detail: "torn down" },
        ),
    };
    const agent = sessionAgent(
      () => Promise.resolve({ status: "completed", rationale: "clean" }),
      () => Promise.resolve({ status: "reroute", rationale: "retry the worker", payload: brief }),
    );
    const ports: SurfacePorts = { agent, triage: createAgentTriage(agent), closer: refusingCloser };
    const location = await provisioned(dir, { "report.tap": PASSING_TAP }, ports);

    expect((await run(dir, location, ports)).state).toBe("ESCALATED");

    const packet = await storedPacket();
    expect(packet.why_now).toContain(
      "triage answered reroute, which is not allowed after a close failure (allowed: retry_close, escalate, abort)",
    );
    expect(packet.evidence).toBe("the merge was refused");
    const { history } = await load(dir);
    expect(history.filter((e) => e.t === "triage")).toMatchObject([{ trigger: "close_failure", verdict: "escalate" }]);
    expect(history.filter((e) => e.t === "dispatch")).toHaveLength(1);
  });

  it("resumes a triage escalation recorded before its outcome, keeping the round's packet", async () => {
    const ports = portsWith(unusedAgent());
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "exhaustion", rationale: "stuck",
    });
    await writeRef(dir, "triage-0", { trigger: "worker_escalate", rationale: "no retry will help", artifact: agentPacket });
    await appendEntry(dir, {
      t: "triage", afterAttempt: 1, trigger: "worker_escalate",
      verdict: "escalate", rationale: "no retry will help", artifactRef: "triage-0",
    });

    await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, ports);

    expect(await storedPacket()).toEqual(agentPacket);
    expect((await load(dir)).outcome).toMatchObject({ source: "triage" });
  });

  it("resumes an authority escalation recorded before its outcome with the same packet a live run writes", async () => {
    const ports = portsWith(unusedAgent());
    await setBaseline(dir, { status: "PASS", assertions: [], detail: "" });
    await appendEntry(dir, { t: "dispatch", role: "worker", attempt: 1, sessionKey: "worker-1-0" });
    await appendEntry(dir, {
      t: "terminus", role: "worker", attempt: 1, sessionKey: "worker-1-0",
      status: "escalate", category: "authority", rationale: "needs an owner's sign-off",
    });

    await advance(dir, { repoPath: "/unused", worktreePath: "/unused" }, ports);

    const packet = await storedPacket();
    expect(packet.decision).toContain("lacked authority");
    expect(packet.evidence).toBe("needs an owner's sign-off");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/surface.test.ts -t "escalation packets"`
Expected: FAIL, the outcome has no `packetRef`, and there is no `escalation` ref.

- [ ] **Step 3: Write the implementation**

`src/schema.ts`, in `CaseFileOutcome` after `at`:

```ts
  // Escalated only: the ref holding the EscalationPacket a person reads.
  // Optional, so every case file written before packets existed stays valid.
  packetRef: z.string().optional(),
```

`src/surface.ts` imports: add `import { z } from "zod";`, `import { resolveEscalationPacket } from "./escalation-packet.js";`, `import { EscalationPacket } from "./triage-role-config.js";`, and add `EscalationCause`, `TriageVerdict` to the `./ports.js` type import.

Replace `escalate` and its comment:

```ts
/**
 * Terminate as ESCALATED with the standard `{kind, source, reason, at}` shape,
 * plus the packet a person reads. Every escalation, whatever caused it, comes
 * through here, so none can reach a person without one. One fixed ref key: a
 * surface escalates at most once, and a re-run after a crash rewrites the same
 * deterministic packet at the same place.
 */
async function escalate(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
  reason: string,
  packet: EscalationPacket,
): Promise<AdvanceResult> {
  const packetRef = await writeRef(dir, "escalation", packet);
  return terminate(dir, caseFile, location, ports, "ESCALATED", {
    kind: "escalated",
    source,
    reason,
    at: new Date().toISOString(),
    packetRef,
  });
}

/** The harness's packet for a cause, over the log as it now stands on disk. */
async function packetFor(dir: string, cause: EscalationCause): Promise<EscalationPacket> {
  return resolveEscalationPacket(dir, await load(dir), cause);
}

/** The ref shape `triage()` writes for an escalate round. */
const PacketRef = z.object({ artifact: EscalationPacket });
```

Replace `escalateFromTail` (as left by Task 1):

```ts
async function escalateFromTail(
  dir: string,
  caseFile: CaseFile,
  location: SurfaceLocation,
  ports: SurfacePorts,
  source: string,
): Promise<AdvanceResult> {
  const tail = logTail(caseFile);
  if (tail?.t === "triage") {
    // TRIAGE wrote this round's packet into its ref before appending the entry.
    const ref = PacketRef.safeParse(await readRef(dir, tail.artifactRef));
    const packet = ref.success
      ? ref.data.artifact
      : await packetFor(dir, { kind: "triage_failure", rationale: tail.rationale });
    return escalate(dir, caseFile, location, ports, "triage", tail.rationale, packet);
  }
  const terminus = tail?.t === "terminus" ? tail : undefined;
  const cause: EscalationCause =
    terminus?.category === "authority"
      ? { kind: "authority", role: terminus.role ?? "worker" }
      : { kind: "repair_gave_up" };
  return escalate(
    dir, caseFile, location, ports, source,
    terminus ? terminus.rationale : "the session escalated",
    await packetFor(dir, cause),
  );
}
```

(Only an authority terminus or a repair session's escalate reaches here with a terminus tail, since a worker's exhaustion escalate routes to `TRIAGE`.)

In `dispatchGateMaintenance`, the cap branch:

```ts
  if (used >= max) {
    return escalate(
      dir, caseFile, location, ports, "gate-maintenance",
      budgetExhausted("gateMaintenance", { used, max }, reason),
      await packetFor(dir, { kind: "budget", population: "gateMaintenance", budget: { used, max }, detail: reason }),
    );
  }
```

In `dispatchSession`, the `ESCALATED` branch (reached only by an authority-class terminus):

```ts
  if (state === "ESCALATED") {
    return escalate(
      dir, caseFile, location, ports, role, terminus.rationale,
      await packetFor(dir, { kind: "authority", role }),
    );
  }
```

In `incompleteTerminus`, the cap branch:

```ts
  if (used >= max) {
    return escalate(
      dir, caseFile, location, ports, "worker",
      budgetExhausted("terminus", { used, max }, tail.rationale),
      await packetFor(dir, { kind: "budget", population: "terminus", budget: { used, max }, detail: tail.rationale }),
    );
  }
```

Add above `triage()`:

```ts
/**
 * The packet for an escalate verdict: the agent's own when it wrote one, else
 * the harness's, built from the cause the port named. A port that named none
 * is treated as triage failing to reach a verdict, so no escalation can ever
 * reach a person without a packet.
 */
async function packetForVerdict(
  dir: string,
  caseFile: CaseFile,
  verdict: TriageVerdict,
): Promise<EscalationPacket> {
  const authored = EscalationPacket.safeParse(verdict.artifact);
  if (authored.success) return authored.data;
  return resolveEscalationPacket(
    dir, caseFile, verdict.cause ?? { kind: "triage_failure", rationale: verdict.rationale },
  );
}
```

In `triage()`, replace everything from the ref-write comment to the end of the function:

```ts
  // Every escalate carries a packet a person can act on. It goes into the
  // round's ref like any artefact, before the entry, so a resumed escalation
  // finds it there. Keyed by prior triage count so repeated rounds never
  // overwrite each other's artefacts; a crash between the ref and the entry
  // leaves an orphan ref that the re-run overwrites at the same key.
  const packet = verdict.verdict === "escalate" ? await packetForVerdict(dir, caseFile, verdict) : undefined;
  const artifact = packet ?? verdict.artifact;
  const artifactRef = await writeRef(dir, `triage-${priorTriages}`, {
    trigger,
    rationale: verdict.rationale,
    ...(artifact ? { artifact } : {}),
  });

  const entry: HistoryEntry = {
    t: "triage",
    afterAttempt: workerAttempt(caseFile.history),
    trigger,
    verdict: verdict.verdict,
    rationale: verdict.rationale,
    artifactRef,
  };
  await appendEntry(dir, entry);

  const state = deriveStateFromEntry(entry);
  // `packet` is set exactly when the verdict is escalate, which is exactly when
  // the entry routes to ESCALATED.
  if (state === "ESCALATED" && packet) {
    return escalate(dir, caseFile, location, ports, "triage", verdict.rationale, packet);
  }
  if (state === "ABORTED") {
    return abort(dir, caseFile, location, ports, "triage", verdict.rationale);
  }
  await updateCursor(dir, { state });
  return { state, done: false };
```

`docs/single-surface-control-flow.md`, in the case-file sketch, replace

```
  outcome?                    # {kind: closed|escalated|aborted, source, reason, at}
```

with

```
  outcome?                    # {kind: closed|escalated|aborted, source, reason, at, packet_ref?}
                              # packet_ref: escalated only → the EscalationPacket a person reads
                              # (decision, verbatim evidence, dead ends, why now, session keys)
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/surface.test.ts src/case-file.test.ts src/schema.test.ts` then `npx tsc --noEmit`
Expected: PASS: the new describe, plus every existing escalation, budget-cap, TRIAGE, "triage by agent" and resume-parity test, unchanged; typecheck clean. The mock-gated test runs when `claude-mock` is on `PATH`.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/surface.ts src/surface.test.ts docs/single-surface-control-flow.md
git commit -m "Store an escalation packet on every escalation, whatever caused it

An escalation is the handoff to a person, and a rationale string made
them reconstruct the rest from transcripts. Every escalation now goes
through one place that writes the packet to the case file and points the
outcome at it: the triage agent's own packet when it wrote one, otherwise
one built from the log for an authority limit, a spent budget, or triage
output that could not be used. A triage round's packet also lives in its
ref, so a resumed escalation hands over the same packet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Runnable demo: five escalations, five packets ✅ DONE (deliver-slice)

**Files:**
- Create: `demos/triage-slice-2-escalation-packets.ts`
- Modify: `package.json` (`demo:triage-slice-2`)

**Interfaces:**
- Consumes: `run` (`surface.ts`), `create`, `readRef` (`case-file.ts`), `createAgentPort` (`agent-invoke.ts`), `createAgentTriage` (`triage.ts`), `deterministicRouter` (`router.ts`), `triageRoleConfig`, `EscalationPacket` (`triage-role-config.ts`), the worker and gate-maintenance configs, `initTempRepo`, `isOnPath`, `noopCloser`.
- Produces: printed sections headed exactly `1. The triage agent escalates`, `2. The worker hits an authority limit`, `3. The correction budget runs out`, `4. Triage replies with something unusable`, `5. A failed close answered with "retry the worker"`, `6. What this shows`. Each packet prints the labels `Decision:`, `Evidence:`, `Already tried:`, `Why now:`, `Sessions to consult:`. The UAT phase asserts on these, so keep them exact.

- [ ] **Step 1: Write the demo**

Create `demos/triage-slice-2-escalation-packets.ts`:

```ts
/**
 * UAT demo for Triage and Deterministic Router Slice 2: Every Escalation Hands
 * a Human a Decision, Not Internal State.
 *
 * Drives five surfaces to escalation and prints the packet each one stores:
 * the triage agent escalates; the worker hits an authority limit; the
 * correction budget runs out; the triage agent replies with something
 * unusable; and a failed close that the triage agent wrongly answers with
 * "retry the worker".
 *
 * Requires `claude-mock` on PATH. It is a sibling project, not vendored in this
 * repo: install it with `npm link` from its own checkout. No live API call is
 * made, and no API key is needed. `claude-mock` does not enforce a role's tool
 * list, so this demo shows nothing about triage's read-only authority.
 *
 * Usage: npm run demo:triage-slice-2
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run } from "../src/surface.js";
import { create, readRef } from "../src/case-file.js";
import { createAgentPort } from "../src/agent-invoke.js";
import { createAgentTriage } from "../src/triage.js";
import { deterministicRouter } from "../src/router.js";
import { triageRoleConfig, EscalationPacket } from "../src/triage-role-config.js";
import { workerRoleConfig, gateMaintenanceRoleConfig } from "../src/role-config.js";
import { initTempRepo } from "../src/temp-repo.js";
import { isOnPath } from "../src/on-path.js";
import { noopCloser } from "../src/ports.js";
import type { AgentPort, CloserPort, SurfacePorts, TriagePort } from "../src/ports.js";
import type { BudgetSet, GateRef } from "../src/schema.js";

const budgets: BudgetSet = {
  correction: { used: 0, max: 3 },
  gateError: { used: 0, max: 3 },
  gateMaintenance: { used: 0, max: 2 },
  terminus: { used: 0, max: 5 },
  close: { used: 0, max: 3 },
};
const gateRef: GateRef = { type: "command", command: "cat report.tap", parseMode: "tap" };
const PASSING_TAP = "1..2\nok 1 - alpha\nok 2 - beta\n";
const FAILING_TAP = "1..2\nok 1 - alpha\nnot ok 2 - beta\n";
const configs = { worker: workerRoleConfig, "gate-maintenance": gateMaintenanceRoleConfig, triage: triageRoleConfig };

const STUCK = {
  status: "escalate",
  category: "exhaustion",
  rationale: "The greeting comes from a translations service I cannot find in this repository.",
};

const agentPacket = {
  decision: "The greeting is served by a translations service this task cannot change. Decide whether to grant access to it or narrow the task to the template.",
  evidence: "Worker attempt 1: \"The greeting comes from a translations service I cannot find in this repository.\"",
  dead_ends: "Attempt 1 searched the route handlers and templates; the string is in neither.",
  why_now: "A worker escalation with 3 correction slots left, but a retry would repeat the same search.",
  references: ["worker-1-0"],
};

const brief = {
  problem: "The merge failed, so the change never landed.",
  dead_ends: "No earlier attempt was made; the change passed the gate first time.",
  scope: "Re-run the worker on the same task.",
  references: ["worker-1-0"],
  diagnosis: "The change may conflict with the target branch.",
};

/** A closer that refuses to accept the work, and tears down cleanly. */
const refusingCloser: CloserPort = {
  close: (_ctx, outcome) =>
    Promise.resolve(
      outcome.kind === "accepted"
        ? { status: "FAIL", detail: "The merge was refused: the target branch moved while the change was being checked." }
        : { status: "DONE", detail: "torn down" },
    ),
};

function requireMock(): void {
  if (isOnPath("claude-mock")) return;
  console.error(
    "claude-mock is not on PATH.\n\n" +
      "It is a scripted fake `claude` binary from a sibling project, deliberately not\n" +
      "vendored into this repo. Install it with `npm link` from its own checkout, then\n" +
      "run this demo again. Nothing here calls a live API.",
  );
  process.exit(1);
}

function mockSession(scratch: string, script: unknown[]) {
  const scriptPath = path.join(scratch, "mock.json");
  fs.writeFileSync(scriptPath, JSON.stringify(script), "utf-8");
  return {
    pathToClaudeCodeExecutable: "claude-mock",
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: scriptPath, CLAUDE_MOCK_JOURNAL: path.join(scratch, "journal.jsonl") },
  };
}

interface Scenario {
  script: unknown[];
  budgets?: Partial<BudgetSet>;
  /** Defaults to the agent-backed triage port. */
  triage?: (agent: AgentPort) => TriagePort;
  closer?: CloserPort;
}

interface Escalated {
  state: string;
  packetRef: string;
  triageCalls: number;
  packet: EscalationPacket | undefined;
}

/** Run one surface to its end; return the packet its outcome points at, and how often triage was asked. */
async function escalateOne(name: string, scenario: Scenario): Promise<Escalated> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `triage-demo-${name}-`));
  const dir = fs.mkdtempSync(path.join(scratch, `${name}-case-`));
  await create(dir, { surfaceId: name, taskDef: { intent: "make the greeting say hello" }, gateRef }, { ...budgets, ...scenario.budgets });
  const repoPath = initTempRepo(`triage-demo-${name}-repo-`, { "report.tap": PASSING_TAP });
  const location = { repoPath, worktreePath: fs.mkdtempSync(path.join(scratch, `${name}-tree-`)) };

  const inner = createAgentPort(configs, mockSession(scratch, scenario.script));
  let triageCalls = 0;
  const agent: AgentPort = {
    invoke: ((roleCfg, ctx) => {
      if (roleCfg.role === "triage") triageCalls += 1;
      return inner.invoke(roleCfg, ctx);
    }) as AgentPort["invoke"],
  };
  const ports: SurfacePorts = {
    agent,
    triage: (scenario.triage ?? createAgentTriage)(agent),
    closer: scenario.closer ?? noopCloser,
  };

  const result = await run(dir, location, ports);
  const packetRef = result.outcome?.packetRef ?? "";
  const parsed = packetRef ? EscalationPacket.safeParse(await readRef(dir, packetRef)) : undefined;
  return { state: result.state, packetRef, triageCalls, packet: parsed?.success ? parsed.data : undefined };
}

const indent = (text: string, by: number) => text.split("\n").map((l) => `${" ".repeat(by)}${l}`).join("\n");

function printPacket(heading: string, r: Escalated): void {
  console.log(heading);
  console.log(`   Surface finished: ${r.state}; triage agent calls: ${r.triageCalls}; packet stored at: ${r.packetRef || "none"}`);
  if (!r.packet) {
    console.log("   NO ESCALATION PACKET WAS STORED\n");
    return;
  }
  const field = (label: string, text: string) => console.log(`   ${label}\n${indent(text, 6)}`);
  field("Decision:", r.packet.decision);
  field("Evidence:", r.packet.evidence);
  field("Already tried:", r.packet.dead_ends);
  field("Why now:", r.packet.why_now);
  field("Sessions to consult:", r.packet.references.join(", ") || "none");
  console.log("");
}

async function main(): Promise<void> {
  requireMock();

  // Each session re-reads the whole script, so expectations are routed by prompt
  // content: only triage's prompt has a Setback slot, so it is matched first.
  printPacket("1. The triage agent escalates", await escalateOne("triage-escalates", {
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "escalate", rationale: "A retry would repeat the same search; a person must decide.", payload: agentPacket } },
      { json: STUCK },
    ],
  }));

  printPacket("2. The worker hits an authority limit", await escalateOne("authority", {
    script: [
      { json: { status: "escalate", category: "authority", rationale: "Changing the greeting needs the translations service's deploy key, which I do not hold." } },
    ],
  }));

  // The lookup-table router alone decides this one: a packet does not depend on
  // which triage port a harness is wired with.
  printPacket("3. The correction budget runs out", await escalateOne("budget", {
    budgets: { correction: { used: 0, max: 1 } },
    triage: () => deterministicRouter,
    script: [
      { effects: [{ write: { path: "report.tap", content: FAILING_TAP } }], json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  }));

  printPacket("4. Triage replies with something unusable", await escalateOne("unusable-triage", {
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "completed", rationale: "Looks fine to me." } },
      { json: STUCK },
    ],
  }));

  printPacket("5. A failed close answered with \"retry the worker\"", await escalateOne("failed-close", {
    budgets: { close: { used: 0, max: 1 } },
    closer: refusingCloser,
    script: [
      { when: { promptContains: "## Setback" }, json: { status: "reroute", rationale: "Retry the worker.", payload: brief } },
      { json: { status: "completed", rationale: "Changed the greeting." } },
    ],
  }));

  console.log("6. What this shows");
  console.log(
    "   Every escalation, whatever caused it, stored a packet that opens with a decision for\n" +
      "   a person, then the verbatim evidence, what was already tried, why it escalated now,\n" +
      "   and the sessions to consult. The triage agent wrote the first; the harness built the\n" +
      "   other four from the case file, without asking any agent to write them. The budget\n" +
      "   case says no budget remains. The failed close was not retried as a worker, because\n" +
      "   \"retry the worker\" is not allowed after a close failure.\n" +
      "   Note: claude-mock does not enforce a role's tool list; triage's read-only authority\n" +
      "   is proven by unit tests and, live, by the real agent runtime.",
  );
}

await main();
```

- [ ] **Step 2: Wire the script**

`package.json` scripts, directly after `demo:triage-slice-1`:

```json
"demo:triage-slice-2": "npx tsx demos/triage-slice-2-escalation-packets.ts",
```

- [ ] **Step 3: Run the demo and read its output**

Run: `npm run demo:triage-slice-2`
Expected (with `claude-mock` on `PATH`): exit 0 and five packets, each line `Surface finished: ESCALATED; …; packet stored at: escalation`, and each with all five labels.
- Section 1: `triage agent calls: 1`; the decision is the agent's own ("… Decide whether to grant access to it or narrow the task to the template.").
- Section 2: `triage agent calls: 0`; the decision contains `lacked authority`, and the evidence is the worker's deploy-key sentence.
- Section 3: `triage agent calls: 0`; the decision contains `No correction budget remains (1/1 used).`, and the evidence names the failing `beta` assertion.
- Section 4: `triage agent calls: 1`; the decision is `Triage could not reach a verdict. Decide how to proceed from the evidence below.`, and why now contains `triage did not produce a usable verdict`.
- Section 5: `triage agent calls: 1`; why now contains `triage answered reroute, which is not allowed after a close failure (allowed: retry_close, escalate, abort)`, and the evidence is the merge-refused sentence.
- No section prints `NO ESCALATION PACKET WAS STORED`.

Without `claude-mock`: exit 1 and the "claude-mock is not on PATH" message.

If section 4's mock reply is rejected by `claude-mock` itself rather than by the envelope schema (so the session ends in an error), the decision is the same; only the quoted reason in why now differs. Do not change the printed labels to fit it.

Run: `npx eslint demos/triage-slice-2-escalation-packets.ts`
Expected: no errors (the default-project file count stays under the ceiling of 60).

- [ ] **Step 4: Commit**

```bash
git add demos/triage-slice-2-escalation-packets.ts package.json
git commit -m "Add a runnable demo of escalation packets across five causes

A reviewer needs to see, without reading code, that whichever way a
surface escalates, the person handed it gets a decision, the evidence,
what was tried and why now. The demo drives an agent escalation, an
authority limit, a spent correction budget, unusable triage output and a
failed close wrongly answered with a worker retry, against claude-mock,
and prints the packet each one stored.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
