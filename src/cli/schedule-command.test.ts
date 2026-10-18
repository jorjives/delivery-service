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
import { journalHint, NO_SYSTEMCTL, scheduledOn } from "./schedule-command.js";

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
