import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InstalledPackRefused, PackSourceUnavailable } from "../errors.js";
import { comparePacks } from "../packs/install/compare.js";
import { fingerprintedFiles } from "../packs/install/digests.js";
import { diffPackFiles } from "../packs/install/file-diff.js";
import { readInstalledPacks } from "../packs/install/installed.js";
import { fakePackSource, type FakePackSource } from "../packs/install/fake-source.js";
import { CODE_TEXT, packPackage } from "../packs/install/install-fixtures.js";
import { PACK_HASH_LABEL, readLock } from "../packs/install/lock.js";
import { readPackage } from "../packs/install/package-archive.js";
import { sriOf } from "../packs/install/pack-source.js";
import { installedPackDir } from "../packs/install/store.js";
import { withStagedPack } from "../packs/install/staged.js";
import { inspectionOf } from "../packs/inspection.js";
import { readPackFolder } from "../packs/pack-folder.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, withPrivateTmpdir } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { PackDecision } from "./pack-decision.js";
import { fingerprintDiffers, nobodyToAsk } from "./packs-add-render.js";
import { projectBaseline } from "./project-baseline.js";
import { addedDocsDrift, tree } from "./installed-fixtures.js";
import { notAddedLines } from "./installed-render.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { packsAddCommand } from "./packs-add-command.js";
import { packsUpdateCommand } from "./packs-update-command.js";
import { newerFormat } from "../packs/manifest.js";
import { keptDiffersLines, notUpdatableLines, renamedLines, updatedLines } from "./packs-update-render.js";

const NAME = "@acme/delivery-pack-docs";

/** The text with every run of white space made one space: where a line wraps does not matter. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/** The temporary folders an update left in `dir`, by name. */
const tempFolders = (dir: string): string[] => readdirSync(dir).filter((name) => name.startsWith("delivery-pack-")).sort();

/** The bare hash of a package's pack: the fingerprint the account prints, and the one `--approve` takes. */
async function hashOf(tarball: Uint8Array): Promise<string> {
  const read = await readPackage(tarball);
  if (!read.ok) throw new Error("the fixture package must read");
  return withStagedPack(read.packFiles, async (_stagedDir, folder) => {
    if (!folder.ok) throw new Error("the fixture package must hold a pack");
    return folder.pack.hash;
  });
}

/**
 * The two inspections and the file diffs an update of docs-drift to `next` judges, built as the command builds them:
 * the kept copy against the staged new version, under the same project baseline.
 */
async function judged(repo: string, next: Uint8Array) {
  const entry = (await readLock(repo)).packs["docs-drift"];
  if (entry === undefined) throw new Error("docs-drift must be added");
  const read = await readPackage(next);
  if (!read.ok) throw new Error("the fixture package must read");
  return withStagedPack(read.packFiles, async (stagedDir, folder) => {
    if (!folder.ok) throw new Error("the fixture package must hold a pack");
    const baseline = await projectBaseline(repo, {}, stagedDir);
    const keptDir = installedPackDir(repo, "docs-drift");
    const kept = await readPackFolder(keptDir);
    if (!kept.ok) throw new Error("the kept pack must read");
    const newPack = {
      ...folder.pack,
      dir: keptDir,
      origin: { kind: "installed" as const, package: entry.package, version: "1.3.0", request: entry.request, integrity: sriOf(next) },
    };
    const before = inspectionOf({ ...kept.pack, origin: { kind: "installed", package: entry.package, version: entry.version, request: entry.request, integrity: entry.integrity } }, baseline, kept.files);
    const after = inspectionOf(newPack, baseline, folder.files);
    const diffs = await diffPackFiles(keptDir, fingerprintedFiles(kept.pack), stagedDir, fingerprintedFiles(newPack));
    return { before, after, diffs };
  });
}

const SCAN = { kind: "find", prompt: "scan.md", ideasFor: ["code"] };
const V1_WORKFLOWS = { scan: SCAN, code: { kind: "act", prompt: "code.md", hold: { atOrAbove: "high" } } };
const V2_WORKFLOWS = {
  scan: { ...SCAN, ideasFor: ["code", "audit"] },
  code: { kind: "act", summary: "Code that calls the replaced code.", prompt: "code.md" },
  audit: { kind: "act", summary: "Audit of the calls.", prompt: "audit.md" },
};

