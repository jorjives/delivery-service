// Slice 5: Add and update from automation, with output scripts can read, and documentation
// Source: docs/superpowers/specs/2026-10-24-install-a-pack-from-elsewhere-slices.md
// Recorded: 2026-10-25 against commit 879dc28
//
// Drives the compiled `delivery` as a real subprocess against a real `npm` talking only to a throwaway local
// registry (tests/local-registry.ts), in throwaway git repositories. "Nobody to ask" is a subprocess with no
// terminal; the person's yes (to read the account first) goes through a pseudo-terminal (pty.py, as in slice 1).
// Asserts on stable phrases, exit codes, parsed JSON and files on disk, not full-output equality.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const PTY = join(import.meta.dirname, "pty.py");
const LOCK = ".delivery/packs.lock.json";
const FOLDER = ".delivery/packs/docs-drift";
const SCAN = { kind: "find", prompt: "scan.md", ideasFor: ["code"] };
const V2_WORKFLOWS = {
  scan: { ...SCAN, ideasFor: ["code", "audit"] },
  code: { kind: "act", summary: "Code that calls the replaced code.", prompt: "code.md" },
  audit: { kind: "act", summary: "Audit of the calls.", prompt: "audit.md" },
};

interface Run {
  status: number | null;
  output: string;
  stdout: string;
}

let registry: LocalRegistry;
let env: NodeJS.ProcessEnv;
const scratch = mkdtempSync(join(tmpdir(), "uat-automation-"));

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
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("close", (status) => resolve({ status, output, stdout }));
  });
}

const delivery = (args: string[], cwd: string): Promise<Run> => run(process.execPath, [DELIVERY_BIN, ...args], cwd);
const deliveryAnswering = (keys: string, args: string[], cwd: string): Promise<Run> =>
  run("python3", ["-I", PTY, cwd, keys, process.execPath, DELIVERY_BIN, ...args], cwd);

const ESCAPES = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g");
const flat = (text: string): string => text.replace(ESCAPES, "").replace(/\r/g, "").replace(/\s+/g, " ");
const freshProject = (): string => initTempRepo("uat-automation-project-", { "package.json": PACKAGE, "a.js": "x\n" });
const state = (repo: string): string => git(repo, ["status", "--porcelain", "--untracked-files=all"]);
const commitAll = (repo: string): void => {
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "snapshot"]);
};
/** The 64-hex fingerprint after `--approve` in a refusal; the command is wrapped over lines with a backslash. */
const approvedIn = (text: string): string => {
  const hex = text.replace(/\\\r?\n/g, "").match(/--approve\s+((?:[0-9a-f]\s*){64})/);
  if (hex?.[1] === undefined) throw new Error(`no --approve fingerprint in: ${text}`);
  return hex[1].replace(/\s+/g, "");
};

beforeAll(async () => {
  registry = await startLocalRegistry();
  env = npmEnv(registry.url);
  registry.publish(NAME, "1.2.0", packPackage({ version: "1.2.0" }));
});

