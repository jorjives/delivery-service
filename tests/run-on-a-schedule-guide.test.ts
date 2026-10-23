// Named schedules, slice 6: docs/run-on-a-schedule.md is what a person follows to turn a schedule on, and
// the command reference is what they look things up in. The guide's worked example names the commands and
// the status it shows as the code prints them, and its refusal block is the exact text a machine with no
// scheduler backend gets. Each is checked here against the same expressions the command uses, so the docs
// cannot drift from what the command prints.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cronLine } from "../src/cli/schedule/cron.js";
import { noBackend, type InstalledSchedule } from "../src/cli/schedule/backend.js";
import { parseInterval, type Schedule } from "../src/cli/schedule/model.js";
import { runSettings, scheduleHeading, unsupported } from "../src/cli/schedule-command.js";
import { SKIPPED_IDLE } from "../src/cli/run-exclusion.js";
import { flatten, outputBlock, REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/run-on-a-schedule.md"), "utf-8");
const reference = readFileSync(join(REPO_ROOT, "docs/cli-reference.md"), "utf-8");
const example: Schedule = {
  repoPath: "/home/you/app", name: "nightly", every: parseInterval("1d"),
  launcher: { node: "/usr/bin/node", main: "/usr/lib/node_modules/delivery-service/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
  args: { workflow: "deep", max: 3 },
};

/** From a `## ` heading to the next one, so a test reads only that section. */
const section = (heading: string): string => {
  const start = guide.indexOf(heading);
  if (start === -1) throw new Error(`the guide has no ${heading}`);
  const end = guide.indexOf("\n## ", start + heading.length);
  return guide.slice(start, end === -1 ? undefined : end);
};

describe("the scheduling guide", () => {
  it("works an example of two schedules, enabling each and showing both in status with their own settings", () => {
    const worked = section("## Worked example: two schedules on one project");
    expect(worked).toContain("delivery schedule enable --name hourly --every 1h");
    expect(worked).toContain("delivery schedule enable --name nightly --every 1d --workflow deep --max 3");
    expect(worked).toContain(scheduleHeading({ name: "hourly", every: "1h", enabled: true } as InstalledSchedule));
    expect(worked).toContain(scheduleHeading({ name: "nightly", every: "1d", enabled: true } as InstalledSchedule));
    expect(worked).toContain(runSettings({}));
    expect(worked).toContain(runSettings({ workflow: "deep", max: 3 }));
    expect(worked).toContain("delivery schedule disable --name hourly");
  });

  it("explains the idle option and that one run at a time holds the repository", () => {
    const overlap = flatten(section("## When runs overlap"));
    expect(overlap).toContain("`--if-idle`");
    expect(overlap).toContain(SKIPPED_IDLE);
    expect(overlap).toContain("Another run is already going here");
    expect(overlap).toMatch(/by hand/);
  });

  it("shows the refusal and crontab line a machine with no scheduler backend gets, exactly as printed", () => {
    const cron = section("## Use cron where there is no scheduler");
    expect(outputBlock(cron)).toEqual(unsupported(noBackend("darwin"), cronLine(example)).split("\n"));
  });

  it("does not say scheduling needs Linux with systemd in its opening", () =>
    expect(guide.split("\n## ")[0]).not.toContain("on Linux with systemd"));
});

describe("the command reference on schedules", () => {
  it("says what enable does where there is no scheduler backend, and that every run holds the repository", () => {
    const flat = flatten(reference);
    expect(flat).toContain("has no scheduler backend yet");
    expect(flat).toContain("run-on-a-schedule.md#use-cron-where-there-is-no-scheduler");
    expect(flat).toContain("run-on-a-schedule.md#when-runs-overlap");
  });
});
