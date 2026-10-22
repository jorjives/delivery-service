import { execFile as execFileCb } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { repoKey } from "../../run-location.js";
import type { ScheduleTarget } from "./model.js";

const execFile = promisify(execFileCb);

export type SystemctlResult = { ok: true; stdout: string } | { ok: false; reason: string };

export const NO_SYSTEMCTL = "systemctl isn't installed";

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
