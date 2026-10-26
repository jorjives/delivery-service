import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { git } from "../git-exec.js";
import { readJournal, promptsSent } from "../mock-script.js";
import { SCAN_TEXT, packPackage } from "../packs/install/install-fixtures.js";
import type { FakePackSource } from "../packs/install/fake-source.js";
import { initTempRepo } from "../temp-repo.js";
import { TEST_MOCK_SCRIPT } from "./agent-session.js";
import { completes, delivery, movesProject, PACKAGE, scriptFile } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { addedDocsDrift } from "./installed-fixtures.js";

/** The text with every run of white space made one space: where a line wraps does not matter. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

const LOCK = ".delivery/packs.lock.json";
const PACK = ".delivery/packs/docs-drift";

describe("an added pack, loaded by every command that uses packs", () => {
  let repo: string;
  let source: FakePackSource;

  beforeEach(async () => {
    repo = initTempRepo("installed-load-", { "package.json": PACKAGE });
    source = await addedDocsDrift(repo);
  });

  it("refuses a changed pack before anything is sent to an agent, naming the pack, its state and the file", async () => {
    const scan = join(repo, PACK, "scan.md");
    writeFileSync(scan, readFileSync(scan, "utf-8").replace("Read", "Reed"));
    const script = await scriptFile(completes);
    const run = await delivery(["review", "docs-drift"], { cwd: repo, env: { [TEST_MOCK_SCRIPT]: script } });
    expect(run.exitCode).toBe(EXIT.configuration);
    const text = flat(run.stderr);
    expect(text).toContain("The pack docs-drift is not as you approved it.");
    expect(text).toContain(`Changed: ${PACK}/scan.md`);
    expect(text).toContain("Nothing was sent to an agent.");
    expect(text).toContain("delivery packs restore docs-drift");
    expect(promptsSent(await readJournal(`${script}.journal.jsonl`))).toEqual([]);
  });

  it.each<[string, (repo: string) => void, string[]]>([
    ["a deleted instruction file", (dir) => rmSync(join(dir, PACK, "code.md")), [`${PACK}/code.md`, "delivery packs restore docs-drift"]],
    ["a stray file", (dir) => writeFileSync(join(dir, PACK, "notes.txt"), "stray\n"), [`${PACK}/notes.txt`, "delivery packs restore docs-drift"]],
    ["a removed folder", (dir) => rmSync(join(dir, PACK), { recursive: true }), ["its files are missing", "delivery packs restore docs-drift"]],
    [
      "an approved fingerprint edited in the record",
      (dir) => {
        const lock = JSON.parse(readFileSync(join(dir, LOCK), "utf-8")) as { packs: Record<string, { fingerprint: string; approved: string }> };
        const entry = lock.packs["docs-drift"];
        if (entry === undefined) throw new Error("the fixture record has no docs-drift entry");
        entry.approved = entry.fingerprint.replace(/.$/, (last) => (last === "0" ? "1" : "0"));
        writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2));
      },
      ["delivery packs approve docs-drift"],
    ],
  ])("refuses %s with --preview, naming it and the one command that fixes it", async (_, damage, expected) => {
    damage(repo);
    const preview = await delivery(["review", "docs-drift", "--preview"], { cwd: repo });
    expect(preview.exitCode).toBe(EXIT.configuration);
    const text = flat(preview.stderr);
    expect(text).toContain("Nothing was sent to an agent.");
    for (const fragment of expected) expect(text).toContain(fragment);
  });

  it("refuses a kept folder with no record entry, and not a leftover staging folder", async () => {
    const lockBytes = readFileSync(join(repo, LOCK));
    const lock = JSON.parse(lockBytes.toString("utf-8")) as { packs: Record<string, unknown> };
    delete lock.packs["docs-drift"];
    writeFileSync(join(repo, LOCK), JSON.stringify(lock, null, 2));

    const refused = await delivery(["review", "docs-drift", "--preview"], { cwd: repo });
    expect(refused.exitCode).toBe(EXIT.configuration);
    expect(flat(refused.stderr)).toContain(PACK);

    writeFileSync(join(repo, LOCK), lockBytes);
    const staging = join(repo, ".delivery", "packs", ".staging", "abc");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "pack.json"), "{}");
    expect((await delivery(["review", "docs-drift", "--preview"], { cwd: repo })).exitCode).toBe(EXIT.ok);
  });

  it("runs a fresh clone with no npm, as approved", async () => {
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "add docs-drift"]);
    const clone = join(tmpdir(), `installed-clone-${Date.now()}`);
    await git(tmpdir(), ["clone", repo, clone]);
    const preview = await delivery(["review", "docs-drift", "--preview"], {
      cwd: clone,
      env: { DELIVERY_NPM: join(tmpdir(), "no-npm", "npm") },
    });
    expect(preview.exitCode).toBe(EXIT.ok);
    expect(preview.stdout).toContain(SCAN_TEXT.slice(0, SCAN_TEXT.indexOf("\n")));
    const listed = await delivery(["packs"], { cwd: clone, env: { DELIVERY_NPM: join(tmpdir(), "no-npm", "npm") } });
    expect(listed.exitCode).toBe(EXIT.ok);
    const row = listed.stdout.split("\n").find((line) => line.includes("docs-drift"));
    expect(row).toContain("As approved.");
  });

  it("runs the recorded version when a newer one is published", async () => {
    const lockBefore = readFileSync(join(repo, LOCK));
    source.publish("@acme/delivery-pack-docs", "1.3.0", packPackage({ version: "1.3.0", extra: { "scan.md": "A different scan.\n" } }));
    const preview = await delivery(["review", "docs-drift", "--preview"], { cwd: repo });
    expect(preview.exitCode).toBe(EXIT.ok);
    expect(preview.stdout).toContain(SCAN_TEXT.slice(0, SCAN_TEXT.indexOf("\n")));
    expect(readFileSync(join(repo, LOCK))).toEqual(lockBefore);
  });

  it("loads a folder-pack project exactly as before", async () => {
    const folderRepo = movesProject();
    const listed = await delivery(["packs"], { cwd: folderRepo });
    expect(listed.stdout).toContain("  moves");
    expect(listed.stdout).toContain("Start it with: delivery review moves");
    expect((await delivery(["validate"], { cwd: folderRepo })).exitCode).toBe(EXIT.ok);
    expect(existsSync(join(folderRepo, ".delivery", "packs"))).toBe(false);
  });

  it("refuses inspect of a changed pack with the changed refusal", async () => {
    const scan = join(repo, PACK, "scan.md");
    writeFileSync(scan, readFileSync(scan, "utf-8").replace("Read", "Reed"));
    const inspected = await delivery(["packs", "inspect", "docs-drift"], { cwd: repo });
    expect(inspected.exitCode).toBe(EXIT.configuration);
    expect(flat(inspected.stderr)).toContain("The pack docs-drift is not as you approved it.");
  });
});
