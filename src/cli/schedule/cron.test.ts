import { describe, expect, it } from "vitest";
import { cronLine } from "./cron.js";
import { parseInterval, type Schedule } from "./model.js";

const target: Schedule = {
  repoPath: "/home/op/my project",
  name: "default",
  every: parseInterval("5m"),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
  args: {},
};

describe("cron line", () => {
  it("gives the equivalent cron line, quoted for the shell and for cron", () => {
    expect(cronLine(target)).toBe(
      "*/5 * * * * cd '/home/op/my project' && PATH='/usr/local/bin:/usr/bin' '/usr/bin/node' '/opt/delivery/dist/cli/main.js' run --sources --if-idle",
    );
    expect(cronLine({ ...target, repoPath: "/w/it's 100%" })).toContain("cd '/w/it'\\''s 100\\%'");
  });
  it("carries the schedule's settings, quoted like every other token", () =>
    expect(cronLine({ ...target, args: { config: "/home/op/my cfg/100%.json", workflow: "deep", max: 3 } })).toMatch(
      / run --sources --config '\/home\/op\/my cfg\/100\\%\.json' --workflow deep --max 3 --if-idle$/));
});
