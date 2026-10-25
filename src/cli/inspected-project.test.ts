import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_PROJECT } from "../packs/inspection.js";
import { readPackFolder } from "../packs/pack-folder.js";
import { ONE_LINE } from "../packs/setting-types.js";
import { initTempRepo } from "../temp-repo.js";
import { PACKAGE, writeGuidePack } from "./command-fixtures.js";
import { EXIT, Refusal } from "./failures.js";
import { inspectedProject } from "./inspected-project.js";
import { settingsRefusal } from "./pack-settings-render.js";

/** The guide pack read from `folder`, as the inspect command reads it. */
async function guidePackIn(folder: string) {
  const read = await readPackFolder(join(folder, "guide-pack"));
  if (!read.ok) throw new Error(`the guide pack did not read from ${folder}`);
  return read.pack;
}

/** A project whose config is `config`, with the guide pack laid in it. */
function guideRepo(config: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const repo = initTempRepo("inspected-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify(config), ...extra });
  writeGuidePack(repo);
  return repo;
}

const HIDDEN = String.fromCodePoint(0x202e);

describe("inspectedProject", () => {
  it("reads the owner's values for a listed pack", async () => {
    const repo = guideRepo({ packs: ["guide-pack"], packSettings: { guide: { "docs-folder": "handbook" } } });
    const { values, configName } = await inspectedProject(repo, {}, await guidePackIn(repo));
    expect(values).toEqual({ "docs-folder": "handbook" });
    expect(configName).toBe("delivery.config.json");
  });

  it("counts a listed folder however it is spelt", async () => {
    const repo = guideRepo({ packs: ["./guide-pack/"], packSettings: { guide: { "docs-folder": "handbook" } } });
    expect((await inspectedProject(repo, {}, await guidePackIn(repo))).values).not.toBeNull();
  });

  it("counts a listed folder reached through a symlink", async () => {
    const repo = guideRepo({ packs: ["guide-link"], packSettings: { guide: { "docs-folder": "handbook" } } });
    symlinkSync(join(repo, "guide-pack"), join(repo, "guide-link"));
    expect((await inspectedProject(repo, {}, await guidePackIn(repo))).values).not.toBeNull();
  });

  it("gives an empty object in a project that uses the pack but gives no values", async () => {
    const repo = guideRepo({ packs: ["guide-pack"] });
    expect((await inspectedProject(repo, {}, await guidePackIn(repo))).values).toEqual({});
  });

  it("does not read values for a folder the project does not list", async () => {
    const repo = guideRepo({ packSettings: { guide: { "docs-folder": "handbook" } } });
    expect((await inspectedProject(repo, {}, await guidePackIn(repo))).values).toBeNull();
  });

  it("gives no values outside a project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "inspected-outside-"));
    writeGuidePack(outside);
    const { project, values } = await inspectedProject(outside, {}, await guidePackIn(outside));
    expect(project).toEqual(NO_PROJECT);
    expect(values).toBeNull();
  });

  it("gives no values for a code configuration, and says it is code", async () => {
    const repo = initTempRepo("inspected-code-", {
      "package.json": PACKAGE,
      "delivery.config.mjs": `export default { packs: ["guide-pack"], packSettings: { guide: { "docs-folder": "handbook" } } };\n`,
    });
    writeGuidePack(repo);
    const { project, values } = await inspectedProject(repo, {}, await guidePackIn(repo));
    expect(project.config).toBe("code");
    expect(values).toBeNull();
  });

  it("refuses a hidden character in this pack's value, without printing it", async () => {
    const value = `hand${HIDDEN}book`;
    const repo = guideRepo({ packs: ["guide-pack"], packSettings: { guide: { "docs-folder": value } } });
    const error: unknown = await inspectedProject(repo, {}, await guidePackIn(repo)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Refusal);
    const refusal = error as Refusal;
    expect(refusal.message).toBe(settingsRefusal([{ kind: "invalid", pack: "guide", setting: "docs-folder", rule: ONE_LINE, value }], "delivery.config.json"));
    expect(refusal.message).not.toContain(HIDDEN);
    expect(refusal.field).toBe("packSettings.guide.docs-folder");
    expect(refusal.exitCode).toBe(EXIT.configuration);
  });

  it("ignores another pack's faults", async () => {
    const repo = guideRepo({ packs: ["guide-pack"], packSettings: { guide: { "docs-folder": "handbook" }, nope: { a: "b" } } });
    const { values } = await inspectedProject(repo, {}, await guidePackIn(repo));
    expect(values).toEqual({ "docs-folder": "handbook" });
  });
});
