import type { Schedule, ScheduleArgs } from "./model.js";
import { systemdBackend } from "./systemd.js";

export type Probe = { ok: true; catchesUp: boolean } | { ok: false; reason: string };

export interface InstalledSchedule {
  name: string;
  /** The interval as typed (`5m`), or the scheduler's own wording when it matches none. */
  every: string;
  /** The run settings the schedule runs with, as installed. */
  args: ScheduleArgs;
  enabled: boolean;
  /** As the scheduler reports them; "" when there is none. */
  lastRun: string;
  nextRun: string;
  /** The command that shows this schedule's run output. */
  logCommand: string;
}

/** `installed: false` when the place this schedule needs is held by another repository's schedule; `heldBy` is that repository's path, or "" when it records none. Nothing was written. */
export type InstallOutcome = { installed: true } | { installed: false; heldBy: string };

/** What a scheduler adapter provides. A platform's adapter implements this and passes the contract suite in backend.contract.ts. */
export interface SchedulerBackend {
  probe(env: NodeJS.ProcessEnv): Promise<Probe>;
  /** Install or replace one schedule of this repository, enabled and running. Never replaces another repository's schedule: reports it held instead, having written nothing. */
  install(schedule: Schedule, env: NodeJS.ProcessEnv): Promise<InstallOutcome>;
  remove(repoPath: string, name: string, env: NodeJS.ProcessEnv): Promise<boolean>;
  /** Default first, then by name. */
  list(repoPath: string, env: NodeJS.ProcessEnv): Promise<InstalledSchedule[]>;
  logCommand(repoPath: string, name: string): string;
}

/** The contributor seam that names the platform in tests, so they never depend on the host. */
export const TEST_PLATFORM = "DELIVERY_TEST_PLATFORM";
export const platformOf = (env: NodeJS.ProcessEnv): string => env[TEST_PLATFORM] ?? process.platform;
export const noBackend = (platform: string): string => `${platform} has no scheduler backend yet`;

/** Reached only after a failed probe, which the caller checks first; anything else is a programming error. */
const unreachable = (): never => {
  throw new Error("no scheduler backend on this platform; install and logCommand need a passing probe first");
};

const noBackendOn = (platform: string): SchedulerBackend => ({
  async probe() {
    return { ok: false, reason: noBackend(platform) };
  },
  install: async () => unreachable(),
  async remove() {
    return false;
  },
  async list() {
    return [];
  },
  logCommand: () => unreachable(),
});

export function selectBackend(platform: string): SchedulerBackend {
  return platform === "linux" ? systemdBackend : noBackendOn(platform);
}
