// Slice 3: Clashes reported plainly, and taking a pack out
// Source: docs/superpowers/specs/2026-10-24-install-a-pack-from-elsewhere-slices.md
// Recorded: 2026-10-24 against commit 148745c
//
// Drives the compiled `delivery` as a real subprocess against a real `npm` talking only to a throwaway local
// registry (tests/local-registry.ts), in throwaway git repositories. Adds go through a pseudo-terminal (pty.py,
// as in slice 1). Asserts on stable phrases, exit codes and files on disk, not full-output equality.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedOut } from "../../src/mock-session.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { packPackage } from "../../src/packs/install/install-fixtures.js";
import { PACKAGE } from "../../src/cli/command-fixtures.js";
import { DELIVERY_BIN, git } from "../helpers.js";
import { startLocalRegistry, type LocalRegistry } from "../local-registry.js";

const FIRST = "@acme/delivery-pack-docs";
const SECOND = "@other/delivery-pack-docs";
const PTY = join(import.meta.dirname, "pty.py");
const LOCK = ".delivery/packs.lock.json";
const FOLDER = ".delivery/packs/docs-drift";

interface Run {
  status: number | null;
  output: string;
}

let registry: LocalRegistry;
let env: NodeJS.ProcessEnv;
const scratch = mkdtempSync(join(tmpdir(), "uat-clash-"));

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

function run(command: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("close", (status) => resolve({ status, output }));
  });
}

const delivery = (args: string[], cwd: string): Promise<Run> => run(process.execPath, [DELIVERY_BIN, ...args], cwd);
const deliveryAnswering = (keys: string, args: string[], cwd: string): Promise<Run> =>
  run("python3", ["-I", PTY, cwd, keys, process.execPath, DELIVERY_BIN, ...args], cwd);

const ESCAPES = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g");
const flat = (text: string): string => text.replace(ESCAPES, "").replace(/\r/g, "").replace(/\s+/g, " ");
const freshProject = (): string => initTempRepo("uat-clash-project-", { "package.json": PACKAGE, "a.js": "x\n" });
const state = (repo: string): string => git(repo, ["status", "--porcelain", "--untracked-files=all"]);
const commitAll = (repo: string): void => {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "snapshot"]);
};
const withFirst = async (): Promise<string> => {
  const project = freshProject();
  await deliveryAnswering("y\r", ["packs", "add", FIRST], project);
  commitAll(project);
  return project;
};
const rows = (output: string): string[] => output.split("\n").filter((line) => line.includes("docs-drift") || line.includes("other-pack"));

beforeAll(async () => {
  registry = await startLocalRegistry();
  env = npmEnv(registry.url);
  registry.publish(FIRST, "1.2.0", packPackage());
  // A second author's pack that uses the same pack name, so the same workflow names.
  registry.publish(SECOND, "3.0.0", packPackage({ packageName: SECOND, version: "3.0.0" }));
  registry.publish("@other/delivery-pack-other", "1.0.0", packPackage({ name: "other-pack", packageName: "@other/delivery-pack-other", version: "1.0.0" }));
  registry.publish("@other/code-pack", "1.0.0", packPackage({ name: "code", packageName: "@other/code-pack", version: "1.0.0" }));
});

