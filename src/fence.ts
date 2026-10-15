import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { SessionEnvironment } from "./agent-invoke.js";
import { git } from "./git-exec.js";
import { atomicWrite } from "./journal.js";
import { stateHome } from "./run-location.js";
import { FenceMode, type FenceState } from "./schema.js";

const execFileAsync = promisify(execFile);

/** The config file's `fence`: a mode, or a mode and the host devices to pass through (as Autoloop's AUTOLOOP_FSGUARD_DEV_BIND). */
export const FenceSetting = z.union([FenceMode, z.strictObject({ mode: FenceMode.optional(), devices: z.array(z.string().min(1)).optional() })]);
export type FenceSetting = z.infer<typeof FenceSetting>;

export const DEFAULT_FENCE: FenceMode = "preferred";

export function fenceOf(setting: FenceSetting | undefined): { mode: FenceMode; devices: string[] } {
  if (setting === undefined) return { mode: DEFAULT_FENCE, devices: [] };
  if (typeof setting === "string") return { mode: setting, devices: [] };
  return { mode: setting.mode ?? DEFAULT_FENCE, devices: setting.devices ?? [] };
}

/**
 * Contributor-only test seam: the bubblewrap the harness runs. A missing path makes the fence absent on any
 * machine, which is how the command's own tests stay the same everywhere. Documented in CONTRIBUTING.md.
 */
export const TEST_BWRAP = "DELIVERY_TEST_BWRAP";
export const bwrapOf = (env: NodeJS.ProcessEnv): string => env[TEST_BWRAP] ?? "bwrap";

/** What the fence binds: the main folder read-only, the paths inside it that stay writable, and the devices passed through. */
export interface FencePaths {
  readOnly: string;
  writable: string[];
  devices: string[];
}

const inside = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** The fence for a repository: its shared git folder stays writable, and so does a working copy that sits inside it. */
export async function fencePaths(repoPath: string, worktreePath: string | undefined, devices: string[]): Promise<FencePaths> {
  const gitDir = await git(repoPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const writable = [gitDir, ...(worktreePath !== undefined && inside(repoPath, worktreePath) ? [worktreePath] : [])];
  return { readOnly: repoPath, writable, devices };
}

/** Autoloop's fsguard, as arguments: the filesystem as it is, the main folder over it read-only, then what stays writable. */
export function fenceArgs({ readOnly, writable, devices }: FencePaths): string[] {
  return [
    "--dev-bind", "/", "/",
    "--ro-bind", readOnly, readOnly,
    ...writable.flatMap((path) => ["--bind", path, path]),
    ...devices.flatMap((device) => ["--dev-bind", device, device]),
  ];
}

const PROBE_FILE = ".delivery-fence-probe";
/** Exit 3: the main folder could be written. Otherwise a scratch write and the git folder must both work. */
const PROBE = `if touch "$1/${PROBE_FILE}" 2>/dev/null; then rm -f "$1/${PROBE_FILE}"; exit 3; fi; d=$(mktemp -d) && touch "$d/x" && rm -rf "$d" && test -w "$2"`;

/**
 * Whether the fence holds on this machine: inside it, a write to the main folder must fail, a write elsewhere must
 * succeed, and the shared git folder must be writable. Run before the run's first session, so the record says
 * whether the fence was there rather than assuming it.
 */
export async function probeFence(bwrap: string, paths: FencePaths, env: NodeJS.ProcessEnv): Promise<FenceState> {
  try {
    await execFileAsync(bwrap, [...fenceArgs(paths), "--", "sh", "-c", PROBE, "probe", paths.readOnly, paths.writable[0] ?? paths.readOnly], { env });
    return { present: true };
  } catch (err) {
    const { code, stderr } = err as { code?: unknown; stderr?: string };
    if (code === "ENOENT") return { present: false, reason: "bubblewrap (bwrap) is not installed" };
    if (code === 3) return { present: false, reason: "the main folder could still be written to inside the fence" };
    const said = (stderr ?? "").trim().split("\n")[0];
    return { present: false, reason: `bubblewrap could not start${said ? `: ${said}` : ""}` };
  }
}

const quoted = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;

/** The executable the SDK starts in place of the runtime: the runtime, inside the fence, with the session's own arguments. */
export function wrapperScript(bwrap: string, paths: FencePaths, runtime: string): string {
  return `#!/bin/sh\nexec ${[bwrap, ...fenceArgs(paths)].map(quoted).join(" ")} -- ${quoted(runtime)} "$@"\n`;
}

/** Where a wrapper is kept: named by its content, so the same fence is written once and never changes under a running session. */
export async function writeWrapper(env: NodeJS.ProcessEnv, script: string): Promise<string> {
  const dir = join(stateHome(env), "delivery-service", "fence");
  const file = join(dir, `${createHash("sha256").update(script).digest("hex").slice(0, 16)}.sh`);
  if (existsSync(file)) return file;
  await mkdir(dir, { recursive: true });
  await atomicWrite(file, script, 0o700);
  return file;
}

/** The session, its runtime started inside the fence. Every process the session spawns inherits it. */
export async function fenceSession(
  session: SessionEnvironment,
  { repoPath, worktreePath, devices, env }: { repoPath: string; worktreePath: string; devices: string[]; env: NodeJS.ProcessEnv },
): Promise<SessionEnvironment> {
  const runtime = session.pathToClaudeCodeExecutable;
  if (runtime === undefined) throw new Error("the agent's runtime was not resolved, so it cannot be started inside the fence");
  const paths = await fencePaths(repoPath, worktreePath, devices);
  return { ...session, pathToClaudeCodeExecutable: await writeWrapper(env, wrapperScript(bwrapOf(env), paths, runtime)) };
}
