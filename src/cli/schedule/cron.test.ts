import { describe, expect, it } from "vitest";
import { cronLine } from "./cron.js";
import { parseInterval, type ScheduleTarget } from "./model.js";

const target: ScheduleTarget = {
  repoPath: "/home/op/my project",
  node: "/usr/bin/node",
  main: "/opt/delivery/dist/cli/main.js",
  path: "/usr/local/bin:/usr/bin",
  every: parseInterval("5m"),
};

describe("cron line", () => {
  it("gives the equivalent cron line, quoted for the shell and for cron", () => {
    expect(cronLine(target)).toBe(
      "*/5 * * * * cd '/home/op/my project' && PATH='/usr/local/bin:/usr/bin' '/usr/bin/node' '/opt/delivery/dist/cli/main.js' run --sources",
    );
    expect(cronLine({ ...target, repoPath: "/w/it's 100%" })).toContain("cd '/w/it'\\''s 100\\%'");
  });
});
