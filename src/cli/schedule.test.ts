import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { badInterval, cronLine, parseInterval, parseShow, serviceUnit, timerUnit, unitDir, unitName, type ScheduleTarget } from "./schedule.js";
import { EXIT, Refusal } from "./failures.js";

const target: ScheduleTarget = {
  repoPath: "/home/op/my project",
  node: "/usr/bin/node",
  main: "/opt/delivery/dist/cli/main.js",
  path: "/usr/local/bin:/usr/bin",
  every: parseInterval("5m"),
};

describe("unit text", () => {
  it("names a project's units by its repository key", () => {
    expect(unitName("/home/op/my project")).toBe("delivery-home-op-my-project");
  });

  it("runs delivery run --sources in the repository, with the operator's PATH", () => {
    expect(serviceUnit(target)).toBe(
      [
        "[Unit]",
        "Description=delivery run --sources every 5m in /home/op/my project",
        "",
        "[Service]",
        "Type=oneshot",
        "WorkingDirectory=/home/op/my project",
        'Environment="PATH=/usr/local/bin:/usr/bin"',
        'ExecStart="/usr/bin/node" "/opt/delivery/dist/cli/main.js" run --sources',
        "",
      ].join("\n"),
    );
  });

  it("fires on the interval's calendar and catches up a run missed while the machine was off", () => {
    expect(timerUnit(target)).toBe(
      [
        "[Unit]",
        "Description=delivery run --sources every 5m in /home/op/my project",
        "",
        "[Timer]",
        "OnCalendar=*-*-* *:00/5:00",
        "Persistent=true",
        "Unit=delivery-home-op-my-project.service",
        "",
        "[Install]",
        "WantedBy=timers.target",
        "",
      ].join("\n"),
    );
  });

  it("escapes what systemd would otherwise read as a specifier, a variable or a quote", () => {
    const odd = { ...target, repoPath: "/w/100%", main: '/w/$HOME/"x"/main.js' };
    expect(serviceUnit(odd)).toContain("WorkingDirectory=/w/100%%");
    expect(serviceUnit(odd)).toContain('ExecStart="/usr/bin/node" "/w/$$HOME/\\"x\\"/main.js" run --sources');
  });

  it("gives the equivalent cron line, quoted for the shell and for cron", () => {
    expect(cronLine(target)).toBe(
      "*/5 * * * * cd '/home/op/my project' && PATH='/usr/local/bin:/usr/bin' '/usr/bin/node' '/opt/delivery/dist/cli/main.js' run --sources",
    );
    expect(cronLine({ ...target, repoPath: "/w/it's 100%" })).toContain("cd '/w/it'\\''s 100\\%'");
  });
});

describe("parseShow", () => {
  it("reads systemctl show's Key=Value lines, keeping any = in a value", () => {
    expect(parseShow("UnitFileState=enabled\nDescription=a=b\nLastTriggerUSec=\n")).toEqual({
      UnitFileState: "enabled",
      Description: "a=b",
      LastTriggerUSec: "",
    });
  });
});

describe("unitDir", () => {
  it("is the user's systemd folder under XDG_CONFIG_HOME, or ~/.config when that is unset or relative", () => {
    expect(unitDir({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/systemd/user");
    expect(unitDir({ XDG_CONFIG_HOME: "rel" })).toBe(join(homedir(), ".config", "systemd", "user"));
    expect(unitDir({})).toBe(join(homedir(), ".config", "systemd", "user"));
  });
});

// The real systemd, where it is installed: the text above must be units it accepts. Skipped elsewhere, as
// fence.test.ts skips without bwrap. Nothing is installed or enabled: verify and calendar only read.
const analyze = (() => {
  try {
    execFileSync("systemd-analyze", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!analyze)("against the real systemd-analyze", () => {
  it.each(["5m", "1h", "6h", "1d"])("accepts the %s calendar", (text) => {
    expect(() => execFileSync("systemd-analyze", ["calendar", parseInterval(text).onCalendar], { stdio: "pipe" })).not.toThrow();
  });

  it("verifies the service and timer as written", () => {
    const dir = mkdtempSync(join(tmpdir(), "schedule-units-"));
    const real: ScheduleTarget = { ...target, repoPath: dir, node: process.execPath, main: process.execPath, path: process.env.PATH ?? "/usr/bin" };
    const name = unitName(dir);
    writeFileSync(join(dir, `${name}.service`), serviceUnit(real));
    writeFileSync(join(dir, `${name}.timer`), timerUnit(real));
    // XDG_CONFIG_HOME isolates verify from the contributor's own ~/.config/systemd/user: WantedBy=timers.target
    // otherwise pulls in every installed user timer, and a broken one of theirs would print here. Isolated, a clean
    // pair prints nothing; systemd only warns (exit 0) on a line it ignores, such as unbalanced quoting, so stderr
    // must be empty too.
    const result = spawnSync("systemd-analyze", ["--user", "verify", join(dir, `${name}.service`), join(dir, `${name}.timer`)], {
      encoding: "utf-8",
      env: { ...process.env, XDG_CONFIG_HOME: dir },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("parseInterval", () => {
  it.each([
    ["5m", "*-*-* *:00/5:00", "*/5 * * * *"],
    ["30m", "*-*-* *:00/30:00", "*/30 * * * *"],
    ["1h", "*-*-* 00/1:00:00", "0 */1 * * *"],
    ["6h", "*-*-* 00/6:00:00", "0 */6 * * *"],
    ["1d", "*-*-* 00:00:00", "0 0 * * *"],
  ])("schedules %s as OnCalendar %s and cron %s", (text, onCalendar, cron) => {
    expect(parseInterval(text)).toEqual({ text, onCalendar, cron });
  });

  it.each(["7m", "60m", "0m", "5h", "24h", "2d", "5", "every day", ""])("refuses %j, naming what it accepts", (text) => {
    const attempt = () => parseInterval(text);
    expect(attempt).toThrow(Refusal);
    expect(attempt).toThrow(badInterval(text));
    try {
      attempt();
    } catch (err) {
      expect((err as Refusal).exitCode).toBe(EXIT.configuration);
    }
  });
});
