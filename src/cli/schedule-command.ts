import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { selectBackend, type InstalledSchedule } from "./schedule/backend.js";
import { cronLine } from "./schedule/cron.js";
import { BARE_ARG, DEFAULT_INTERVAL, DEFAULT_NAME, describeSchedule, parseInterval, parseName, parseScheduleArgs, settingsArgs, type Schedule, type ScheduleArgs, type ScheduleFlags } from "./schedule/model.js";

export interface ScheduleOptions extends ScheduleFlags {
  repo?: string;
  every?: string;
  name?: string;
}

export const unsupported = (reason: string, line: string): string =>
  `This machine can't run delivery on a schedule: it needs systemd's user timers, and ${reason}.\n` +
  `Add this line to your own scheduler (crontab -e) instead. Unlike the timer, cron skips a run missed while the machine is off:\n${line}`;
export const scheduledOn = (description: string, catchesUp: boolean): string =>
  `Scheduling is on: ${description}. ` +
  (catchesUp
    ? "A run missed while this machine is off happens as soon as it is back."
    : "A run missed while this machine is off is skipped.");
export const journalHint = (command: string): string => `Each scheduled run's output: ${command}`;
export const runSettings = (args: ScheduleArgs): string => {
  const tokens = settingsArgs(args);
  if (tokens.length === 0) return "Run settings: none, so the project's own config file and defaults apply.";
  return `Run settings: ${tokens.map((token) => (BARE_ARG.test(token) ? token : JSON.stringify(token))).join(" ")}.`;
};

export const scheduledOff = (repoPath: string): string =>
  `Scheduling is off for ${repoPath}. Turn it on with: delivery schedule enable --every <interval>`;
export const alreadyOff = (repoPath: string): string => `Scheduling is already off for ${repoPath}.`;
export const turnedOff = (repoPath: string): string =>
  `Scheduling is off for ${repoPath}. You can still run it by hand at any time: delivery run --sources`;
export const lastRun = (when: string): string => `Last run: ${when}`;
export const nextRun = (when: string): string => `Next run: ${when}`;
export const scheduleHeading = ({ name, every, enabled }: InstalledSchedule): string =>
  `Scheduling is ${enabled ? "on" : "off"} for the ${name} schedule, every ${every}.`;
export const noSuchSchedule = (name: string, repoPath: string): string =>
  `There is no schedule called ${name} for ${repoPath}. Turn it on with: delivery schedule enable --name ${name} --every <interval>`;

/** This build's own entry point: `dist/cli/main.js` beside this file once built. */
const MAIN = fileURLToPath(new URL("./main.js", import.meta.url));

/** The repository the command is about: `--repo`, or the one around the working directory. */
const repositoryOf = (options: ScheduleOptions, ctx: CommandContext): Promise<string> =>
  findRepository(resolve(ctx.cwd, options.repo ?? "."));

/** `delivery schedule enable`: install and start this project's timer, or refuse with the cron line to use instead. */
export async function scheduleEnableCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const name = parseName(options.name);
  const every = parseInterval(options.every ?? DEFAULT_INTERVAL);
  const args = parseScheduleArgs(options, resolve(ctx.cwd, options.repo ?? "."));
  const repoPath = await repositoryOf(options, ctx);
  const schedule: Schedule = {
    repoPath,
    name,
    every,
    launcher: { node: process.execPath, main: MAIN, path: ctx.env.PATH ?? "" },
    args,
  };
  const backend = selectBackend();
  const probe = await backend.probe(ctx.env);
  if (!probe.ok) throw new Refusal(unsupported(probe.reason, cronLine(schedule)), EXIT.configuration);

  await backend.install(schedule, ctx.env);
  ctx.writeLine(scheduledOn(describeSchedule(schedule), probe.catchesUp));
  ctx.writeLine(runSettings(schedule.args));
  ctx.writeLine(journalHint(backend.logCommand(repoPath, name)));
  return EXIT.ok;
}

/**
 * `delivery schedule status`: each schedule this project has, with its interval, whether it is on, and when it last and
 * next ran, as systemd says; or only the one `--name` names.
 */
export async function scheduleStatusCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await repositoryOf(options, ctx);
  const wanted = options.name === undefined ? undefined : parseName(options.name);
  const installed = await selectBackend().list(repoPath, ctx.env);
  const shown = wanted === undefined ? installed : installed.filter((schedule) => schedule.name === wanted);
  if (wanted !== undefined && shown.length === 0) {
    ctx.writeLine(noSuchSchedule(wanted, repoPath));
    return EXIT.ok;
  }
  if (shown.length === 0) {
    ctx.writeLine(scheduledOff(repoPath));
    return EXIT.ok;
  }
  shown.forEach((schedule, index) => {
    if (index > 0) ctx.writeLine("");
    ctx.writeLine(scheduleHeading(schedule));
    ctx.writeLine(runSettings(schedule.args));
    ctx.writeLine(lastRun(schedule.lastRun || "not yet"));
    ctx.writeLine(nextRun(schedule.nextRun || "none"));
    ctx.writeLine(journalHint(schedule.logCommand));
  });
  return EXIT.ok;
}

/** `delivery schedule disable`: stop and remove this project's timer. A run already going finishes; running by hand is untouched. */
export async function scheduleDisableCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await repositoryOf(options, ctx);
  const removed = await selectBackend().remove(repoPath, DEFAULT_NAME, ctx.env);
  ctx.writeLine(removed ? turnedOff(repoPath) : alreadyOff(repoPath));
  return EXIT.ok;
}
