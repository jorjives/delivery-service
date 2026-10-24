// Slice 3: Inspect any pack folder, and be refused plainly when it holds more than a pack should
// Source: docs/superpowers/specs/2026-10-23-inspect-a-pack-slices.md
// Recorded: 2026-10-24 against commit 542a012
//
// Drives the compiled `delivery packs inspect <folder>` command as a real subprocess (tests/helpers.ts's
// runDelivery) against copies of the built-in deprecations pack that this test makes stray in one way each.
// Asserts on stable phrases, the exit code and the path named, not full-output equality.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { initTempRepo } from "../../src/temp-repo.js";
import { REPO_ROOT, runDelivery } from "../helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "uat-inspect-3-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const NOTHING_SHOWN = "Nothing from this pack was shown, run or sent to an agent.";
const flat = (text: string): string => text.replace(/\s+/g, " ");
let counter = 0;

/** A fresh copy of the built-in deprecations pack in its own folder; `change` makes it stray. */
function pack(change: (dir: string) => void = () => undefined): string {
  const dir = join(scratch, `pack-${++counter}`);
  cpSync(join(REPO_ROOT, "packs", "deprecations"), dir, { recursive: true });
  change(dir);
  return dir;
}

/** Add or replace top-level keys of a pack copy's manifest. */
function editManifest(dir: string, changes: Record<string, unknown>): void {
  const manifest = join(dir, "pack.json");
  writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf-8")), ...changes }));
}

/** A directory outside any git repository to run from. */
const outside = join(scratch, "outside");
mkdirSync(outside);

function inspect(dir: string, cwd = outside) {
  const result = runDelivery(["packs", "inspect", dir], { cwd });
  return { ...result, text: flat(result.stdout) };
}

function expectRefused(result: ReturnType<typeof inspect>, path: string, reason: string) {
  expect(result.status).not.toBe(0);
  expect(result.text).toContain(path);
  expect(result.text).toContain(reason);
  expect(result.text).toContain(NOTHING_SHOWN);
  // No instruction text of the pack is shown.
  expect(result.stdout).not.toContain("Instructions for");
  expect(result.stdout).not.toContain("Move off deprecated code");
}

describe("UAT: check a pack a colleague sent, then add a script to a copy", () => {
  it("inspects the folder outside any project and shows the account", () => {
    const result = inspect(pack());
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe("Pack: Move off deprecated code");
    expect(result.text).toContain("It has 3 workflows");
  });

  it("refuses a copy with a script added, names it, and shows nothing else", () => {
    const dir = pack((d) => writeFileSync(join(d, "run.sh"), "echo hi\n"));
    expectRefused(inspect(dir), `${dir.split("/").at(-1)}/run.sh is not part of a pack`, "so a script or any other file cannot come with it");
  });
});

describe("AC: a folder can be inspected whether or not the project lists it", () => {
  it("names the project's own check and landing when a project is found", () => {
    const project = initTempRepo("uat-inspect-3-p-", {
      "package.json": '{"name":"p"}\n',
      "delivery.config.json": JSON.stringify({
        domain: "d",
        gate: { type: "command", command: "make verify", parseMode: "exitcode", checkOnly: true },
        closer: { type: "open-pr" },
        workflows: { w: { steps: [{ name: "s", prompt: "p" }] } },
      }),
    });
    const result = inspect(pack(), project);
    expect(result.status).toBe(0);
    expect(result.text).toContain("Check: runs `make verify`.");
    expect(result.text).toContain("Landing: opens a pull request.");
    rmSync(project, { recursive: true, force: true });
  });

  it("says which check and landing would be used is not known when no project is found", () => {
    const result = inspect(pack());
    expect(result.status).toBe(0);
    expect(result.text).toContain("No project was found here, so which check and landing would be used is not known.");
  });
});

describe("AC: a folder holding more than a pack should is refused whole", () => {
  it("refuses an unnamed file, naming it and why", () => {
    const dir = pack((d) => writeFileSync(join(d, "notes.txt"), "x\n"));
    expectRefused(inspect(dir), "/notes.txt is not part of a pack", "a pack folder holds only its pack.json");
  });

  it("refuses an unnamed folder, such as a hooks folder", () => {
    const dir = pack((d) => {
      mkdirSync(join(d, "hooks"));
      writeFileSync(join(d, "hooks", "pre.sh"), "x\n");
    });
    expectRefused(inspect(dir), "/hooks is a folder that is not part of a pack", "a pack folder holds only its pack.json");
  });

  it("refuses an instruction file that no workflow uses", () => {
    const dir = pack((d) => writeFileSync(join(d, "extra.md"), "# Extra\n"));
    expectRefused(inspect(dir), "/extra.md is an instruction file that no workflow in pack.json names", "so it is not part of the pack");
  });
});

describe("AC: a link is refused and its content never shown", () => {
  it("refuses a link among the instruction files", () => {
    const target = join(scratch, "secret.txt");
    writeFileSync(target, "SECRET-LINK-CONTENT\n");
    const dir = pack((d) => symlinkSync(target, join(d, "link.md")));
    const result = inspect(dir);
    expectRefused(result, "/link.md is a link", "this command does not follow it");
    expect(result.stdout).not.toContain("SECRET-LINK-CONTENT");
  });

  it("refuses the manifest itself when it is a link", () => {
    const target = join(scratch, "manifest-target.json");
    cpSync(join(REPO_ROOT, "packs", "deprecations", "pack.json"), target);
    const dir = pack((d) => {
      rmSync(join(d, "pack.json"));
      symlinkSync(target, join(d, "pack.json"));
    });
    expectRefused(inspect(dir), "/pack.json is a link", "this command does not follow it");
  });
});

