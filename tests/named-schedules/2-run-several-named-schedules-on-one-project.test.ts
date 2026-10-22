// Slice 2: Run Several Named Schedules on One Project
// Source: docs/superpowers/specs/2026-10-21-named-schedules-slices.md
// Recorded: 2026-10-22 against commit aeb5e47
//
// Drives the compiled `delivery` command as an operator would, over real
// subprocesses against a scratch git project. The platform scheduler is the
// systemctl stand-in (the contributor-only swap the command already honours),
// so nothing touches the contributor's own systemd and no timer needs to fire:
// "last run" and "next run" in `status` are the evidence a schedule is live.

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { createSystemctlStandIn } from "../../src/systemctl-stand-in.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { TEST_SYSTEMCTL, unitName } from "../../src/cli/schedule/systemd.js";
import { runDelivery } from "../helpers.js";

const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });

function operator() {
  const repo = realpathSync(initTempRepo("uat-ns-2-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "uat-ns-2-config-"));
  const units = join(config, "systemd", "user");
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, PATH: process.env.PATH ?? "/usr/bin" };
  const delivery = (args: string[]) => runDelivery(["schedule", ...args], { cwd: repo, env });
  const unit = (name: string) => unitName(repo, name);
  const timer = (name: string) => readFileSync(join(units, `${unit(name)}.timer`), "utf-8");
  return { repo, units, standIn, delivery, unit, timer };
}

const BLOCK = /Scheduling is on for the (\S+) schedule, every (\S+)\./;

describe("UAT: an hourly and a nightly schedule on the same project", () => {
  it("lists both with their own interval, runs and log command; re-enabling hourly changes only hourly", () => {
    const { standIn, delivery, unit, timer } = operator();

    // Steps 1 and 2: enable hourly and nightly.
    const hourly = delivery(["enable", "--name", "hourly", "--every", "1h"]);
    expect(hourly.status).toBe(EXIT.ok);
    const nightly = delivery(["enable", "--name", "nightly", "--every", "1d"]);
    expect(nightly.status).toBe(EXIT.ok);

    const live = (name: string, next: string) =>
      standIn.showingFor(`${unit(name)}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: next });
    live("hourly", "Thu 2026-10-22 11:00:00 BST");
    live("nightly", "Fri 2026-10-23 00:00:00 BST");

    // Step 3: status lists both.
    const before = delivery(["status"]);
    expect(before.status).toBe(EXIT.ok);
    expect(before.stdout).toContain("Scheduling is on for the hourly schedule, every 1h.");
    expect(before.stdout).toContain("Scheduling is on for the nightly schedule, every 1d.");
    expect(before.stdout).toContain("Thu 2026-10-22 11:00:00 BST");
    expect(before.stdout).toContain("Fri 2026-10-23 00:00:00 BST");
    expect(before.stdout).toContain(`journalctl --user -u ${unit("hourly")}.service`);
    expect(before.stdout).toContain(`journalctl --user -u ${unit("nightly")}.service`);
    const nightlyBefore = timer("nightly");

    // Step 4: enable hourly again with a different interval.
    expect(delivery(["enable", "--name", "hourly", "--every", "6h"]).status).toBe(EXIT.ok);
    const after = delivery(["status"]);
    expect(after.stdout).toContain("Scheduling is on for the hourly schedule, every 6h.");
    expect(after.stdout).not.toContain("every 1h");
    expect(after.stdout).toContain("Scheduling is on for the nightly schedule, every 1d.");
    expect(timer("nightly")).toBe(nightlyBefore);
  });
});

describe("AC: the default schedule is unchanged and sits alongside named ones", () => {
  it("enable without a name sets up the default schedule; a named one is added beside it", () => {
    const { delivery, timer, standIn, unit } = operator();
    expect(delivery(["enable", "--every", "5m"]).status).toBe(EXIT.ok);
    expect(timer("default")).toContain("OnCalendar=*-*-* *:00/5:00");
    expect(delivery(["enable", "--name", "hourly", "--every", "1h"]).status).toBe(EXIT.ok);
    expect(timer("default")).toContain("OnCalendar=*-*-* *:00/5:00");
    standIn.showing({ UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Thu 2026-10-22 11:00:00 BST" });
    const names = [...delivery(["status"]).stdout.matchAll(new RegExp(BLOCK, "g"))].map((m) => m[1]);
    expect(names.sort()).toEqual(["default", "hourly"]);
    expect(unit("default")).not.toBe(unit("hourly"));
  });

  it("a default schedule installed before named schedules existed is still listed and can be disabled", () => {
    const { repo, units, delivery, unit, standIn } = operator();
    mkdirSync(units, { recursive: true });
    const base = unit("default");
    writeFileSync(
      join(units, `${base}.service`),
      `[Unit]\nDescription=delivery run --sources every 1d in ${repo}\n\n[Service]\nType=oneshot\nWorkingDirectory=${repo}\nExecStart=/usr/bin/node /x/main.js run --sources --if-idle\n`,
    );
    writeFileSync(join(units, `${base}.timer`), "[Timer]\nOnCalendar=*-*-* 00:00:00\nPersistent=true\n");
    standIn.showing({ UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Mon 2026-10-19 00:00:00 BST" });
    expect(delivery(["status"]).stdout).toContain("Scheduling is on for the default schedule, every 1d.");
    expect(delivery(["disable"]).status).toBe(EXIT.ok);
    expect(existsSync(join(units, `${base}.timer`))).toBe(false);
  });
});

describe("AC: status", () => {
  it("--name shows only that schedule", () => {
    const { delivery, standIn, unit } = operator();
    delivery(["enable", "--name", "hourly", "--every", "1h"]);
    delivery(["enable", "--name", "nightly", "--every", "1d"]);
    standIn.showingFor(`${unit("nightly")}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
    const only = delivery(["status", "--name", "nightly"]);
    expect(only.status).toBe(EXIT.ok);
    expect(only.stdout).toContain("Scheduling is on for the nightly schedule, every 1d.");
    expect(only.stdout).not.toContain("hourly");
  });

  it("on a project with no schedules says scheduling is off", () => {
    const { delivery } = operator();
    const none = delivery(["status"]);
    expect(none.status).toBe(EXIT.ok);
    expect(none.stdout).toMatch(/Scheduling is off/);
  });
});

describe("AC: a name that cannot be used is refused and nothing is installed", () => {
  it.each(["default", "Nightly", "night_ly", "a".repeat(33)])("refuses %j", (bad) => {
    const { delivery, units, standIn } = operator();
    const refused = delivery(["enable", "--name", bad, "--every", "1h"]);
    expect(refused.status).toBe(EXIT.configuration);
    expect(refused.stderr).not.toBe("");
    expect(existsSync(units)).toBe(false);
    expect(standIn.calls()).toEqual([]);
  });
});

describe("AC: the on message says what happens to a missed run", () => {
  it("states that a missed run happens when the machine is back", () => {
    const { delivery } = operator();
    const on = delivery(["enable", "--name", "hourly", "--every", "1h"]);
    expect(on.stdout).toMatch(/Scheduling is on: .*the hourly schedule/);
    expect(on.stdout).toMatch(/missed while this machine is off/i);
  });
});
