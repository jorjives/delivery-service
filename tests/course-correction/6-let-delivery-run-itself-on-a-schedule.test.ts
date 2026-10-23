// Slice 6: Let Delivery Run Itself on a Schedule
// Source: docs/superpowers/specs/2026-10-06-course-correction-slices.md
// Recorded: 2026-10-18 against commit 69dce0f
//
// Drives the compiled `delivery` command as a person would (tests/helpers.ts's
// runDelivery over dist/cli/main.js), in a scratch project, with systemctl
// swapped for the contributor-only stand-in so the contributor's own systemd is
// never touched.
// Acceptance criteria that need a real systemd clock (a run happening by
// itself, a missed run catching up on boot) are recorded as skipped below, each
// with its reason.

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKAGE } from "../../src/cli/command-fixtures.js";
import { TEST_SYSTEMCTL, unitName } from "../../src/cli/schedule/systemd.js";
import { initTempRepo } from "../../src/temp-repo.js";
import { createSystemctlStandIn } from "../../src/systemctl-stand-in.js";
import { runDelivery } from "../helpers.js";

function project() {
  const repo = initTempRepo("uat-schedule-", { "package.json": PACKAGE });
  const config = mkdtempSync(join(tmpdir(), "uat-schedule-config-"));
  const standIn = createSystemctlStandIn();
  const env = { ...process.env, XDG_CONFIG_HOME: config, [TEST_SYSTEMCTL]: standIn.command };
  const units = join(config, "systemd", "user");
  // The unit name is derived from the resolved repository path, as the command derives it.
  const name = unitName(repo, "default");
  return { repo, standIn, env, units, name };
}

describe("UAT: set a project running on a schedule, check it, turn it off", () => {
  it("enable, status, disable round trip", () => {
    const { repo, standIn, env, units, name } = project();
    const before = runDelivery(["schedule", "status"], { cwd: repo, env });
    expect(before.status).toBe(0);
    expect(before.stdout).toContain("Scheduling is off");

    const enabled = runDelivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    expect(enabled.status).toBe(0);
    expect(enabled.stdout).toContain("Scheduling is on");
    expect(enabled.stdout).toContain("delivery run --sources every 5m");
    expect(readFileSync(join(units, `${name}.service`), "utf8")).toMatch(/^ExecStart=.* run --sources --if-idle$/m);
    expect(standIn.calls()).toContain(`--user enable ${name}.timer`);

    standIn.showing({
      UnitFileState: "enabled",
      Description: "delivery run --sources every 5m",
      LastTriggerUSec: "n/a",
      NextElapseUSecRealtime: "Sun 2026-10-18 12:05:00 UTC",
    });
    const status = runDelivery(["schedule", "status"], { cwd: repo, env });
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("Scheduling is on");
    expect(status.stdout).toContain("Last run:");
    expect(status.stdout).toContain("Next run: Sun 2026-10-18 12:05:00 UTC");

    const disabled = runDelivery(["schedule", "disable"], { cwd: repo, env });
    expect(disabled.status).toBe(0);
    expect(disabled.stdout).toContain("You can still run it by hand");
    expect(readdirSync(units)).toEqual([]);

    const after = runDelivery(["schedule", "status"], { cwd: repo, env });
    expect(after.stdout).toContain("Scheduling is off");
  });
});

describe("AC: a missed run is caught up rather than skipped", () => {
  it("installs a persistent timer", () => {
    const { repo, env, units, name } = project();
    expect(runDelivery(["schedule", "enable", "--every", "1h"], { cwd: repo, env }).status).toBe(0);
    expect(readFileSync(join(units, `${name}.timer`), "utf8")).toContain("Persistent=true");
  });
});

describe("AC: a machine without systemd scheduling is refused plainly with a cron line", () => {
  it("refuses, installs nothing, and prints the line to use instead", () => {
    const { repo, standIn, env, units } = project();
    standIn.noBus();
    const refused = runDelivery(["schedule", "enable", "--every", "5m"], { cwd: repo, env });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("can't run delivery on a schedule");
    expect(refused.stderr).toMatch(/\*\/5 \* \* \* \* cd .* run --sources/);
    expect(existsSync(units)).toBe(false);
  });
});

describe("AC: not recorded here", () => {
  it.skip("the run happens by itself when the interval passes (needs a real systemd timer firing; covered by the unit files asserted in src/cli/schedule-command.test.ts)", () => {});
  it.skip("a run missed while the machine was off runs on return (needs a real systemd and a power cycle; Persistent=true is asserted above)", () => {});
});
