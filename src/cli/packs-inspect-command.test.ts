import { basename, dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type Inspection, inspectionOf, inspectionSchema, narrowedTo } from "../packs/inspection.js";
import { installPack } from "../packs/install/store.js";
import { BUILT_IN_PACKS, packNamed } from "../packs/manifest.js";
import { packSchema } from "../packs/pack-format.js";
import { NO_FOLDER, NO_MANIFEST, NOT_IN_A_PACK, readPackFolder } from "../packs/pack-folder.js";
import { initTempRepo } from "../temp-repo.js";
import { delivery, MOVES_FILES, movesProject, PACKAGE, V2_FILES } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { NAME_A_PACK } from "./packs-inspect-command.js";
import { projectBaseline } from "./project-baseline.js";
import { renderInspection, SHOWN_NOTHING } from "./packs-inspect-render.js";

// Inspecting a built-in pack reads its folder and nothing else: no process starts, no agent runs, nothing is asked.
const wiring = vi.hoisted(() => ({ forbid: false, calls: [] as string[] }));

vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const spied = (name: string, original: unknown) => (...args: unknown[]) => {
    if (!wiring.forbid) return (original as (...rest: unknown[]) => unknown)(...args);
    wiring.calls.push(name);
    throw new Error(`${name} must not run`);
  };
  // `git-exec.ts` promisifies execFile, so the stand-in keeps the promisified form and still refuses while forbidden.
  const execFile = spied("execFile", real.execFile) as ((...args: unknown[]) => unknown) & Record<symbol, unknown>;
  Object.defineProperty(execFile, promisify.custom, {
    value: (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        execFile(...args, (err: Error | null, stdout: string, stderr: string) => (err ? reject(err) : resolve({ stdout, stderr })));
      }),
  });
  return {
    ...real,
    spawn: spied("spawn", real.spawn),
    spawnSync: spied("spawnSync", real.spawnSync),
    exec: spied("exec", real.exec),
    execFile,
    execFileSync: spied("execFileSync", real.execFileSync),
    fork: spied("fork", real.fork),
  };
});

vi.mock("./agent-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-session.js")>()),
  agentSession: () => {
    throw new Error("no agent may be started");
  },
}));

/** Every path under `dir`, `.git/` included, with its size, mode and modification time, sorted. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((rel) => {
      const stat = statSync(join(dir, rel));
      return `${rel} ${stat.size} ${stat.mode} ${stat.mtimeMs}`;
    });
}

/** The moves pack's manifest, as the fixture writes it. */
const movesManifest = (): Record<string, unknown> => JSON.parse(MOVES_FILES["moves-pack/pack.json"] ?? "{}");

