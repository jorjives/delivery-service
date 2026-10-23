// Slice 6: Machines Without a Scheduler Get a Crontab Line per Schedule, and the Docs Say How
// Source: docs/superpowers/specs/2026-10-21-named-schedules-slices.md
// Recorded: 2026-10-23 against commit 722fcb2
//
// Drives the compiled `delivery` command as an operator on a machine with no scheduler
// backend would (the platform seam names darwin), over real subprocesses against a scratch
// git project. Nothing touches the contributor's own systemd or crontab.

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../src/cli/failures.js";
import { createSystemctlStandIn } from "../../src/systemctl-stand-in.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { TEST_SYSTEMCTL } from "../../src/cli/schedule/systemd.js";
import { TEST_PLATFORM } from "../../src/cli/schedule/backend.js";
import { REPO_ROOT, runDelivery } from "../helpers.js";

const PACKAGE = JSON.stringify({ name: "scratch", private: true, scripts: { test: "exit 0" } });

function machine(platform: string) {
  const repo = realpathSync(initTempRepo("uat-ns-6-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "uat-ns-6-config-"));
  const units = join(config, "systemd", "user");
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, [TEST_PLATFORM]: platform, PATH: process.env.PATH ?? "/usr/bin" };
  const enable = (...args: string[]) => runDelivery(["schedule", "enable", ...args], { cwd: repo, env });
  return { repo, units, standIn, enable };
}

const cronLines = (stderr: string) => stderr.split("\n").filter((line) => line.includes(" run --sources"));

describe("UAT: enabling nightly where there is no scheduler", () => {
  it("is refused plainly, prints one crontab line with interval, workflow and idle option, and notes missed runs", () => {
    const { repo, units, standIn, enable } = machine("darwin");

    // Step 1: try to enable a schedule named nightly with a workflow.
    const { status, stderr } = enable("--name", "nightly", "--every", "1d", "--workflow", "deep");

    // Step 2: a clear refusal, nothing installed.
    expect(status).toBe(EXIT.configuration);
    expect(stderr).toContain("darwin has no scheduler backend yet");
    expect(existsSync(units)).toBe(false);
    expect(standIn.calls()).toEqual([]);

    // AC: exactly one line, with the interval, workflow and idle option.
    const lines = cronLines(stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^0 0 \* \* \* cd /);
    expect(lines[0]).toContain(repo);
    expect(lines[0]).toMatch(/run --sources --workflow deep .*--if-idle$/);

    // AC: the missed-run caveat.
    expect(stderr).toContain("Cron skips a run missed while the machine is off");
  });
});

describe("AC: the printed line matches an installed schedule", () => {
  it("carries the same run arguments as the unit an installed schedule runs", () => {
    const args = ["--name", "nightly", "--every", "1d", "--workflow", "deep", "--max", "3"];
    const printed = cronLines(machine("darwin").enable(...args).stderr)[0] ?? "";
    const runArgs = printed.slice(printed.indexOf(" run --sources") + 1);

    const linux = machine("linux");
    expect(linux.enable(...args).status).toBe(EXIT.ok);
    const service = readdirSync(linux.units).find((file) => file.endsWith(".service"));
    expect(service).toBeDefined();
    const unit = readFileSync(join(linux.units, service as string), "utf-8");
    const normalise = (text: string) => text.replace(/['"]/g, "");
    expect(normalise(unit)).toContain(normalise(runArgs));
  });

  it("gives each schedule its own line, one per enable", () => {
    const { enable } = machine("darwin");
    const hourly = cronLines(enable("--name", "hourly", "--every", "1h").stderr);
    const nightly = cronLines(enable("--name", "nightly", "--every", "1d").stderr);
    expect(hourly).toHaveLength(1);
    expect(nightly).toHaveLength(1);
    expect(hourly[0]).toMatch(/^0 \*\/1 \* \* \* /);
    expect(nightly[0]).toMatch(/^0 0 \* \* \* /);
  });
});

describe("AC: the documentation and release note", () => {
  const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");
  const guide = read("docs/run-on-a-schedule.md");

  it("the guide covers naming, the idle option, exclusion and a worked two-schedule example", () => {
    expect(guide).toContain("## Run more than one schedule");
    expect(guide).toContain("## Give a schedule its own settings");
    expect(guide).toContain("## Worked example: two schedules on one project");
    expect(guide).toContain("## When runs overlap");
    expect(guide).toContain("## Use cron where there is no scheduler");
    expect(guide).toContain("--if-idle");
    for (const command of ["schedule enable", "schedule status", "schedule disable"]) expect(guide).toContain(`delivery ${command}`);
  });

  it("the CLI reference describes the three commands, --name and the no-backend refusal", () => {
    const reference = read("docs/cli-reference.md");
    for (const command of ["schedule enable", "schedule status", "schedule disable"]) expect(reference).toContain(`delivery ${command}`);
    expect(reference).toContain("--name <name>");
    expect(reference).toContain("has no scheduler backend yet");
  });

  it("a release note describes the change", () => {
    expect(read(".changeset/use-named-schedules-without-a-scheduler.md").trim().length).toBeGreaterThan(0);
  });
});
