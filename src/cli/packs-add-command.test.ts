import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PackSourceUnavailable, PackSpecRefused } from "../errors.js";
import { git } from "../git-exec.js";
import { fingerprintOf, readLock } from "../packs/install/lock.js";
import { fileDigests } from "../packs/install/digests.js";
import { installedPackDir } from "../packs/install/store.js";
import { readPackage, NO_PACK_FIELD, noPackThere } from "../packs/install/package-archive.js";
import { fakePackSource, type FakePackSource } from "../packs/install/fake-source.js";
import { packPackage, SCAN_TEXT } from "../packs/install/install-fixtures.js";
import type { PackSource } from "../packs/install/pack-source.js";
import { sriOf } from "../packs/install/pack-source.js";
import { loadPack } from "../packs/manifest.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { packsAddCommand } from "./packs-add-command.js";
import { addedLines, alreadyAdded, NOTHING_ADDED, nobodyToAsk } from "./packs-add-render.js";
import { builtInPackClash } from "./pack-workflows.js";
import { INSPECT_RULE } from "./packs-inspect-render.js";
import { context, scriptedAsk } from "./init-fixtures.js";

const NAME = "@acme/delivery-pack-docs";

type PackOptions = Parameters<typeof packPackage>[0];

/** Every path under `repo` except `.git`, with a directory's marker or a file's bytes, so a test can prove nothing changed. */
function tree(repo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(repo, { recursive: true }).map(String)) {
    if (rel === ".git" || rel.startsWith(".git/")) continue;
    const path = join(repo, rel);
    out[rel] = statSync(path).isDirectory() ? "<folder>" : readFileSync(path).toString("base64");
  }
  return out;
}

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
    expect(lines.slice(-nobodyToAsk().length)).toEqual(nobodyToAsk());
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
    expect(listed.stdout).toContain("From npm: @acme/delivery-pack-docs 1.2.0. Start it with: delivery review docs-drift");
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

  it("refuses a pack that would break the project, writing nothing", async () => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ name: "code" }));
    const before = tree(repo);
    const { ctx } = context(repo);
    await expect(packsAddCommand(NAME, ctx, scriptedAsk({ confirm: true }).ask, other)).rejects.toThrow(
      builtInPackClash("code", join(repo, ".delivery", "packs", "code", "pack.json")),
    );
    expect(tree(repo)).toEqual(before);
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
    const before = tempFolders();
    await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: false }).ask, source);
    await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source);
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ field: "pack", extra: { "pack/install.sh": "rm -rf /" } }));
    await packsAddCommand(NAME, context(repo).ctx, scriptedAsk({ confirm: true }).ask, other);
    expect(tempFolders()).toEqual(before);
  });
});
