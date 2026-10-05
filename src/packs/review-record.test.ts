import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DamagedReview } from "../errors.js";
import { initTempRepo } from "../temp-repo.js";
import { listReviews, loadReview, packsRoot, readReply } from "./review-record.js";
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
