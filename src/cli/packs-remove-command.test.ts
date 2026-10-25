import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readLock } from "../packs/install/lock.js";
import { entryFor, packPackage, SCAN_TEXT } from "../packs/install/install-fixtures.js";
import { installedPackDir, installPack } from "../packs/install/store.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, writeNeedyPack } from "./command-fixtures.js";
import { readConfig } from "./config.js";
import { EXIT } from "./failures.js";
import { addedDocsDrift, tree } from "./installed-fixtures.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { packsAddCommand } from "./packs-add-command.js";
import { packsRemoveCommand } from "./packs-remove-command.js";
import { withPackWorkflows } from "./pack-workflows.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The text with every run of white space made one space: where a line wraps does not matter. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/** The contents of a delivery.pack/3 manifest named `name`, with a find and an act workflow. */
const v3Pack = (name: string): string =>
  JSON.stringify({
    schema: "delivery.pack/3",
    name,
    version: "1.0.0",
    title: "Mine",
    summary: "Mine.",
    workflows: { scan: { kind: "find", prompt: "scan.md", ideasFor: ["code"] }, code: { kind: "act", prompt: "code.md" } },
  });

describe("delivery packs remove", () => {
  let repo: string;
  const configPath = (): string => join(repo, "delivery.config.json");
  const dirPath = (): string => join(repo, ".delivery", "packs", "docs-drift");
  const scanPath = (): string => join(dirPath(), "scan.md");

  beforeEach(() => {
    repo = initTempRepo("remove-pack-", { "package.json": PACKAGE });
  });

  it("names the workflows that stop existing, then deletes the kept files and the record entry", async () => {
    await addedDocsDrift(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.ok);
    expect(lines).toEqual([
      // 63 characters unwrapped, so `wrap` breaks it at 60
      "Removing docs-drift, added from @acme/delivery-pack-docs",
      "1.2.0.",
      "  These workflows will stop existing:",
      "    docs-drift:scan",
      "    docs-drift:code",
      "Removed docs-drift.",
      "  Deleted: .delivery/packs/docs-drift",
      "  And its entry in .delivery/packs.lock.json",
      "Commit both, so the pack is gone for everyone.",
    ]);
    expect(existsSync(dirPath())).toBe(false);
    expect((await readLock(repo)).packs).toEqual({});
  });

  it("still works when a pack the project uses has a required setting with no value", async () => {
    writeFileSync(configPath(), JSON.stringify({ packs: ["needy-pack"] }));
    writeNeedyPack(repo);
    await addedDocsDrift(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.ok);
    expect(lines).toEqual([
      "Removing docs-drift, added from @acme/delivery-pack-docs",
      "1.2.0.",
      "  These workflows will stop existing:",
      "    docs-drift:scan",
      "    docs-drift:code",
      "Removed docs-drift.",
      "  Deleted: .delivery/packs/docs-drift",
      "  And its entry in .delivery/packs.lock.json",
      "Commit both, so the pack is gone for everyone.",
    ]);
    expect(existsSync(dirPath())).toBe(false);
    expect((await readLock(repo)).packs).toEqual({});
  });

  it("leaves a packSettings entry for the removed pack to be refused, not ignored", async () => {
    // added pack "moves" plus packSettings: { moves: {} } in delivery.config.json (an empty entry, so the project is
    // ready before the remove and the only problem after it is the pack no longer being used)
    const files = [
      { path: "pack.json", bytes: encode(v3Pack("moves")) },
      { path: "scan.md", bytes: encode("# Scan\n") },
      { path: "code.md", bytes: encode("# Code\n") },
    ];
    await installPack(repo, "moves", files, await entryFor(files, { package: "@acme/moves", request: "^1.2.0" }));
    writeFileSync(configPath(), JSON.stringify({ packSettings: { moves: {} } }));
    expect((await delivery(["packs", "remove", "moves"], { cwd: repo })).exitCode).toBe(EXIT.ok);
    const validated = await delivery(["validate"], { cwd: repo });
    expect(validated.exitCode).toBe(EXIT.configuration);
    expect(validated.stdout + validated.stderr).toContain("moves: no pack called moves is used by this project.");
  });

  it("refuses, changing nothing, while a task in the configuration names one of its workflows", async () => {
    await addedDocsDrift(repo);
    writeFileSync(configPath(), JSON.stringify({ tasks: ["Tidy up", { intent: "Move calls", workflow: "docs-drift:code" }] }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.configuration);
    expect(lines).toContain("  tasks 2: docs-drift:code");
    expect(lines).toContain("  These workflows will stop existing:");
    expect(lines.at(-1)).toBe("Nothing was changed.");
    expect(tree(repo)).toEqual(before);
  });

  it("refuses while the single task in the configuration names one of its workflows", async () => {
    await addedDocsDrift(repo);
    writeFileSync(configPath(), JSON.stringify({ task: { intent: "Move calls", workflow: "docs-drift:code" } }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.configuration);
    expect(lines).toContain("  task: docs-drift:code");
    expect(lines.at(-1)).toBe("Nothing was changed.");
    expect(tree(repo)).toEqual(before);
  });

  it("refuses while a github source delivers by one of its workflows", async () => {
    await addedDocsDrift(repo);
    writeFileSync(
      configPath(),
      JSON.stringify({ sources: [{ type: "backlog" }, { type: "github", workflow: "docs-drift:scan" }] }),
    );
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.configuration);
    expect(lines).toContain("  sources 2: docs-drift:scan");
    expect(lines.at(-1)).toBe("Nothing was changed.");
    expect(tree(repo)).toEqual(before);
  });

  it("is not blocked by a workflow of another pack whose name starts the same", async () => {
    await addedDocsDrift(repo);
    writeFileSync(configPath(), JSON.stringify({ tasks: [{ intent: "x", workflow: "docs-drift-old:scan" }] }));
    const { ctx } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.ok);
    expect(existsSync(dirPath())).toBe(false);
  });

  it("names the added packs for a name that is not added, changing nothing", async () => {
    await addedDocsDrift(repo);
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("nope", ctx)).toBe(EXIT.configuration);
    expect(lines).toEqual(["nope is not an added pack. Added: docs-drift."]);
    expect(tree(repo)).toEqual(before);
  });

  it.each<[string, () => void]>([
    ["its folder is gone", () => rmSync(installedPackDir(repo, "docs-drift"), { recursive: true, force: true })],
    ["a file in it is changed", () => writeFileSync(scanPath(), `${SCAN_TEXT}\nEdited.\n`)],
  ])("removes a pack whose files are missing or changed, naming no workflows, when %s", async (_, damage) => {
    await addedDocsDrift(repo);
    damage();
    const { ctx, lines } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.ok);
    expect(lines).toContain("  It is not as approved, so none of its workflows run now.");
    expect(lines).not.toContain("  These workflows will stop existing:");
    expect((await readLock(repo)).packs).toEqual({});
    expect(existsSync(dirPath())).toBe(false);
  });

  it("removes a pack that clashes with a listed folder pack, which is how the clash is resolved", async () => {
    await addedDocsDrift(repo);
    mkdirSync(join(repo, "local"));
    writeFileSync(configPath(), JSON.stringify({ packs: ["local"] }));
    writeFileSync(join(repo, "local", "pack.json"), v3Pack("docs-drift"));
    writeFileSync(join(repo, "local", "scan.md"), SCAN_TEXT);
    writeFileSync(join(repo, "local", "code.md"), "# Code\n");
    const { ctx } = context(repo);
    expect(await packsRemoveCommand("docs-drift", ctx)).toBe(EXIT.ok);
    const config = await withPackWorkflows(await readConfig(configPath()), repo, repo);
    expect(config.workflows?.["docs-drift:scan"]).toBeDefined();
  });

  it("lets a second package with the same pack name be added after the first is removed", async () => {
    const source = await addedDocsDrift(repo);
    source.publish("@other/docs", "2.0.0", packPackage({ packageName: "@other/docs", version: "2.0.0" }));
    const refused = context(repo);
    expect(await packsAddCommand("@other/docs", refused.ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);

    const removing = context(repo);
    expect(await packsRemoveCommand("docs-drift", removing.ctx)).toBe(EXIT.ok);

    const added = context(repo);
    expect(await packsAddCommand("@other/docs", added.ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    const lock = await readLock(repo);
    expect(lock.packs["docs-drift"]?.package).toBe("@other/docs");
    expect(Object.keys(lock.packs)).toEqual(["docs-drift"]);
  });

  it("keeps its lines within 60 columns, with no colour and no reassuring or forbidden words", async () => {
    await addedDocsDrift(repo);
    writeFileSync(configPath(), JSON.stringify({ tasks: [{ intent: "Move calls", workflow: "docs-drift:code" }] }));
    const refused = context(repo);
    await packsRemoveCommand("docs-drift", refused.ctx);
    const removed = context(repo);
    await packsRemoveCommand("nope", removed.ctx);
    const all = [...refused.lines, ...removed.lines];
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toContain("\u001b");
      expect(line).not.toMatch(REASSURING);
      expect(line).not.toMatch(FORBIDDEN);
    }
    expect(flat(all.join("\n"))).toContain("Not removed: delivery.config.json still names its workflows.");
  });

  it("is wired as delivery packs remove", async () => {
    const { exitCode, stdout } = await delivery(["packs", "remove", "nope"], { cwd: repo });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toContain("nope is not an added pack. Added: none.");
  });
});
