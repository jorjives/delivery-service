// Slice 5: the harness is released like any other package. The version, the
// changelog and the licence gate are the promises this file holds: publishing
// must stay off until a human chooses a licence, so the gate is asserted rather
// than trusted to a comment.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
const pkg = JSON.parse(read("package.json")) as Record<string, unknown> & { version: string };

describe("releasing the harness", () => {
  it("starts at 0.1.0: usable, with no stability promise yet", () => {
    expect(pkg.version).toBe("0.1.0");
  });

  it("declares no licence, and ships no LICENSE file, until a human chooses one", () => {
    expect(Object.keys(pkg)).not.toContain("license");
    expect(existsSync(join(REPO_ROOT, "LICENSE"))).toBe(false);
  });

  it("has a changelog whose newest entry is the 0.1.0 release, in plain sentences", () => {
    const changelog = read("CHANGELOG.md");
    const versions = changelog.split("\n").filter((line) => line.startsWith("## "));
    expect(versions[0]).toBe("## 0.1.0");
    expect(changelog).toContain("`delivery`");
    expect(changelog).not.toContain("—"); // no em-dashes in outward-facing copy
  });

  it("versions the package from changeset entries on merges to main", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain("changesets/action@v1");
    expect(workflow).toMatch(/^\s*version: npx changeset version$/m);
    expect(JSON.parse(read(".changeset/config.json"))).toMatchObject({ baseBranch: "main" });
  });

  it("keeps the publish step off, and says what a human must settle to turn it on", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).not.toMatch(/^\s*publish:/m); // only the commented-out form may appear
    expect(workflow).toContain("LICENSE");
    expect(workflow).toContain("NPM_TOKEN");
  });

  it("tells contributors how to describe their change", () => {
    expect(read("CONTRIBUTING.md")).toContain("npx changeset");
  });

  it("records project configuration's commands and settings as an additive release", () => {
    // Pending entries become the changelog on `changeset version`, so read both:
    // this holds before the release and after it.
    const pending = readdirSync(join(REPO_ROOT, ".changeset"))
      .filter((name) => name.endsWith(".md") && name !== "README.md")
      .map((name) => read(`.changeset/${name}`));
    const recorded = [read("CHANGELOG.md"), ...pending].join("\n");
    for (const surface of ["delivery validate", "delivery preview", "`domain`", "`tasks`", "`roles`", "docs/project-configuration.md"]) {
      expect(recorded).toContain(surface);
    }
    for (const entry of pending) expect(entry).not.toMatch(/^"delivery-service": major$/m);
  });
});
