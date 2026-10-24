// Slice 1: Add a pack from npm and run it
// Source: docs/superpowers/specs/2026-10-24-install-a-pack-from-elsewhere-slices.md
// Recorded: 2026-10-24 against commit 5131f37
//
// Drives the compiled `delivery packs add` as a real subprocess against a real `npm` talking only to a
// throwaway local registry (tests/local-registry.ts), in a throwaway git repository. The confirm question
// needs a terminal, so the answered runs go through a pseudo-terminal (pty.py). Asserts on stable phrases,
// exit codes and files on disk, not full-output equality.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INSPECT_RULE } from "../../src/cli/packs-inspect-render.js";
import { signedOut } from "../../src/mock-session.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { packPackage } from "../../src/packs/install/install-fixtures.js";
import { DELIVERY_BIN, git } from "../helpers.js";
import { startLocalRegistry, type LocalRegistry } from "../local-registry.js";

const NAME = "@acme/delivery-pack-docs";
const PTY = join(import.meta.dirname, "pty.py");

interface Run {
  status: number | null;
  output: string;
}

let registry: LocalRegistry;
let env: NodeJS.ProcessEnv;
const scratch = mkdtempSync(join(tmpdir(), "uat-add-pack-"));

/** The real npm, kept to the local registry with its own cache and no user config. */
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

/** `delivery <args>` with no terminal on stdin. */
const delivery = (args: string[], cwd: string, runEnv?: NodeJS.ProcessEnv): Promise<Run> => run(process.execPath, [DELIVERY_BIN, ...args], cwd, runEnv);

/** `delivery <args>` in a pseudo-terminal, typing `keys` when the question is asked. */
const deliveryAnswering = (keys: string, args: string[], cwd: string): Promise<Run> =>
  run("python3", ["-I", PTY, cwd, keys, process.execPath, DELIVERY_BIN, ...args], cwd);

const ESCAPES = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g");
const flat = (text: string): string => text.replace(ESCAPES, "").replace(/\r/g, "").replace(/\s+/g, " ");
const freshProject = (): string => initTempRepo("uat-add-pack-project-", { "package.json": '{"name":"p"}\n', "a.js": "x\n" });
const state = (repo: string): string => git(repo, ["status", "--porcelain", "--untracked-files=all"]);

beforeAll(async () => {
  registry = await startLocalRegistry();
  env = npmEnv(registry.url);
  registry.publish(NAME, "1.2.0", packPackage());
});

