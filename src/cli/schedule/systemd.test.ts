import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backendContract } from "./backend.contract.js";
import { DEFAULT_NAME, parseInterval, type Schedule } from "./model.js";
import { createSystemctlStandIn } from "../../systemctl-stand-in.js";
import { NO_SYSTEMCTL, MARKER, TEST_SYSTEMCTL, parseShow, serviceUnit, systemdBackend, timerUnit, unitDir, unitName } from "./systemd.js";

const target: Schedule = {
  repoPath: "/home/op/my project",
  name: "default",
  every: parseInterval("5m"),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
  args: {},
};

backendContract("systemd", () => {
  const config = mkdtempSync(join(tmpdir(), "contract-config-"));
  const standIn = createSystemctlStandIn();
  standIn.showing({ UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "" });
  const base = mkdtempSync(join(tmpdir(), "contract-repo-"));
  return { backend: systemdBackend, env: { XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command }, repo: (suffix = "") => base + suffix };
});

/** A systemd environment whose stand-in reports every unit enabled, with its own unit directory. */
function systemdEnv() {
  const standIn = createSystemctlStandIn();
  standIn.showing({ UnitFileState: "enabled", LastTriggerUSec: "", NextElapseUSecRealtime: "" });
  return { env: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "systemd-only-config-")), [TEST_SYSTEMCTL]: standIn.command }, standIn };
}

describe("systemd scheduler backend", () => {
  it("lists a unit pair written before the marker existed as default", async () => {
    const { env } = systemdEnv();
    const repo = "/w/old-project";
    const schedule = { ...target, repoPath: repo, every: parseInterval("1d") };
    const dir = unitDir(env);
    mkdirSync(dir, { recursive: true });
    const unmarked = (text: string) => text.replace(new RegExp(`^${MARKER}=.*\\n`, "m"), "");
    writeFileSync(join(dir, `${unitName(repo, DEFAULT_NAME)}.service`), unmarked(serviceUnit(schedule)));
    writeFileSync(join(dir, `${unitName(repo, DEFAULT_NAME)}.timer`), unmarked(timerUnit(schedule)));
    expect(await systemdBackend.list(repo, env)).toMatchObject([{ name: "default", every: "1d", enabled: true }]);
  });

  it("installs and lists a repository whose path holds a percent sign and a space", async () => {
    const { env } = systemdEnv();
    const repo = "/w/100% done";
    await systemdBackend.install({ ...target, repoPath: repo, every: parseInterval("1d") }, env);
    expect(await systemdBackend.list(repo, env)).toMatchObject([{ name: "default", every: "1d" }]);
  });

  it("lists only this repository's complete schedules from a unit directory holding other things", async () => {
    const { env } = systemdEnv();
    const mine = "/w/mine";
    const theirs = "/w/theirs";
    const dir = unitDir(env);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not a unit\n");
    writeFileSync(join(dir, "delivery-x.service"), serviceUnit({ ...target, repoPath: mine, every: parseInterval("1d") }));
    await systemdBackend.install({ ...target, repoPath: mine, every: parseInterval("1d") }, env);
    await systemdBackend.install({ ...target, repoPath: mine, name: "nightly", every: parseInterval("1d") }, env);
    await systemdBackend.install({ ...target, repoPath: theirs, every: parseInterval("1h") }, env);
    expect(await systemdBackend.list(mine, env)).toMatchObject([{ name: "default" }, { name: "nightly" }]);
  });

  it("reports a timer whose calendar was hand-edited as that raw calendar", async () => {
    const { env } = systemdEnv();
    const repo = "/w/edited";
    await systemdBackend.install({ ...target, repoPath: repo, every: parseInterval("1d") }, env);
    const timer = join(unitDir(env), `${unitName(repo, DEFAULT_NAME)}.timer`);
    writeFileSync(timer, readFileSync(timer, "utf-8").replace("OnCalendar=*-*-* 00:00:00", "OnCalendar=Mon *-*-* 09:00:00"));
    expect(await systemdBackend.list(repo, env)).toMatchObject([{ every: "Mon *-*-* 09:00:00" }]);
  });

  it("lists nothing, without calling systemctl, while the unit directory does not exist", async () => {
    const { env, standIn } = systemdEnv();
    expect(await systemdBackend.list("/w/none", env)).toEqual([]);
    expect(standIn.calls()).toEqual([]);
  });

  it("probes with show-environment, and says it catches up missed runs", async () => {
    const { env, standIn } = systemdEnv();
    expect(await systemdBackend.probe(env)).toEqual({ ok: true, catchesUp: true });
    expect(standIn.calls()).toEqual(["--user show-environment"]);
  });

  it("reports that systemctl is missing when the probe cannot run it", async () => {
    const env = { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "systemd-only-config-")), [TEST_SYSTEMCTL]: join(tmpdir(), "no-such-systemctl") };
    expect(await systemdBackend.probe(env)).toEqual({ ok: false, reason: NO_SYSTEMCTL });
  });

  it("gives a named schedule the journal command for its own unit", () => {
    expect(systemdBackend.logCommand("/w/log", "nightly")).toBe(`journalctl --user -u ${unitName("/w/log", "nightly")}.service`);
  });
});

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
