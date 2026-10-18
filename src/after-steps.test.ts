import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../tests/helpers.js";
import { initTempRepo } from "./temp-repo.js";
import { readAfter, recordAfter, type PlannedStep } from "./after-ledger.js";
import { dropPending, runBatch, supersedeOlder, type AfterDeps } from "./after-steps.js";

async function batchOf(steps: PlannedStep[], followUps: { run: string; source: string; file: string; text: string }[] = []) {
  const repo = initTempRepo("after-steps-", { "package.json": "{}" });
  const ledger = join(mkdtempSync(join(tmpdir(), "after-steps-ledger-")), "after.jsonl");
  const commit = git(repo, ["rev-parse", "HEAD"]);
  await recordAfter(ledger, { t: "batch", batch: "b1", branch: "delivery/main", base: "main", commit, landed: [], followUps, steps });
  const notes: string[] = [];
  const raisedCalls: string[] = [];
  const deps: AfterDeps = {
    repoPath: repo, env: process.env, ledger,
    resolve: (planned) => planned.step,
    raise: async (_source, item) => { raisedCalls.push(item.file); return { id: `#${raisedCalls.length}` }; },
    agentPass: async () => ({ ok: true, items: [], discarded: [] }),
    landFollowUps: async () => undefined,
    note: (line) => notes.push(line),
  };
  const state = async () => (await readAfter(ledger))[0]!;
  return { repo, ledger, commit, deps, notes, raisedCalls, state };
}

