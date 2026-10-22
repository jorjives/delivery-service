import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { git } from "../../tests/helpers.js";
import { recordDelivery } from "../delivery-ledger.js";
import { createGhStandIn, type GhStandIn } from "../gh-stand-in.js";
import { initTempRepo } from "../temp-repo.js";
import { EXIT, Refusal } from "./failures.js";
import { checkStackSetup, stackGitRefusal } from "./stack-setup.js";

const BRANCH = "delivery/main";

describe("stackGitRefusal", () => {
  it.each([
    ["git version 2.37.9", "2.37.9"],
    ["git version 1.9.0", "1.9.0"],
  ])("refuses git %s, naming the version", (versionOutput, found) => {
    expect(stackGitRefusal(versionOutput)).toContain(`git ${found}`);
  });

  it.each(["git version 2.38.0", "git version 2.43.0.windows.1", "git version 3.0.0"])("accepts %s", (versionOutput) => {
    expect(stackGitRefusal(versionOutput)).toBeUndefined();
  });
});

describe("checkStackSetup", () => {
  let repo: string;
  let ledger: string;
  let gh: GhStandIn;

  /** Record a section of the delivery branch: stacked or rolling, opened at the seed commit. */
  async function openSection(stack: boolean): Promise<void> {
    await recordDelivery(ledger, { t: "opened", branch: BRANCH, base: "main", from: git(repo, ["rev-parse", "HEAD"]), ...(stack ? { stack: true as const } : {}) });
  }

  /** Create the delivery branch at the seed commit and open a pull request for it on the stand-in, returning its url. */
  function openPullRequest(): string {
    git(repo, ["branch", BRANCH]);
    return execFileSync(gh.command, ["pr", "create", "--base=main", `--head=${BRANCH}`, "--title=T", "--body=B"], { cwd: repo, encoding: "utf-8" }).trim();
  }

  beforeEach(() => {
    repo = initTempRepo("stack-setup-", { "seed.txt": "hello\n" });
    ledger = join(mkdtempSync(join(tmpdir(), "stack-setup-ledger-")), "delivery.jsonl");
    gh = createGhStandIn();
    vi.stubEnv("PATH", `${gh.binDir}:${process.env.PATH ?? ""}`);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses, naming it, when a rolling pull request for the delivery branch is open", async () => {
    await openSection(false);
    const url = openPullRequest();

    const err = await checkStackSetup(repo, ledger, BRANCH).catch((caught: unknown) => caught);

    expect(err).toBeInstanceOf(Refusal);
    expect(err).toMatchObject({ exitCode: EXIT.configuration, message: expect.stringContaining(url) });
  });

  it("refuses when rolling landings still wait for the closer", async () => {
    await openSection(false);
    git(repo, ["branch", BRANCH]);
    await recordDelivery(ledger, {
      t: "landed",
      branch: BRANCH,
      runId: "r1",
      key: "backlog:first",
      intent: "Add first",
      commit: git(repo, ["rev-parse", "HEAD"]),
    });

    const err = await checkStackSetup(repo, ledger, BRANCH).catch((caught: unknown) => caught);

    expect(err).toBeInstanceOf(Refusal);
    expect(err).toMatchObject({ exitCode: EXIT.configuration, message: expect.stringContaining("backlog:first") });
  });

  it("lets stack mode start when the rolling pull request has merged or there is no delivery branch", async () => {
    await openSection(false);
    expect(await checkStackSetup(repo, ledger, BRANCH)).toBeUndefined();

    const url = openPullRequest();
    gh.mergePullRequest(url, git(repo, ["rev-parse", "HEAD"]));

    expect(await checkStackSetup(repo, ledger, BRANCH)).toBeUndefined();
  });

  it("asks GitHub nothing once the section is stacked", async () => {
    await openSection(true);
    git(repo, ["branch", BRANCH]);
    gh.setMode("offline");

    expect(await checkStackSetup(repo, ledger, BRANCH)).toBeUndefined();
    expect(gh.calls()).toEqual([]);
  });

  it("returns a reason, starting nothing, when GitHub cannot be asked", async () => {
    await openSection(false);
    git(repo, ["branch", BRANCH]);
    gh.setMode("offline");

    expect(await checkStackSetup(repo, ledger, BRANCH)).toBe(
      `Could not ask GitHub whether ${BRANCH} has an open pull request (error connecting to api.github.com), so stack mode cannot safely start. Run again once gh can reach GitHub.`,
    );
    expect(gh.pullRequests()).toEqual([]);
  });
});
