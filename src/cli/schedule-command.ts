import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import { selectBackend } from "./schedule/backend.js";
import { cronLine } from "./schedule/cron.js";
import { DEFAULT_INTERVAL, DEFAULT_NAME, describeSchedule, parseInterval, parseName, type Schedule } from "./schedule/model.js";
import { must, parseShow, unitDir, unitName } from "./schedule/systemd.js";

export interface ScheduleOptions {
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

export const scheduledOff = (repoPath: string): string =>
  `Scheduling is off for ${repoPath}. Turn it on with: delivery schedule enable --every <interval>`;
export const alreadyOff = (repoPath: string): string => `Scheduling is already off for ${repoPath}.`;
export const turnedOff = (repoPath: string): string =>
  `Scheduling is off for ${repoPath}. You can still run it by hand at any time: delivery run --sources`;
export const lastRun = (when: string): string => `Last run: ${when}`;
export const nextRun = (when: string): string => `Next run: ${when}`;

/** This build's own entry point: `dist/cli/main.js` beside this file once built. */
const MAIN = fileURLToPath(new URL("./main.js", import.meta.url));

/** The project's repository, its units' name, and the path its timer would be installed at. Used by status until it moves to the port. */
async function scheduled(options: ScheduleOptions, ctx: CommandContext) {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const name = unitName(repoPath, DEFAULT_NAME);
  const dir = unitDir(ctx.env);
  return { repoPath, name, dir, timerPath: join(dir, `${name}.timer`) };
}

/** `delivery schedule enable`: install and start this project's timer, or refuse with the cron line to use instead. */
export async function scheduleEnableCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const name = parseName(options.name);
  const every = parseInterval(options.every ?? DEFAULT_INTERVAL);
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const schedule: Schedule = {
    repoPath,
    name,
    every,
    launcher: { node: process.execPath, main: MAIN, path: ctx.env.PATH ?? "" },
  };
  const backend = selectBackend();
  const probe = await backend.probe(ctx.env);
  if (!probe.ok) throw new Refusal(unsupported(probe.reason, cronLine(schedule)), EXIT.configuration);

  await backend.install(schedule, ctx.env);
  ctx.writeLine(scheduledOn(describeSchedule(schedule), probe.catchesUp));
  ctx.writeLine(journalHint(backend.logCommand(repoPath, name)));
  return EXIT.ok;
}

/** `delivery schedule status`: whether this project runs on its own, and when it last and next ran, as systemd says. */
export async function scheduleStatusCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, name, timerPath } = await scheduled(options, ctx);
  if (!existsSync(timerPath)) {
    ctx.writeLine(scheduledOff(repoPath));
    return EXIT.ok;
  }
  const show = parseShow(
    await must(ctx.env, ["show", `${name}.timer`, "-p", "UnitFileState", "-p", "Description", "-p", "LastTriggerUSec", "-p", "NextElapseUSecRealtime"]),
  );
  if (show.UnitFileState !== "enabled") {
    ctx.writeLine(scheduledOff(repoPath));
    return EXIT.ok;
  }
  ctx.writeLine(scheduledOn(show.Description ?? "", true));
  ctx.writeLine(lastRun(show.LastTriggerUSec || "not yet"));
  ctx.writeLine(nextRun(show.NextElapseUSecRealtime || "none"));
  ctx.writeLine(journalHint(selectBackend().logCommand(repoPath, DEFAULT_NAME)));
  return EXIT.ok;
}

/** `delivery schedule disable`: stop and remove this project's timer. A run already going finishes; running by hand is untouched. */
export async function scheduleDisableCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const removed = await selectBackend().remove(repoPath, DEFAULT_NAME, ctx.env);
  ctx.writeLine(removed ? turnedOff(repoPath) : alreadyOff(repoPath));
  return EXIT.ok;
}
