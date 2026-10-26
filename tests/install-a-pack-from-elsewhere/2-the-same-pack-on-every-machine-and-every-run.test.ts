// Slice 2: The same pack on every machine and every run
// Source: docs/superpowers/specs/2026-10-24-install-a-pack-from-elsewhere-slices.md
// Recorded: 2026-10-24 against commit 8a31ee5
//
// Drives the compiled `delivery` as a real subprocess against a real `npm` talking only to a throwaway local
// registry (tests/local-registry.ts), in throwaway git repositories. The pack is added once through a
// pseudo-terminal (pty.py, as in slice 1) and committed; every case then works from a fresh clone of that
// commit, as a colleague would. Asserts on stable phrases, exit codes and files on disk, not full-output equality.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedOut } from "../../src/mock-session.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { packPackage } from "../../src/packs/install/install-fixtures.js";
import { movesProject, PACKAGE } from "../../src/cli/command-fixtures.js";
import { DELIVERY_BIN, git } from "../helpers.js";
import { startLocalRegistry, type LocalRegistry } from "../local-registry.js";

const NAME = "@acme/delivery-pack-docs";
const PTY = join(import.meta.dirname, "pty.py");
const LOCK = ".delivery/packs.lock.json";
const PACK = ".delivery/packs/docs-drift";
const SCAN_FIRST_LINE = "Read the project and find calls to code it has marked as replaced.";

interface Run {
  status: number | null;
  output: string;
}

let registry: LocalRegistry;
let env: NodeJS.ProcessEnv;
let committed: string;
const scratch = mkdtempSync(join(tmpdir(), "uat-same-pack-"));

function npmEnv(url: string): NodeJS.ProcessEnv {
  const userconfig = join(scratch, "npmrc");
  writeFileSync(userconfig, "");
  return signedOut({
    ...process.env,
    npm_config_registry: url,
    npm_config_cache: join(scratch, "cache"),
    npm_config_userconfig: userconfig,
    npm_config_fetch_retries: "0",
  });
}

function run(command: string, args: string[], cwd: string, runEnv: NodeJS.ProcessEnv = env): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: runEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("close", (status) => resolve({ status, output }));
  });
}

const delivery = (args: string[], cwd: string, runEnv?: NodeJS.ProcessEnv): Promise<Run> => run(process.execPath, [DELIVERY_BIN, ...args], cwd, runEnv);
const deliveryAnswering = (keys: string, args: string[], cwd: string): Promise<Run> =>
  run("python3", ["-I", PTY, cwd, keys, process.execPath, DELIVERY_BIN, ...args], cwd);

const ESCAPES = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g");
const flat = (text: string): string => text.replace(ESCAPES, "").replace(/\r/g, "").replace(/\s+/g, " ");

/** A fresh clone of the committed project: what a colleague has. Each case gets its own. */
function clone(): string {
  const dir = join(mkdtempSync(join(scratch, "clone-")), "project");
  git(scratch, ["clone", "--quiet", committed, dir]);
  return dir;
}

const preview = (cwd: string, runEnv?: NodeJS.ProcessEnv): Promise<Run> => delivery(["review", "docs-drift", "--preview"], cwd, runEnv);
const editScan = (dir: string): void => {
  const path = join(dir, PACK, "scan.md");
  writeFileSync(path, readFileSync(path, "utf-8").replace("Read", "Reed"));
};

beforeAll(async () => {
  registry = await startLocalRegistry();
  env = npmEnv(registry.url);
  registry.publish(NAME, "1.2.0", packPackage());
  // Slice 1's journey, then commit both kept items.
  const owner = initTempRepo("uat-same-pack-owner-", { "package.json": PACKAGE, "a.js": "x\n" });
  await deliveryAnswering("y\r", ["packs", "add", NAME], owner);
  git(owner, ["add", "-A"]);
  git(owner, ["commit", "-m", "add pack"]);
  committed = owner;
});

