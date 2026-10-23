// Slice 5: Similarly Named Projects Never See or Overwrite Each Other's Schedules
// Source: docs/superpowers/specs/2026-10-21-named-schedules-slices.md
// Recorded: 2026-10-23 against commit 55135b5
//
// Drives the compiled `delivery` command as an operator would, over real
// subprocesses against scratch git projects whose paths differ only by a
// suffix. The platform scheduler is the systemctl stand-in (the contributor-only
// swap the command already honours), so nothing touches the contributor's own systemd.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { createSystemctlStandIn } from "../../src/systemctl-stand-in.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { TEST_SYSTEMCTL, unitName } from "../../src/cli/schedule/systemd.js";
import { DEFAULT_NAME } from "../../src/cli/schedule/model.js";
import { runDelivery } from "../helpers.js";

const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });

function machine() {
  const repo = realpathSync(initTempRepo("uat-ns-5-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "uat-ns-5-config-"));
  const units = join(config, "systemd", "user");
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, PATH: process.env.PATH ?? "/usr/bin" };
  const run = (cwd: string, args: string[]) => runDelivery(["schedule", ...args], { cwd, env });
  /** A second project beside `repo` whose path is `repo` + suffix, so the two share a path prefix. */
  const sibling = (suffix: string): string => {
    const path = repo + suffix;
    mkdirSync(path);
    writeFileSync(join(path, "package.json"), PACKAGE);
    execFileSync("git", ["init", "-q"], { cwd: path });
    return realpathSync(path);
  };
  const live = (cwd: string, name: string = DEFAULT_NAME) =>
    standIn.showingFor(`${unitName(cwd, name)}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
  const enable = (cwd: string, name?: string) => {
    expect(run(cwd, ["enable", ...(name ? ["--name", name] : []), "--every", "1h"]).status).toBe(EXIT.ok);
    live(cwd, name);
  };
  const unitFiles = () => (existsSync(units) ? readdirSync(units).sort() : []);
  const snapshot = () => unitFiles().map((file) => [file, readFileSync(join(units, file), "utf-8")]);
  return { repo, units, standIn, run, sibling, enable, live, unitFiles, snapshot };
}

describe("UAT: two similarly pathed projects each enable a schedule", () => {
  it("each lists only its own; disabling the first leaves the second unchanged; a colliding name is refused", () => {
    const { repo, sibling, run, enable, snapshot } = machine();
    const other = sibling(".nightly");

    // Step 1: enable a schedule on each project.
    enable(repo, "hourly");
    enable(other, "weekly");

    // Step 2: each project's status lists only its own schedule.
    const mine = run(repo, ["status"]).stdout;
    expect(mine).toContain("Scheduling is on for the hourly schedule");
    expect(mine).not.toContain("weekly");
    const theirs = run(other, ["status"]).stdout;
    expect(theirs).toContain("Scheduling is on for the weekly schedule");
    expect(theirs).not.toContain("hourly");

    // Step 3: disable everything on the first; the second is unchanged.
    expect(run(repo, ["disable", "--all"]).status).toBe(EXIT.ok);
    expect(run(repo, ["status"]).stdout).toContain(`Scheduling is off for ${repo}`);
    expect(run(other, ["status"]).stdout).toBe(theirs);

    // Step 4: the other project's default unit is where `nightly` would land on this project.
    enable(other);
    const before = snapshot();
    const refused = run(repo, ["enable", "--name", "nightly", "--every", "1h"]);
    expect(refused.status).toBe(EXIT.configuration);
    expect(refused.stderr).toContain("already keeps a schedule in its place for another project");
    expect(refused.stderr).toContain(other);
    expect(refused.stderr).toContain("Nothing was changed");
    expect(snapshot()).toEqual(before);
  });
});

describe("AC: projects at /a/b and /a/b.c see only their own schedules and disable separately", () => {
  it("disabling the shorter path never removes the longer path's schedules", () => {
    const { repo, sibling, run, enable, unitFiles } = machine();
    const other = sibling(".c");
    enable(repo);
    enable(repo, "nightly");
    enable(other, "hourly");
    const mine = run(repo, ["status"]).stdout;
    expect(mine).toContain("the default schedule");
    expect(mine).toContain("the nightly schedule");
    expect(mine).not.toContain("the hourly schedule");
    const theirs = run(other, ["status"]).stdout;
    expect(theirs).toContain("the hourly schedule");
    expect(theirs).not.toContain("the nightly schedule");
    expect(run(repo, ["disable", "--all"]).status).toBe(EXIT.ok);
    expect(unitFiles()).toEqual([`${unitName(other, "hourly")}.service`, `${unitName(other, "hourly")}.timer`]);
    expect(run(other, ["status"]).stdout).toContain("the hourly schedule");
  });
});

describe("AC: an older unlabelled default schedule is listed as default for its own project", () => {
  it("is attributed to the project in its recorded folder, and to no sibling", () => {
    const { repo, units, sibling, run, standIn } = machine();
    const other = sibling(".c");
    mkdirSync(units, { recursive: true });
    const name = unitName(repo, DEFAULT_NAME);
    writeFileSync(
      join(units, `${name}.service`),
      `[Unit]\nDescription=delivery run --sources every 1d in ${repo}\n\n[Service]\nType=oneshot\nWorkingDirectory=${repo}\nExecStart=/usr/bin/node /x/main.js run --sources\n`,
    );
    writeFileSync(join(units, `${name}.timer`), "[Timer]\nOnCalendar=*-*-* 00:00:00\nPersistent=true\n");
    standIn.showingFor(`${name}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "" });
    expect(run(repo, ["status"]).stdout).toContain("Scheduling is on for the default schedule");
    expect(run(other, ["status"]).stdout).toContain(`Scheduling is off for ${other}`);
  });
});

