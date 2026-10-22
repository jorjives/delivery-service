import { EXIT, Refusal } from "../failures.js";

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

/** The name of the unnamed schedule, which is also the word a schedule may not be given. */
export const DEFAULT_NAME = "default";

export const badName = (text: string): string =>
  `"${text}" isn't a name I can give a schedule. Use 1 to 32 lowercase letters, digits or hyphens, such as nightly, or leave --name out for the default schedule.`;

export function parseName(text: string | undefined): string {
  if (text === undefined) return DEFAULT_NAME;
  if (!/^[a-z0-9-]{1,32}$/.test(text) || text === DEFAULT_NAME) throw new Refusal(badName(text), EXIT.configuration);
  return text;
}

/** How a schedule's run is launched: the node binary, this package's entry point, and the operator's PATH. */
export interface Launcher {
  node: string;
  main: string;
  path: string;
}

/** A named schedule on one project: what it runs, where, how often, and how it is launched. */
export interface Schedule {
  repoPath: string;
  name: string;
  every: Interval;
  launcher: Launcher;
}

/** A token a scheduler's command line can take unquoted; the renderers quote any other. */
export const BARE_ARG = /^[A-Za-z0-9_./=-]+$/;

/** The arguments `delivery` runs with on each tick. Every scheduled run skips quietly when another run holds the repository. */
export function runArgs(_schedule: Schedule): string[] {
  void _schedule; // every schedule runs alike today; the parameter keeps the seam for per-schedule arguments
  return ["run", "--sources", "--if-idle"];
}

/** Says a schedule in words; the default schedule keeps its original wording. */
export function describeSchedule(schedule: Schedule): string {
  const run = `delivery run --sources every ${schedule.every.text} in ${schedule.repoPath}`;
  return schedule.name === DEFAULT_NAME ? run : `the ${schedule.name} schedule, ${run}`;
}

/** Every interval text parseInterval accepts: minute steps that divide an hour, hour steps that divide a day, and 1d. */
const ACCEPTED_TEXTS: string[] = [];
for (let n = 1; n < 60; n++) if (60 % n === 0) ACCEPTED_TEXTS.push(`${n}m`);
for (let n = 1; n < 24; n++) if (24 % n === 0) ACCEPTED_TEXTS.push(`${n}h`);
ACCEPTED_TEXTS.push("1d");

/** The interval a systemd calendar stands for, or undefined when no accepted interval produces it. */
export function intervalForCalendar(onCalendar: string): Interval | undefined {
  return ACCEPTED_TEXTS.map((text) => parseInterval(text)).find((interval) => interval.onCalendar === onCalendar);
}
