import { describe, expect, it } from "vitest";
import {
  badInterval,
  badName,
  describeSchedule,
  intervalForCalendar,
  parseInterval,
  parseName,
  runArgs,
  type Schedule,
} from "./model.js";
import { EXIT, Refusal } from "../failures.js";

const schedule = (name: string): Schedule => ({
  repoPath: "/home/op/my project",
  name,
  every: parseInterval("5m"),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
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

describe("runArgs", () => {
  it("runs the sources and skips quietly when another run is going", () =>
    expect(runArgs(schedule("default"))).toEqual(["run", "--sources", "--if-idle"]));
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
