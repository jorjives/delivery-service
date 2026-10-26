// Slice 4: Update a pack and see what changed first
// Source: docs/superpowers/specs/2026-10-24-install-a-pack-from-elsewhere-slices.md
// Recorded: 2026-10-24 against commit b851164
//
// Drives the compiled `delivery` as a real subprocess against a real `npm` talking only to a throwaway local
// registry (tests/local-registry.ts), in throwaway git repositories. Adds and updates go through a pseudo-terminal
// (pty.py, as in slice 1). Asserts on stable phrases, exit codes and files on disk, not full-output equality.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedOut } from "../../src/mock-session.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { CODE_TEXT, packPackage } from "../../src/packs/install/install-fixtures.js";
import { PACKAGE } from "../../src/cli/command-fixtures.js";
import { DELIVERY_BIN, git } from "../helpers.js";
import { startLocalRegistry, type LocalRegistry } from "../local-registry.js";

const NAME = "@acme/delivery-pack-docs";
const PTY = join(import.meta.dirname, "pty.py");
const LOCK = ".delivery/packs.lock.json";
const FOLDER = ".delivery/packs/docs-drift";

const SCAN = { kind: "find", prompt: "scan.md", ideasFor: ["code"] };
const V1_WORKFLOWS = { scan: SCAN, code: { kind: "act", prompt: "code.md", hold: { atOrAbove: "high" } } };
// Version 1.3.0: "code" no longer waits for sign-off, and an "audit" workflow is added.
const V2_WORKFLOWS = {
  scan: { ...SCAN, ideasFor: ["code", "audit"] },
  code: { kind: "act", summary: "Code that calls the replaced code.", prompt: "code.md" },
  audit: { kind: "act", summary: "Audit of the calls.", prompt: "audit.md" },
};

interface Run {
  status: number | null;
  output: string;
}

let registry: LocalRegistry;
let env: NodeJS.ProcessEnv;
const scratch = mkdtempSync(join(tmpdir(), "uat-update-"));

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
const freshProject = (): string => initTempRepo("uat-update-project-", { "package.json": PACKAGE, "a.js": "x\n" });
const state = (repo: string): string => git(repo, ["status", "--porcelain", "--untracked-files=all"]);
const commitAll = (repo: string): void => {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "snapshot"]);
};
const withFirst = async (): Promise<string> => {
  const project = freshProject();
  await deliveryAnswering("y\r", ["packs", "add", NAME], project);
  commitAll(project);
  return project;
};
const listed = async (project: string): Promise<string> => flat((await delivery(["packs"], project)).output);

beforeAll(async () => {
  // 1.2.0 is the version added first; 1.3.0 is published afterwards, so "latest" moves.
  registry = await startLocalRegistry();
  env = npmEnv(registry.url);
  registry.publish(NAME, "1.2.0", packPackage({ version: "1.2.0", manifest: { workflows: V1_WORKFLOWS } }));
});

afterAll(async () => {
  await registry.close();
  rmSync(scratch, { recursive: true, force: true });
});

const publishNewer = (): void =>
  registry.publish(
    NAME,
    "1.3.0",
    packPackage({ version: "1.3.0", manifest: { workflows: V2_WORKFLOWS }, extra: { "audit.md": "Audit.\nTwice.\n", "code.md": CODE_TEXT + "\nAlso this." } }),
  );

describe("UAT: take a newer version of a shared pack knowingly", () => {
  let project: string;
  let declined: Run;

  it("shows a report that leads with the missing sign-off, then files, then changed lines", async () => {
    project = await withFirst();
    publishNewer();
    declined = await deliveryAnswering("n\r", ["packs", "update", "docs-drift"], project);
    const text = flat(declined.output);
    expect(declined.status).toBe(0);
    expect(text).toContain('Found 1.3.0 for "latest" (you have 1.2.0)');
    expect(text).toContain('"code" no longer waits for your sign-off');
    expect(text.indexOf("no longer waits for your sign-off")).toBeLessThan(text.indexOf("Instruction files"));
    expect(text.indexOf("Instruction files")).toBeLessThan(text.indexOf("Changed lines"));
    expect(text).toContain("Workflows added: audit");
    expect(text).toContain("audit.md: new");
    expect(text).toContain("+ Also this.");
    expect(text).toContain("This summary does not cover what the instructions say.");
  });

  it("after no, says nothing changed and the list still shows the old version", async () => {
    expect(flat(declined.output)).toContain("Nothing was changed.");
    expect(state(project)).toBe("");
    const text = await listed(project);
    expect(text).toContain("1.2.0");
    expect(text).not.toContain("1.3.0");
  });

  it("after yes, the list shows the new version and the record and kept files are updated", async () => {
    const accepted = await deliveryAnswering("y\r", ["packs", "update", "docs-drift"], project);
    expect(accepted.status).toBe(0);
    expect(flat(accepted.output)).toContain("1.3.0");
    const text = await listed(project);
    expect(text).toContain("1.3.0");
    expect(text).not.toContain("1.2.0");
    expect(readFileSync(join(project, LOCK), "utf-8")).toContain("1.3.0");
    expect(readFileSync(join(project, FOLDER, "audit.md"), "utf-8")).toContain("Audit.");
    expect(readFileSync(join(project, FOLDER, "code.md"), "utf-8")).toContain("Also this.");
  });
});

