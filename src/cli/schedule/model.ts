import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NO_SUCH_CONFIG } from "../config.js";
import { EXIT, Refusal } from "../failures.js";
import { concurrencyNamed, maxItems, NOT_A_CONCURRENCY } from "../settings.js";

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

/** The run settings a schedule carries, each left out when the project's own setting should apply. */
export interface ScheduleArgs {
  config?: string;
  workflow?: string;
  max?: number;
  concurrency?: number;
}

/** The run settings as typed on the command line, before they are checked. */
export interface ScheduleFlags {
  config?: string;
  workflow?: string;
  max?: string;
  concurrency?: string;
}

/** A named schedule on one project: what it runs, where, how often, how it is launched, and the settings it runs with. */
export interface Schedule {
  repoPath: string;
  name: string;
  every: Interval;
  launcher: Launcher;
  args: ScheduleArgs;
}

export const emptySetting = (flag: "--config" | "--workflow"): string =>
  `\`${flag}\` is empty. Give it a value, or leave it out to use the project's own setting.`;

/** Checks the run settings typed for a schedule, the way the run itself would check them, so nothing unrunnable is stored. */
export function parseScheduleArgs(flags: ScheduleFlags, startDir: string): ScheduleArgs {
  const args: ScheduleArgs = {};
  if (flags.config !== undefined) {
    if (flags.config === "") throw new Refusal(emptySetting("--config"), EXIT.configuration, "config");
    const config = resolve(startDir, flags.config);
    if (!existsSync(config)) throw new Refusal(NO_SUCH_CONFIG(flags.config), EXIT.configuration, "config");
    args.config = config;
  }
  if (flags.workflow !== undefined) {
    if (flags.workflow.trim() === "") throw new Refusal(emptySetting("--workflow"), EXIT.configuration, "workflow");
    args.workflow = flags.workflow;
  }
  if (flags.max !== undefined) args.max = maxItems({ max: flags.max });
  if (flags.concurrency !== undefined) {
    const count = concurrencyNamed(flags.concurrency);
    if (count === undefined) {
      throw new Refusal(NOT_A_CONCURRENCY("--concurrency", flags.concurrency), EXIT.configuration, "concurrency");
    }
    args.concurrency = count;
  }
  return args;
}

/** The per-setting tokens a schedule runs with, in the fixed order the command line and the cron line both use. */
export function settingsArgs(args: ScheduleArgs): string[] {
  const tokens: string[] = [];
  if (args.config !== undefined) tokens.push("--config", args.config);
  if (args.workflow !== undefined) tokens.push("--workflow", args.workflow);
  if (args.max !== undefined) tokens.push("--max", String(args.max));
  if (args.concurrency !== undefined) tokens.push("--concurrency", String(args.concurrency));
  return tokens;
}

/**
 * The settings a unit or cron line says, read back from its tokens. Anything it does not recognise is ignored, and so is
 * a count that is not a positive whole number, so a hand-edited line still lists rather than throws.
 */
export function scheduleArgsFrom(tokens: string[]): ScheduleArgs {
  const args: ScheduleArgs = {};
  for (let i = 0; i + 1 < tokens.length; i++) {
    const value = tokens[i + 1];
    if (value === undefined) break;
    const max = Number(value);
    const concurrency = concurrencyNamed(value);
    if (tokens[i] === "--config") args.config = value;
    else if (tokens[i] === "--workflow") args.workflow = value;
    else if (tokens[i] === "--max" && Number.isInteger(max) && max >= 1) args.max = max;
    else if (tokens[i] === "--concurrency" && concurrency !== undefined) args.concurrency = concurrency;
    else continue;
    i++;
  }
  return args;
}

/** A token a scheduler's command line can take unquoted; the renderers quote any other. */
export const BARE_ARG = /^[A-Za-z0-9_./=-]+$/;

/** The arguments `delivery` runs with on each tick. Every scheduled run skips quietly when another run holds the repository. */
export function runArgs(schedule: Schedule): string[] {
  return ["run", "--sources", ...settingsArgs(schedule.args), "--if-idle"];
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
