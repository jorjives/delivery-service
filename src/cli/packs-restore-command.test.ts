import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { PackSourceUnavailable } from "../errors.js";
import { readInstalledPacks } from "../packs/install/installed.js";
import { packPackage } from "../packs/install/install-fixtures.js";
import { sriOf } from "../packs/install/pack-source.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { PACKAGE, writeNeedyPack } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { addedDocsDrift, tree } from "./installed-fixtures.js";
import { context } from "./init-fixtures.js";
import { packsRestoreCommand } from "./packs-restore-command.js";

const NAME = "@acme/delivery-pack-docs";

/** The text with every run of white space made one space: where a line wraps does not matter. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("delivery packs restore", () => {
  let repo: string;
  const scanPath = (): string => join(repo, ".delivery", "packs", "docs-drift", "scan.md");
  const dirPath = (): string => join(repo, ".delivery", "packs", "docs-drift");
  const lockPath = (): string => join(repo, ".delivery", "packs.lock.json");

  /** Edit the kept scan instructions, so the folder no longer matches the record. */
  const editScan = (): void => writeFileSync(scanPath(), readFileSync(scanPath(), "utf-8").replace("Read", "Reed"));

  beforeEach(() => {
    repo = initTempRepo("restore-pack-", { "package.json": PACKAGE });
  });

  it("puts back a changed pack at the recorded version, and it runs as approved", async () => {
    const source = await addedDocsDrift(repo);
    editScan();
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.ok);
    expect(lines.at(-1)).toBe("It matches the record. Replaced .delivery/packs/docs-drift.");
    expect(source.fetched.at(-1)).toEqual({ name: NAME, request: "1.2.0", typed: true });
    expect(await readInstalledPacks(repo)).toMatchObject([{ state: "ok" }]);
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it.each<[string, () => void]>([
    ["a deleted file is put back", () => rmSync(scanPath())],
    ["a stray file is removed", () => writeFileSync(join(dirPath(), "stray.md"), "left behind\n")],
    ["a missing folder is put back", () => rmSync(dirPath(), { recursive: true, force: true })],
  ])("%s, and the pack ends as approved", async (_, damage) => {
    const source = await addedDocsDrift(repo);
    damage();
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.ok);
    expect(lines.at(-1)).toBe("It matches the record. Replaced .delivery/packs/docs-drift.");
    expect(await readInstalledPacks(repo)).toMatchObject([{ state: "ok" }]);
  });

  it("still works when a pack the project uses has a required setting with no value", async () => {
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ packs: ["needy-pack"] }));
    writeNeedyPack(repo);
    const source = await addedDocsDrift(repo);
    editScan();
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.ok);
    expect(lines.at(-1)).toBe("It matches the record. Replaced .delivery/packs/docs-drift.");
    expect(await readInstalledPacks(repo)).toMatchObject([{ state: "ok" }]);
  });

  it("fetches the recorded version even when a newer one is published", async () => {
    const source = await addedDocsDrift(repo);
    source.publish(NAME, "1.3.0", packPackage({ extra: { "README.md": "newer\n" } }));
    editScan();
    const { ctx } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.ok);
    expect(source.fetched.at(-1)).toEqual({ name: NAME, request: "1.2.0", typed: true });
  });

  it("refuses, changing nothing, when npm now serves different contents for the recorded version", async () => {
    const source = await addedDocsDrift(repo);
    source.publish(NAME, "1.2.0", packPackage({ extra: { "README.md": "new\n" } }));
    editScan();
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain("Not restored: npm now serves different contents for @acme/delivery-pack-docs 1.2.0.");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    expect(tree(repo)).toEqual(before);
  });

  it("refuses, changing nothing, when the package npm serves is not the pack in the record", async () => {
    const source = await addedDocsDrift(repo);
    const lock = JSON.parse(readFileSync(lockPath(), "utf-8")) as { packs: Record<string, { fingerprint: string }> };
    const entry = lock.packs["docs-drift"];
    if (entry === undefined) throw new Error("the fixture pack is not in the record");
    entry.fingerprint = "delivery.pack-hash/1:" + "c".repeat(64);
    writeFileSync(lockPath(), JSON.stringify(lock, null, 2));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain(
      "Not restored: @acme/delivery-pack-docs 1.2.0 is the package you added, but this delivery-service does not read it as the pack in the record.",
    );
    expect(flat(lines.join("\n"))).toContain("The folder is unchanged.");
    expect(tree(repo)).toEqual(before);
  });

  it("names the added packs for a name that is not added", async () => {
    const source = await addedDocsDrift(repo);
    const fetchedBefore = source.fetched.length;
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("nope", ctx, source)).toBe(EXIT.configuration);
    expect(lines).toEqual(["nope is not an added pack. Added: docs-drift."]);
    expect(source.fetched.length).toBe(fetchedBefore);
  });

  it("says Not restored when npm cannot be reached, changing nothing", async () => {
    const source = await addedDocsDrift(repo);
    source.unreachable();
    const before = tree(repo);
    const { ctx } = context(repo);
    const error: unknown = await packsRestoreCommand("docs-drift", ctx, source).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(PackSourceUnavailable);
    expect(error).toMatchObject({ reason: "unreachable", attempt: "restore" });
    expect(tree(repo)).toEqual(before);
  });

  it("says a pack that is restored but not approved, and names the command that approves it", async () => {
    const source = await addedDocsDrift(repo);
    const lock = JSON.parse(readFileSync(lockPath(), "utf-8")) as { packs: Record<string, { approved: string }> };
    const entry = lock.packs["docs-drift"];
    if (entry === undefined) throw new Error("the fixture pack is not in the record");
    entry.approved = "delivery.pack-hash/1:" + "b".repeat(64);
    writeFileSync(lockPath(), JSON.stringify(lock, null, 2));
    editScan();
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.ok);
    expect(flat(lines.join("\n"))).toContain("The record says docs-drift has not been approved. To read it and decide: delivery packs approve docs-drift");
    expect(await readInstalledPacks(repo)).toMatchObject([{ state: "unapproved" }]);
  });

  it("keeps its own lines within 60 columns, with no reassuring or forbidden words", async () => {
    const source = await addedDocsDrift(repo);
    editScan();
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.ok);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    const text = lines.join("\n");
    expect(text).not.toMatch(REASSURING);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("refuses to restore when npm serves the recorded version in a newer format, the record unchanged", async () => {
    const source = await addedDocsDrift(repo);
    const tarball = packPackage({ manifest: { schema: "delivery.pack/4" } });
    source.publish(NAME, "1.2.0", tarball);
    const lock = JSON.parse(readFileSync(lockPath(), "utf-8")) as { packs: Record<string, { integrity: string }> };
    const entry = lock.packs["docs-drift"];
    if (entry === undefined) throw new Error("the fixture pack is not in the record");
    entry.integrity = sriOf(tarball);
    writeFileSync(lockPath(), JSON.stringify(lock, null, 2));
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo);
    expect(await packsRestoreCommand("docs-drift", ctx, source)).toBe(EXIT.configuration);
    expect(flat(lines.join("\n"))).toContain("upgrade delivery-service");
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

});