describe("running a batch of after steps", () => {
  it("runs commands in order, each confirmed by its check, with the landed commit in their environment", async () => {
    // Written inside the repo (in: base) or to a private temp folder: never `../`, which is the shared system tmpdir.
    const out = mkdtempSync(join(tmpdir(), "after-steps-out-"));
    const { repo, commit, deps, state } = await batchOf([
      { for: "project", label: "deploy", step: { run: 'echo "$DELIVERY_COMMIT $DELIVERY_BRANCH" > deployed', in: "base", check: "test -f deployed" } },
      { for: "project", label: "copy", step: { run: `git rev-parse HEAD > "${out}/copy-head"` } },
    ]);
    expect(await runBatch(await state(), deps)).toBe(true);
    expect(readFileSync(join(repo, "deployed"), "utf-8").trim()).toBe(`${commit} delivery/main`);
    expect(readFileSync(join(out, "copy-head"), "utf-8").trim()).toBe(commit);
    expect((await state()).steps.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("stops at a failing check, leaves the rest pending, and starts again from it", async () => {
    const { repo, deps, notes, state } = await batchOf([
      { for: "project", label: "deploy", step: { run: "true", in: "base", check: "test -f healthy" } },
      { for: "project", label: "announce", step: { run: "touch announced", in: "base" } },
    ]);
    expect(await runBatch(await state(), deps)).toBe(false);
    expect((await state()).steps.map((s) => s.status)).toEqual(["failed", "pending"]);
    expect(existsSync(join(repo, "announced"))).toBe(false);
    expect(notes.join("\n")).toContain("After landing, deploy did not work: its check `test -f healthy` exited with code 1");

    writeFileSync(join(repo, "healthy"), "");
    expect(await runBatch(await state(), deps)).toBe(true);
    expect(existsSync(join(repo, "announced"))).toBe(true);
  });

  it("raises each held follow-up once, even when raising is retried after a failure", async () => {
    const followUps = [{ run: "r1", source: "tracker", file: "a.md", text: "a" }, { run: "r1", source: "tracker", file: "b.md", text: "b" }];
    const { deps, raisedCalls, state } = await batchOf([{ for: "follow-ups", label: "Raise follow-ups", step: { raise: true } }], followUps);
    let failB = true;
    const raise = deps.raise;
    deps.raise = async (source, item) => (item.file === "b.md" && failB ? { error: "tracker down" } : raise(source, item));

    expect(await runBatch(await state(), deps)).toBe(false);
    failB = false;
    expect(await runBatch(await state(), deps)).toBe(true);
    expect(raisedCalls).toEqual(["a.md", "b.md"]);
    expect([...(await state()).raised]).toEqual([["a.md", "#1"], ["b.md", "#2"]]);
  });

  it("runs an agent pass once, raising or landing what it left, and does not run it again on a retry", async () => {
    const { deps, raisedCalls, state } = await batchOf([
      { for: "project", label: "notes", step: { prompt: "Write release notes.", check: "false" }, raiseVia: "tracker" },
    ]);
    let passes = 0;
    deps.agentPass = async () => { passes += 1; return { ok: true, items: [{ file: "c.md", text: "c" }], discarded: ["README.md"] }; };

    expect(await runBatch(await state(), deps)).toBe(false); // its check fails
    expect(await runBatch(await state(), deps)).toBe(false);
    expect(passes).toBe(1);
    expect(raisedCalls).toEqual(["c.md"]);
    expect((await state()).held.get(0)).toEqual({ items: [{ file: "c.md", text: "c" }], discarded: ["README.md"] });
  });

  it("runs a step as the config defines it now, and skips one the config no longer has", async () => {
    const { repo, deps, notes, state } = await batchOf([
      { for: "project", label: "deploy", step: { run: "false", in: "base" } },
      { for: "project", label: "old", step: { run: "touch old", in: "base" } },
    ]);
    deps.resolve = (_planned, index) => (index === 0 ? { run: "touch deployed", in: "base" } : undefined);
    expect(await runBatch(await state(), deps)).toBe(true);
    expect(existsSync(join(repo, "deployed"))).toBe(true);
    expect(existsSync(join(repo, "old"))).toBe(false);
    expect((await state()).steps.map((s) => s.status)).toEqual(["done", "skipped"]);
    expect(notes.join("\n")).toContain("After landing, old was skipped: it is no longer in your config file.");
  });

  it("lets a newer batch supersede an older batch's command step from the same list, but not its raise or an agent step that left items", async () => {
    const followUps = [{ run: "r1", source: "tracker", file: "a.md", text: "a" }];
    const { repo, ledger, commit, deps, raisedCalls, state } = await batchOf([
      { for: "follow-ups", label: "Raise follow-ups", step: { raise: true } },
      { for: "project", label: "deploy", step: { run: "touch deployed-1", in: "base" } },
      { for: "project", label: "notes", step: { prompt: "notes" } },
      { for: "other", label: "other list", step: { run: "touch other", in: "base" } },
    ], followUps);
    await recordAfter(ledger, { t: "held", batch: "b1", index: 2, items: [{ file: "n.md", text: "n" }], discarded: [] });
    await recordAfter(ledger, { t: "batch", batch: "b2", branch: "delivery/main", base: "main", commit, landed: [], followUps: [], steps: [{ for: "project", label: "deploy", step: { run: "touch deployed-2", in: "base" } }] });
    const states = await readAfter(ledger);

    expect(await supersedeOlder(ledger, states, states[1]!.batch)).toBe(1);

    const [older] = await readAfter(ledger);
    expect(older?.steps.map((s) => s.status)).toEqual(["pending", "skipped", "pending", "pending"]);
    expect(older?.steps[1]?.detail).toBe("superseded by b2, which runs the same steps on a later commit");
    expect(await runBatch(older!, deps)).toBe(true);
    expect(raisedCalls).toEqual(["a.md"]);
    expect(existsSync(join(repo, "deployed-1"))).toBe(false);
    expect(existsSync(join(repo, "other"))).toBe(true);
    expect((await state()).steps.map((s) => s.status)).toEqual(["done", "skipped", "done", "done"]);
  });

  it("drops every unfinished step of the named batch, or of all, and reports whether a raise step was among them", async () => {
    const { ledger } = await batchOf([
      { for: "follow-ups", label: "Raise follow-ups", step: { raise: true } },
      { for: "project", label: "deploy", step: { run: "true" } },
    ]);
    await recordAfter(ledger, { t: "step", batch: "b1", index: 1, status: "done", detail: "" });
    expect(await dropPending(ledger, await readAfter(ledger), "nope")).toEqual([]);
    expect(await dropPending(ledger, await readAfter(ledger), "b1")).toEqual([{ batch: "b1", label: "Raise follow-ups", raise: true }]);
    const [state] = await readAfter(ledger);
    expect(state?.steps.map((s) => s.status)).toEqual(["skipped", "done"]);
    expect(state?.steps[0]?.detail).toBe("dropped with `delivery drop-after`");
    expect(await dropPending(ledger, await readAfter(ledger))).toEqual([]);
  });

  it("lands an agent pass's follow-ups when its project's backlog is a folder, and fails the step when the pass did not work", async () => {
    const { deps, notes, state } = await batchOf([{ for: "project", label: "triage", step: { prompt: "Look for follow-ups." } }]);
    const landed: string[] = [];
    deps.landFollowUps = async (items) => { landed.push(...items.map((i) => i.file)); };
    deps.agentPass = async () => ({ ok: false, detail: "the agent escalated: nothing to do" });
    expect(await runBatch(await state(), deps)).toBe(false);
    expect(notes.join("\n")).toContain("the agent escalated: nothing to do");

    deps.agentPass = async () => ({ ok: true, items: [{ file: "d.md", text: "d" }], discarded: [] });
    expect(await runBatch(await state(), deps)).toBe(true);
    expect(landed).toEqual(["d.md"]);
  });
});
