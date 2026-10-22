import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTempRepo } from "../temp-repo.js";
import { createSystemctlStandIn } from "../systemctl-stand-in.js";
import { delivery, PACKAGE } from "./command-fixtures.js";
import { EXIT } from "./failures.js";
import { findRepository } from "./project.js";
import { badInterval, badName } from "./schedule/model.js";
import { NO_SYSTEMCTL, TEST_SYSTEMCTL, unitName } from "./schedule/systemd.js";
import { alreadyOff, journalHint, lastRun, nextRun, noSuchSchedule, scheduledOff, scheduledOn, turnedOff } from "./schedule-command.js";

async function project() {
  const repo = await findRepository(initTempRepo("schedule-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "schedule-config-"));
  const units = join(config, "systemd", "user");
  const name = unitName(repo, "default");
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
    expect(service).toMatch(/^ExecStart=".+" ".+main\.js" run --sources --if-idle$/m);
    expect(standIn.calls()).toEqual([
      "--user show-environment",
      "--user daemon-reload",
      `--user enable ${name}.timer`,
      `--user restart ${name}.timer`,
    ]);
    expect(stdout).toContain(scheduledOn(`delivery run --sources every 5m in ${repo}`, true));
    expect(stdout).toContain(journalHint(`journalctl --user -u ${name}.service`));
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
    expect(stderr).toMatch(/main\.js' run --sources --if-idle$/m);
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

  it("sets up a named schedule alongside the default one", async () => {
    const { repo, units, name, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    const { exitCode, stdout } = await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(readFileSync(join(units, `${name}.hourly.timer`), "utf-8")).toContain("OnCalendar=*-*-* 00/1:00:00");
    expect(readFileSync(join(units, `${name}.timer`), "utf-8")).toContain("OnCalendar=*-*-* 00:00:00");
    expect(standIn.calls().slice(-3)).toEqual(["--user daemon-reload", `--user enable ${name}.hourly.timer`, `--user restart ${name}.hourly.timer`]);
    expect(stdout).toContain(scheduledOn(`the hourly schedule, delivery run --sources every 1h in ${repo}`, true));
    expect(stdout).toContain(journalHint(`journalctl --user -u ${name}.hourly.service`));
  });

  it("enabling a name again replaces that schedule only", async () => {
    const { repo, units, name, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    const defaultBefore = readFileSync(join(units, `${name}.timer`), "utf-8");
    const nightlyBefore = readFileSync(join(units, `${name}.nightly.timer`), "utf-8");
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "6h"], { cwd: repo, env });
    expect(readFileSync(join(units, `${name}.hourly.timer`), "utf-8")).toContain("OnCalendar=*-*-* 00/6:00:00");
    expect(readFileSync(join(units, `${name}.timer`), "utf-8")).toBe(defaultBefore);
    expect(readFileSync(join(units, `${name}.nightly.timer`), "utf-8")).toBe(nightlyBefore);
  });

  it.each(["", "default", "Nightly", "night_ly", "a".repeat(33)])("refuses the name %j, touching nothing", async (bad) => {
    const { repo, units, standIn, env } = await project();
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--name", bad, "--every", "1h"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(badName(bad));
    expect(existsSync(units)).toBe(false);
    expect(standIn.calls()).toEqual([]);
  });

  it("gives the scheduled-on line the skipped wording when the scheduler does not catch up", () => {
    expect(scheduledOn("d", false)).toBe("Scheduling is on: d. A run missed while this machine is off is skipped.");
  });
});

describe("delivery schedule status", () => {
  it("says scheduling is on, and when it last and next ran, as systemd reports", async () => {
    const { repo, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    standIn.showing({
      UnitFileState: "enabled",
      LastTriggerUSec: "Sun 2026-10-18 12:00:00 BST",
      NextElapseUSecRealtime: "Sun 2026-10-18 12:05:00 BST",
    });
    const { exitCode, stdout } = await delivery(["schedule", "status"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain("Scheduling is on for the default schedule, every 5m.");
    expect(stdout).toContain(lastRun("Sun 2026-10-18 12:00:00 BST"));
    expect(stdout).toContain(nextRun("Sun 2026-10-18 12:05:00 BST"));
    expect(stdout).toContain(journalHint(`journalctl --user -u ${name}.service`));
    expect(standIn.calls().at(-1)).toBe(`--user show ${name}.timer -p UnitFileState -p LastTriggerUSec -p NextElapseUSecRealtime`);
  });

  it("says a timer that has never fired has not run yet", async () => {
    const { repo, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    standIn.showing({ UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Mon 2026-10-19 00:00:00 BST" });
    expect((await delivery(["schedule", "status"], { cwd: repo, env })).stdout).toContain(lastRun("not yet"));
  });

  it("lists every schedule, one block each, with its own interval, runs and log command", async () => {
    const { repo, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    standIn.showingFor(`${name}.hourly.timer`, {
      UnitFileState: "enabled",
      LastTriggerUSec: "Thu 2026-10-22 10:00:00 BST",
      NextElapseUSecRealtime: "Thu 2026-10-22 11:00:00 BST",
    });
    standIn.showingFor(`${name}.nightly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
    const { exitCode, stdout } = await delivery(["schedule", "status"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(
      [
        "Scheduling is on for the hourly schedule, every 1h.",
        lastRun("Thu 2026-10-22 10:00:00 BST"),
        nextRun("Thu 2026-10-22 11:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.hourly.service`),
        "",
        "Scheduling is on for the nightly schedule, every 1d.",
        lastRun("not yet"),
        nextRun("Fri 2026-10-23 00:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.nightly.service`),
        "",
      ].join("\n"),
    );
  });

  it("shows only the schedule named", async () => {
    const { repo, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    standIn.showingFor(`${name}.hourly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Thu 2026-10-22 11:00:00 BST" });
    standIn.showingFor(`${name}.nightly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
    const { exitCode, stdout } = await delivery(["schedule", "status", "--name", "nightly"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(
      [
        "Scheduling is on for the nightly schedule, every 1d.",
        lastRun("not yet"),
        nextRun("Fri 2026-10-23 00:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.nightly.service`),
        "",
      ].join("\n"),
    );
  });

  it("says there is no such schedule for a name not installed", async () => {
    const { repo, env } = await project();
    const none = await delivery(["schedule", "status", "--name", "weekly"], { cwd: repo, env });
    expect(none.exitCode).toBe(EXIT.ok);
    expect(none.stdout).toBe(`${noSuchSchedule("weekly", repo)}\n`);
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    const other = await delivery(["schedule", "status", "--name", "weekly"], { cwd: repo, env });
    expect(other.exitCode).toBe(EXIT.ok);
    expect(other.stdout).toBe(`${noSuchSchedule("weekly", repo)}\n`);
  });

  it("refuses a name it could never have installed", async () => {
    const { repo, standIn, env } = await project();
    const { exitCode, stderr } = await delivery(["schedule", "status", "--name", "Nightly"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(badName("Nightly"));
    expect(standIn.calls()).toEqual([]);
  });

  it("lists a default schedule installed before named schedules existed", async () => {
    const { repo, units, name, standIn, env } = await project();
    mkdirSync(units, { recursive: true });
    writeFileSync(
      join(units, `${name}.service`),
      `[Unit]\nDescription=delivery run --sources every 1d in ${repo}\n\n[Service]\nType=oneshot\nWorkingDirectory=${repo}\nExecStart=/usr/bin/node /x/main.js run --sources --if-idle\n`,
    );
    writeFileSync(join(units, `${name}.timer`), "[Timer]\nOnCalendar=*-*-* 00:00:00\nPersistent=true\n");
    standIn.showing({
      UnitFileState: "enabled",
      LastTriggerUSec: "Sun 2026-10-18 12:00:00 BST",
      NextElapseUSecRealtime: "Mon 2026-10-19 00:00:00 BST",
    });
    const { exitCode, stdout } = await delivery(["schedule", "status"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(
      [
        "Scheduling is on for the default schedule, every 1d.",
        lastRun("Sun 2026-10-18 12:00:00 BST"),
        nextRun("Mon 2026-10-19 00:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.service`),
        "",
      ].join("\n"),
    );
  });

  it("shows only the re-enabled schedule changed", async () => {
    const { repo, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    standIn.showingFor(`${name}.hourly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Thu 2026-10-22 11:00:00 BST" });
    standIn.showingFor(`${name}.nightly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
    const first = (await delivery(["schedule", "status"], { cwd: repo, env })).stdout;
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "6h"], { cwd: repo, env });
    const second = (await delivery(["schedule", "status"], { cwd: repo, env })).stdout;
    expect(second).toContain("Scheduling is on for the hourly schedule, every 6h.");
    expect(second).not.toContain("every 1h");
    const nightlyBlock = (text: string) => text.slice(text.indexOf("Scheduling is on for the nightly schedule"));
    expect(nightlyBlock(second)).toBe(nightlyBlock(first));
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
    standIn.showing({ UnitFileState: "disabled", LastTriggerUSec: "", NextElapseUSecRealtime: "" });
    expect((await delivery(["schedule", "status"], { cwd: repo, env })).stdout).toContain("Scheduling is off for the default schedule, every 1d.");
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

  it("disables a default schedule installed before named schedules existed", async () => {
    const { repo, units, name, standIn, env } = await project();
    mkdirSync(units, { recursive: true });
    writeFileSync(
      join(units, `${name}.service`),
      `[Unit]\nDescription=delivery run --sources every 1d in ${repo}\n\n[Service]\nType=oneshot\nWorkingDirectory=${repo}\nExecStart=/usr/bin/node /x/main.js run --sources --if-idle\n`,
    );
    writeFileSync(join(units, `${name}.timer`), "[Timer]\nOnCalendar=*-*-* 00:00:00\nPersistent=true\n");
    const { exitCode, stdout } = await delivery(["schedule", "disable"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(turnedOff(repo));
    expect(existsSync(join(units, `${name}.timer`))).toBe(false);
    expect(existsSync(join(units, `${name}.service`))).toBe(false);
    expect(standIn.calls()).toEqual([`--user disable --now ${name}.timer`, "--user daemon-reload"]);
  });

  it("says it is already off when there is nothing to turn off", async () => {
    const { repo, standIn, env } = await project();
    const { exitCode, stdout } = await delivery(["schedule", "disable"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toContain(alreadyOff(repo));
    expect(standIn.calls()).toEqual([]);
  });
});
