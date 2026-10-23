import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_SUCH_CONFIG } from "../config.js";
import { NOT_A_CONCURRENCY, NOT_A_MAX } from "../settings.js";
import {
  badInterval,
  badName,
  describeSchedule,
  emptySetting,
  intervalForCalendar,
  parseInterval,
  parseName,
  parseScheduleArgs,
  runArgs,
  scheduleArgsFrom,
  type Schedule,
} from "./model.js";
import { EXIT, Refusal } from "../failures.js";

const schedule = (name: string): Schedule => ({
  repoPath: "/home/op/my project",
  name,
  every: parseInterval("5m"),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
  args: {},
});

const refusedWith = (attempt: () => unknown, message: string): void => {
  expect(attempt).toThrow(Refusal);
  expect(attempt).toThrow(message);
  try {
    attempt();
  } catch (err) {
    expect((err as Refusal).exitCode).toBe(EXIT.configuration);
  }
};

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

describe("parseName", () => {
  it("is the default schedule when no name is given", () => expect(parseName(undefined)).toBe("default"));
  it.each(["nightly", "a", "hourly-2", "0", "a".repeat(32)])("accepts %j", (text) => expect(parseName(text)).toBe(text));
  it.each(["", "default", "Nightly", "night_ly", "a.b", "a b", "a".repeat(33), "ünï"])("refuses %j as configuration", (text) => {
    expect(() => parseName(text)).toThrow(badName(text));
    try {
      parseName(text);
    } catch (err) {
      expect((err as Refusal).exitCode).toBe(EXIT.configuration);
    }
  });
});

describe("parseScheduleArgs", () => {
  const dir = mkdtempSync(join(tmpdir(), "schedule-args-"));
  writeFileSync(join(dir, "nightly.json"), "{}");

  it("is no settings when none are given", () => expect(parseScheduleArgs({}, dir)).toEqual({}));
  it("keeps every setting, the config resolved against the start folder", () =>
    expect(parseScheduleArgs({ config: "nightly.json", workflow: "deep", max: "3", concurrency: "2" }, dir))
      .toEqual({ config: join(dir, "nightly.json"), workflow: "deep", max: 3, concurrency: 2 }));
  it("keeps an absolute config as given", () =>
    expect(parseScheduleArgs({ config: join(dir, "nightly.json") }, "/elsewhere").config).toBe(join(dir, "nightly.json")));
  it("refuses a config that does not exist", () => refusedWith(() => parseScheduleArgs({ config: "missing.json" }, dir), NO_SUCH_CONFIG("missing.json")));
  it.each(["--config", "--workflow"] as const)("refuses an empty %s", (flag) =>
    refusedWith(() => parseScheduleArgs(flag === "--config" ? { config: "" } : { workflow: "" }, dir), emptySetting(flag)));
  it("refuses a workflow of only spaces", () => refusedWith(() => parseScheduleArgs({ workflow: "  " }, dir), emptySetting("--workflow")));
  it.each(["0", "-1", "2.5", "abc", ""])("refuses --max %j", (max) => refusedWith(() => parseScheduleArgs({ max }, dir), NOT_A_MAX(max)));
  it.each(["0", "01", "1.5", "x", ""])("refuses --concurrency %j", (c) =>
    refusedWith(() => parseScheduleArgs({ concurrency: c }, dir), NOT_A_CONCURRENCY("--concurrency", c)));
});

describe("runArgs", () => {
  it("runs the sources and skips quietly when another run is going", () =>
    expect(runArgs(schedule("default"))).toEqual(["run", "--sources", "--if-idle"]));
  it("puts each setting given between --sources and --if-idle, in a fixed order", () =>
    expect(runArgs({ ...schedule("nightly"), args: { concurrency: 2, max: 3, workflow: "deep", config: "/c/n.json" } }))
      .toEqual(["run", "--sources", "--config", "/c/n.json", "--workflow", "deep", "--max", "3", "--concurrency", "2", "--if-idle"]));
  it.each([{}, { workflow: "deep" }, { config: "/c/n.json", max: 3 }, { config: "/a b/100% $x \"q\" \\.json", workflow: "it's", max: 1, concurrency: 4 }])
    ("reads %j back from its own argument list", (args) => expect(scheduleArgsFrom(runArgs({ ...schedule("n"), args }))).toEqual(args));
  it("reads nothing from tokens it does not know, or a count that is not a whole number", () =>
    expect(scheduleArgsFrom(["run", "--sources", "--max", "lots", "--frob", "x"])).toEqual({}));
});

describe("describeSchedule", () => {
  it("keeps the default schedule's words", () =>
    expect(describeSchedule(schedule("default"))).toBe("delivery run --sources every 5m in /home/op/my project"));
  it("names a named schedule", () =>
    expect(describeSchedule(schedule("nightly"))).toBe(
      "the nightly schedule, delivery run --sources every 5m in /home/op/my project",
    ));
});

describe("intervalForCalendar", () => {
  it.each(["5m", "15m", "30m", "1h", "6h", "12h", "1d"])("reads %s back from its calendar", (text) =>
    expect(intervalForCalendar(parseInterval(text).onCalendar)).toEqual(parseInterval(text)),
  );
  it("is undefined for a calendar no interval produces", () =>
    expect(intervalForCalendar("Mon *-*-* 09:00:00")).toBeUndefined());
});
