import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initTempRepo } from "./temp-repo.js";

afterEach(() => vi.unstubAllEnvs());

describe("initTempRepo", () => {
  it("runs no hook from a git template, so a seeded project cannot run commands through the harness's git", () => {
    const home = mkdtempSync(join(tmpdir(), "temp-repo-home-"));
    const ran = join(home, "ran");
    const hooks = join(home, "template", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\ntouch ${ran}\n`);
    chmodSync(join(hooks, "pre-commit"), 0o755);
    writeFileSync(join(home, ".gitconfig"), `[init]\n\ttemplateDir = ${join(home, "template")}\n`);
    vi.stubEnv("HOME", home);
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
    initTempRepo("temp-repo-test-", { "a.txt": "a\n" });
    expect(existsSync(ran)).toBe(false);
  });
});
