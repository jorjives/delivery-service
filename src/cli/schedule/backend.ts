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

/** What a scheduler adapter provides. A platform's adapter implements this and passes the contract suite in backend.contract.ts. */
export interface SchedulerBackend {
  probe(env: NodeJS.ProcessEnv): Promise<Probe>;
  install(schedule: Schedule, env: NodeJS.ProcessEnv): Promise<void>;
  remove(repoPath: string, name: string, env: NodeJS.ProcessEnv): Promise<boolean>;
  /** Default first, then by name. */
  list(repoPath: string, env: NodeJS.ProcessEnv): Promise<InstalledSchedule[]>;
  logCommand(repoPath: string, name: string): string;
}

export function selectBackend(): SchedulerBackend {
  return systemdBackend;
}
