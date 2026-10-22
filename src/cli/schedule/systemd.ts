import { execFile as execFileCb } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { repoKey } from "../../run-location.js";
import { BARE_ARG, DEFAULT_NAME, describeSchedule, runArgs, type Schedule } from "./model.js";

const execFile = promisify(execFileCb);

export type SystemctlResult = { ok: true; stdout: string } | { ok: false; reason: string };

export const NO_SYSTEMCTL = "systemctl isn't installed";

/** The `[Unit]` key that records which schedule a unit pair is, so a repository's schedules are found without a registry. */
export const MARKER = "X-Delivery-Schedule";

/** A project's units are named by its repository key, as Autoloop's `autoloop@<key>` are; a named schedule adds its name. */
export const unitName = (repoPath: string, name: string): string =>
  name === DEFAULT_NAME ? `delivery-${repoKey(repoPath)}` : `delivery-${repoKey(repoPath)}.${name}`;

/** Where the user's own systemd units live. */
export function unitDir(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config"), "systemd", "user");
}

const specifiers = (text: string): string => text.replace(/%/g, "%%");
const quoted = (text: string): string => `"${specifiers(text.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}"`;
const execArg = (text: string): string => quoted(text.replace(/\$/g, "$$$$"));
const runArg = (token: string): string => (BARE_ARG.test(token) ? token : execArg(token));
const unitSection = (schedule: Schedule): string[] => [
  "[Unit]",
  `Description=${specifiers(describeSchedule(schedule))}`,
  `${MARKER}=${schedule.name}`,
  "",
];

export function serviceUnit(schedule: Schedule): string {
  const { launcher, repoPath } = schedule;
  return [
    ...unitSection(schedule),
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${specifiers(repoPath)}`,
    `Environment=${quoted(`PATH=${launcher.path}`)}`,
    `ExecStart=${execArg(launcher.node)} ${execArg(launcher.main)} ${runArgs(schedule).map(runArg).join(" ")}`,
    "",
  ].join("\n");
}

/** `Persistent=true` is what runs a schedule missed while the machine was off as soon as it is back; it only applies to `OnCalendar=`. */
export function timerUnit(schedule: Schedule): string {
  return [
    ...unitSection(schedule),
    "[Timer]",
    `OnCalendar=${schedule.every.onCalendar}`,
    "Persistent=true",
    `Unit=${unitName(schedule.repoPath, schedule.name)}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
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

/**
 * Contributor-only test seam: the systemctl the harness runs. The `delivery()` test helper points it at a path that
 * does not exist, so no command test can reach the contributor's own systemd. Documented in CONTRIBUTING.md.
 */
export const TEST_SYSTEMCTL = "DELIVERY_TEST_SYSTEMCTL";
export const systemctlOf = (env: NodeJS.ProcessEnv): string => env[TEST_SYSTEMCTL] ?? "systemctl";

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
export async function must(env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  const result = await systemctl(env, args);
  if (!result.ok) throw new Error(`systemctl --user ${args.join(" ")} failed: ${result.reason}`);
  return result.stdout;
}
