// Slice 5: Adding and updating a pack tells you what to set
// Source: docs/superpowers/specs/2026-10-25-adapt-a-shared-pack-slices.md
// Recorded: 2026-10-26 against commit ed4cc26
//
// Drives the compiled `delivery` as a real subprocess against a real `npm` talking only to a throwaway local
// registry (tests/local-registry.ts), in throwaway git repositories. Adds and updates go through a pseudo-terminal
// (pty.py, as in the install slices). Asserts on stable phrases, exit codes and files on disk, not full-output equality.
//
// SKIPPED AC: a default change that moves the hold is reported with its direction, saying whether it lets more through
//   (covered by the packs-update-render and compare unit tests).
// SKIPPED AC: a new setting, a removed setting and a changed type are reported without being called safe
//   (a wording rule on the safe-change sentence; covered by the packs-update-render unit tests).
// SKIPPED AC: the data output of `add` and `update` carries the setting changes
//   (pinned by the pack-decision published-keys file and its unit tests).
// SKIPPED AC: no command in this slice fetches anything new on a run
//   (a negative about the run path; covered by the install and run unit tests).

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedOut } from "../../src/mock-session.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { packPackage } from "../../src/packs/install/install-fixtures.js";
import { PACKAGE } from "../../src/cli/command-fixtures.js";
import { DELIVERY_BIN, git } from "../helpers.js";
import { startLocalRegistry, type LocalRegistry } from "../local-registry.js";

const NAME = "@acme/delivery-pack-docs";
const PTY = join(import.meta.dirname, "..", "install-a-pack-from-elsewhere", "pty.py");

const SCAN = { kind: "find", prompt: "scan.md", ideasFor: ["code"] };
const CODE = { kind: "act", summary: "Code that calls the replaced code.", prompt: "code.md" };
const WORKFLOWS = { scan: SCAN, code: CODE };
const FOLDER = { type: "path", summary: "The folder that holds your documentation." };
const TONE = { type: "text", summary: "How the pages should read." };

/** A package of the pack with these settings, each one used in the instructions (a setting no prompt uses is refused). */
function packageWith(version: string, settings: Record<string, object>, options: { packageName?: string; name?: string } = {}): Uint8Array {
  const used = Object.keys(settings).map((setting) => `{{settings.${setting}}}`).join(" ");
  return packPackage({
    ...options,
    version,
    manifest: { workflows: WORKFLOWS, settings },
    extra: { "scan.md": `# Scan\n\nLook at ${used}.\n`, "code.md": `# Code\n\nChange ${used}.\n` },
  });
}

interface Run {
  status: number | null;
  output: string;
}

let registry: LocalRegistry;
let env: NodeJS.ProcessEnv;
const scratch = mkdtempSync(join(tmpdir(), "uat-adapt-slice-5-"));

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
const freshProject = (): string => initTempRepo("uat-adapt-slice-5-project-", { "package.json": PACKAGE, "a.js": "x\n" });

beforeAll(async () => {
  registry = await startLocalRegistry();
  env = npmEnv(registry.url);
  // 1.2.0 needs one setting; 1.3.0 is published by the test that updates.
  registry.publish(NAME, "1.2.0", packageWith("1.2.0", { "docs-folder": FOLDER }));
});

afterAll(async () => {
  await registry.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("UAT: know what to set after adding or updating a pack", () => {
  let project: string;

  it("after an add, says how many settings the pack needs, with the lines to add, and still succeeds", async () => {
    project = freshProject();
    const added = await deliveryAnswering("y\r", ["packs", "add", NAME], project);
    const text = flat(added.output);
    expect(added.status).toBe(0);
    expect(text).toContain("It will not run until you give it 1 setting.");
    expect(text).toContain("docs-folder");
    expect(text).toContain("The folder that holds your documentation.");
    expect(text).toContain('"docs-drift": {');
    expect(text).toContain("Then run: delivery validate");
  });

  it("marks the pack in the list as needing the setting, naming it", async () => {
    const listed = await delivery(["packs"], project);
    expect(listed.status).toBe(0);
    const text = flat(listed.output);
    expect(text).toContain("docs-drift");
    expect(text).toMatch(/needs[^.]*docs-folder/i);
  });

  it("reports a new required setting on update, and that every run will stop until it is given", async () => {
    registry.publish(NAME, "1.3.0", packageWith("1.3.0", { "docs-folder": FOLDER, tone: TONE }));
    const declined = await deliveryAnswering("n\r", ["packs", "update", "docs-drift"], project);
    const text = flat(declined.output);
    expect(declined.status).toBe(0);
    expect(text).toContain('Found 1.3.0 for "latest" (you have 1.2.0)');
    expect(text).toContain("New, needs a value: tone.");
    expect(text).toContain("every run in this project will stop, including scheduled runs.");
  });
});

describe("AC: an update reports the other kinds of setting change", () => {
  it("reports a new optional setting, a removed setting that the configuration still names, and a changed default", async () => {
    const name = "@acme/delivery-pack-shifting";
    const pack = (version: string, settings: Record<string, object>) => packageWith(version, settings, { packageName: name, name: "shifting" });
    registry.publish(name, "1.0.0", pack("1.0.0", { gone: { ...TONE, default: "x" }, level: { ...TONE, default: "plain" } }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", name], project);
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify({ packSettings: { shifting: { gone: "y" } } }));
    git(project, ["add", "-A"]);
    git(project, ["commit", "-m", "snapshot"]);
    registry.publish(name, "1.1.0", pack("1.1.0", { level: { ...TONE, default: "formal" }, extra: { ...TONE, default: "z" } }));
    const text = flat((await deliveryAnswering("n\r", ["packs", "update", "shifting"], project)).output);
    expect(text).toContain("extra");
    expect(text).toContain("gone");
    expect(text).toMatch(/still names/i);
    expect(text).toContain("formal");
  });
});
