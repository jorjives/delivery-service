import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CommandContext } from "./context.js";
import { EXIT, Refusal, type ExitCode } from "./failures.js";
import { findRepository } from "./project.js";
import {
  cronLine,
  DEFAULT_INTERVAL,
  parseInterval,
  parseShow,
  serviceUnit,
  systemctlOf,
  timerUnit,
  unitDir,
  unitName,
  type ScheduleTarget,
} from "./schedule.js";

const execFile = promisify(execFileCb);

export interface ScheduleOptions {
  repo?: string;
  every?: string;
}

export type SystemctlResult = { ok: true; stdout: string } | { ok: false; reason: string };

export const NO_SYSTEMCTL = "systemctl isn't installed";
export const unsupported = (reason: string, line: string): string =>
  `This machine can't run delivery on a schedule: it needs systemd's user timers, and ${reason}.\n` +
  `Add this line to your own scheduler (crontab -e) instead. Unlike the timer, cron skips a run missed while the machine is off:\n${line}`;
export const scheduledOn = (description: string): string =>
  `Scheduling is on: ${description}. A run missed while this machine is off happens as soon as it is back.`;
export const journalHint = (name: string): string => `Each scheduled run's output: journalctl --user -u ${name}.service`;

/** `systemctl --user <args>`: its output, or why it could not answer. Never throws. */
export async function systemctl(env: NodeJS.ProcessEnv, args: string[]): Promise<SystemctlResult> {
  try {
    const { stdout } = await execFile(systemctlOf(env), ["--user", ...args], { env });
    return { ok: true, stdout };
  } catch (err) {
    const { code, stderr, message } = err as { code?: unknown; stderr?: string; message: string };
    if (code === "ENOENT") return { ok: false, reason: NO_SYSTEMCTL };
    return { ok: false, reason: `systemctl --user said: ${(stderr ?? "").trim() || message}` };
  }
}

/** A systemctl call that must work once the probe has: a failure here is not the operator's setup. */
async function must(env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  const result = await systemctl(env, args);
  if (!result.ok) throw new Error(`systemctl --user ${args.join(" ")} failed: ${result.reason}`);
  return result.stdout;
}

/** This build's own entry point: `dist/cli/main.js` beside this file once built. */
const MAIN = fileURLToPath(new URL("./main.js", import.meta.url));

export const scheduledOff = (repoPath: string): string =>
  `Scheduling is off for ${repoPath}. Turn it on with: delivery schedule enable --every <interval>`;
export const alreadyOff = (repoPath: string): string => `Scheduling is already off for ${repoPath}.`;
export const turnedOff = (repoPath: string): string =>
  `Scheduling is off for ${repoPath}. You can still run it by hand at any time: delivery run --sources`;
export const lastRun = (when: string): string => `Last run: ${when}`;
export const nextRun = (when: string): string => `Next run: ${when}`;

/** The project's repository, its units' name, and the path its timer would be installed at. */
async function scheduled(options: ScheduleOptions, ctx: CommandContext) {
  const repoPath = await findRepository(resolve(ctx.cwd, options.repo ?? "."));
  const name = unitName(repoPath);
  const dir = unitDir(ctx.env);
  return { repoPath, name, dir, timerPath: join(dir, `${name}.timer`) };
}

/** `delivery schedule enable`: install and start this project's timer, or refuse with the cron line to use instead. */
export async function scheduleEnableCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const every = parseInterval(options.every ?? DEFAULT_INTERVAL);
  const { repoPath, name, dir } = await scheduled(options, ctx);
  const target: ScheduleTarget = { repoPath, node: process.execPath, main: MAIN, path: ctx.env.PATH ?? "", every };
  const probe = await systemctl(ctx.env, ["show-environment"]);
  if (!probe.ok) throw new Refusal(unsupported(probe.reason, cronLine(target)), EXIT.configuration);

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.service`), serviceUnit(target));
  await writeFile(join(dir, `${name}.timer`), timerUnit(target));
  await must(ctx.env, ["daemon-reload"]);
  await must(ctx.env, ["enable", `${name}.timer`]);
  await must(ctx.env, ["restart", `${name}.timer`]); // so a changed interval takes effect on a timer already running
  ctx.writeLine(scheduledOn(`delivery run --sources every ${every.text} in ${repoPath}`));
  ctx.writeLine(journalHint(name));
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
  ctx.writeLine(scheduledOn(show.Description ?? ""));
  ctx.writeLine(lastRun(show.LastTriggerUSec || "not yet"));
  ctx.writeLine(nextRun(show.NextElapseUSecRealtime || "none"));
  ctx.writeLine(journalHint(name));
  return EXIT.ok;
}

/** `delivery schedule disable`: stop and remove this project's timer. A run already going finishes; running by hand is untouched. */
export async function scheduleDisableCommand(options: ScheduleOptions, ctx: CommandContext): Promise<ExitCode> {
  const { repoPath, name, dir, timerPath } = await scheduled(options, ctx);
  if (!existsSync(timerPath)) {
    ctx.writeLine(alreadyOff(repoPath));
    return EXIT.ok;
  }
  await must(ctx.env, ["disable", "--now", `${name}.timer`]);
  await rm(timerPath);
  await rm(join(dir, `${name}.service`), { force: true });
  await must(ctx.env, ["daemon-reload"]);
  ctx.writeLine(turnedOff(repoPath));
  return EXIT.ok;
}