afterAll(async () => {
  await registry.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("UAT: a clash is refused, the first pack is removed, the second adds", () => {
  let project: string;
  let refusal: Run;
  let removal: Run;

  it("refuses the second pack with both packs named and nothing changed", async () => {
    project = await withFirst();
    refusal = await deliveryAnswering("y\r", ["packs", "add", SECOND], project);
    const text = flat(refusal.output);
    expect(refusal.status).not.toBe(0);
    expect(text).toContain("Not added");
    expect(text).toContain(FIRST);
    expect(text).toContain(SECOND);
    expect(text).toContain("Nothing was changed.");
    expect(state(project)).toBe("");
  });

  it("suggests removing the first pack as the one action", () => {
    expect(flat(refusal.output)).toContain("delivery packs remove docs-drift");
  });

  it("removes the first pack, naming the workflows that stop existing", async () => {
    removal = await delivery(["packs", "remove", "docs-drift"], project);
    const text = flat(removal.output);
    expect(removal.status).toBe(0);
    expect(text).toContain("These workflows will stop existing");
    expect(text).toContain("scan");
    expect(text).toContain("code");
    expect(text).toContain("Removed docs-drift.");
    expect(existsSync(join(project, FOLDER))).toBe(false);
  });

  it("then adds the second pack and the list shows only it", async () => {
    const added = await deliveryAnswering("y\r", ["packs", "add", SECOND], project);
    expect(added.status).toBe(0);
    const list = await delivery(["packs"], project);
    const text = flat(list.output);
    expect(list.status).toBe(0);
    expect(text).toContain("3.0.0");
    expect(text).not.toContain("1.2.0");
    expect(JSON.parse(readFileSync(join(project, LOCK), "utf-8")) as unknown).toBeTruthy();
    expect(readFileSync(join(project, LOCK), "utf-8")).toContain(SECOND);
    expect(readFileSync(join(project, LOCK), "utf-8")).not.toContain(FIRST);
  });
});

describe("AC: clashes are refused before anything is written", () => {
  it("refuses a pack named like a built-in pack, asking the authors to rename it", async () => {
    const project = freshProject();
    const result = await deliveryAnswering("y\r", ["packs", "add", "@other/code-pack"], project);
    const text = flat(result.output);
    expect(result.status).not.toBe(0);
    expect(text).toContain("Not added");
    expect(text).toContain("a pack that comes with the harness");
    expect(text).toContain("ask the authors of the new pack to rename it");
    expect(state(project)).toBe("");
  });

  it("refuses a pack named like a listed folder pack, naming the folder's manifest", async () => {
    // The folder pack is a copy of a pack added to a donor project, so it is a valid pack.
    const donor = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", FIRST], donor);
    const project = freshProject();
    cpSync(join(donor, FOLDER), join(project, "local"), { recursive: true });
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify({ packs: ["local"] }));
    commitAll(project);
    const result = await deliveryAnswering("y\r", ["packs", "add", SECOND], project);
    const text = flat(result.output);
    expect(result.status).not.toBe(0);
    expect(text).toContain("Not added");
    expect(text).toContain("local/pack.json");
    expect(text).toContain(SECOND);
    expect(state(project)).toBe("");
  });
});

describe("AC: removing a pack", () => {
  it("is refused, changing nothing, while the configuration names one of its workflows", async () => {
    const project = await withFirst();
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify({ tasks: [{ intent: "Move calls", workflow: "docs-drift:code" }] }));
    commitAll(project);
    const result = await delivery(["packs", "remove", "docs-drift"], project);
    const text = flat(result.output);
    expect(result.status).not.toBe(0);
    expect(text).toContain("Not removed: delivery.config.json still names its workflows.");
    expect(text).toContain("docs-drift:code");
    expect(text).toContain("Nothing was changed.");
    expect(state(project)).toBe("");
    expect(existsSync(join(project, FOLDER, "pack.json"))).toBe(true);
  });

  it("is not blocked by a workflow of a pack whose name only begins the same way", async () => {
    const project = await withFirst();
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify({ tasks: [{ intent: "x", workflow: "docs-drift-old:scan" }] }));
    commitAll(project);
    const result = await delivery(["packs", "remove", "docs-drift"], project);
    expect(result.status).toBe(0);
    expect(existsSync(join(project, FOLDER))).toBe(false);
  });

  it("deletes the kept files and the record entry, leaving the other packs alone", async () => {
    const project = await withFirst();
    await deliveryAnswering("y\r", ["packs", "add", "@other/delivery-pack-other"], project);
    commitAll(project);
    const result = await delivery(["packs", "remove", "docs-drift"], project);
    const text = flat(result.output);
    expect(result.status).toBe(0);
    expect(text).toContain("Commit both");
    expect(existsSync(join(project, FOLDER))).toBe(false);
    const lock = readFileSync(join(project, LOCK), "utf-8");
    expect(lock).not.toContain(FIRST);
    expect(lock).toContain("other-pack");
    expect(existsSync(join(project, ".delivery/packs/other-pack/pack.json"))).toBe(true);
    const list = await delivery(["packs"], project);
    expect(rows(list.output).join("\n")).toContain("other-pack");
    expect(rows(list.output).join("\n")).not.toContain("docs-drift");
  });

  it("names the packs that are installed when the pack is not", async () => {
    const project = await withFirst();
    const result = await delivery(["packs", "remove", "nope"], project);
    const text = flat(result.output);
    expect(result.status).not.toBe(0);
    expect(text).toContain("nope");
    expect(text).toContain("docs-drift");
    expect(state(project)).toBe("");
  });
});

describe("AC: a clash that appears later is reported when the packs load", () => {
  it("names both sides when a folder pack comes to share an added pack's name", async () => {
    const project = await withFirst();
    mkdirSync(join(project, "local"));
    const added = readFileSync(join(project, FOLDER, "pack.json"), "utf-8");
    writeFileSync(join(project, "local", "pack.json"), added);
    for (const file of ["scan.md", "code.md"]) writeFileSync(join(project, "local", file), readFileSync(join(project, FOLDER, file), "utf-8"));
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify({ packs: ["local"] }));
    const list = await delivery(["packs"], project);
    const text = flat(list.output);
    expect(list.status).not.toBe(0);
    expect(text).toContain("docs-drift");
    expect(text).toContain("local/pack.json");
  });
});