describe("AC: enabling a name another project holds is refused and writes nothing", () => {
  it("names the problem and leaves every unit and scheduler call untouched", () => {
    const { repo, sibling, run, enable, snapshot, standIn } = machine();
    const other = sibling(".nightly");
    enable(other);
    const before = snapshot();
    const calls = standIn.calls().length;
    const refused = run(repo, ["enable", "--name", "nightly", "--every", "1h"]);
    expect(refused.status).toBe(EXIT.configuration);
    expect(refused.stderr).toContain("another project");
    expect(snapshot()).toEqual(before);
    expect(standIn.calls().slice(calls)).toEqual(["--user show-environment"]);
  });
});

describe("AC: re-enabling the default on a project with an older default timer replaces it cleanly", () => {
  it("leaves one labelled default pair with the new interval", () => {
    const { repo, units, run, standIn, unitFiles } = machine();
    mkdirSync(units, { recursive: true });
    const name = unitName(repo, DEFAULT_NAME);
    writeFileSync(
      join(units, `${name}.service`),
      `[Unit]\nDescription=delivery run --sources every 1d in ${repo}\n\n[Service]\nType=oneshot\nWorkingDirectory=${repo}\nExecStart=/usr/bin/node /x/main.js run --sources\n`,
    );
    writeFileSync(join(units, `${name}.timer`), "[Timer]\nOnCalendar=*-*-* 00:00:00\nPersistent=true\n");
    expect(run(repo, ["enable", "--every", "6h"]).status).toBe(EXIT.ok);
    standIn.showingFor(`${name}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "" });
    expect(readFileSync(join(units, `${name}.service`), "utf-8")).toContain("X-Delivery-Schedule=default");
    expect(readFileSync(join(units, `${name}.timer`), "utf-8")).toContain("OnCalendar=*-*-* 00/6:00:00");
    expect(unitFiles()).toEqual([`${name}.service`, `${name}.timer`]);
    const status = run(repo, ["status"]).stdout;
    expect(status).toContain("Scheduling is on for the default schedule, every 6h.");
    expect(status.match(/Scheduling is/g)).toHaveLength(1);
  });
});
