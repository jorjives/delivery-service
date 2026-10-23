import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { cleanGitEnv } from "../git-env.js";
import { initTempRepo } from "../temp-repo.js";
import { createSystemctlStandIn } from "../systemctl-stand-in.js";
import { delivery, PACKAGE } from "./command-fixtures.js";
import { NO_SUCH_CONFIG } from "./config.js";
import { EXIT } from "./failures.js";
import { findRepository } from "./project.js";
import { badInterval, badName, emptySetting } from "./schedule/model.js";
import { execTokens, NO_SYSTEMCTL, parseShow, TEST_SYSTEMCTL, unitName } from "./schedule/systemd.js";
import { allAlreadyOff, alreadyOff, BY_HAND, heldElsewhere, journalHint, lastRun, NAME_AND_ALL, nextRun, noSuchSchedule, runSettings, scheduledOff, scheduledOn, turnedOff } from "./schedule-command.js";
import { NOT_A_CONCURRENCY, NOT_A_MAX } from "./settings.js";

async function project() {
  const repo = await findRepository(initTempRepo("schedule-", { "package.json": PACKAGE }));
  const config = mkdtempSync(join(tmpdir(), "schedule-config-"));
  const units = join(config, "systemd", "user");
  const name = unitName(repo, "default");
  const standIn = createSystemctlStandIn();
  const env = { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command, PATH: "/opt/tools:/usr/bin" };
  return { repo, units, name, standIn, env };
}