describe("delivery packs update", () => {
  let repo: string;
  let source: FakePackSource;
  let V1: Uint8Array;
  let V2: Uint8Array;
  let oldHash: string;
  let newHash: string;
  const dirPath = (): string => join(repo, ".delivery", "packs", "docs-drift");
  const lockPath = (): string => join(repo, ".delivery", "packs.lock.json");

  beforeEach(async () => {
    repo = initTempRepo("update-pack-", { "package.json": PACKAGE });
    V1 = packPackage({ manifest: { workflows: V1_WORKFLOWS } });
    V2 = packPackage({
      version: "1.3.0",
      manifest: { workflows: V2_WORKFLOWS },
      extra: { "audit.md": "Audit.\nTwice.\n", "code.md": CODE_TEXT + "\nAlso this." },
    });
    oldHash = await hashOf(V1);
    newHash = await hashOf(V2);
    source = await addedDocsDrift(repo, V1);
    source.publish(NAME, "1.3.0", V2);
  });

  it("leads the report with the removed sign-off, then files, then lines, and changes nothing on no", async () => {
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: false }).ask, source)).toBe(EXIT.ok);
    const text = lines.join("\n");
    expect(lines[0]).toBe(`Checking ${NAME} on npm.`);
    expect(text).toContain('Found 1.3.0 for "latest" (you have 1.2.0).');
    expect(text.indexOf('Sign-off: "code" no longer waits for your sign-off.')).toBeLessThan(text.indexOf("Instruction files"));
    expect(text.indexOf("Instruction files")).toBeLessThan(text.indexOf("Changed lines"));
    expect(text).toContain("Workflows added: audit");
    expect(text).toContain("  audit.md: new, 2 lines");
    expect(text).toContain("  + Also this.");
    expect(flat(text)).toContain("This summary does not cover what the instructions say.");
    expect(lines.at(-1)).toBe("Nothing was changed.");
    expect(tree(repo)).toEqual(before);
  });

  it("on yes, keeps the new files and records 1.3.0 approved at its fingerprint, and the list shows it", async () => {
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect(lines.slice(-updatedLines("docs-drift", "1.3.0").length)).toEqual(updatedLines("docs-drift", "1.3.0"));
    const entry = (await readLock(repo)).packs["docs-drift"];
    expect(entry).toMatchObject({ version: "1.3.0", integrity: sriOf(V2), request: "latest" });
    expect(entry?.approved).toBe(entry?.fingerprint);
    expect(await readInstalledPacks(repo)).toMatchObject([{ state: "ok", pack: { workflows: { "docs-drift:audit": expect.anything() } } }]);
    const listed = await delivery(["packs"], { cwd: repo });
    expect(listed.stdout).toContain("From npm: @acme/delivery-pack-docs 1.3.0. As approved.");
  });

  it("shows the report and refuses, changing nothing, when nothing can ask", async () => {
    const before = tree(repo);
    const { ctx, lines } = context(repo, { interactive: false });
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain("Not updated: nothing here can ask you.");
    expect(tree(repo)).toEqual(before);
  });

  it("says the pack is up to date and writes nothing when npm has nothing newer", async () => {
    const repo2 = initTempRepo("update-pack-", { "package.json": PACKAGE });
    const same = await addedDocsDrift(repo2, V1);
    const before = tree(repo2);
    const { ctx, lines } = context(repo2);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, same)).toBe(EXIT.ok);
    expect(lines).toContain("docs-drift is up to date at 1.2.0.");
    expect(tree(repo2)).toEqual(before);
  });

  it("says a newer version with the same content changes nothing, naming both versions", async () => {
    source.publish(NAME, "1.3.0", packPackage({ manifest: { workflows: V1_WORKFLOWS }, version: "1.3.0", extra: { "README.md": "x\n" } }));
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect(flat(lines.join("\n"))).toContain("docs-drift 1.3.0 has the same content as the 1.2.0 you have.");
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it("takes the version the owner names and records that request", async () => {
    const { ctx } = context(repo);
    expect(await packsUpdateCommand("docs-drift", "1.3.0", ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect(source.fetched.at(-1)).toEqual({ name: NAME, request: "1.3.0", typed: true });
    expect((await readLock(repo)).packs["docs-drift"]?.request).toBe("1.3.0");
  });

  it("refuses a request that is not a version, range or tag, before asking npm", async () => {
    const asked = source.fetched.length;
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", "x y", ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain('Not updated: x y is not a version, range or tag.');
    expect(source.fetched.length).toBe(asked);
  });

  it("refuses an update that adds a workflow another pack defines, naming both, with the record unchanged", async () => {
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ workflows: { "docs-drift:audit": { steps: [{ name: "a", prompt: "a" }] } } }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain('Not updated: two things define the workflow "docs-drift:audit".');
    expect(lines).toContain("  To keep the new pack, rename your own workflow.");
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a new version that cannot be read, with the record unchanged", async () => {
    source.publish(NAME, "1.3.0", packPackage({ version: "1.3.0", extra: { "install.sh": "rm -rf /" } }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain("Not updated:");
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a new version whose pack has another name", async () => {
    source.publish(NAME, "1.3.0", packPackage({ name: "docs-sweep", version: "1.3.0" }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain(flat(renamedLines("docs-drift", NAME, "1.3.0", "docs-sweep").join("\n")));
    expect(tree(repo)).toEqual(before);
  });

  it("refuses when npm now serves other contents for the recorded version", async () => {
    const other = fakePackSource();
    other.publish(NAME, "1.2.0", packPackage({ extra: { "README.md": "new\n" } }));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, other)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain("Not updated: npm now serves different contents");
    expect(tree(repo)).toEqual(before);
  });

  it("compares a changed kept copy against what is on disk and accepts the new version", async () => {
    const code = join(dirPath(), "code.md");
    writeFileSync(code, readFileSync(code, "utf-8").replace("Read", "Reed"));
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.ok);
    expect(lines).toEqual(expect.arrayContaining(keptDiffersLines()));
    expect(lines).toContain("  - Reed the file named in the idea.");
    expect(await readInstalledPacks(repo)).toMatchObject([{ state: "ok", entry: { version: "1.3.0" } }]);
  });

  it.each(["missing", "invalid"])("refuses to update a %s kept copy and names restore", async (state) => {
    if (state === "missing") rmSync(dirPath(), { recursive: true, force: true });
    else writeFileSync(join(dirPath(), "stray.md"), "left behind\n");
    const fetched = source.fetched.length;
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain("Put them back first: delivery packs restore docs-drift");
    expect(source.fetched.length).toBe(fetched);
  });

  it("names the added packs when the name is not one", async () => {
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("nope", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain(flat(notAddedLines("nope", ["docs-drift"]).join("\n")));
  });

  it("lets an unreachable npm refuse as an update, changing nothing", async () => {
    source.unreachable();
    const before = tree(repo);
    const { ctx } = context(repo);
    const failure = packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source);
    await expect(failure).rejects.toBeInstanceOf(PackSourceUnavailable);
    await expect(failure).rejects.toMatchObject({ attempt: "update" });
    expect(tree(repo)).toEqual(before);
  });

  it("refuses while another added pack is unusable, naming it", async () => {
    const other = fakePackSource();
    other.publish("@acme/delivery-pack-sweep", "1.0.0", packPackage({ name: "docs-sweep", packageName: "@acme/delivery-pack-sweep", version: "1.0.0" }));
    expect(await packsAddCommand("@acme/delivery-pack-sweep", context(repo).ctx, scriptedAsk({ confirm: true }).ask, other)).toBe(EXIT.ok);
    rmSync(join(repo, ".delivery", "packs", "docs-sweep", "scan.md"));
    const { ctx } = context(repo);
    await expect(packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).rejects.toBeInstanceOf(InstalledPackRefused);
  });

  it("keeps its own lines within 60 columns, with no colour and no reassuring words", async () => {
    const { ctx, lines } = context(repo);
    await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: false }).ask, source);
    const block = lines.indexOf("Changed lines");
    const own = [...lines.slice(0, block), lines.at(-1) ?? ""];
    for (const line of own) {
      expect(line.length).toBeLessThanOrEqual(60);
      expect(line).not.toContain("\u001b");
    }
    const text = own.join("\n");
    expect(text).not.toMatch(REASSURING);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("leaves no temporary folder behind", async () => {
    await withPrivateTmpdir(async (scratch) => {
      await packsUpdateCommand("docs-drift", undefined, context(repo).ctx, scriptedAsk({ confirm: false }).ask, source);
      await packsUpdateCommand("docs-drift", undefined, context(repo).ctx, scriptedAsk({ confirm: true }).ask, source);
      expect(tempFolders(scratch)).toEqual([]);
    });
  });

  it("is a subcommand of delivery packs, refusing an unknown name with the added packs named", async () => {
    const result = await delivery(["packs", "update", "nope"], { cwd: repo });
    expect(result.exitCode).toBe(EXIT.configuration);
    expect(result.stdout).toContain("nope is not an added pack.");
  });

  it("refuses a new version in a newer format with the upgrade sentence, the record byte for byte", async () => {
    source.publish(NAME, "1.3.0", packPackage({ version: "1.3.0", manifest: { schema: "delivery.pack/4" } }));
    const lockBefore = readFileSync(lockPath());
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain(newerFormat("delivery.pack/4"));
    expect(readFileSync(lockPath())).toEqual(lockBefore);
    expect(tree(repo)).toEqual(before);
  });

  it("refuses to update a kept pack in a newer format, saying to upgrade", async () => {
    await addedDocsDrift(repo, V1);
    const manifestFile = join(dirPath(), "pack.json");
    writeFileSync(manifestFile, readFileSync(manifestFile, "utf-8").replace("delivery.pack/3", "delivery.pack/4"));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(lines).toEqual(notUpdatableLines("docs-drift", "newer-format"));
    expect(tree(repo)).toEqual(before);
  });

  it("refuses with nobody to ask, naming the update command as typed", async () => {
    source.publish(NAME, "1.3.0", V2, { tags: ["^1.0.0"] });
    const before = tree(repo);
    const { ctx, lines } = context(repo, { interactive: false });
    expect(await packsUpdateCommand("docs-drift", "^1.0.0", ctx, scriptedAsk({ confirm: true }).ask, source)).toBe(EXIT.configuration);
    expect(lines.slice(-9)).toEqual(nobodyToAsk("update", "delivery packs update docs-drift ^1.0.0", newHash));
    expect(tree(repo)).toEqual(before);
  });

  it("names the update command with no request when none was typed, and quotes a range a shell would read", async () => {
    const plain = context(repo, { interactive: false });
    expect(await packsUpdateCommand("docs-drift", undefined, plain.ctx, scriptedAsk().ask, source)).toBe(EXIT.configuration);
    expect(plain.lines.slice(-9)).toEqual(nobodyToAsk("update", "delivery packs update docs-drift", newHash));

    source.publish(NAME, "1.3.0", V2, { tags: [">=1.0.0"] });
    const ranged = context(repo, { interactive: false });
    expect(await packsUpdateCommand("docs-drift", ">=1.0.0", ranged.ctx, scriptedAsk().ask, source)).toBe(EXIT.configuration);
    expect(ranged.lines.slice(-9)).toEqual(nobodyToAsk("update", "delivery packs update docs-drift '>=1.0.0'", newHash));
  });

  it("leaves the recorded request alone when the printed command is followed", async () => {
    const refused = context(repo, { interactive: false });
    expect(await packsUpdateCommand("docs-drift", undefined, refused.ctx, scriptedAsk().ask, source)).toBe(EXIT.configuration);
    const at = refused.lines.findIndex((line) => line.startsWith("    delivery packs update"));
    const printed = refused.lines
      .slice(at, at + 3)
      .join("\n")
      .replace(/\\\n/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const match = /^delivery packs update (\S+)(?: (\S+))? --approve ([0-9a-f]{64})$/.exec(printed);
    if (match === null) throw new Error(`the refusal printed no runnable command: ${printed}`);
    const [, typed, request, approve] = match;
    if (typed === undefined || approve === undefined) throw new Error("the printed command must name the pack and the fingerprint");
    expect(approve).toBe(newHash);
    expect(await packsUpdateCommand(typed, request, context(repo, { interactive: false }).ctx, scriptedAsk().ask, source, { approve })).toBe(EXIT.ok);
    expect(await readLock(repo)).toMatchObject({ packs: { "docs-drift": { version: "1.3.0", request: "latest" } } });

    source.publish(NAME, "1.4.0", packPackage({ version: "1.4.0", manifest: { workflows: V2_WORKFLOWS }, extra: { "audit.md": "Audit.\nThrice.\n" } }));
    const update = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, update.ctx, scriptedAsk({ confirm: false }).ask, source)).toBe(EXIT.ok);
    expect(update.lines.join("\n")).not.toContain("is up to date");
    expect(flat(update.lines.join("\n"))).toContain("1.4.0");
  });

  it("updates with the new version's fingerprint, asking nothing", async () => {
    const { ctx, lines } = context(repo, { interactive: false });
    const { ask, asked } = scriptedAsk();
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, ask, source, { approve: newHash })).toBe(EXIT.ok);
    expect(lines.slice(-updatedLines("docs-drift", "1.3.0").length)).toEqual(updatedLines("docs-drift", "1.3.0"));
    expect(asked).toEqual([]);
    const entry = (await readLock(repo)).packs["docs-drift"];
    expect(entry).toMatchObject({ version: "1.3.0" });
    expect(entry?.approved).toBe(PACK_HASH_LABEL + newHash);
  });

  it("refuses the old version's fingerprint as different, the record unchanged", async () => {
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk().ask, source, { approve: oldHash })).toBe(EXIT.configuration);
    expect(lines.slice(-fingerprintDiffers("update").length)).toEqual(fingerprintDiffers("update"));
    expect(tree(repo)).toEqual(before);
  });

  it("refuses a fingerprint read before a newer version appeared, the record unchanged", async () => {
    source.publish(NAME, "1.3.0", V2, { tags: ["^1.0.0"] });
    const first = context(repo, { interactive: false });
    expect(await packsUpdateCommand("docs-drift", "^1.0.0", first.ctx, scriptedAsk().ask, source)).toBe(EXIT.configuration);

    source.publish(NAME, "1.4.0", packPackage({ version: "1.4.0", manifest: { workflows: V2_WORKFLOWS }, extra: { "audit.md": "Audit.\nThrice.\n" } }), {
      tags: ["^1.0.0"],
    });
    const before = tree(repo);
    const second = context(repo);
    expect(await packsUpdateCommand("docs-drift", "^1.0.0", second.ctx, scriptedAsk().ask, source, { approve: newHash })).toBe(EXIT.configuration);
    expect(second.lines.slice(-fingerprintDiffers("update").length)).toEqual(fingerprintDiffers("update"));
    expect(tree(repo)).toEqual(before);
  });

  it("gives the change as an update document under --json", async () => {
    const { before, after, diffs } = await judged(repo, V2);
    const { ctx, lines } = context(repo, { json: true });
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk().ask, source)).toBe(EXIT.configuration);
    expect(lines).toHaveLength(1);
    const doc = PackDecision.parse(JSON.parse(lines[0] ?? ""));
    expect(doc).toMatchObject({
      command: "update",
      outcome: "needs-approval",
      pack: "docs-drift",
      package: { version: "1.3.0" },
      previous: { version: "1.2.0", fingerprint: oldHash },
      fingerprint: newHash,
    });
    expect(doc.account?.pack.source.path).toBe(".delivery/packs/docs-drift"); // relative to the repository
    expect(lines[0]).not.toContain(repo);
    expect(lines[0]).not.toContain(tmpdir());
    expect(doc.changes).toEqual(comparePacks(before, after));
    expect(doc.files).toEqual(diffs); // every file diffPackFiles gives, unchanged ones too, as filesLines lists them
    expect(doc.files?.find(({ path }) => path === "audit.md")?.status).toBe("added");
  });

  it("says unchanged under --json when npm has nothing newer", async () => {
    const repo2 = initTempRepo("update-pack-", { "package.json": PACKAGE });
    const same = await addedDocsDrift(repo2, V1);
    const { ctx, lines } = context(repo2, { json: true });
    expect(await packsUpdateCommand("docs-drift", undefined, ctx, scriptedAsk().ask, same)).toBe(EXIT.ok);
    expect(lines).toHaveLength(1);
    expect(PackDecision.parse(JSON.parse(lines[0] ?? ""))).toMatchObject({ outcome: "unchanged", changes: null });
  });

  it("gives a refused document under --json for a name that is not added", async () => {
    const { ctx, lines } = context(repo, { json: true });
    expect(await packsUpdateCommand("nope", undefined, ctx, scriptedAsk().ask, source)).toBe(EXIT.configuration);
    expect(lines).toHaveLength(1);
    const doc = PackDecision.parse(JSON.parse(lines[0] ?? ""));
    expect(doc.outcome).toBe("refused");
    expect(doc.message).toContain("is not an added pack");
  });
});
