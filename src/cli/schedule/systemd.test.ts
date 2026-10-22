import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseInterval, type Schedule } from "./model.js";
import { parseShow, serviceUnit, timerUnit, unitDir, unitName } from "./systemd.js";

const target: Schedule = {
  repoPath: "/home/op/my project",
  name: "default",
  every: parseInterval("5m"),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
};

describe("unit text", () => {
  it("names a project's units by its repository key", () => {
    expect(unitName("/home/op/my project", "default")).toBe("delivery-home-op-my-project");
  });

  it("names a named schedule's units after the repository and the schedule", () =>
    expect(unitName("/home/op/my project", "nightly")).toBe("delivery-home-op-my-project.nightly"));
  it("keeps the default schedule's unit name", () =>
    expect(unitName("/home/op/my project", "default")).toBe("delivery-home-op-my-project"));
  it("describes and marks a named schedule, and its timer starts its own service", () => {
    const nightly = { ...target, name: "nightly" };
    expect(serviceUnit(nightly)).toContain("Description=the nightly schedule, delivery run --sources every 5m in /home/op/my project\nX-Delivery-Schedule=nightly\n");
    expect(timerUnit(nightly)).toContain("Unit=delivery-home-op-my-project.nightly.service");
  });

  it("runs delivery run --sources in the repository, with the operator's PATH", () => {
    expect(serviceUnit(target)).toBe(
      [
        "[Unit]",
        "Description=delivery run --sources every 5m in /home/op/my project",
        "X-Delivery-Schedule=default",
        "",
        "[Service]",
        "Type=oneshot",
        "WorkingDirectory=/home/op/my project",
        'Environment="PATH=/usr/local/bin:/usr/bin"',
        'ExecStart="/usr/bin/node" "/opt/delivery/dist/cli/main.js" run --sources --if-idle',
        "",
      ].join("\n"),
    );
  });

  it("fires on the interval's calendar and catches up a run missed while the machine was off", () => {
    expect(timerUnit(target)).toBe(
      [
        "[Unit]",
        "Description=delivery run --sources every 5m in /home/op/my project",
        "X-Delivery-Schedule=default",
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
    const odd = { ...target, repoPath: "/w/100%", launcher: { ...target.launcher, main: '/w/$HOME/"x"/main.js' } };
    expect(serviceUnit(odd)).toContain("WorkingDirectory=/w/100%%");
    expect(serviceUnit(odd)).toContain('ExecStart="/usr/bin/node" "/w/$$HOME/\\"x\\"/main.js" run --sources --if-idle');
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
    const real: Schedule = { ...target, repoPath: dir, launcher: { node: process.execPath, main: process.execPath, path: process.env.PATH ?? "/usr/bin" } };
    const nightly: Schedule = { ...real, name: "nightly" };
    const names = [unitName(dir, "default"), unitName(dir, "nightly")];
    writeFileSync(join(dir, `${names[0]}.service`), serviceUnit(real));
    writeFileSync(join(dir, `${names[0]}.timer`), timerUnit(real));
    writeFileSync(join(dir, `${names[1]}.service`), serviceUnit(nightly));
    writeFileSync(join(dir, `${names[1]}.timer`), timerUnit(nightly));
    // XDG_CONFIG_HOME isolates verify from the contributor's own ~/.config/systemd/user: WantedBy=timers.target
    // otherwise pulls in every installed user timer, and a broken one of theirs would print here. Isolated, a clean
    // pair prints nothing; systemd only warns (exit 0) on a line it ignores, such as unbalanced quoting, so stderr
    // must be empty too.
    const units = names.flatMap((name) => [join(dir, `${name}.service`), join(dir, `${name}.timer`)]);
    const result = spawnSync("systemd-analyze", ["--user", "verify", ...units], {
      encoding: "utf-8",
      env: { ...process.env, XDG_CONFIG_HOME: dir },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
