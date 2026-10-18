import { describe, expect, it } from "vitest";
import { badInterval, parseInterval } from "./schedule.js";
import { EXIT, Refusal } from "./failures.js";

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
