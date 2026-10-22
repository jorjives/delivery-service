import { describe, expect, it } from "vitest";
import { cronLine } from "./cron.js";
import { parseInterval, type Schedule } from "./model.js";

const target: Schedule = {
  repoPath: "/home/op/my project",
  name: "default",
  every: parseInterval("5m"),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
};

describe("cron line", () => {
  it("gives the equivalent cron line, quoted for the shell and for cron", () => {
    expect(cronLine(target)).toBe(
      "*/5 * * * * cd '/home/op/my project' && PATH='/usr/local/bin:/usr/bin' '/usr/bin/node' '/opt/delivery/dist/cli/main.js' run --sources --if-idle",
    );
    expect(cronLine({ ...target, repoPath: "/w/it's 100%" })).toContain("cd '/w/it'\\''s 100\\%'");
  });
});
