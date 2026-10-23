// Slice 3: Give a Schedule Its Own Run Settings
// Source: docs/superpowers/specs/2026-10-21-named-schedules-slices.md
// Recorded: 2026-10-23 against commit 210260b
//
// Drives the compiled `delivery` command as an operator would, over real
// subprocesses against a scratch git project. The platform scheduler is the
// systemctl stand-in (the contributor-only swap the command already honours),
// so nothing touches the contributor's own systemd and no timer needs to fire.

import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { createSystemctlStandIn } from "../../src/systemctl-stand-in.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { TEST_SYSTEMCTL, unitName } from "../../src/cli/schedule/systemd.js";
import { runDelivery } from "../helpers.js";

const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });

function operator() {
  const repo = realpathSync(initTempRepo("uat-ns-3-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "uat-ns-3-config-"));
  const units = join(config, "systemd", "user");
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, PATH: process.env.PATH ?? "/usr/bin" };
  const delivery = (args: string[]) => runDelivery(["schedule", ...args], { cwd: repo, env });
  const showing = (name: string) =>
    standIn.showingFor(`${unitName(repo, name)}.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
  const unitFiles = () => (existsSync(units) ? readdirSync(units).sort() : []);
  return { repo, config, units, standIn, delivery, showing, unitFiles };
}

/** The status block for one schedule, from its heading to the next blank line. */
const block = (stdout: string, name: string): string =>
  stdout.split("\n\n").find((part) => part.includes(`for the ${name} schedule`)) ?? "";

describe("UAT: a nightly schedule with its own settings beside a plain hourly one", () => {
  it("lists each schedule's own settings; re-enabling nightly drops the max and config; a missing config is refused and changes nothing", () => {
    const { repo, standIn, delivery, showing, unitFiles } = operator();
    const nightlyConfig = join(repo, "nightly.config.json");
    writeFileSync(nightlyConfig, "{}");

    // Step 1: nightly with a workflow, a maximum of three and a config file.
    const nightly = delivery(["enable", "--name", "nightly", "--every", "1d", "--workflow", "thorough", "--max", "3", "--config", "nightly.config.json"]);
    expect(nightly.status).toBe(EXIT.ok);
    // Step 2: hourly with no extra settings.
    expect(delivery(["enable", "--name", "hourly", "--every", "1h"]).status).toBe(EXIT.ok);
    showing("nightly");
    showing("hourly");

    // Step 3: status shows each schedule's own settings.
    const before = delivery(["status"]);
    expect(before.status).toBe(EXIT.ok);
    const nightlyBlock = block(before.stdout, "nightly");
    expect(nightlyBlock).toContain("every 1d");
    expect(nightlyBlock).toContain("--workflow thorough");
    expect(nightlyBlock).toContain("--max 3");
    expect(nightlyBlock).toContain(`--config ${nightlyConfig}`);
    const hourlyBlock = block(before.stdout, "hourly");
    expect(hourlyBlock).toContain("every 1h");
    expect(hourlyBlock).toContain("Run settings: none");
    expect(hourlyBlock).not.toContain("--workflow");

    // Step 4: re-enable nightly with only the workflow; the rest is cleared.
    expect(delivery(["enable", "--name", "nightly", "--every", "1d", "--workflow", "thorough"]).status).toBe(EXIT.ok);
    const after = block(delivery(["status"]).stdout, "nightly");
    expect(after).toContain("--workflow thorough");
    expect(after).not.toContain("--max");
    expect(after).not.toContain("--config");

    // Step 5: a config file that does not exist is refused; nothing changes.
    const filesBefore = unitFiles();
    const callsBefore = standIn.calls().length;
    const refused = delivery(["enable", "--name", "weekly", "--every", "1d", "--config", "missing.json"]);
    expect(refused.status).toBe(EXIT.configuration);
    expect(refused.stderr).toContain("missing.json");
    expect(unitFiles()).toEqual(filesBefore);
    expect(standIn.calls().length).toBe(callsBefore);
  });
});

describe("AC: refusals give a configuration message and install nothing", () => {
  it.each([
    ["a maximum of zero", ["--max", "0"]],
    ["a non-numeric maximum", ["--max", "lots"]],
    ["a fractional maximum", ["--max", "1.5"]],
    ["a negative concurrency", ["--concurrency", "-2"]],
    ["a zero concurrency", ["--concurrency", "0"]],
    ["an empty workflow name", ["--workflow", ""]],
    ["a config file that does not exist", ["--config", "nope.json"]],
  ])("refuses %s", (_label, flags) => {
    const { delivery, unitFiles, standIn } = operator();
    const refused = delivery(["enable", "--name", "nightly", "--every", "1d", ...flags]);
    expect(refused.status).toBe(EXIT.configuration);
    expect(refused.stderr).not.toBe("");
    expect(unitFiles()).toEqual([]);
    expect(standIn.calls()).toEqual([]);
  });

  it("a refusal on re-enable leaves the installed schedule as it was", () => {
    const { delivery, showing } = operator();
    expect(delivery(["enable", "--name", "nightly", "--every", "1d", "--max", "3"]).status).toBe(EXIT.ok);
    expect(delivery(["enable", "--name", "nightly", "--every", "1d", "--max", "0"]).status).toBe(EXIT.configuration);
    showing("nightly");
    expect(block(delivery(["status"]).stdout, "nightly")).toContain("--max 3");
  });
});

describe("AC: settings are stored and shown", () => {
  it("a config that exists is stored as its full path, and concurrency is kept", () => {
    const { repo, delivery, showing } = operator();
    writeFileSync(join(repo, "c.json"), "{}");
    const on = delivery(["enable", "--name", "nightly", "--every", "1d", "--config", "c.json", "--concurrency", "2"]);
    expect(on.status).toBe(EXIT.ok);
    expect(on.stdout).toContain(`--config ${join(repo, "c.json")}`);
    showing("nightly");
    const shown = block(delivery(["status", "--name", "nightly"]).stdout, "nightly");
    expect(shown).toContain(`--config ${join(repo, "c.json")}`);
    expect(shown).toContain("--concurrency 2");
  });
});

describe("AC: the cron fallback line carries the same settings", () => {
  it("prints the settings in the crontab line when the machine has no systemd timers", () => {
    const { repo, standIn, delivery, unitFiles } = operator();
    writeFileSync(join(repo, "c.json"), "{}");
    standIn.noBus();
    const refused = delivery(["enable", "--name", "nightly", "--every", "1d", "--workflow", "thorough", "--max", "3", "--concurrency", "2", "--config", "c.json"]);
    expect(refused.status).not.toBe(EXIT.ok);
    const line = refused.stderr.split("\n").find((l) => l.includes("run --sources")) ?? "";
    expect(line).toContain("--workflow thorough");
    expect(line).toContain("--max 3");
    expect(line).toContain("--concurrency 2");
    expect(line).toContain(`--config ${join(repo, "c.json")}`);
    expect(unitFiles()).toEqual([]);
  });
});

describe("AC: task and fresh options are not accepted for a schedule", () => {
  it.each([["--task", "do it"], ["--fresh"]])("refuses %s", (...flags) => {
    const { delivery, unitFiles } = operator();
    const refused = delivery(["enable", "--every", "1d", ...flags]);
    expect(refused.status).not.toBe(EXIT.ok);
    expect(unitFiles()).toEqual([]);
  });
});
