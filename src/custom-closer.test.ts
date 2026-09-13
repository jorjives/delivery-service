import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCustomCloser, loadCustomCloser } from "./custom-closer.js";
import { CloserModuleLoadFailure, InvalidCloserExport } from "./errors.js";
import type { CloseContext } from "./ports.js";

// Each test writes a real .mjs module to a fresh temp dir and loads it by
// path, exactly how a project's closer module reaches the harness.
function writeCloserModule(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-closer-test-"));
  const file = path.join(dir, "closer.mjs");
  fs.writeFileSync(file, source);
  return file;
}

// Absolute module paths ignore the repo root, so these tests pass one that is
// deliberately not the directory the closer module lives in.
const REPO_ROOT = "/tmp/not-the-closer-directory";

const ctx: CloseContext = {
  worktreePath: "/tmp/custom-closer-tree",
  dir: "/tmp/custom-closer-case",
  repoPath: REPO_ROOT,
  branch: "surface/surface-9",
  baseBranch: "main",
};
const accepted = { kind: "accepted" } as const;

const WORKING_CLOSER = `
export default {
  async close(ctx, outcome) {
    return { status: "DONE", detail: "closed " + ctx.branch + " onto " + ctx.baseBranch + " as " + outcome.kind };
  },
};
`;

describe("custom closer loading", () => {
  it("requires a repo root: omitting it must not type-check", () => {
    // @ts-expect-error both take a required repoPath, so a relative modulePath
    // can never silently resolve against process.cwd().
    const loadWithoutRepoRoot: (modulePath: string) => unknown = loadCustomCloser;
    // @ts-expect-error see above.
    const createWithoutRepoRoot: (modulePath: string) => unknown = createCustomCloser;

    expect(loadWithoutRepoRoot).toBe(loadCustomCloser);
    expect(createWithoutRepoRoot).toBe(createCustomCloser);
  });
});

describe("loadCustomCloser", () => {
  it("loads a default export and hands it the context and outcome", async () => {
    const closer = await loadCustomCloser(REPO_ROOT, writeCloserModule(WORKING_CLOSER));

    expect(await closer.close(ctx, { kind: "escalated" })).toEqual({
      status: "DONE",
      detail: "closed surface/surface-9 onto main as escalated",
    });
  });

  it("loads a named export other than the default", async () => {
    const modulePath = writeCloserModule(`
      export const notify = { close: async () => ({ status: "DONE", detail: "from notify" }) };
      export default { close: async () => ({ status: "DONE", detail: "from default" }) };
    `);

    const closer = await loadCustomCloser(REPO_ROOT, modulePath, "notify");

    expect((await closer.close(ctx, accepted)).detail).toBe("from notify");
  });

  it("resolves a relative module path against the supplied repo root", async () => {
    const modulePath = writeCloserModule(WORKING_CLOSER);

    const closer = await loadCustomCloser(path.dirname(modulePath), "./closer.mjs");

    expect((await closer.close(ctx, accepted)).status).toBe("DONE");
  });

  it("throws CloserModuleLoadFailure naming the module when it cannot be imported", async () => {
    const missing = path.join(os.tmpdir(), "no-such-closer-module-xyz.mjs");

    await expect(loadCustomCloser(REPO_ROOT, missing)).rejects.toThrow(CloserModuleLoadFailure);
    await expect(loadCustomCloser(REPO_ROOT, missing)).rejects.toThrow(missing);
  });

  it("throws InvalidCloserExport naming the module and the missing close method", async () => {
    const modulePath = writeCloserModule(`export default { shut: async () => ({ status: "DONE", detail: "" }) };`);

    await expect(loadCustomCloser(REPO_ROOT, modulePath)).rejects.toThrow(InvalidCloserExport);
    await expect(loadCustomCloser(REPO_ROOT, modulePath)).rejects.toThrow(/missing "close" method/);
    await expect(loadCustomCloser(REPO_ROOT, modulePath)).rejects.toThrow(modulePath);
  });

  it("throws InvalidCloserExport when the named export is absent", async () => {
    const modulePath = writeCloserModule(WORKING_CLOSER);

    await expect(loadCustomCloser(REPO_ROOT, modulePath, "notThere")).rejects.toThrow(InvalidCloserExport);
    await expect(loadCustomCloser(REPO_ROOT, modulePath, "notThere")).rejects.toThrow(/notThere/);
  });

  it("turns a synchronous throw into an ERROR report naming the module and the message", async () => {
    const modulePath = writeCloserModule(`export default { close() { throw new Error("mail server down"); } };`);

    const report = await (await loadCustomCloser(REPO_ROOT, modulePath)).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain(modulePath);
    expect(report.detail).toContain("mail server down");
  });

  it("turns a rejected promise into an ERROR report", async () => {
    const modulePath = writeCloserModule(`export default { close: async () => { throw new Error("timed out"); } };`);

    const report = await (await loadCustomCloser(REPO_ROOT, modulePath)).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain("timed out");
  });

  it("turns a malformed report into an ERROR report", async () => {
    for (const returned of [`{ status: "OK", detail: "x" }`, `{ status: "DONE" }`, `undefined`]) {
      const modulePath = writeCloserModule(`export default { close: async () => (${returned}) };`);

      const report = await (await loadCustomCloser(REPO_ROOT, modulePath)).close(ctx, accepted);

      expect(report.status).toBe("ERROR");
      expect(report.detail).toContain("did not return a valid CloseReport");
      expect(report.detail).toContain(modulePath);
    }
  });
});

describe("createCustomCloser", () => {
  it("runs a working closer without the caller loading it first", async () => {
    const closer = createCustomCloser(REPO_ROOT, writeCloserModule(WORKING_CLOSER));

    expect((await closer.close(ctx, accepted)).detail).toBe("closed surface/surface-9 onto main as accepted");
  });

  it("reports a module that cannot be loaded as an ERROR report naming it, not a throw", async () => {
    const missing = path.join(os.tmpdir(), "no-such-closer-module-abc.mjs");

    const report = await createCustomCloser(REPO_ROOT, missing).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain(missing);
  });

  it("reports a module without close as an ERROR report naming the module and what is missing", async () => {
    const modulePath = writeCloserModule(`export default {};`);

    const report = await createCustomCloser(REPO_ROOT, modulePath).close(ctx, accepted);

    expect(report.status).toBe("ERROR");
    expect(report.detail).toContain(modulePath);
    expect(report.detail).toContain('missing "close" method');
  });
});
