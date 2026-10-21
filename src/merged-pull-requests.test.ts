import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createGhStandIn } from "./gh-stand-in.js";
import { mergedPullRequestTips } from "./merged-pull-requests.js";

const create = (command: string, head: string): string =>
  execFileSync(command, ["pr", "create", "--base=main", `--head=${head}`, "--title=T", "--body=B"], { encoding: "utf-8" }).trim();

describe("mergedPullRequestTips", () => {
  it("is empty when no pull request for the branch has merged, open ones included", async () => {
    const gh = createGhStandIn();
    create(gh.command, "delivery/main");
    expect(await mergedPullRequestTips(tmpdir(), "delivery/main", { command: gh.command })).toEqual(new Set());
  });

  it("holds the head commit of each merged pull request for the branch, and no other branch's", async () => {
    const gh = createGhStandIn();
    gh.mergePullRequest(create(gh.command, "delivery/main"), "aaa");
    gh.mergePullRequest(create(gh.command, "delivery/main"), "bbb");
    gh.mergePullRequest(create(gh.command, "delivery/other"), "ccc");
    expect(await mergedPullRequestTips(tmpdir(), "delivery/main", { command: gh.command })).toEqual(new Set(["aaa", "bbb"]));
  });

  it("throws when gh cannot answer, so the caller can say so", async () => {
    const gh = createGhStandIn();
    gh.setMode("offline");
    await expect(mergedPullRequestTips(tmpdir(), "delivery/main", { command: gh.command })).rejects.toBeDefined();
  });
});