describe("AC: nothing changes unless the owner says yes, and plain answers when there is nothing to take", () => {
  it("changes nothing when nobody can be asked", async () => {
    registry.publish("@acme/delivery-pack-quiet", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-quiet", version: "1.0.0", name: "quiet-pack", manifest: { workflows: V1_WORKFLOWS } }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "@acme/delivery-pack-quiet"], project);
    commitAll(project);
    registry.publish("@acme/delivery-pack-quiet", "1.1.0", packPackage({ packageName: "@acme/delivery-pack-quiet", version: "1.1.0", name: "quiet-pack", manifest: { workflows: V2_WORKFLOWS }, extra: { "audit.md": "Audit.\n" } }));
    const before = readFileSync(join(project, LOCK), "utf-8");
    const result = await delivery(["packs", "update", "quiet-pack"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("Not updated: nothing here can ask you.");
    expect(state(project)).toBe("");
    expect(readFileSync(join(project, LOCK), "utf-8")).toBe(before);
  });

  it("says plainly there is nothing newer when the version is the latest, and writes nothing", async () => {
    registry.publish("@acme/delivery-pack-current", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-current", version: "1.0.0", name: "current-pack" }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "@acme/delivery-pack-current"], project);
    commitAll(project);
    const result = await deliveryAnswering("y\r", ["packs", "update", "current-pack"], project);
    expect(result.status).toBe(0);
    expect(flat(result.output)).toContain("is up to date at 1.0.0");
    expect(state(project)).toBe("");
  });

  it("says plainly that a newer version with the same content changes nothing, and writes nothing", async () => {
    registry.publish("@acme/delivery-pack-same", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-same", version: "1.0.0", name: "same-pack" }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "@acme/delivery-pack-same"], project);
    commitAll(project);
    registry.publish("@acme/delivery-pack-same", "1.0.1", packPackage({ packageName: "@acme/delivery-pack-same", version: "1.0.1", name: "same-pack" }));
    const result = await deliveryAnswering("y\r", ["packs", "update", "same-pack"], project);
    expect(result.status).toBe(0);
    expect(flat(result.output)).toContain("has the same content as the 1.0.0 you have");
    expect(state(project)).toBe("");
  });
});

describe("AC: an update that cannot be taken is refused with the record unchanged", () => {
  it("refuses an update that would add a workflow another pack defines, naming it", async () => {
    registry.publish("@acme/delivery-pack-clash", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-clash", version: "1.0.0", name: "clash-pack", manifest: { workflows: { scan: SCAN, code: { kind: "act", prompt: "code.md" } } } }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "@acme/delivery-pack-clash"], project);
    // A project workflow named like the one the new version would add.
    writeFileSync(join(project, "delivery.config.json"), JSON.stringify({ workflows: { "clash-pack:audit": { steps: [{ name: "a", prompt: "a" }] } } }));
    commitAll(project);
    registry.publish("@acme/delivery-pack-clash", "1.1.0", packPackage({ packageName: "@acme/delivery-pack-clash", version: "1.1.0", name: "clash-pack", manifest: { workflows: V2_WORKFLOWS }, extra: { "audit.md": "Audit.\n" } }));
    const result = await deliveryAnswering("y\r", ["packs", "update", "clash-pack"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("Not updated");
    expect(state(project)).toBe("");
  });

  it("refuses an update that cannot be read, with the record unchanged", async () => {
    registry.publish("@acme/delivery-pack-broken", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-broken", version: "1.0.0", name: "broken-pack" }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "@acme/delivery-pack-broken"], project);
    commitAll(project);
    registry.publish("@acme/delivery-pack-broken", "1.1.0", packPackage({ packageName: "@acme/delivery-pack-broken", version: "1.1.0", name: "broken-pack", manifest: { workflows: { scan: { kind: "find", prompt: "missing.md" } } } }));
    const result = await deliveryAnswering("y\r", ["packs", "update", "broken-pack"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("Not updated");
    expect(state(project)).toBe("");
  });

  it("names the installed packs when the pack to update is not installed", async () => {
    const project = await withFirst();
    const result = await delivery(["packs", "update", "nope"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("docs-drift");
    expect(state(project)).toBe("");
  });
});