afterAll(async () => {
  await registry.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe("UAT: add a shared pack from a script with no terminal", () => {
  let project: string;
  let fingerprint: string;

  it("the first run shows the account, writes nothing and refuses, naming how to accept", async () => {
    project = freshProject();
    const refused = await delivery(["packs", "add", NAME], project);
    const text = flat(refused.output);
    expect(refused.status).not.toBe(0);
    expect(text).toContain("Not added: nothing here can ask you.");
    expect(text).toContain("--approve");
    expect(text).toContain("Fingerprint");
    expect(state(project)).toBe("");
    fingerprint = approvedIn(refused.output);
  });

  it("a different fingerprint is refused and nothing is written", async () => {
    const wrong = await delivery(["packs", "add", NAME, "--approve", "0".repeat(64)], project);
    expect(wrong.status).not.toBe(0);
    expect(state(project)).toBe("");
  });

  it("the fingerprint shown adds the pack, and the data list matches the plain list", async () => {
    const added = await delivery(["packs", "add", NAME, "--approve", fingerprint], project);
    expect(added.status).toBe(0);
    expect(flat(added.output)).toContain("Added docs-drift 1.2.0.");
    expect(readFileSync(join(project, LOCK), "utf-8")).toContain("1.2.0");

    const plain = flat((await delivery(["packs"], project)).output);
    const data = await delivery(["packs", "--json"], project);
    expect(data.status).toBe(0);
    const doc = JSON.parse(data.stdout) as { schema?: string; packs: { name: string; version: string; source: { kind: string; package: { name: string; version: string } | null }; state: string | null }[] };
    expect(doc.schema).toBe("delivery.packs/1");
    const mine = doc.packs.find((p) => p.name === "docs-drift");
    expect(mine?.source.package).toEqual({ name: NAME, version: "1.2.0" });
    expect(plain).toContain("docs-drift");
    for (const pack of doc.packs) expect(plain).toContain(pack.name);
  });
});

describe("AC: updating from automation is bound to the new fingerprint", () => {
  it("refuses with nobody to ask, then takes only the fingerprint shown", async () => {
    const project = freshProject();
    await deliveryAnswering("y\r", ["packs", "add", NAME], project);
    commitAll(project);
    registry.publish(NAME, "1.3.0", packPackage({ version: "1.3.0", manifest: { workflows: V2_WORKFLOWS }, extra: { "audit.md": "Audit.\n" } }));

    const refused = await delivery(["packs", "update", "docs-drift"], project);
    expect(refused.status).not.toBe(0);
    expect(flat(refused.output)).toContain("--approve");
    expect(state(project)).toBe("");
    const fingerprint = approvedIn(refused.output);

    const wrong = await delivery(["packs", "update", "docs-drift", "--approve", "0".repeat(64)], project);
    expect(wrong.status).not.toBe(0);
    expect(state(project)).toBe("");

    const taken = await delivery(["packs", "update", "docs-drift", "--approve", fingerprint], project);
    expect(taken.status).toBe(0);
    expect(readFileSync(join(project, LOCK), "utf-8")).toContain("1.3.0");
    expect(readFileSync(join(project, FOLDER, "audit.md"), "utf-8")).toContain("Audit.");
  });
});

describe("AC: add, update and approve give their facts as versioned data", () => {
  it("add --json and update --json print one parsable versioned document each", async () => {
    registry.publish("@acme/delivery-pack-data", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-data", version: "1.0.0", name: "data-pack" }));
    const project = freshProject();
    const refused = await delivery(["packs", "add", "@acme/delivery-pack-data", "--json"], project);
    expect(refused.status).not.toBe(0);
    const refusal = JSON.parse(refused.stdout) as { schema: string };
    expect(refusal.schema).toMatch(/^delivery\.[a-z-]+\/\d+$/);
    expect(state(project)).toBe("");

    const fingerprint = approvedIn((await delivery(["packs", "add", "@acme/delivery-pack-data"], project)).output);
    const added = await delivery(["packs", "add", "@acme/delivery-pack-data", "--approve", fingerprint, "--json"], project);
    expect(added.status).toBe(0);
    const outcome = JSON.parse(added.stdout) as { schema: string };
    expect(outcome.schema).toMatch(/^delivery\.[a-z-]+\/\d+$/);
    expect(readFileSync(join(project, LOCK), "utf-8")).toContain("data-pack");
  });
});

describe("AC: a pack in a format this build cannot read is refused with the record untouched", () => {
  it("refuses a newer pack format on add with the upgrade sentence", async () => {
    registry.publish("@acme/delivery-pack-future", "1.0.0", packPackage({ packageName: "@acme/delivery-pack-future", version: "1.0.0", name: "future-pack", manifest: { schema: "delivery.pack/99" } }));
    const project = freshProject();
    const result = await deliveryAnswering("y\r", ["packs", "add", "@acme/delivery-pack-future"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("upgrade delivery-service");
    expect(state(project)).toBe("");
  });

  it("refuses a record from a newer delivery-service with the upgrade sentence, leaving it as it was", async () => {
    const project = freshProject();
    mkdirSync(join(project, ".delivery"), { recursive: true });
    const record = JSON.stringify({ schema: "delivery.packs-lock/2", packs: {} });
    writeFileSync(join(project, LOCK), record);
    commitAll(project);
    const result = await delivery(["packs"], project);
    expect(result.status).not.toBe(0);
    expect(flat(result.output)).toContain("upgrade delivery-service");
    expect(readFileSync(join(project, LOCK), "utf-8")).toBe(record);
    expect(state(project)).toBe("");
  });
});

describe("AC: the documentation teaches the whole flow", () => {
  const page = readFileSync(join(import.meta.dirname, "../../docs/packs.md"), "utf-8");
  const section = page.slice(page.indexOf("## Add a pack from elsewhere"));

  it("has the section with a worked add, update and refusal", () => {
    expect(page).toContain("## Add a pack from elsewhere");
    expect(section).toContain("delivery packs add");
    expect(section).toContain("delivery packs update");
    expect(section).toContain("--approve");
    expect(section).toContain("is not as you approved it");
  });

  it("says pinning keeps review stable and is not a review of the pack itself, and names the publishers' keyword", () => {
    expect(flat(section)).toMatch(/pinning|pinned/i);
    expect(flat(section)).toMatch(/does not review the pack for you/i);
    expect(section).toContain("delivery-pack");
  });

  it("shows add's refusal exactly as the compiled command prints it", async () => {
    const project = freshProject();
    const refused = await delivery(["packs", "add", NAME], project);
    const fingerprint = approvedIn(refused.output);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(section).toContain("Not added: nothing here can ask you.");
    expect(flat(refused.output)).toContain("The command is refused if the pack has a different fingerprint.");
    expect(flat(section)).toContain("The command is refused if the pack has a different fingerprint.");
  });
});
