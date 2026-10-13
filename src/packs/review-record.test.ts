import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DamagedReview } from "../errors.js";
import { initTempRepo } from "../temp-repo.js";
import { listReviews, loadReview, newestFirst, packsRoot, readReply, reviewOfPlan, PLAN_FILE, saveResult, startReview, uncheckable, type ReviewHeader } from "./review-record.js";
import { sampleFinding, writeReview } from "./review-fixtures.js";

const repo = () => initTempRepo("review-record-", { "a.js": "x\n" });

describe("the review record", () => {
  it("is empty in a project with no review", async () => {
    expect(await listReviews(repo())).toEqual([]);
  });

  it("reads back a finished review exactly as it was saved", async () => {
    const project = repo();
    const finding = sampleFinding();
    await writeReview(project, { reviewId: "code-20261005T101500Z", findings: [finding] });
    const [entry] = await listReviews(project);
    expect(entry).toMatchObject({ state: "done", header: { reviewId: "code-20261005T101500Z", pack: { name: "code" } } });
    if (entry?.state !== "done") throw new Error("expected a finished review");
    expect((await loadReview(entry)).result.findings).toEqual([finding]);
  });

  it("tells a review whose list was not yet saved from a finished one", async () => {
    const project = repo();
    await writeReview(project, { reviewId: "code-20261005T101500Z", finished: false });
    expect((await listReviews(project))[0]?.state).toBe("unfinished");
  });

  it("lists the newest first, across packs, and ignores a folder that never became a review", async () => {
    const project = repo();
    await writeReview(project, { reviewId: "code-20261005T101500Z" });
    await writeReview(project, { reviewId: "security-20261005T111500Z" });
    await writeReview(project, { reviewId: "code-2-20261004T101500Z" });
    mkdirSync(join(packsRoot(project), "code-20261006T000000Z"), { recursive: true });
    mkdirSync(join(packsRoot(project), "scan-errors"), { recursive: true });
    expect((await listReviews(project)).map((entry) => entry.dir.split("/").at(-1))).toEqual(["security-20261005T111500Z", "code-20261005T101500Z", "code-2-20261004T101500Z"]);
  });

  it("is readable only by the owner where it holds the agent's words", async () => {
    const project = repo();
    const dir = await writeReview(project, { reviewId: "code-20261005T101500Z" });
    for (const file of ["review.json", "refs/reply.json", "refs/scan.json"]) expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600);
  });

  it.each(["review.json", "refs/reply.json"])("names a damaged %s rather than reading it", async (file) => {
    const project = repo();
    const dir = await writeReview(project, { reviewId: "code-20261005T101500Z", finished: false });
    writeFileSync(join(dir, file), "{ not json");
    expect(await listReviews(project)).toEqual([{ dir, state: "damaged", file: join(dir, file) }]);
  });

  it("names a damaged list when it is loaded", async () => {
    const project = repo();
    const dir = await writeReview(project, { reviewId: "code-20261005T101500Z" });
    writeFileSync(join(dir, "refs", "scan.json"), "[]");
    const [entry] = await listReviews(project);
    if (entry?.state !== "done") throw new Error("expected a finished review");
    await expect(loadReview(entry)).rejects.toEqual(new DamagedReview(join(dir, "refs", "scan.json")));
  });

  it("reads the agent's reply back against the pack's own categories", async () => {
    const project = repo();
    const dir = await writeReview(project, { reviewId: "code-20261005T101500Z", finished: false });
    const [entry] = await listReviews(project);
    if (entry?.state !== "unfinished") throw new Error("expected an unfinished review");
    expect((await readReply(dir, entry.header)).envelope).toEqual({ findings: [], notes: "" });
  });
});

describe("the review a plan belongs to", () => {
  it("is the finished review whose folder the plan sits in", async () => {
    const repo_ = initTempRepo("plan-review-", { "a.js": "x\n" });
    const dir = await writeReview(repo_, { findings: [] });

    expect((await reviewOfPlan(repo_, join(dir, PLAN_FILE)))?.dir).toBe(dir);
  });

  it("is none for the project's own configuration, and for a review that was never finished", async () => {
    const repo_ = initTempRepo("plan-review-", { "a.js": "x\n" });
    const unfinished = await writeReview(repo_, { finished: false });

    expect(await reviewOfPlan(repo_, join(repo_, "delivery.config.json"))).toBeUndefined();
    expect(await reviewOfPlan(repo_, join(unfinished, PLAN_FILE))).toBeUndefined();
  });
});

describe("whether a problem can be checked", () => {
  const pack = { name: "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 40, categories: [{ id: "correctness", title: "Wrong results" }] };
  const none = sampleFinding({ check: { kind: "none" } });
  const specific = sampleFinding();

  it.each([
    ["a problem with no check, in a project with no tests", { pack, noTests: true as const }, none, true],
    ["a problem with no check, from a pack that requires one", { pack: { ...pack, requireCheck: true as const } }, none, true],
    ["a problem with no check, in a project with tests and a pack that does not require one", { pack }, none, false],
    ["a problem with a specific check, in a project with no tests", { pack, noTests: true as const }, specific, false],
  ])("%s: %s", (_, header, finding, expected) => {
    expect(uncheckable(header, finding)).toBe(expected);
  });
});

describe("the order of reviews", () => {
  it("puts the newest first, and of reviews made in the same second, the later one first", () => {
    expect(newestFirst(["code-20261009T100000Z", "code-2-20261009T100000Z", "code-20261008T090000Z", "code-10-20261009T100000Z"])).toEqual([
      "code-10-20261009T100000Z",
      "code-2-20261009T100000Z",
      "code-20261009T100000Z",
      "code-20261008T090000Z",
    ]);
  });
});

describe("what the review session cost", () => {
  it("reads back what the review session cost, and nothing when its record does not say", async () => {
    const repo = mkdtempSync(join(tmpdir(), "usage-"));
    const HEADER: ReviewHeader = {
      reviewId: "code-20261005T101500Z",
      pack: { name: "code", version: "1.0.0", title: "Code review", hash: "0".repeat(64), maxFindings: 40, categories: [{ id: "correctness", title: "Wrong results" }] },
      repoPath: repo,
      commit: "1".repeat(40),
      fileCount: 4,
      startedAt: "2026-10-05T10:15:00.000Z",
      endedAt: "2026-10-05T10:19:12.000Z",
    };
    const dir = await startReview(repo, HEADER, { envelope: { findings: [], notes: "" }, usage: { costUsd: 0.31, durationMs: 252_000 } });
    await saveResult(dir, { findings: [], unconfirmed: [], notShown: 0, notes: "" });
    const [entry] = await listReviews(repo);
    if (entry?.state !== "done") throw new Error("not done");
    expect((await loadReview(entry)).usage).toEqual({ costUsd: 0.31, durationMs: 252_000 });
    writeFileSync(join(dir, "refs", "reply.json"), "not json");
    expect((await loadReview(entry)).usage).toBeUndefined();
  });
});
