import { EXIT, Refusal } from "./failures.js";

/** How often a project runs: as the operator typed it, as a systemd calendar, and as a cron schedule. */
export interface Interval {
  text: string;
  onCalendar: string;
  cron: string;
}

/** Once a day, as Autoloop's own timers run. */
export const DEFAULT_INTERVAL = "1d";

export const badInterval = (text: string): string =>
  `"${text}" isn't an interval I can schedule. Use minutes that divide an hour (such as 5m, 15m or 30m), hours that divide a day (such as 1h, 6h or 12h), or 1d.`;

/**
 * An interval as both schedulers say it. Only steps that divide the hour or the day evenly, because both express
 * "every n" as a step within the hour or day: 7m would fire at :56 and again at :00.
 */
export function parseInterval(text: string): Interval {
  const match = /^(\d+)([mhd])$/.exec(text);
  const n = match ? Number(match[1]) : 0;
  const unit = match?.[2];
  if (unit === "m" && n >= 1 && n < 60 && 60 % n === 0) return { text, onCalendar: `*-*-* *:00/${n}:00`, cron: `*/${n} * * * *` };
  if (unit === "h" && n >= 1 && n < 24 && 24 % n === 0) return { text, onCalendar: `*-*-* 00/${n}:00:00`, cron: `0 */${n} * * *` };
  if (unit === "d" && n === 1) return { text, onCalendar: "*-*-* 00:00:00", cron: "0 0 * * *" };
  throw new Refusal(badInterval(text), EXIT.configuration);
}