afterAll(async () => {
  await registry.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("UAT: add a pack from npm, read it, say no, say yes, run it", () => {
  const project = freshProject();
  let no: Run;
  let yes: Run;

  it("shows the version, that nothing is run, and the full account; answering no changes nothing", async () => {
    no = await deliveryAnswering("n\r", ["packs", "add", NAME], project);
    const text = flat(no.output);
    expect(no.status).toBe(0);
    expect(text).toContain(`Found ${NAME} on npm.`);
    expect(text).toContain("Version: 1.2.0");
    expect(text).toContain("Nothing from the package is run");
    expect(text).toContain("docs-drift, version 1.0.0");
    for (const heading of ["In short", "What it may touch", "How far each workflow goes before it asks you", "Things to look at"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("Read the project and find calls to code it has marked as replaced.");
    expect(text).toContain("Nothing was added.");
    expect(state(project)).toBe("");
    expect(existsSync(join(project, ".delivery"))).toBe(false);
  });

  it("after yes, names the two items to commit and keeps both", async () => {
    yes = await deliveryAnswering("y\r", ["packs", "add", NAME], project);
    const text = flat(yes.output);
    expect(yes.status).toBe(0);
    expect(text).toContain(`Added docs-drift 1.2.0.`);
    expect(text).toContain(".delivery/packs.lock.json");
    expect(text).toContain(".delivery/packs/docs-drift");
    expect(text).toContain("Commit both");
    expect(existsSync(join(project, ".delivery/packs.lock.json"))).toBe(true);
    expect(existsSync(join(project, ".delivery/packs/docs-drift/pack.json"))).toBe(true);
    // Kept by version control, not ignored: both show as new files to commit.
    const changes = state(project);
    expect(changes).toContain(".delivery/packs.lock.json");
    expect(changes).toContain(".delivery/packs/docs-drift/pack.json");
  });

  it("lists the pack's workflows with its source and version", async () => {
    const list = await delivery(["packs"], project);
    const text = flat(list.output);
    expect(list.status).toBe(0);
    expect(text).toContain("docs-drift");
    expect(text).toContain("1.2.0");
    expect(text).toContain("npm");
  });
});

describe("UAT: the added pack runs", () => {
  it("previews its workflow as normal", async () => {
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", NAME], project);
    const preview = await delivery(["packs", "inspect", "docs-drift", "--workflow", "scan"], project);
    expect(preview.status).toBe(0);
    expect(flat(preview.output)).toContain("Read the project and find calls to code it has marked as replaced.");
  });
});

describe("AC: refusals leave the project unchanged", () => {
  it("gives no answer (no terminal): shows the account, adds nothing", async () => {
    const project = freshProject();
    const result = await delivery(["packs", "add", NAME], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("Not added");
    expect(state(project)).toBe("");
  });

  it.each(["github:acme/pack", "https://example.com/pack.tgz", "./local-pack", "git+https://example.com/p.git"])("refuses the address %s", async (address) => {
    const project = freshProject();
    const result = await delivery(["packs", "add", address], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("only npm packages can be added");
    expect(state(project)).toBe("");
  });

  it("refuses a package that does not say it holds a pack", async () => {
    registry.publish("plain-lib", "1.0.0", packPackage({ packageJson: { "delivery-pack": undefined }, packageName: "plain-lib", version: "1.0.0" }));
    const project = freshProject();
    const result = await delivery(["packs", "add", "plain-lib"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toMatch(/delivery-pack/);
    expect(state(project)).toBe("");
  });

  it("names the stray file when the pack folder holds something the format does not name", async () => {
    registry.publish("stray-pack", "1.0.0", packPackage({ packageName: "stray-pack", version: "1.0.0", field: "pack", extra: { "pack/install.sh": "echo hi\n" } }));
    const project = freshProject();
    const result = await delivery(["packs", "add", "stray-pack"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("install.sh");
    expect(state(project)).toBe("");
  });

  it("lists files outside the pack as not part of it, and does not keep them", async () => {
    registry.publish("with-readme", "1.0.0", packPackage({ packageName: "with-readme", version: "1.0.0", field: "pack", extra: { "README.md": "hello\n" } }));
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "with-readme"], project);
    expect(existsSync(join(project, ".delivery/packs/docs-drift/README.md"))).toBe(false);
  });

  it("does not run an install script", async () => {
    const marker = join(scratch, "script-ran");
    registry.publish(
      "scripted-pack",
      "1.0.0",
      packPackage({ packageName: "scripted-pack", version: "1.0.0", packageJson: { scripts: { postinstall: `touch ${marker}`, prepare: `touch ${marker}` } } }),
    );
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", "scripted-pack"], project);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(project, ".delivery/packs.lock.json"))).toBe(true);
  });

  it("says so, and changes nothing, when the same pack is added again", async () => {
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", NAME], project);
    git(project, ["add", "-A"]);
    git(project, ["commit", "-m", "add pack"]);
    const again = await delivery(["packs", "add", NAME], project);
    expect(again.status).toBe(0);
    expect(flat(again.output)).toContain("already added");
    expect(state(project)).toBe("");
  });

  it("gives a plain sentence for an unknown package, an unknown version, and an unreachable registry", async () => {
    const project = freshProject();
    const unknown = await delivery(["packs", "add", "no-such-pack"], project);
    expect(unknown.status).not.toBe(0);
    expect(flat(unknown.output)).not.toMatch(/at .*\.js:\d+/);
    const version = await delivery(["packs", "add", `${NAME}@9.9.9`], project);
    expect(version.status).not.toBe(0);
    expect(flat(version.output)).toContain("9.9.9");
    const offline = await delivery(["packs", "add", NAME], project, { ...env, npm_config_registry: "http://127.0.0.1:1" });
    expect(offline.status).not.toBe(0);
    expect(flat(offline.output)).toMatch(/reach|registry/i);
    expect(state(project)).toBe("");
  });

  it("says plainly that npm is missing, and changes nothing", async () => {
    const project = freshProject();
    // A PATH holding git alone, so npm cannot be found.
    const gitOnly = join(scratch, "git-only");
    mkdirSync(gitOnly);
    symlinkSync(execFileSync("which", ["git"], { encoding: "utf-8" }).trim(), join(gitOnly, "git"));
    const result = await delivery(["packs", "add", NAME], project, { ...env, PATH: gitOnly });
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toMatch(/npm/);
    expect(state(project)).toBe("");
  });

  it("reads at 60 columns and never calls a pack safe, trusted or verified", async () => {
    const project = freshProject();
    const result = await deliveryAnswering("n\r", ["packs", "add", NAME], project);
    const plain = result.output.replace(ESCAPES, "").replace(/\r/g, "");
    // The pack's own instructions sit between two rules and are shown unaltered; only the account's words are held to 60.
    const account: string[] = [];
    let inside = false;
    for (const line of plain.split("\n")) {
      if (line === INSPECT_RULE) inside = !inside;
      else if (!inside && !line.startsWith("?")) account.push(line);
    }
    expect(Math.max(...account.map((l) => l.length))).toBeLessThanOrEqual(60);
    expect(plain).not.toMatch(/\b(safe|trusted|verified)\b/i);
  });
});