afterAll(async () => {
  await registry.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("UAT: change a word, be refused, restore, preview, see it as approved", () => {
  const project = (): string => (shared ??= clone());
  let shared: string | undefined;

  it("refuses the run, naming the pack and the file, saying nothing was sent to an agent", async () => {
    editScan(project());
    const refused = await delivery(["review", "docs-drift"], project());
    const text = flat(refused.output);
    expect(refused.status).not.toBe(0);
    expect(text).toContain("The pack docs-drift is not as you approved it.");
    expect(text).toContain(`Changed: ${PACK}/scan.md`);
    expect(text).toContain("Nothing was sent to an agent.");
    expect(text).toContain("delivery packs restore docs-drift");
  });

  it("restores the pack from the recorded version", async () => {
    const restored = await delivery(["packs", "restore", "docs-drift"], project());
    expect(restored.status).toBe(0);
    expect(flat(restored.output)).toContain("It matches the record.");
    expect(readFileSync(join(project(), PACK, "scan.md"), "utf-8")).toContain("Read the project");
  });

  it("previews the workflow again and lists the pack as approved", async () => {
    const shown = await preview(project());
    expect(shown.status).toBe(0);
    expect(flat(shown.output)).toContain(SCAN_FIRST_LINE);
    const list = await delivery(["packs"], project());
    const row = list.output.split("\n").find((line) => line.includes("docs-drift"));
    expect(row).toContain("As approved.");
  });
});

describe("AC: the same pack on a fresh copy, with no network, whatever npm now holds", () => {
  it("runs from a fresh clone with no npm and no registry, and the list says as approved", async () => {
    const dir = clone();
    const offline = { ...env, DELIVERY_NPM: join(scratch, "no-npm", "npm"), npm_config_registry: "http://127.0.0.1:1" };
    const shown = await preview(dir, offline);
    expect(shown.status).toBe(0);
    expect(flat(shown.output)).toContain(SCAN_FIRST_LINE);
    const list = await delivery(["packs"], dir, offline);
    expect(list.output.split("\n").find((line) => line.includes("docs-drift"))).toContain("As approved.");
  });

  it("is not changed by a newer version appearing on npm", async () => {
    registry.publish(NAME, "1.3.0", packPackage({ version: "1.3.0", extra: { "scan.md": "A different scan.\n" } }));
    const dir = clone();
    const lockBefore = readFileSync(join(dir, LOCK));
    const shown = await preview(dir);
    expect(shown.status).toBe(0);
    expect(flat(shown.output)).toContain(SCAN_FIRST_LINE);
    expect(readFileSync(join(dir, LOCK))).toEqual(lockBefore);
  });
});

describe("AC: a pack that is not as approved stops the run, naming the pack, state, file and fix", () => {
  it.each<[string, (dir: string) => void, string[]]>([
    ["a deleted file", (d) => rmSync(join(d, PACK, "code.md")), [`${PACK}/code.md`]],
    ["a stray file", (d) => writeFileSync(join(d, PACK, "notes.txt"), "stray\n"), [`${PACK}/notes.txt`]],
    ["a removed folder", (d) => rmSync(join(d, PACK), { recursive: true }), ["its files are missing"]],
    ["one changed character", editScan, [`${PACK}/scan.md`]],
  ])("refuses %s before anything is sent to an agent, naming the one command that fixes it", async (_, damage, named) => {
    const dir = clone();
    damage(dir);
    const refused = await preview(dir);
    const text = flat(refused.output);
    expect(refused.status).not.toBe(0);
    expect(text).toContain("docs-drift");
    expect(text).toContain("Nothing was sent to an agent.");
    for (const fragment of named) expect(text).toContain(fragment);
    expect(text).toContain("delivery packs restore docs-drift");
  });

  it("refuses a kept pack with no record entry, but not a leftover staging folder", async () => {
    const dir = clone();
    const lockBytes = readFileSync(join(dir, LOCK));
    const lock = JSON.parse(lockBytes.toString("utf-8")) as { packs: Record<string, unknown> };
    delete lock.packs["docs-drift"];
    writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2));
    const refused = await preview(dir);
    expect(refused.status).not.toBe(0);
    expect(flat(refused.output)).toContain(PACK);

    writeFileSync(join(dir, LOCK), lockBytes);
    const staging = join(dir, ".delivery", "packs", ".staging", "abc");
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, "pack.json"), "{}");
    expect((await preview(dir)).status).toBe(0);
  });
});

