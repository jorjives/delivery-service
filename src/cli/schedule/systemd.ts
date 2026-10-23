import { execFile as execFileCb } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { repoKey } from "../../run-location.js";
import type { InstalledSchedule, SchedulerBackend } from "./backend.js";
import { BARE_ARG, DEFAULT_NAME, describeSchedule, intervalForCalendar, runArgs, scheduleArgsFrom, type Schedule, type ScheduleArgs } from "./model.js";

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

const unescapeToken = (token: string): string => token.replace(/%%/g, "%").replace(/\$\$/g, "$");

/**
 * The tokens of an `ExecStart` line, the inverse of how `serviceUnit` writes one: bare tokens split on spaces, and a
 * quoted token unescapes `\\` and `\"` in one pass, then `%%` and `$$` on the token. A hand-edited line never throws;
 * an unterminated quote runs to the end of the line.
 */
export function execTokens(line: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let started = false;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      const next = line[i + 1];
      if (ch === '"') quoted = false;
      else if (ch === "\\" && (next === "\\" || next === '"')) {
        token += next;
        i++;
      } else token += ch;
    } else if (ch === '"') {
      quoted = true;
      started = true;
    } else if (ch === " ") {
      if (started) tokens.push(unescapeToken(token));
      token = "";
      started = false;
    } else {
      token += ch;
      started = true;
    }
  }
  if (started) tokens.push(unescapeToken(token));
  return tokens;
}

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

/** One installed schedule as its unit files say it is: the unit basename as found on disk, and what the timer fires on. */
interface UnitEntry {
  unit: string;
  name: string;
  servicePath: string;
  timerPath: string;
  onCalendar: string;
  args: ScheduleArgs;
}

/** The repository a unit pair records, read from its service's WorkingDirectory; "" when it records none. */
const recordedRepository = (service: Record<string, string>): string => (service.WorkingDirectory ?? "").replace(/%%/g, "%");

/**
 * The schedules on this repository, read from the unit files themselves: a `delivery-*.service` with a sibling `.timer`
 * whose WorkingDirectory is the repository. The unit's own basename is kept, so later operations never recompute a name.
 */
async function installedEntries(repoPath: string, env: NodeJS.ProcessEnv): Promise<UnitEntry[]> {
  const dir = unitDir(env);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: UnitEntry[] = [];
  for (const file of files) {
    if (!/^delivery-.*\.service$/.test(file)) continue;
    const unit = file.slice(0, -".service".length);
    if (!files.includes(`${unit}.timer`)) continue;
    const servicePath = join(dir, file);
    const timerPath = join(dir, `${unit}.timer`);
    const service = parseShow(await readFile(servicePath, "utf-8"));
    if (recordedRepository(service) !== repoPath) continue;
    const timer = parseShow(await readFile(timerPath, "utf-8"));
    const args = scheduleArgsFrom(execTokens(service.ExecStart ?? "").slice(2));
    entries.push({ unit, name: service[MARKER] || DEFAULT_NAME, servicePath, timerPath, onCalendar: timer.OnCalendar ?? "", args });
  }
  return entries;
}

const journal = (unit: string): string => `journalctl --user -u ${unit}.service`;

/** Default first, then by name. */
const byName = (a: InstalledSchedule, b: InstalledSchedule): number => {
  if (a.name === b.name) return 0;
  if (a.name === DEFAULT_NAME) return -1;
  if (b.name === DEFAULT_NAME) return 1;
  return a.name < b.name ? -1 : 1;
};

export const systemdBackend: SchedulerBackend = {
  async probe(env) {
    const result = await systemctl(env, ["show-environment"]);
    return result.ok ? { ok: true, catchesUp: true } : { ok: false, reason: result.reason };
  },

  async install(schedule, env) {
    const unit = unitName(schedule.repoPath, schedule.name);
    const dir = unitDir(env);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${unit}.service`), serviceUnit(schedule));
    await writeFile(join(dir, `${unit}.timer`), timerUnit(schedule));
    await must(env, ["daemon-reload"]);
    await must(env, ["enable", `${unit}.timer`]);
    await must(env, ["restart", `${unit}.timer`]); // so a changed interval takes effect on a timer already running
  },

  async remove(repoPath, name, env) {
    const entry = (await installedEntries(repoPath, env)).find((found) => found.name === name);
    if (!entry) return false;
    await must(env, ["disable", "--now", `${entry.unit}.timer`]);
    await rm(entry.timerPath);
    await rm(entry.servicePath);
    await must(env, ["daemon-reload"]);
    return true;
  },

  async list(repoPath, env) {
    const entries = await installedEntries(repoPath, env);
    const listed = await Promise.all(
      entries.map(async (entry): Promise<InstalledSchedule> => {
        const show = parseShow(
          await must(env, ["show", `${entry.unit}.timer`, "-p", "UnitFileState", "-p", "LastTriggerUSec", "-p", "NextElapseUSecRealtime"]),
        );
        return {
          name: entry.name,
          every: intervalForCalendar(entry.onCalendar)?.text ?? entry.onCalendar,
          args: entry.args,
          enabled: show.UnitFileState === "enabled",
          lastRun: show.LastTriggerUSec ?? "",
          nextRun: show.NextElapseUSecRealtime ?? "",
          logCommand: journal(entry.unit),
        };
      }),
    );
    return listed.sort(byName);
  },

  logCommand: (repoPath, name) => journal(unitName(repoPath, name)),
};
