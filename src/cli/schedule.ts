import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { EXIT, Refusal } from "./failures.js";
import { repoKey } from "../run-location.js";

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

/** What a project's schedule runs, where, and how often. */
export interface ScheduleTarget {
  repoPath: string;
  /** The node binary, absolute, so the run does not depend on the service's PATH to find it. */
  node: string;
  /** This package's `dist/cli/main.js`, absolute. */
  main: string;
  /** The operator's PATH when they enabled it: a user service starts with systemd's minimal one, and the check and agent need theirs. */
  path: string;
  every: Interval;
}

/** A project's units are named by its repository key, as Autoloop's `autoloop@<key>` are. */
export const unitName = (repoPath: string): string => `delivery-${repoKey(repoPath)}`;

/** Where the user's own systemd units live. */
export function unitDir(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config"), "systemd", "user");
}

const specifiers = (text: string): string => text.replace(/%/g, "%%");
const quoted = (text: string): string => `"${specifiers(text.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}"`;
const execArg = (text: string): string => quoted(text.replace(/\$/g, "$$$$"));
const descriptionOf = ({ every, repoPath }: ScheduleTarget): string => `delivery run --sources every ${every.text} in ${specifiers(repoPath)}`;

export function serviceUnit(target: ScheduleTarget): string {
  return [
    "[Unit]",
    `Description=${descriptionOf(target)}`,
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${specifiers(target.repoPath)}`,
    `Environment=${quoted(`PATH=${target.path}`)}`,
    `ExecStart=${execArg(target.node)} ${execArg(target.main)} run --sources`,
    "",
  ].join("\n");
}

/** `Persistent=true` is what runs a schedule missed while the machine was off as soon as it is back; it only applies to `OnCalendar=`. */
export function timerUnit(target: ScheduleTarget): string {
  return [
    "[Unit]",
    `Description=${descriptionOf(target)}`,
    "",
    "[Timer]",
    `OnCalendar=${target.every.onCalendar}`,
    "Persistent=true",
    `Unit=${unitName(target.repoPath)}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/** Single-quoted for the shell; cron reads a bare % as a newline. */
const shellArg = (text: string): string => `'${text.replace(/'/g, "'\\''").replace(/%/g, "\\%")}'`;

/** The line a machine without systemd user timers can add to its own crontab instead. */
export function cronLine(target: ScheduleTarget): string {
  return `${target.every.cron} cd ${shellArg(target.repoPath)} && PATH=${shellArg(target.path)} ${shellArg(target.node)} ${shellArg(target.main)} run --sources`;
}

/** `systemctl show` output, one `Key=Value` per line. */
export function parseShow(text: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) properties[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return properties;
}
