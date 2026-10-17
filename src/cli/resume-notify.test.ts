import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { delivery, interruptedRun, PACKAGE, TASK, writesHello } from "./command-fixtures.js";
import { EXIT } from "./failures.js";

const CONFIG = "delivery.config.json";

// The resumed session stands in for an agent that rewrites the project's config while it works.
vi.mock("./drive.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./drive.js")>()),
  resumeRun: async (record: { repoPath: string }) => {
    writeFileSync(join(record.repoPath, CONFIG), JSON.stringify({ notify: "cat > after.json" }));
    return 0;
  },
}));

describe("delivery resume notify", () => {
  it("runs the notify command the project had before the session, not one the session wrote", async () => {
    const repo = initTempRepo("resume-notify-", { "package.json": PACKAGE, [CONFIG]: JSON.stringify({ notify: "cat > before.json" }) });
    const state = mkdtempSync(join(tmpdir(), "resume-state-"));
    await interruptedRun(repo, state, { task: TASK, steps: 3, worker: writesHello });

    const { exitCode } = await delivery(["resume"], { cwd: repo, env: { XDG_STATE_HOME: state } });

    expect(exitCode).toBe(EXIT.ok);
    expect(existsSync(join(repo, "after.json"))).toBe(false);
    expect(existsSync(join(repo, "before.json"))).toBe(true);
  });
});
