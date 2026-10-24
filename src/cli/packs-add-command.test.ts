import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InstalledPackRefused, PackSourceUnavailable, PackSpecRefused } from "../errors.js";
import { git } from "../git-exec.js";
import { fingerprintOf, readLock } from "../packs/install/lock.js";
import { fileDigests } from "../packs/install/digests.js";
import { installedPackDir } from "../packs/install/store.js";
import { readPackage, NO_PACK_FIELD, noPackThere } from "../packs/install/package-archive.js";
import { fakePackSource, type FakePackSource } from "../packs/install/fake-source.js";
import { packPackage, SCAN_TEXT } from "../packs/install/install-fixtures.js";
import type { PackSource } from "../packs/install/pack-source.js";
import { sriOf } from "../packs/install/pack-source.js";
import { loadPack, newerFormat } from "../packs/manifest.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, withPrivateTmpdir } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { packsAddCommand } from "./packs-add-command.js";
import { addedDifferently, addedLines, alreadyAdded, NOTHING_ADDED, nobodyToAsk } from "./packs-add-render.js";
import { packWorkflowClash } from "./pack-clash.js";
import { INSPECT_RULE } from "./packs-inspect-render.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { addedDocsDrift, tree } from "./installed-fixtures.js";

const NAME = "@acme/delivery-pack-docs";

type PackOptions = Parameters<typeof packPackage>[0];

/** The lines outside each pair of rules: the account's own words, not the pack's instructions shown between the rules. */
function linesOutsideRules(lines: readonly string[]): string[] {
  const outside: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line === INSPECT_RULE) {
      inside = !inside;
      continue;
    }
    if (!inside) outside.push(line);
  }
  return outside;
}

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

/** The temporary folders an add makes, by name. */
const tempFolders = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("delivery-pack-")).sort();

