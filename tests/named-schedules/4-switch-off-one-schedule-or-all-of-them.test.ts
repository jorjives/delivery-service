// Slice 4: Switch Off One Schedule, or All of Them
// Source: docs/superpowers/specs/2026-10-21-named-schedules-slices.md
// Recorded: 2026-10-23 against commit 2b2706b
//
// Drives the compiled `delivery` command as an operator would, over real
// subprocesses against a scratch git project. The platform scheduler is the
// systemctl stand-in (the contributor-only swap the command already honours),
// so nothing touches the contributor's own systemd and no timer needs to fire.

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { createSystemctlStandIn } from "../../src/systemctl-stand-in.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { TEST_SYSTEMCTL, unitName } from "../../src/cli/schedule/systemd.js";
import { DEFAULT_NAME } from "../../src/cli/schedule/model.js";
import { runDelivery } from "../helpers.js";

const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });

function operator() {
  const repo = realpathSync(initTempRepo("uat-ns-4-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "uat-ns-4-config-"));
  const units = join(config, "systemd", "user");
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, PATH: process.env.PATH ?? "/usr/bin" };
  const delivery = (args: string[]) => runDelivery(["schedule", ...args], { cwd: repo, env });
  const live = (name: string = DEFAULT_NAME) =>
    standIn.showingFor(`${unitName(repo, name)}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
  const unitFiles = () => (existsSync(units) ? readdirSync(units).sort() : []);
  /** Enable the named schedules (the default schedule when a name is undefined) and mark them live. */
  const enableAll = (...names: (string | undefined)[]) =>
    names.forEach((name) => {
      const flags = name ? ["--name", name] : [];
      expect(delivery(["enable", ...flags, "--every", "1h"]).status).toBe(EXIT.ok);
      live(name);
    });
  return { repo, standIn, delivery, live, unitFiles, enableAll };
}

describe("UAT: hourly and nightly enabled, nightly switched off, then everything", () => {
  it("removes only nightly; a repeat says it is already off; name plus --all is refused; --all leaves scheduling off", () => {
    const { repo, delivery, enableAll, unitFiles } = operator();
    enableAll("hourly", "nightly");

    // Step 1: disable nightly by name; status lists only hourly.
    const off = delivery(["disable", "--name", "nightly"]);
    expect(off.status).toBe(EXIT.ok);
    expect(off.stdout).toContain("Scheduling is off for the nightly schedule");
    const afterOne = delivery(["status"]);
    expect(afterOne.status).toBe(EXIT.ok);
    expect(afterOne.stdout).toContain("Scheduling is on for the hourly schedule");
    expect(afterOne.stdout).not.toContain("nightly");

    // Step 2: nightly again says it is already off.
    const again = delivery(["disable", "--name", "nightly"]);
    expect(again.status).toBe(EXIT.ok);
    expect(again.stdout).toContain("already off for the nightly schedule");

    // Step 3: name and --all together is refused, and hourly survives.
    const filesBefore = unitFiles();
    const both = delivery(["disable", "--name", "hourly", "--all"]);
    expect(both.status).toBe(EXIT.configuration);
    expect(both.stderr).toContain("--name");
    expect(both.stderr).toContain("--all");
    expect(unitFiles()).toEqual(filesBefore);
    expect(delivery(["status"]).stdout).toContain("Scheduling is on for the hourly schedule");

    // Step 4: --all leaves scheduling off for the project.
    const all = delivery(["disable", "--all"]);
    expect(all.status).toBe(EXIT.ok);
    expect(unitFiles()).toEqual([]);
    const final = delivery(["status"]);
    expect(final.status).toBe(EXIT.ok);
    expect(final.stdout).toContain(`Scheduling is off for ${repo}`);
    expect(final.stdout).not.toContain("hourly");
  });
});

describe("AC: disable with no options removes only the default schedule", () => {
  it("leaves the named schedule in place", () => {
    const { delivery, enableAll } = operator();
    enableAll(undefined, "hourly");
    const off = delivery(["disable"]);
    expect(off.status).toBe(EXIT.ok);
    expect(off.stdout).toContain("Scheduling is off for the default schedule");
    const status = delivery(["status"]).stdout;
    expect(status).toContain("Scheduling is on for the hourly schedule");
    expect(status).not.toContain("default schedule");
  });
});

describe("AC: disable --name removes that schedule only", () => {
  it("leaves the default and other named schedules in place", () => {
    const { delivery, enableAll } = operator();
    enableAll(undefined, "hourly", "nightly");
    expect(delivery(["disable", "--name", "hourly"]).status).toBe(EXIT.ok);
    const status = delivery(["status"]).stdout;
    expect(status).toContain("Scheduling is on for the nightly schedule");
    expect(status).toContain("Scheduling is on for the default schedule");
    expect(status).not.toContain("hourly");
  });
});

describe("AC: disable --all removes every schedule on the project", () => {
  it("removes the default and all named schedules", () => {
    const { delivery, enableAll, unitFiles } = operator();
    enableAll(undefined, "hourly", "nightly");
    expect(delivery(["disable", "--all"]).status).toBe(EXIT.ok);
    expect(unitFiles()).toEqual([]);
    const status = delivery(["status"]).stdout;
    expect(status).not.toContain("hourly");
    expect(status).not.toContain("nightly");
    expect(status).not.toContain("default schedule");
  });
});

describe("AC: disabling a schedule that does not exist changes nothing", () => {
  it("says it is already off and leaves the others alone", () => {
    const { delivery, enableAll, unitFiles } = operator();
    enableAll("hourly");
    const before = unitFiles();
    const missing = delivery(["disable", "--name", "ghost"]);
    expect(missing.status).toBe(EXIT.ok);
    expect(missing.stdout).toContain("already off for the ghost schedule");
    expect(unitFiles()).toEqual(before);
  });
});

describe("AC: running the project by hand is unaffected", () => {
  it("the run command is still offered after a removal", () => {
    const { delivery, enableAll } = operator();
    enableAll("hourly");
    const off = delivery(["disable", "--all"]);
    expect(off.stdout).toContain("You can still run it by hand at any time: delivery run --sources");
  });
});
