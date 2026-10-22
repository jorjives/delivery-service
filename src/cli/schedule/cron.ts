import type { ScheduleTarget } from "./model.js";

/** Single-quoted for the shell; cron reads a bare % as a newline. */
const shellArg = (text: string): string => `'${text.replace(/'/g, "'\\''").replace(/%/g, "\\%")}'`;

/** The line a machine without systemd user timers can add to its own crontab instead. */
export function cronLine(target: ScheduleTarget): string {
  return `${target.every.cron} cd ${shellArg(target.repoPath)} && PATH=${shellArg(target.path)} ${shellArg(target.node)} ${shellArg(target.main)} run --sources`;
}
