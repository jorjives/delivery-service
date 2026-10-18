import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { createSystemctlStandIn } from "../systemctl-stand-in.js";
import { delivery, PACKAGE } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { findRepository } from "./project.js";
import { badInterval, TEST_SYSTEMCTL, unitName } from "./schedule.js";
import { alreadyOff, journalHint, lastRun, nextRun, NO_SYSTEMCTL, scheduledOff, scheduledOn, turnedOff } from "./schedule-command.js";

async function project() {
  const repo = await findRepository(initTempRepo("schedule-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "schedule-config-"));
  const units = join(config, "systemd", "user");
  const name = unitName(repo);
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, PATH: "/opt/tools:/usr/bin" };
  return { repo, units, name, standIn, env };
}

describe("delivery schedule enable", () => {
  it("installs and starts a timer running delivery run --sources on the interval, catching up missed runs", async () => {
    const { repo, units, name, standIn, env } = await project();
    const { exitCode, stdout } = await delivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    const timer = readFileSync(join(units, `${name}.timer`), "utf-8");
    const service = readFileSync(join(units, `${name}.service`), "utf-8");
    expect(timer).toContain("OnCalendar=*-*-* *:00/5:00");
    expect(timer).toContain("Persistent=true");
    expect(service).toContain(`WorkingDirectory=${repo}`);
    expect(service).toContain('Environment="PATH=/opt/tools:/usr/bin"');
    expect(service).toMatch(/^ExecStart=".+" ".+main\.js" run --sources$/m);
    expect(standIn.calls()).toEqual([
      "--user show-environment",
      "--user daemon-reload",
      `--user enable ${name}.timer`,
      `--user restart ${name}.timer`,
    ]);
    expect(stdout).toContain(scheduledOn(`delivery run --sources every 5m in ${repo}`));
    expect(stdout).toContain(journalHint(name));
  });

  it("runs once a day when no interval is given", async () => {
    const { repo, units, name, env } = await project();
    expect((await delivery(["schedule", "enable"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    expect(readFileSync(join(units, `${name}.timer`), "utf-8")).toContain("OnCalendar=*-*-* 00:00:00");
  });

  it("changes the interval when enabled again", async () => {
    const { repo, units, name, env } = await project();
    await delivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--every", "6h"], { cwd: repo, env });
    expect(readFileSync(join(units, `${name}.timer`), "utf-8")).toContain("OnCalendar=*-*-* 00/6:00:00");
  });

  it("refuses an interval it cannot schedule, touching nothing", async () => {
    const { repo, units, standIn, env } = await project();
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--every", "7m"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(badInterval("7m"));
    expect(existsSync(units)).toBe(false);
    expect(standIn.calls()).toEqual([]);
  });

  it("refuses where systemd has no user manager, giving the equivalent cron line", async () => {
    const { repo, units, standIn, env } = await project();
    standIn.noBus();
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain("Failed to connect to bus: No medium found");
    expect(stderr).toContain(`*/5 * * * * cd '${repo}' && PATH='/opt/tools:/usr/bin' '${process.execPath}' '`);
    expect(stderr).toMatch(/main\.js' run --sources$/m);
    expect(existsSync(units)).toBe(false);
  });

  it("refuses where systemctl is not installed, giving the equivalent cron line", async () => {
    const { repo, units, env } = await project();
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--every", "1h"], {
      cwd: repo,
      env: { ...env, [TEST_SYSTEMCTL]: join(tmpdir(), "no-such-systemctl", "systemctl") },
    });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(NO_SYSTEMCTL);
    expect(stderr).toMatch(/^0 \*\/1 \* \* \* cd /m);
    expect(existsSync(units)).toBe(false);
  });
});

describe("delivery schedule status", () => {
  it("says scheduling is on, and when it last and next ran, as systemd reports", async () => {
    const { repo, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    standIn.showing({
      UnitFileState: "enabled",
      Description: `delivery run --sources every 5m in ${repo}`,
      LastTriggerUSec: "Sun 2026-10-18 12:00:00 BST",
      NextElapseUSecRealtime: "Sun 2026-10-18 12:05:00 BST",
    });
    const { exitCode, stdout } = await delivery(["schedule", "status"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(scheduledOn(`delivery run --sources every 5m in ${repo}`));
    expect(stdout).toContain(lastRun("Sun 2026-10-18 12:00:00 BST"));
    expect(stdout).toContain(nextRun("Sun 2026-10-18 12:05:00 BST"));
    expect(stdout).toContain(journalHint(name));
    expect(standIn.calls().at(-1)).toBe(
      `--user show ${name}.timer -p UnitFileState -p Description -p LastTriggerUSec -p NextElapseUSecRealtime`,
    );
  });

  it("says a timer that has never fired has not run yet", async () => {
    const { repo, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    standIn.showing({ UnitFileState: "enabled", Description: "d", LastTriggerUSec: "", NextElapseUSecRealtime: "Mon 2026-10-19 00:00:00 BST" });
    expect((await delivery(["schedule", "status"], { cwd: repo, env })).stdout).toContain(lastRun("not yet"));
  });

  it("says scheduling is off for a project that never turned it on, without asking systemd", async () => {
    const { repo, standIn, env } = await project();
    const { exitCode, stdout } = await delivery(["schedule", "status"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(scheduledOff(repo));
    expect(standIn.calls()).toEqual([]);
  });

  it("says scheduling is off when the timer was disabled outside delivery", async () => {
    const { repo, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    standIn.showing({ UnitFileState: "disabled", Description: "d", LastTriggerUSec: "", NextElapseUSecRealtime: "" });
    expect((await delivery(["schedule", "status"], { cwd: repo, env })).stdout).toContain(scheduledOff(repo));
  });
});

describe("delivery schedule disable", () => {
  it("stops and removes the timer, leaving the project to run by hand", async () => {
    const { repo, units, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    const { exitCode, stdout } = await delivery(["schedule", "disable"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(turnedOff(repo));
    expect(existsSync(join(units, `${name}.timer`))).toBe(false);
    expect(existsSync(join(units, `${name}.service`))).toBe(false);
    expect(standIn.calls().slice(-2)).toEqual([`--user disable --now ${name}.timer`, "--user daemon-reload"]);
    expect((await delivery(["schedule", "status"], { cwd: repo, env })).stdout).toContain(scheduledOff(repo));
  });

  it("says it is already off when there is nothing to turn off", async () => {
    const { repo, standIn, env } = await project();
    const { exitCode, stdout } = await delivery(["schedule", "disable"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(alreadyOff(repo));
    expect(standIn.calls()).toEqual([]);
  });
});