describe("delivery packs add", () => {
  let repo: string;
  let source: FakePackSource;
  let tarball: Uint8Array;

  beforeEach(() => {
    repo = initTempRepo("add-pack-", { "package.json": PACKAGE });
    source = fakePackSource();
    tarball = packPackage();
    source.publish(NAME, "1.2.0", tarball);
  });

  it("shows the exact version, that nothing is run, and the whole account before asking", async () => {
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: false });
    await packsAddCommand(NAME, ctx, ask, source);
    expect(lines.slice(0, 2)).toEqual([`Found ${NAME} on npm.`, "  Version: 1.2.0"]);
    expect(flat(lines.join("\n"))).toContain("Nothing from the package is run");
    const text = lines.join("\n");
    expect(flat(text)).toContain("docs-drift, version 1.0.0, from npm: @acme/delivery-pack-docs 1.2.0.");
    for (const heading of ["In short", "What it may touch", "How far each workflow goes before it asks you", "Checks and landing", "Things to look at"]) {
      expect(lines).toContain(heading);
    }
    // The pack's own instructions are headed with the workflow's name and a line count.
    expect(lines.some((line) => line.startsWith("Instructions for scan"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Instructions for code"))).toBe(true);
    expect(text).toContain(SCAN_TEXT);
    expect(text.indexOf("Found ")).toBeLessThan(text.indexOf("In short"));
    expect(asked).toEqual([{ message: "Add docs-drift 1.2.0 to this project?", default: false }]);
  });

  it("says which version a range or tag found", async () => {
    source.publish(NAME, "1.2.0", tarball, { tags: ["^1.0.0"] });
    const { ctx, lines } = context(repo);
    await packsAddCommand(`${NAME}@^1.0.0`, ctx, scriptedAsk({ confirm: false }).ask, source);
    expect(lines).toContain("  Version: 1.2.0 (found for ^1.0.0)");
  });

  it("names both the package and the pack when they differ, and keys the record by the pack", async () => {
    const { ctx, lines } = context(repo);
    await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source);
    expect(flat(lines.join("\n"))).toContain(NAME);
    expect(flat(lines.join("\n"))).toContain("docs-drift");
    const lock = await readLock(repo);
    expect(Object.keys(lock.packs)).toEqual(["docs-drift"]);
    expect(lock.packs["docs-drift"]).toMatchObject({ package: NAME });
  });

  it.each<[string, boolean | undefined]>([
    ["no", false],
    ["no answer", undefined],
  ])("changes nothing when the owner answers %s", async (_, confirm) => {
    const { ctx, lines } = context(repo);
    const before = tree(repo);
    const exit = await packsAddCommand(NAME, ctx, scriptedAsk({ confirm }).ask, source);
    expect(exit).toBe(EXIT.ok);
    expect(lines.at(-1)).toBe(NOTHING_ADDED);
    expect(tree(repo)).toEqual(before);
  });

  it("shows the account and refuses, changing nothing, when nothing can ask", async () => {
    const { ctx, lines } = context(repo, { interactive: false });
    const { ask, asked } = scriptedAsk({ confirm: true });
    const before = tree(repo);
    const exit = await packsAddCommand(NAME, ctx, ask, source);
    expect(exit).toBe(EXIT.configuration);
    // The account prints the fingerprint in two halves, one to a line: the command gives it back whole.
    const halves = lines.filter((line) => /^  [0-9a-f]{32}$/.test(line)).map((line) => line.trim());
    expect(halves).toHaveLength(2);
    const hash = halves.join("");
    expect(lines.slice(-nobodyToAsk("add", `delivery packs add ${NAME}`, hash).length)).toEqual(nobodyToAsk("add", `delivery packs add ${NAME}`, hash));
    expect(asked).toEqual([]);
    expect(tree(repo)).toEqual(before);
  });

  it("after yes, names the two items to commit, and git keeps both", async () => {
    const { ctx, lines } = context(repo);
    const exit = await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source);
    expect(exit).toBe(EXIT.ok);
    expect(lines.slice(-addedLines("docs-drift", "1.2.0").length)).toEqual(addedLines("docs-drift", "1.2.0"));

    const status = await git(repo, ["status", "--porcelain", "--untracked-files=all"]);
    expect(status).toContain(".delivery/packs.lock.json");
    expect(status).toContain(".delivery/packs/docs-drift/pack.json");
    for (const path of [".delivery/packs.lock.json", ".delivery/packs/docs-drift/pack.json"]) {
      await expect(git(repo, ["check-ignore", "-q", path])).rejects.toThrow();
    }

    const read = await readPackage(tarball);
    if (!read.ok) throw new Error("the fixture package must read");
    for (const file of read.packFiles) {
      expect(readFileSync(join(repo, ".delivery", "packs", "docs-drift", file.path))).toEqual(Buffer.from(file.bytes));
    }

    const entry = (await readLock(repo)).packs["docs-drift"];
    const kept = await loadPack(join(repo, ".delivery", "packs", "docs-drift"));
    expect(entry).toEqual({
      source: "npm",
      package: NAME,
      request: "latest",
      version: "1.2.0",
      integrity: sriOf(tarball),
      fingerprint: fingerprintOf(kept),
      approved: fingerprintOf(kept),
      files: await fileDigests(join(repo, ".delivery", "packs", "docs-drift"), ["code.md", "pack.json", "scan.md"]),
    });
  });

  it("records the digest of the manifest and each instruction file it adds", async () => {
    expect(await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect((await readLock(repo)).packs["docs-drift"]?.files).toEqual(
      await fileDigests(installedPackDir(repo, "docs-drift"), ["code.md", "pack.json", "scan.md"]),
    );
  });

  it("keeps both committed paths unignored when the project still has the old .delivery rule", async () => {
    // The rule before added packs: it ignored everything in .delivery but the backlog, so the two committed paths would be hidden.
    mkdirSync(join(repo, ".delivery"), { recursive: true });
    writeFileSync(join(repo, ".delivery", ".gitignore"), "*\n!backlog/\n!backlog/**\n");
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect(lines.slice(-addedLines("docs-drift", "1.2.0").length)).toEqual(addedLines("docs-drift", "1.2.0"));
    const status = await git(repo, ["status", "--porcelain", "--untracked-files=all"]);
    expect(status).toContain(".delivery/packs.lock.json");
    expect(status).toContain(".delivery/packs/docs-drift/pack.json");
    for (const path of [".delivery/packs.lock.json", ".delivery/packs/docs-drift/pack.json"]) {
      await expect(git(repo, ["check-ignore", "-q", path])).rejects.toThrow();
    }
  });

  it("then lists the pack with its source and version, and previews its find", async () => {
    await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source);
    const listed = await delivery(["packs"], { cwd: repo });
    expect(listed.stdout).toContain("From npm: @acme/delivery-pack-docs 1.2.0. As approved. Start it with: delivery review docs-drift");
    const preview = await delivery(["review", "docs-drift", "--preview"], { cwd: repo });
    expect(preview.exitCode).toBe(EXIT.ok);
    expect(preview.stdout).toContain(SCAN_TEXT.slice(0, SCAN_TEXT.indexOf("\n")));
  });

  it("says an already-added pack at the same content is already there, and changes nothing", async () => {
    await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source);
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsAddCommand(NAME, ctx, ask, source)).toBe(EXIT.ok);
    expect(lines.at(-1)).toBe(alreadyAdded("docs-drift", "1.2.0"));
    expect(asked).toEqual([]);
    expect(tree(repo)).toEqual(before);
  });

  // `undefined` drops the key from the package.json, so the package does not say it holds a pack at all.
  it.each<[string, PackOptions, string]>([
    ["a package that does not say it holds a pack", { packageJson: { "delivery-pack": undefined } }, NO_PACK_FIELD],
    ["a pack folder that is not there", { field: "elsewhere", packageJson: { "delivery-pack": "pack" } }, noPackThere("pack")],
  ])("refuses %s, writing nothing", async (_, options, message) => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage(options));
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    const before = tree(repo);
    expect(await packsAddCommand(NAME, ctx, ask, other)).toBe(EXIT.configuration);
    expect(lines[0]).toBe("Not added: @acme/delivery-pack-docs 1.2.0");
    expect(flat(lines.join("\n"))).toContain(message);
    expect(asked).toEqual([]);
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a pack folder holding a file the format does not name, naming it as it sits in the package", async () => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ field: "pack", extra: { "pack/install.sh": "rm -rf /" } }));
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    const before = tree(repo);
    expect(await packsAddCommand(NAME, ctx, ask, other)).toBe(EXIT.configuration);
    expect(lines.some((line) => line.includes("pack/install.sh is not part of a pack"))).toBe(true);
    expect(lines.join("\n")).not.toContain("In short");
    expect(asked).toEqual([]);
    expect(tree(repo)).toEqual(before);
  });

  it("lists files outside the pack folder as not part of the pack and does not keep them", async () => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ field: "pack", extra: { "README.md": "x", "index.js": "y" }, packageJson: { scripts: { postinstall: "node index.js" } } }));
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, other)).toBe(EXIT.ok);
    expect(lines).toContain("In the package, not part of the pack");
    expect(lines).toContain("  index.js, 1 byte");
    expect(flat(lines.join("\n"))).toContain("It declares scripts; delivery-service does not run or install them.");
    expect(existsSync(join(repo, ".delivery", "packs", "docs-drift", "index.js"))).toBe(false);
  });

  it.each(["github:a/b", "https://example.test/pack.tgz", "./my-pack"])("refuses %s before anything is fetched", async (spec) => {
    const { ctx } = context(repo);
    await expect(packsAddCommand(spec, ctx, scriptedAsk({ confirm: true }).ask, source)).rejects.toThrow(PackSpecRefused);
    expect(source.fetched).toEqual([]);
  });

  it("refuses a pack named like a built-in, naming both and asking the authors to rename it", async () => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ name: "code" }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsAddCommand(NAME, ctx, ask, other)).toBe(EXIT.configuration);
    expect(lines).toEqual([
      'Not added: two packs are named "code".',
      '  1. "code", a pack that comes with the harness',
      "  2. the pack you are adding, from @acme/delivery-pack-docs",
      "     1.2.0",
      "Each pack name must be used once.",
      "  A pack that comes with the harness cannot be removed, so",
      "  ask the authors of the new pack to rename it.",
      "Nothing was changed.",
    ]);
    expect(asked).toEqual([]);
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a second package holding a pack of the same name, naming both and the remove that keeps the new one", async () => {
    await addedDocsDrift(repo);
    const other = fakePackSource();
    other.publish("@other/docs", "2.0.0", packPackage({ packageName: "@other/docs", version: "2.0.0" }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand("@other/docs", ctx, scriptedAsk({ confirm: true }).ask, other)).toBe(EXIT.configuration);
    expect(lines).toContain('Not added: two packs are named "docs-drift".');
    expect(flat(lines.join("\n"))).toContain("1. the pack added from @acme/delivery-pack-docs 1.2.0");
    expect(flat(lines.join("\n"))).toContain("2. the pack you are adding, from @other/docs 2.0.0");
    expect(lines.slice(-3)).toEqual(["  To keep the new pack, remove the first:", "    delivery packs remove docs-drift", "Nothing was changed."]);
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a pack named like a listed folder pack, naming the folder's manifest", async () => {
    mkdirSync(join(repo, "local"));
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ packs: ["local"] }));
    writeFileSync(join(repo, "local", "pack.json"), v3Pack("docs-drift"));
    writeFileSync(join(repo, "local", "scan.md"), SCAN_TEXT);
    writeFileSync(join(repo, "local", "code.md"), "# Code\n");
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(lines).toContain('Not added: two packs are named "docs-drift".');
    expect(flat(lines.join("\n"))).toContain("1. the pack in local/pack.json");
    expect(flat(lines.join("\n"))).toContain("take the first out of packs in your configuration.");
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a pack whose workflow the project's own workflows define", async () => {
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ workflows: { "docs-drift:scan": { steps: [{ name: "a", prompt: "a" }] } } }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(lines[0]).toBe('Not added: two things define the workflow "docs-drift:scan".');
    expect(lines).toContain("  1. a workflow in your configuration");
    expect(lines).toContain("  To keep the new pack, rename your own workflow.");
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a project that already clashes with its own sentence, not this pack's", async () => {
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ packs: ["a", "b"] }));
    for (const dir of ["a", "b"]) {
      mkdirSync(join(repo, dir));
      writeFileSync(join(repo, dir, "pack.json"), v3Pack("mine"));
      writeFileSync(join(repo, dir, "scan.md"), SCAN_TEXT);
      writeFileSync(join(repo, dir, "code.md"), "# Code\n");
    }
    const before = tree(repo);
    const { ctx } = context(repo);
    await expect(packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source)).rejects.toThrow(
      packWorkflowClash("mine:scan", { kind: "folder", pack: "mine", manifestFile: join(repo, "a", "pack.json") }, { kind: "folder", pack: "mine", manifestFile: join(repo, "b", "pack.json") }),
    );
    expect(tree(repo)).toEqual(before);
  });

  it("still refuses the same package at other contents as already added, not as a clash", async () => {
    await addedDocsDrift(repo);
    const entry = (await readLock(repo)).packs["docs-drift"];
    if (entry === undefined) throw new Error("the fixture pack must be recorded");
    const other = fakePackSource();
    other.publish(NAME, "1.3.0", packPackage({ version: "1.3.0", extra: { "scan.md": `${SCAN_TEXT}\nAlso check the tests.\n` } }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, other)).toBe(EXIT.configuration);
    expect(lines).toEqual(addedDifferently("docs-drift", entry));
    expect(tree(repo)).toEqual(before);
  });

  it("keeps a clash screen within 60 columns, with no colour and no reassuring words", async () => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ name: "code" }));
    const { ctx, lines } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, other)).toBe(EXIT.configuration);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toContain("\u001b");
    }
    const text = lines.join("\n");
    expect(text).not.toMatch(REASSURING);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it.each(["not-found", "no-version", "unreachable"] as const)("changes nothing when npm says %s", async (reason) => {
    const fake = fakePackSource();
    if (reason !== "not-found") fake.publish(NAME, "1.2.0", tarball);
    if (reason === "unreachable") fake.unreachable();
    const spec = reason === "no-version" ? `${NAME}@^9.0.0` : NAME;
    const { ctx } = context(repo);
    const before = tree(repo);
    const error: unknown = await packsAddCommand(spec, ctx, scriptedAsk({ confirm: true }).ask, fake).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PackSourceUnavailable);
    expect(error).toMatchObject({ reason });
    expect(tree(repo)).toEqual(before);
  });

  it("changes nothing when npm is missing", async () => {
    const missing: PackSource = { fetch: () => Promise.reject(new PackSourceUnavailable(NAME, "latest", "no-npm", "")) };
    const { ctx } = context(repo);
    const before = tree(repo);
    await expect(packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, missing)).rejects.toMatchObject({ reason: "no-npm" });
    expect(tree(repo)).toEqual(before);
  });

  it("keeps its own lines within 60 columns, with no colour and no reassuring words", async () => {
    const { ctx, lines } = context(repo);
    await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source);
    const own = linesOutsideRules(lines);
    for (const line of own) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toContain("\u001b");
    }
    const text = own.join("\n");
    expect(text).not.toMatch(REASSURING);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("leaves no temporary folder behind", async () => {
    await withPrivateTmpdir(async () => {
      await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: false }).ask, source);
      await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source);
      const other = fakePackSource();
      other.publish(NAME, "1.2.0", packPackage({ field: "pack", extra: { "pack/install.sh": "rm -rf /" } }));
      await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, other);
      expect(tempFolders()).toEqual([]);
    });
  });

  it("adds a pack again over its own unrecorded folder", async () => {
    expect(await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    const lockPath = join(repo, ".delivery", "packs.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as { packs: Record<string, unknown> };
    delete lock.packs["docs-drift"];
    writeFileSync(lockPath, JSON.stringify(lock, null, 2));

    const { ctx } = context(repo);
    expect(await packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect((await readLock(repo)).packs["docs-drift"]).toBeDefined();
    expect((await delivery(["review", "docs-drift", "--preview"], { cwd: repo })).exitCode).toBe(EXIT.ok);
  });

  it("refuses to add while another added pack is unusable, naming it and changing nothing", async () => {
    await addedDocsDrift(repo);
    const scan = join(repo, ".delivery", "packs", "docs-drift", "scan.md");
    writeFileSync(scan, readFileSync(scan, "utf-8").replace("Read", "Reed"));
    const other = fakePackSource();
    other.publish("@acme/delivery-pack-other", "1.0.0", packPackage({ name: "other", packageName: "@acme/delivery-pack-other" }));
    const before = tree(repo);
    const { ctx } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    const error: unknown = await packsAddCommand("@acme/delivery-pack-other", ctx, ask, other).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(InstalledPackRefused);
    expect((error as InstalledPackRefused).refused.map((pack) => pack.name)).toEqual(["docs-drift"]);
    expect(asked).toEqual([]);
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a package whose pack is in a newer format with the upgrade sentence, writing nothing", async () => {
    source.publish(NAME, "2.0.0", packPackage({ version: "2.0.0", manifest: { schema: "delivery.pack/4" } }));
    const { ctx, lines } = context(repo);
    const before = tree(repo);
    expect(await packsAddCommand(`${NAME}@2.0.0`, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain(newerFormat("delivery.pack/4"));
    expect(tree(repo)).toEqual(before);
  });

  it("refuses to add while the record is from a newer delivery-service, leaving it byte for byte", async () => {
    const lockPath = join(repo, ".delivery", "packs.lock.json");
    mkdirSync(join(repo, ".delivery"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ schema: "delivery.packs-lock/2", packs: {} }));
    const lockBytesBefore = readFileSync(lockPath);
    const { ctx } = context(repo);
    await expect(packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, source)).rejects.toMatchObject({
      detail: expect.stringContaining("upgrade delivery-service"),
    });
    expect(readFileSync(lockPath)).toEqual(lockBytesBefore);
  });

});