/** A git repository at `repo` + `suffix`, beside `repo`, so the two share a unit-name prefix. */
async function sibling(repo: string, suffix: string): Promise<string> {
  const path = repo + suffix;
  mkdirSync(path);
  writeFileSync(join(path, "package.json"), PACKAGE);
  execFileSync("git", ["init", "-q"], { cwd: path, env: cleanGitEnv() });
  return findRepository(path);
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

  it("refuses a name another project's schedule already holds, changing nothing", async () => {
    const { repo, units, standIn, env } = await project();
    const other = await sibling(repo, ".nightly");
    await delivery(["schedule", "enable"], { cwd: other, env });
    const filesBefore = readdirSync(units).map((file) => [file, readFileSync(join(units, file), "utf-8")]);
    const callsBefore = standIn.calls().length;
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--name", "nightly", "--every", "1h"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(heldElsewhere("nightly", repo, other));
    expect(readdirSync(units).map((file) => [file, readFileSync(join(units, file), "utf-8")])).toEqual(filesBefore);
    expect(standIn.calls().slice(callsBefore)).toEqual(["--user show-environment"]);
  });

  it("says another project without a path when the holder records none", () => {
    expect(heldElsewhere("nightly", "/w/a", "")).toBe(
      "Can't turn on the nightly schedule for /w/a: the scheduler already keeps a schedule in its place for another project. Nothing was changed. Give this schedule a different name with --name.",
    );
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
        runSettings({}),
        lastRun("Thu 2026-10-22 10:00:00 BST"),
        nextRun("Thu 2026-10-22 11:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.hourly.service`),
        "",
        "Scheduling is on for the nightly schedule, every 1d.",
        runSettings({}),
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
        runSettings({}),
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
        runSettings({}),
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
    expect(stdout).toBe(`${turnedOff("default", repo)}\n${BY_HAND}\n`);
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
    expect(stdout).toBe(`${turnedOff("default", repo)}\n${BY_HAND}\n`);
    expect(existsSync(join(units, `${name}.timer`))).toBe(false);
    expect(existsSync(join(units, `${name}.service`))).toBe(false);
    expect(standIn.calls()).toEqual([`--user disable --now ${name}.timer`, "--user daemon-reload"]);
  });

  it("says it is already off when there is nothing to turn off", async () => {
    const { repo, standIn, env } = await project();
    const { exitCode, stdout } = await delivery(["schedule", "disable"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${alreadyOff("default", repo)}\n`);
    expect(standIn.calls()).toEqual([]);
  });

  it("removes only the default schedule when no name is given", async () => {
    const { repo, units, name, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    const { exitCode, stdout } = await delivery(["schedule", "disable"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${turnedOff("default", repo)}\n${BY_HAND}\n`);
    expect(existsSync(join(units, `${name}.timer`))).toBe(false);
    expect(existsSync(join(units, `${name}.nightly.timer`))).toBe(true);
  });

  it("removes only the schedule named, and status stops listing it", async () => {
    const { repo, units, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    const hourlyBefore = readFileSync(join(units, `${name}.hourly.timer`), "utf-8");
    const { exitCode, stdout } = await delivery(["schedule", "disable", "--name", "nightly"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${turnedOff("nightly", repo)}\n${BY_HAND}\n`);
    expect(existsSync(join(units, `${name}.nightly.timer`))).toBe(false);
    expect(existsSync(join(units, `${name}.nightly.service`))).toBe(false);
    expect(readFileSync(join(units, `${name}.hourly.timer`), "utf-8")).toBe(hourlyBefore);
    expect(standIn.calls().slice(-2)).toEqual([`--user disable --now ${name}.nightly.timer`, "--user daemon-reload"]);
    const status = (await delivery(["schedule", "status"], { cwd: repo, env })).stdout;
    expect(status).toContain("for the hourly schedule");
    expect(status).not.toContain("for the nightly schedule");
  });

  it("says a named schedule that is not there is already off, and leaves the others", async () => {
    const { repo, units, name, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    const callsBefore = standIn.calls().length;
    const { exitCode, stdout } = await delivery(["schedule", "disable", "--name", "nightly"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${alreadyOff("nightly", repo)}\n`);
    expect(existsSync(join(units, `${name}.timer`))).toBe(true);
    expect(standIn.calls().length).toBe(callsBefore);
  });

  it.each(["Nightly", "default", ""])("refuses to disable the name %j, touching nothing", async (bad) => {
    const { repo, units, name, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    const callsBefore = standIn.calls().length;
    const { exitCode, stderr } = await delivery(["schedule", "disable", "--name", bad], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(badName(bad));
    expect(existsSync(join(units, `${name}.timer`))).toBe(true);
    expect(standIn.calls().length).toBe(callsBefore);
  });

  it("removes every schedule with --all, after which status says scheduling is off", async () => {
    const { repo, units, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    const { exitCode, stdout } = await delivery(["schedule", "disable", "--all"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe([turnedOff("default", repo), turnedOff("hourly", repo), turnedOff("nightly", repo), BY_HAND, ""].join("\n"));
    expect(readdirSync(units).filter((file) => file.startsWith("delivery-"))).toEqual([]);
    expect((await delivery(["schedule", "status"], { cwd: repo, env })).stdout).toBe(`${scheduledOff(repo)}\n`);
  });

  it("says scheduling is already off for --all on a project with no schedules, without asking systemd", async () => {
    const { repo, standIn, env } = await project();
    const { exitCode, stdout } = await delivery(["schedule", "disable", "--all"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(`${allAlreadyOff(repo)}\n`);
    expect(standIn.calls()).toEqual([]);
  });

  it("leaves another project's schedules alone with --all", async () => {
    const mine = await project();
    const theirs = await findRepository(initTempRepo("schedule-other-", { "package.json": PACKAGE }));
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: theirs, env: mine.env });
    await delivery(["schedule", "enable"], { cwd: mine.repo, env: mine.env });
    await delivery(["schedule", "disable", "--all"], { cwd: mine.repo, env: mine.env });
    expect(existsSync(join(mine.units, `${unitName(theirs, "nightly")}.timer`))).toBe(true);
  });

  it("refuses --name with --all before touching anything", async () => {
    const { repo, units, standIn, env } = await project();
    await delivery(["schedule", "enable"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    const filesBefore = readdirSync(units).sort();
    const callsBefore = standIn.calls().length;
    const { exitCode, stderr } = await delivery(["schedule", "disable", "--name", "nightly", "--all"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(NAME_AND_ALL);
    expect(readdirSync(units).sort()).toEqual(filesBefore);
    expect(standIn.calls().length).toBe(callsBefore);
  });

  it("leaves the project itself untouched, so it still runs by hand", async () => {
    const { repo, env } = await project();
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env });
    const treeBefore = execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo, encoding: "utf-8" });
    const { stdout } = await delivery(["schedule", "disable", "--all"], { cwd: repo, env });
    expect(stdout).toContain(BY_HAND);
    expect(execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo, encoding: "utf-8" })).toBe(treeBefore);
  });
});

describe("delivery schedule enable with run settings", () => {
  it("runs the schedule with its settings, resolved config path and all, and says so", async () => {
    const { repo, units, name, env } = await project();
    writeFileSync(join(repo, "nightly.json"), "{}");
    const { exitCode, stdout } = await delivery(
      ["schedule", "enable", "--name", "nightly", "--every", "1d", "--workflow", "deep", "--max", "3", "--concurrency", "2", "--config", "nightly.json"],
      { cwd: repo, env },
    );
    expect(exitCode).toBe(EXIT.ok);
    const service = readFileSync(join(units, `${name}.nightly.service`), "utf-8");
    expect(execTokens(parseShow(service).ExecStart ?? "").slice(2)).toEqual([
      "run",
      "--sources",
      "--config",
      join(repo, "nightly.json"),
      "--workflow",
      "deep",
      "--max",
      "3",
      "--concurrency",
      "2",
      "--if-idle",
    ]);
    expect(stdout).toContain(runSettings({ config: join(repo, "nightly.json"), workflow: "deep", max: 3, concurrency: 2 }));
  });

  it("resolves a relative --config against --repo, as delivery run does", async () => {
    const { repo, units, name, env } = await project();
    writeFileSync(join(repo, "nightly.json"), "{}");
    const { exitCode } = await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d", "--repo", basename(repo), "--config", "nightly.json"], {
      cwd: dirname(repo),
      env,
    });
    expect(exitCode).toBe(EXIT.ok);
    expect(execTokens(parseShow(readFileSync(join(units, `${name}.nightly.service`), "utf-8")).ExecStart ?? "")).toContain(join(repo, "nightly.json"));
  });

  it("clears settings left out when a name is enabled again", async () => {
    const { repo, units, name, env } = await project();
    writeFileSync(join(repo, "nightly.json"), "{}");
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d", "--workflow", "deep", "--max", "3", "--config", "nightly.json"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d", "--workflow", "deep"], { cwd: repo, env });
    const service = readFileSync(join(units, `${name}.nightly.service`), "utf-8");
    expect(execTokens(parseShow(service).ExecStart ?? "").slice(2)).toEqual(["run", "--sources", "--workflow", "deep", "--if-idle"]);
    expect((await delivery(["schedule", "status", "--name", "nightly"], { cwd: repo, env })).stdout).toContain(runSettings({ workflow: "deep" }));
  });

  it.each([
    [["--config", "missing.json"], NO_SUCH_CONFIG("missing.json")],
    [["--config", ""], emptySetting("--config")],
    [["--workflow", ""], emptySetting("--workflow")],
    [["--max=0"], NOT_A_MAX("0")],
    [["--concurrency", "1.5"], NOT_A_CONCURRENCY("--concurrency", "1.5")],
  ])("refuses %j, changing nothing", async (flags, message) => {
    const { repo, units, name, standIn, env } = await project();
    expect((await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d"], { cwd: repo, env })).exitCode).toBe(EXIT.ok);
    const serviceBefore = readFileSync(join(units, `${name}.nightly.service`), "utf-8");
    const timerBefore = readFileSync(join(units, `${name}.nightly.timer`), "utf-8");
    const callsBefore = standIn.calls().length;
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--name", "nightly", "--every", "1h", ...flags], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(message);
    expect(readFileSync(join(units, `${name}.nightly.service`), "utf-8")).toBe(serviceBefore);
    expect(readFileSync(join(units, `${name}.nightly.timer`), "utf-8")).toBe(timerBefore);
    expect(standIn.calls().length).toBe(callsBefore);
  });

  it.each([["--task", "x"], ["--task-file", "t.md"], ["--fresh"]])("does not take %s", async (...flags) => {
    const { repo, units, standIn, env } = await project();
    const { exitCode, stderr } = await delivery(["schedule", "enable", ...flags], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toContain(`unknown option '${flags[0]}'`);
    expect(existsSync(units)).toBe(false);
    expect(standIn.calls()).toEqual([]);
  });

  it("prints a cron line with the schedule's settings where there is no scheduler", async () => {
    const { repo, standIn, env } = await project();
    standIn.noBus();
    const { exitCode, stderr } = await delivery(["schedule", "enable", "--name", "nightly", "--workflow", "deep", "--max", "3"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.configuration);
    expect(stderr).toMatch(/main\.js' run --sources --workflow deep --max 3 --if-idle$/m);
  });
});

describe("delivery schedule status with run settings", () => {
  it("shows each schedule's own settings after its heading", async () => {
    const { repo, name, standIn, env } = await project();
    await delivery(["schedule", "enable", "--name", "nightly", "--every", "1d", "--workflow", "deep", "--max", "3"], { cwd: repo, env });
    await delivery(["schedule", "enable", "--name", "hourly", "--every", "1h"], { cwd: repo, env });
    standIn.showingFor(`${name}.hourly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Thu 2026-10-22 11:00:00 BST" });
    standIn.showingFor(`${name}.nightly.timer`, { UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "Fri 2026-10-23 00:00:00 BST" });
    const { exitCode, stdout } = await delivery(["schedule", "status"], { cwd: repo, env });
    expect(exitCode).toBe(EXIT.ok);
    expect(stdout).toBe(
      [
        "Scheduling is on for the hourly schedule, every 1h.",
        runSettings({}),
        lastRun("not yet"),
        nextRun("Thu 2026-10-22 11:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.hourly.service`),
        "",
        "Scheduling is on for the nightly schedule, every 1d.",
        runSettings({ workflow: "deep", max: 3 }),
        lastRun("not yet"),
        nextRun("Fri 2026-10-23 00:00:00 BST"),
        journalHint(`journalctl --user -u ${name}.nightly.service`),
        "",
      ].join("\n"),
    );
  });
});

it("says settings plainly, quoting any that need it", () => {
  expect(runSettings({})).toBe("Run settings: none, so the project's own config file and defaults apply.");
  expect(runSettings({ config: "/a b/n.json", workflow: "deep", max: 3 })).toBe('Run settings: --config "/a b/n.json" --workflow deep --max 3.');
});