/** The text of some lines, joined and with every run of white space made one space: the wrap points are not compared. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

const NOT_A_PACK = "Move off old code";

/** A fresh folder outside any project holding MOVES_FILES' pack, with `extra` files (relative to the folder) added or overwritten. */
function packFolderOutsideAnyRepo(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "outside-pack-"));
  for (const [name, text] of Object.entries({ ...MOVES_FILES, ...extra })) {
    const path = join(dir, name.replace(/^moves-pack\//, ""));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

/** The moves pack's folder with its `code.md` replaced by a link to a file outside the pack. */
function linkPrompt(): string {
  const dir = packFolderOutsideAnyRepo();
  const outside = join(mkdtempSync(join(tmpdir(), "linked-")), "secret.md");
  writeFileSync(outside, "SECRET WORDS\n");
  rmSync(join(dir, "code.md"));
  symlinkSync(outside, join(dir, "code.md"));
  return dir;
}

/** The moves pack's folder with a prompt that is not UTF-8 text. */
function badBytes(): string {
  const dir = packFolderOutsideAnyRepo();
  writeFileSync(join(dir, "code.md"), Buffer.from([0x23, 0x20, 0xff, 0x0a]));
  return dir;
}

/** The moves pack's folder with a key the format does not name in its pack.json. */
function unknownKey(): string {
  const dir = packFolderOutsideAnyRepo();
  const manifest = movesManifest();
  writeFileSync(join(dir, "pack.json"), JSON.stringify({ ...manifest, unknownKey: true }));
  return dir;
}

/** The moves pack's folder declaring a format this harness does not read. */
function newerFormatPack(): string {
  const dir = packFolderOutsideAnyRepo();
  const manifest = movesManifest();
  writeFileSync(join(dir, "pack.json"), JSON.stringify({ ...manifest, schema: "delivery.pack/4" }));
  return dir;
}

/** `delivery` with the spawn and agent mocks armed: any process started or agent run is an error. */
async function quietly(args: string[], cwd: string) {
  wiring.forbid = true;
  try {
    return await delivery(args, { cwd });
  } finally {
    wiring.forbid = false;
  }
}

beforeEach(() => {
  wiring.forbid = false;
  wiring.calls.length = 0;
});

describe("delivery packs inspect", () => {
  it("prints the account of a built-in pack by name, and starts, writes and asks nothing", async () => {
    const cwd = initTempRepo("inspect-", { "a.js": "x\n" });
    const before = [snapshot(cwd), snapshot(BUILT_IN_PACKS)];
    const { exitCode, stdout, stderr } = await quietly(["packs", "inspect", "deprecations"], cwd);
    expect(exitCode).toBe(EXIT.ok);
    const pack = await packNamed("deprecations");
    const read = await readPackFolder(pack.dir);
    if (!read.ok) throw new Error("the built-in deprecations pack is not read by the folder check");
    const project = await projectBaseline(cwd, process.env, pack.dir);
    expect(stdout).toBe(`${renderInspection(inspectionOf(pack, project, read.files)).join("\n")}\n`);
    expect(stderr).toBe("");
    expect(wiring.calls).toEqual([]);
    expect([snapshot(cwd), snapshot(BUILT_IN_PACKS)]).toEqual(before);
  });

  it("reads a built-in pack outside any project", async () => {
    const { exitCode, stdout } = await delivery(["packs", "inspect", "code"], { cwd: mkdtempSync(join(tmpdir(), "no-project-")) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe("Pack: Code review");
  });

  it.each(["Deprecations", "nope"])("refuses %s, naming the packs there are, and prints no account", async (name) => {
    const { exitCode, stdout, stderr } = await delivery(["packs", "inspect", name], { cwd: mkdtempSync(join(tmpdir(), "inspect-")) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toBe("");
    expect(stderr).toContain(`There is no pack called "${name}". The packs available are: code, deprecations, security.`);
  });

  it("refuses a path with no folder there, plainly, and prints no account", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "inspect-"));
    const { exitCode, stdout } = await quietly(["packs", "inspect", "./packs/deprecations"], cwd);
    expect(exitCode).toBe(EXIT.configuration);
    expect(flat(stdout)).toContain(`packs/deprecations ${NO_FOLDER}.`);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`  ${SHOWN_NOTHING}`);
  });

  it("inspects an unlisted folder outside any project, and says the check and landing are not known", async () => {
    const dir = packFolderOutsideAnyRepo();
    const { exitCode, stdout } = await quietly(["packs", "inspect", dir], mkdtempSync(join(tmpdir(), "nowhere-")));
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout.split("\n")[0]).toBe("Pack: Move off old code");
    expect(flat(stdout)).toContain("No project was found here, so which check and landing would be used is not known.");
  });

  it("inspects a folder the project does not list, naming the project's check and landing, and writes nothing", async () => {
    const repo = initTempRepo("insp-", { "package.json": PACKAGE, ...MOVES_FILES });
    const before = snapshot(repo);
    const { exitCode, stdout } = await quietly(["packs", "inspect", "./moves-pack"], repo);
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("  Check: runs `npm test`.");
    expect(stdout).toContain("  Landing: commits to a new branch.");
    expect(snapshot(repo)).toEqual(before);
    expect(wiring.calls).toEqual([]);
  });

  it("inspects a folder the project does list, by its path, in the same words", async () => {
    const repo = movesProject();
    const { exitCode, stdout } = await quietly(["packs", "inspect", "./moves-pack"], repo);
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("  Landing: commits to a new branch.");
  });

  it("lists a README in the folder as not read, and never prints it", async () => {
    const dir = packFolderOutsideAnyRepo({ "README.md": "README WORDS\n" });
    const { exitCode, stdout } = await delivery(["packs", "inspect", dir], { cwd: mkdtempSync(join(tmpdir(), "nowhere-")) });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("  README.md");
    expect(stdout).not.toContain("README WORDS");
  });

  it("refuses a folder holding a script, naming it, with nothing from the pack shown and exit 2", async () => {
    const dir = packFolderOutsideAnyRepo({ "install.sh": "rm -rf ~\n" });
    const { exitCode, stdout } = await delivery(["packs", "inspect", dir], { cwd: dirname(dir) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(flat(stdout)).toContain(`${basename(dir)}/install.sh ${NOT_IN_A_PACK}.`);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`  ${SHOWN_NOTHING}`);
    for (const pack of [NOT_A_PACK, "# Look for old code", "Finds places", "rm -rf"]) expect(stdout).not.toContain(pack);
  });

  it.each([
    ["a linked prompt", linkPrompt, "code.md"],
    ["a prompt that is not UTF-8", badBytes, "code.md"],
    ["an unknown manifest key", unknownKey, "pack.json"],
    ["a newer format", newerFormatPack, "pack.json"],
  ])("refuses %s with exit 2, the file named and no pack words", async (_label, build, file) => {
    const dir = build();
    const { exitCode, stdout } = await delivery(["packs", "inspect", dir], { cwd: dirname(dir) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stdout).toContain(`${basename(dir)}/${file}`);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`  ${SHOWN_NOTHING}`);
    expect(stdout).not.toContain(NOT_A_PACK);
  });

  it("reports a folder that holds no pack.json plainly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "no-manifest-"));
    const { exitCode, stdout } = await delivery(["packs", "inspect", dir], { cwd: dirname(dir) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(flat(stdout)).toContain(`${basename(dir)}/pack.json ${NO_MANIFEST}.`);
    expect(stdout.trimEnd().split("\n").at(-1)).toBe(`  ${SHOWN_NOTHING}`);
  });

  it("leaves a delivery.pack/2 pack with a stray file runnable, though inspect refuses it", async () => {
    const repo = initTempRepo("v2-", { "package.json": PACKAGE, "delivery.config.json": JSON.stringify({ packs: ["old-pack"] }), ...V2_FILES("old-pack"), "old-pack/run.sh": "x\n" });
    expect((await delivery(["review", "old", "--preview"], { cwd: repo })).exitCode).toBe(EXIT.ok);
    expect((await delivery(["packs", "inspect", "./old-pack"], { cwd: repo })).exitCode).toBe(EXIT.configuration);
  });
});

describe("delivery packs inspect --json", () => {
  it("prints the same model the text is rendered from, with the fingerprint and raw instructions, and exit 0", async () => {
    const cwd = initTempRepo("inspect-json-", { "a.js": "x\n" });
    const json = await quietly(["packs", "inspect", "deprecations", "--json"], cwd);
    const text = await quietly(["packs", "inspect", "deprecations"], cwd);
    const pack = await packNamed("deprecations");
    const read = await readPackFolder(pack.dir);
    if (!read.ok) throw new Error("deprecations is not read by the folder check");
    const model = inspectionOf(pack, await projectBaseline(cwd, process.env, pack.dir), read.files);
    expect(json.exitCode).toBe(EXIT.ok);
    expect(JSON.parse(json.stdout)).toEqual(JSON.parse(JSON.stringify(model)));
    expect(text.stdout).toBe(`${renderInspection(model).join("\n")}\n`);
    const doc = JSON.parse(json.stdout);
    expect(doc.pack.hash).toBe(pack.hash);
    expect(doc.workflows.find((w: { local: string }) => w.local === "tests").steps[0].instructions.authored).toBe(pack.instructions["deprecations:tests"]?.authored);
    expect(z.fromJSONSchema(inspectionSchema()).safeParse(doc).error).toBeUndefined();
  });

  it("keeps a hidden character raw in the document and lists it, while the text shows it escaped", async () => {
    const dir = packFolderOutsideAnyRepo({ "code.md": `# Look\nab${String.fromCodePoint(0x202e)}cd\n` });
    const cwd = mkdtempSync(join(tmpdir(), "nowhere-"));
    const doc = JSON.parse((await delivery(["packs", "inspect", dir, "--json"], { cwd })).stdout);
    const code = doc.workflows.find((w: { local: string }) => w.local === "code");
    expect(code.steps[0].instructions.authored).toContain(`ab${String.fromCodePoint(0x202e)}cd`);
    expect(doc.hiddenCharacters).toContainEqual(expect.objectContaining({ codePoint: "U+202E", place: "instructions", workflow: code.name }));
    expect((await delivery(["packs", "inspect", dir], { cwd })).stdout).not.toContain(String.fromCodePoint(0x202e));
  });

  it.each([
    ["a folder holding a script", () => packFolderOutsideAnyRepo({ "install.sh": "rm -rf ~\n" }), "install.sh"],
    ["a newer format", newerFormatPack, "pack.json"],
  ])("refuses %s as a document saying it was refused, each problem listed, exit 2, no pack words", async (_l, build, file) => {
    const dir = build();
    const { exitCode, stdout } = await delivery(["packs", "inspect", dir, "--json"], { cwd: dirname(dir) });
    expect(exitCode).toBe(EXIT.configuration);
    const doc = JSON.parse(stdout);
    expect(doc).toMatchObject({ schema: "delivery.pack-inspection/1", ok: false });
    expect(doc.problems.map((p: { file: string }) => basename(p.file))).toContain(file);
    expect(stdout).not.toContain(NOT_A_PACK);
    expect(z.fromJSONSchema(inspectionSchema()).safeParse(doc).error).toBeUndefined();
  });

  it.each([
    [["nope"], 'There is no pack called "nope"'],
    [[], NAME_A_PACK],
  ])("refuses %j as a document on stdout, exit 2", async (pack, words) => {
    const { exitCode, stdout, stderr } = await delivery(["packs", "inspect", ...pack, "--json"], { cwd: mkdtempSync(join(tmpdir(), "inspect-")) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, problems: [{ file: null, message: expect.stringContaining(words) }] });
  });

  it("prints the published schema with --schema, reading no pack, while packs --schema still prints the pack.json schema", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "inspect-"));
    const { exitCode, stdout } = await delivery(["packs", "inspect", "--schema"], { cwd });
    expect(exitCode).toBe(EXIT.ok);
    expect(JSON.parse(stdout)).toEqual(inspectionSchema());
    expect(JSON.parse((await delivery(["packs", "--schema"], { cwd })).stdout)).toEqual(packSchema());
  });

  it("refuses no pack and no --schema plainly", async () => {
    const { exitCode, stderr } = await delivery(["packs", "inspect"], { cwd: mkdtempSync(join(tmpdir(), "inspect-")) });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(NAME_A_PACK);
  });

  it.each([[[]], [["--json"]]])("gives identical output on two runs over the same folder (%j)", async (extra) => {
    const dir = packFolderOutsideAnyRepo({ "README.md": "x\n" });
    const cwd = mkdtempSync(join(tmpdir(), "nowhere-"));
    const first = await delivery(["packs", "inspect", dir, ...extra], { cwd });
    const second = await delivery(["packs", "inspect", dir, ...extra], { cwd });
    expect(second).toEqual(first);
  });
});

describe("delivery packs inspect --workflow", () => {
  it("shows only the tests workflow of deprecations with the identity and standing notices, exit 0", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "nowhere-"));
    const { exitCode, stdout } = await quietly(["packs", "inspect", "deprecations", "--workflow", "tests"], cwd);
    expect(exitCode).toBe(EXIT.ok);
    const pack = await packNamed("deprecations");
    const read = await readPackFolder(pack.dir);
    if (!read.ok) throw new Error("deprecations is not read by the folder check");
    const full = inspectionOf(pack, await projectBaseline(cwd, process.env, pack.dir), read.files);
    expect(stdout).toBe(`${renderInspection(narrowedTo(full, "tests") as Inspection).join("\n")}\n`);
    for (const heading of ["Pack: Move off deprecated code", "What it may touch", "Checks and landing", "Does it widen what the agent may do?", "Things to look at", "Instructions for tests"]) expect(stdout).toContain(heading);
    expect(stdout).not.toContain("Instructions for code");
  });

  it("gives the narrowed document under --json, valid against the schema", async () => {
    const doc = JSON.parse((await delivery(["packs", "inspect", "deprecations", "--workflow", "tests", "--json"], { cwd: mkdtempSync(join(tmpdir(), "nowhere-")) })).stdout);
    expect(doc.workflows.map((w: { local: string }) => w.local)).toEqual(["tests"]);
    expect(doc.pack.workflows).toHaveLength(3);
    expect(z.fromJSONSchema(inspectionSchema()).safeParse(doc).error).toBeUndefined();
  });

  it("refuses an unknown workflow, listing the pack's workflows, with no account, in both forms", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "nowhere-"));
    const message = 'There is no workflow called "nope" in the deprecations pack. Its workflows are: scan, code, tests.';
    const text = await delivery(["packs", "inspect", "deprecations", "--workflow", "nope"], { cwd });
    expect(text.exitCode).toBe(EXIT.configuration);
    expect(text.stdout).toBe("");
    expect(text.stderr).toContain(message);
    const json = await delivery(["packs", "inspect", "deprecations", "--workflow", "nope", "--json"], { cwd });
    expect(json.exitCode).toBe(EXIT.configuration);
    expect(JSON.parse(json.stdout)).toEqual({ schema: "delivery.pack-inspection/1", ok: false, problems: [{ file: null, field: "workflow", message }] });
  });

  it("inspects an added pack by name, naming its npm package", async () => {
    const repo = initTempRepo("inspect-added-", { "package.json": PACKAGE });
    const files = Object.entries(MOVES_FILES).map(([path, text]) => ({ path: path.replace(/^moves-pack\//, ""), bytes: new TextEncoder().encode(text) }));
    await installPack(repo, "moves", files, { source: "npm", package: "@acme/moves", request: "^1.2.0", version: "1.2.0", integrity: "sha512-abc", fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`, approved: `delivery.pack-hash/1:${"a".repeat(64)}` });
    const { exitCode, stdout } = await delivery(["packs", "inspect", "moves"], { cwd: repo });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("from npm: @acme/moves 1.2.0.");
  });
});