describe("AC: restoring, approving", () => {
  it("restores the recorded version even when a newer one exists, putting a deleted file back", async () => {
    registry.publish(NAME, "1.3.0", packPackage({ version: "1.3.0", extra: { "scan.md": "A different scan.\n" } }));
    const dir = clone();
    rmSync(join(dir, PACK, "scan.md"));
    const restored = await delivery(["packs", "restore", "docs-drift"], dir);
    expect(restored.status).toBe(0);
    expect(existsSync(join(dir, PACK, "scan.md"))).toBe(true);
    expect(readFileSync(join(dir, PACK, "scan.md"), "utf-8")).toContain("Read the project");
    expect((await preview(dir)).status).toBe(0);
  });

  it("refuses to restore, changing nothing, when npm now serves different contents for that version", async () => {
    registry.publish(NAME, "1.2.0", packPackage({ extra: { "README.md": "swapped\n" } }));
    const dir = clone();
    editScan(dir);
    const before = git(dir, ["status", "--porcelain", "--untracked-files=all"]);
    const scanBefore = readFileSync(join(dir, PACK, "scan.md"));
    const refused = await delivery(["packs", "restore", "docs-drift"], dir);
    expect(refused.status).not.toBe(0);
    expect(flat(refused.output)).toContain("Not restored: npm now serves different contents");
    expect(readFileSync(join(dir, PACK, "scan.md"))).toEqual(scanBefore);
    expect(git(dir, ["status", "--porcelain", "--untracked-files=all"])).toBe(before);
    // Put the registry back to what was accepted for the cases that follow.
    registry.publish(NAME, "1.2.0", packPackage());
  });

  it("will not approve a pack whose files differ from the record, and says to restore or update it", async () => {
    const dir = clone();
    editScan(dir);
    const lockBefore = readFileSync(join(dir, LOCK));
    const refused = await deliveryAnswering("y\r", ["packs", "approve", "docs-drift"], dir);
    const text = flat(refused.output);
    expect(refused.status).not.toBe(0);
    expect(text).toContain("delivery packs restore docs-drift");
    expect(text).toContain("delivery packs update docs-drift");
    expect(readFileSync(join(dir, LOCK))).toEqual(lockBefore);
  });

  it("approves a pack the record says was not approved, after the full account", async () => {
    const dir = clone();
    const lock = JSON.parse(readFileSync(join(dir, LOCK), "utf-8")) as { packs: Record<string, { approved: string }> };
    const entry = lock.packs["docs-drift"];
    if (entry === undefined) throw new Error("the committed record has no docs-drift entry");
    entry.approved = "delivery.pack-hash/1:" + "b".repeat(64);
    writeFileSync(join(dir, LOCK), JSON.stringify(lock, null, 2));
    const refused = await preview(dir);
    expect(refused.status).not.toBe(0);
    expect(flat(refused.output)).toContain("delivery packs approve docs-drift");

    const approved = await deliveryAnswering("y\r", ["packs", "approve", "docs-drift"], dir);
    const text = flat(approved.output);
    expect(approved.status).toBe(0);
    expect(text).toContain("has not been approved. Read it before you answer.");
    expect(text).toContain("In short");
    expect(text).toContain("Approved docs-drift 1.2.0.");
    expect((await preview(dir)).status).toBe(0);
  });
});

describe("AC: a project with only local folder packs behaves as before", () => {
  it("lists and validates a folder pack and creates no .delivery/packs folder", async () => {
    const dir = movesProject();
    const list = await delivery(["packs"], dir);
    expect(list.status).toBe(0);
    expect(flat(list.output)).toContain("moves");
    expect((await delivery(["validate"], dir)).status).toBe(0);
    expect(existsSync(join(dir, ".delivery", "packs"))).toBe(false);
  });
});
