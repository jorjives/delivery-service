import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readLock } from "../packs/install/lock.js";
import { loadPack } from "../packs/manifest.js";
import { SCAN_TEXT } from "../packs/install/install-fixtures.js";
import { FORBIDDEN, REASSURING } from "../report/report-fixtures.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, PACKAGE, writeNeedyPack } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { addedDocsDrift, tree } from "./installed-fixtures.js";
import { INSPECT_RULE } from "./packs-inspect-render.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { PackDecision } from "./pack-decision.js";
import { packsApproveCommand } from "./packs-approve-command.js";
import { newerFormatLines, notApprovableLines } from "./packs-approve-render.js";
import { fingerprintDiffers, nobodyToAsk } from "./packs-add-render.js";

/** The text with every run of white space made one space: where a line wraps does not matter. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/** The lines outside each pair of rules: the command's own words, not the account shown between the rules. */
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

describe("delivery packs approve", () => {
  let repo: string;
  const scanPath = (): string => join(repo, ".delivery", "packs", "docs-drift", "scan.md");
  const dirPath = (): string => join(repo, ".delivery", "packs", "docs-drift");
  const lockPath = (): string => join(repo, ".delivery", "packs.lock.json");

  /** Edit the kept scan instructions, so the folder no longer matches the record. */
  const editScan = (): void => writeFileSync(scanPath(), readFileSync(scanPath(), "utf-8").replace("Read", "Reed"));

  /** Set the record's approved fingerprint for docs-drift, so the pack reads as added but not approved. */
  const unapprove = (): void => {
    const lock = JSON.parse(readFileSync(lockPath(), "utf-8")) as { packs: Record<string, { approved: string }> };
    const entry = lock.packs["docs-drift"];
    if (entry === undefined) throw new Error("the fixture pack is not in the record");
    entry.approved = "delivery.pack-hash/1:" + "b".repeat(64);
    writeFileSync(lockPath(), JSON.stringify(lock, null, 2));
  };

  beforeEach(() => {
    repo = initTempRepo("approve-pack-", { "package.json": PACKAGE });
  });

  it("approves an unapproved pack after showing its full account", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask)).toBe(EXIT.ok);
    const text = flat(lines.join("\n"));
    expect(text).toContain("The record says docs-drift has not been approved. Read it before you answer.");
    expect(text).toContain("In short");
    expect(text).toContain(flat(SCAN_TEXT.slice(0, SCAN_TEXT.indexOf("\n"))));
    expect(asked).toEqual([{ message: "Approve docs-drift at this fingerprint?", default: false }]);
    const entry = (await readLock(repo)).packs["docs-drift"];
    expect(entry?.approved).toBe(entry?.fingerprint);
    expect(lockBefore).not.toEqual(readFileSync(lockPath()));
    expect(lines.slice(-3)).toEqual([
      "Approved docs-drift 1.2.0.",
      "  Recorded: .delivery/packs.lock.json",
      "Commit it, so everyone runs this same pack.",
    ]);
    expect((await delivery(["review", "docs-drift", "--preview"], { cwd: repo })).exitCode).toBe(EXIT.ok);
  });

  it("still works when a pack the project uses has a required setting with no value", async () => {
    writeFileSync(join(repo, "delivery.config.json"), JSON.stringify({ packs: ["needy-pack"] }));
    writeNeedyPack(repo);
    await addedDocsDrift(repo);
    unapprove();
    const { ctx, lines } = context(repo);
    expect(await packsApproveCommand("docs-drift", ctx, scriptedAsk({ confirm: true }).ask)).toBe(EXIT.ok);
    expect(lines.slice(-3)).toEqual(["Approved docs-drift 1.2.0.", "  Recorded: .delivery/packs.lock.json", "Commit it, so everyone runs this same pack."]);
    const entry = (await readLock(repo)).packs["docs-drift"];
    expect(entry?.approved).toBe(entry?.fingerprint);
  });

  it("changes nothing on no, or with nobody to ask", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const lockBefore = readFileSync(lockPath());

    const { ctx, lines } = context(repo);
    expect(await packsApproveCommand("docs-drift", ctx, scriptedAsk({ confirm: false }).ask)).toBe(EXIT.ok);
    expect(lines.at(-1)).toBe("Nothing was approved.");
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it("shows the account and refuses with nobody to ask, naming the approve command", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const hash = (await loadPack(dirPath())).hash;
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo, { interactive: false });
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask)).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(lines.join("\n")).toContain("In short"); // the account was shown first
    expect(lines.slice(-9)).toEqual(nobodyToAsk("approve", "delivery packs approve docs-drift", hash));
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it("approves with the fingerprint, asking nothing", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const hash = (await loadPack(dirPath())).hash;
    const { ctx } = context(repo, { interactive: false });
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask, { approve: hash })).toBe(EXIT.ok);
    expect(asked).toEqual([]);
    const entry = (await readLock(repo)).packs["docs-drift"];
    expect(entry?.approved).toBe(entry?.fingerprint);
  });

  it("refuses a different fingerprint, the record unchanged", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo, { interactive: false });
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask, { approve: "c".repeat(64) })).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(lines.slice(-fingerprintDiffers("approve").length)).toEqual(fingerprintDiffers("approve"));
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it("gives an approve document under --json", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const hash = (await loadPack(dirPath())).hash;
    const { ctx, lines } = context(repo, { json: true });
    expect(await packsApproveCommand("docs-drift", ctx, scriptedAsk().ask, { approve: hash })).toBe(EXIT.ok);
    expect(lines).toHaveLength(1);
    const doc = PackDecision.parse(JSON.parse(lines[0] ?? ""));
    expect(doc).toMatchObject({ command: "approve", outcome: "approved", pack: "docs-drift", package: { name: "@acme/delivery-pack-docs", version: "1.2.0" }, fingerprint: hash });
    expect(doc.account).not.toBeNull();
  });

  it("says unchanged under --json for an approved pack, and refused for a changed one", async () => {
    await addedDocsDrift(repo);
    const approved = context(repo, { json: true });
    expect(await packsApproveCommand("docs-drift", approved.ctx, scriptedAsk().ask)).toBe(EXIT.ok);
    expect(PackDecision.parse(JSON.parse(approved.lines[0] ?? "")).outcome).toBe("unchanged");

    editScan();
    const changed = context(repo, { json: true });
    expect(await packsApproveCommand("docs-drift", changed.ctx, scriptedAsk().ask)).toBe(EXIT.configuration);
    const doc = PackDecision.parse(JSON.parse(changed.lines[0] ?? ""));
    expect(doc.outcome).toBe("refused");
    expect(doc.message).toBe(notApprovableLines("docs-drift").map((line) => line.trim()).join(" "));
  });

  it("will not approve a pack whose files differ from the record, and says to restore or update it", async () => {
    await addedDocsDrift(repo);
    editScan();
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask)).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(lines).toContain("  To go back:        delivery packs restore docs-drift");
    expect(lines).toContain("  To take a new one:  delivery packs update docs-drift");
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it("will not approve a pack with a stray file in its folder, and says to restore or update it", async () => {
    await addedDocsDrift(repo);
    writeFileSync(join(dirPath(), "stray.md"), "left behind\n");
    const lockBefore = readFileSync(lockPath());
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask)).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    const text = flat(lines.join("\n"));
    expect(text).toContain("delivery packs restore docs-drift");
    expect(text).toContain("delivery packs update docs-drift");
    expect(readFileSync(lockPath())).toEqual(lockBefore);
  });

  it("says to restore a pack whose files are missing", async () => {
    await addedDocsDrift(repo);
    rmSync(dirPath(), { recursive: true, force: true });
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask)).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(lines).toEqual(["Cannot approve docs-drift: its files are missing.", "  To fetch them again:  delivery packs restore docs-drift"]);
  });

  it("says an approved pack needs nothing", async () => {
    await addedDocsDrift(repo);
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("docs-drift", ctx, ask)).toBe(EXIT.ok);
    expect(asked).toEqual([]);
    expect(lines).toEqual(["docs-drift is already approved at 1.2.0. Nothing to do."]);
  });

  it("names the added packs for a name that is not added", async () => {
    await addedDocsDrift(repo);
    const { ctx, lines } = context(repo);
    const { ask, asked } = scriptedAsk({ confirm: true });
    expect(await packsApproveCommand("nope", ctx, ask)).toBe(EXIT.configuration);
    expect(asked).toEqual([]);
    expect(lines).toEqual(["nope is not an added pack. Added: docs-drift."]);
  });

  it("keeps its own lines within 60 columns, with no reassuring or forbidden words", async () => {
    await addedDocsDrift(repo);
    unapprove();
    const { ctx, lines } = context(repo);
    expect(await packsApproveCommand("docs-drift", ctx, scriptedAsk({ confirm: true }).ask)).toBe(EXIT.ok);
    const outside = linesOutsideRules(lines);
    for (const line of outside) expect(line.length).toBeLessThanOrEqual(60);
    const text = outside.join("\n");
    expect(text).not.toMatch(REASSURING);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("keeps its refusals within 60 columns, with no reassuring or forbidden words", async () => {
    await addedDocsDrift(repo);
    editScan();
    const { ctx, lines } = context(repo);
    expect(await packsApproveCommand("docs-drift", ctx, scriptedAsk({ confirm: true }).ask)).toBe(EXIT.configuration);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    const text = lines.join("\n");
    expect(text).not.toMatch(REASSURING);
    expect(text).not.toMatch(FORBIDDEN);
  });

  it("refuses to approve a kept pack in a newer format, naming the upgrade, the record unchanged", async () => {
    await addedDocsDrift(repo);
    const manifestFile = join(dirPath(), "pack.json");
    writeFileSync(manifestFile, readFileSync(manifestFile, "utf-8").replace("delivery.pack/3", "delivery.pack/4"));
    const before = tree(repo);
    const { ctx, lines } = context(repo);
    expect(await packsApproveCommand("docs-drift", ctx, scriptedAsk({ confirm: true }).ask)).toBe(EXIT.configuration);
    expect(lines).toEqual(newerFormatLines("docs-drift"));
    expect(tree(repo)).toEqual(before);
  });

});