describe("AC: an instruction file that is not valid text is refused and named", () => {
  it("names the file and says it is not valid UTF-8", () => {
    const dir = pack((d) => writeFileSync(join(d, "scan.md"), Buffer.from([0xff, 0xfe, 0x00])));
    expectRefused(inspect(dir), "/scan.md is not valid UTF-8 text", "what is shown could differ from what the agent is given");
  });
});

describe("AC: housekeeping files are allowed, listed as not read, and never printed", () => {
  it("lists README, licence and housekeeping files without printing them", () => {
    const dir = pack((d) => {
      writeFileSync(join(d, "README.md"), "README-SECRET-CONTENT\n");
      writeFileSync(join(d, "LICENSE"), "LICENCE-SECRET-CONTENT\n");
      writeFileSync(join(d, "CHANGELOG.md"), "CHANGELOG-SECRET-CONTENT\n");
      writeFileSync(join(d, ".DS_Store"), "");
      mkdirSync(join(d, ".git"));
      writeFileSync(join(d, ".git", "HEAD"), "ref\n");
    });
    const result = inspect(dir);
    expect(result.status).toBe(0);
    expect(result.text).toContain("Not read when the pack is used, and not shown here:");
    for (const name of ["README.md", "LICENSE", "CHANGELOG.md", ".DS_Store", ".git/"]) expect(result.stdout).toContain(`  ${name}\n`);
    expect(result.stdout).not.toContain("SECRET-CONTENT");
  });
});

describe("AC: problems are shown together, and an unreadable or newer format is refused plainly", () => {
  it("shows a manifest problem alongside a folder problem, each by file", () => {
    const dir = pack((d) => {
      writeFileSync(join(d, "run.sh"), "x\n");
      editManifest(d, { bogus: 1 });
    });
    const result = inspect(dir);
    expect(result.status).not.toBe(0);
    expect(result.text).toContain("/run.sh is not part of a pack");
    expect(result.text).toContain('/pack.json: "bogus" is not part of the pack format');
    expect(result.text).toContain(NOTHING_SHOWN);
  });

  it("says a newer format is newer than this harness reads, and to upgrade", () => {
    const dir = pack((d) => editManifest(d, { schema: "delivery.pack/9" }));
    const result = inspect(dir);
    expect(result.status).not.toBe(0);
    expect(result.text).toContain('"schema" is "delivery.pack/9", a newer pack format than this harness reads');
    expect(result.text).toContain("upgrade delivery-service to read this pack");
    expect(result.text).toContain(NOTHING_SHOWN);
  });

  it("says an unreadable manifest is not valid JSON", () => {
    const dir = pack((d) => writeFileSync(join(d, "pack.json"), "{bad"));
    expectRefused(inspect(dir), "/pack.json is not valid JSON", NOTHING_SHOWN);
  });
});

describe("AC: any refusal ends with a non-zero exit and says nothing was shown", () => {
  it("exits 2 and ends on the nothing-shown sentence", () => {
    const result = inspect(pack((d) => writeFileSync(join(d, "run.sh"), "x\n")));
    expect(result.status).toBe(2);
    expect(result.stdout.trimEnd().split("\n").at(-1)?.trim()).toBe(NOTHING_SHOWN);
  });
});

describe("AC: existing packs that carry a stray file keep running unchanged", () => {
  it("still previews a delivery.pack/2 pack listed by a project, though inspect refuses its stray file", () => {
    const project = initTempRepo("uat-inspect-3-v2-", {
      "package.json": JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } }),
      "delivery.config.json": JSON.stringify({ packs: ["old-pack"] }),
      "old-pack/pack.json": JSON.stringify({ schema: "delivery.pack/2", name: "old", version: "1.0.0", title: "Old", summary: "Old.", scan: { prompt: "scan.md" }, fix: { prompt: "fix.md" } }),
      "old-pack/scan.md": "# Scan\n",
      "old-pack/fix.md": "# Fix\n",
      "old-pack/run.sh": "x\n",
    });
    expect(runDelivery(["review", "old", "--preview"], { cwd: project }).status).toBe(0);
    expect(runDelivery(["packs", "inspect", "./old-pack"], { cwd: project }).status).toBe(2);
    rmSync(project, { recursive: true, force: true });
  });
});

describe("AC: a folder that does not exist, or has no manifest, is reported plainly", () => {
  it("says there is no folder at the path", () => {
    const result = inspect(join(scratch, "does-not-exist"));
    expect(result.status).toBe(2);
    expect(result.text).toContain("there is no folder at this path");
    expect(result.text).toContain(NOTHING_SHOWN);
  });

  it("says a folder without pack.json is not a pack", () => {
    const dir = pack((d) => rmSync(join(d, "pack.json")));
    expectRefused(inspect(dir), "/pack.json is missing, so this folder is not a pack", NOTHING_SHOWN);
  });
});
