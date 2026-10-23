import { BARE_ARG, runArgs, type Schedule } from "./model.js";

/** Single-quoted for the shell; cron reads a bare % as a newline. */
const shellArg = (text: string): string => `'${text.replace(/'/g, "'\\''").replace(/%/g, "\\%")}'`;
const runArg = (token: string): string => (BARE_ARG.test(token) ? token : shellArg(token));

/** The line a machine with no scheduler backend can add to its own crontab instead. */
export function cronLine(schedule: Schedule): string {
  const { every, repoPath, launcher } = schedule;
  return `${every.cron} cd ${shellArg(repoPath)} && PATH=${shellArg(launcher.path)} ${shellArg(launcher.node)} ${shellArg(launcher.main)} ${runArgs(schedule).map(runArg).join(" ")}`;
}
