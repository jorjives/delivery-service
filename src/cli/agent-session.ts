import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { z } from "zod";
import type { SessionEnvironment } from "../agent-invoke.js";
import { mockSessionEnvironment } from "../mock-session.js";
import { EXIT, Refusal } from "./failures.js";

export const NO_RUNTIME =
  "I can't start the agent that does the work: the Claude Code runtime that comes with the harness is missing or won't start on this machine. Reinstall the harness without `--omit=optional`, then try again.";

export const NOT_SIGNED_IN =
  "I can't start the agent that does the work: you're not signed in. Run `claude auth login`, or set `ANTHROPIC_API_KEY`, then try again.";

/**
 * Contributor-only test seam: the path of a claude-mock script. When set, every
 * agent session in the run is routed to the vendored scripted agent and the
 * runtime preflight is skipped. Documented in CONTRIBUTING.md and deliberately
 * absent from `--help`: this seam stays undocumented in `--help` because it
 * routes a whole run to a script. claude-mock ships inside the package for
 * `delivery packs check`.
 */
export const TEST_MOCK_SCRIPT = "DELIVERY_TEST_MOCK_SCRIPT";

export interface Platform {
  platform: NodeJS.Platform;
  arch: string;
  /** A Linux whose C library is musl rather than glibc. */
  musl: boolean;
}

/**
 * The packages the Agent SDK looks in for the Claude Code binary it launches,
 * in the order it tries them. The SDK does not export its lookup, so this
 * mirrors it (SDK 0.3.x); `resolveRuntime`'s test fails on install if a new
 * SDK renames the packages.
 */
export function runtimeCandidates({ platform, arch, musl }: Platform): string[] {
  const executable = platform === "win32" ? "claude.exe" : "claude";
  const packages =
    platform === "linux"
      ? musl
        ? [`linux-${arch}-musl`, `linux-${arch}`]
        : [`linux-${arch}`, `linux-${arch}-musl`]
      : [`${platform}-${arch}`];
  return packages.map((name) => `@anthropic-ai/claude-agent-sdk-${name}/${executable}`);
}

function thisPlatform(): Platform {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === "linux" && report.header?.glibcVersionRuntime === undefined,
  };
}

/** Resolves module ids from where the SDK is installed, as the SDK itself does. */
const fromSdk = createRequire(createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"));

/**
 * The Claude Code binary the Agent SDK would launch, or undefined when none is
 * installed. The command hands this path to the SDK explicitly, so the binary
 * the preflight checks is the binary that runs.
 */
export function resolveRuntime(
  resolve: (id: string) => string = (id) => fromSdk.resolve(id),
  platform: Platform = thisPlatform(),
): string | undefined {
  for (const id of runtimeCandidates(platform)) {
    try {
      const path = resolve(id);
      if (existsSync(path)) return path;
    } catch {
      // Not installed for this platform: try the next candidate.
    }
  }
  return undefined;
}

const execFile = promisify(execFileCb);

const AuthStatus = z.object({ loggedIn: z.boolean() });

/**
 * What `claude auth status --json` reports, or undefined when the binary would
 * not run or said something unreadable. A signed-out runtime exits non-zero
 * with the same JSON on stdout, so stdout is read whatever the exit code
 * (Node attaches stdout to a rejected execFile's error too).
 */
async function authStatus(runtime: string, env: NodeJS.ProcessEnv): Promise<{ loggedIn: boolean } | undefined> {
  const stdout = await execFile(runtime, ["auth", "status", "--json"], { env, timeout: 30_000 }).then(
    (result) => result.stdout,
    (err: unknown) => (err as { stdout?: string }).stdout,
  );
  try {
    const parsed = AuthStatus.safeParse(JSON.parse(stdout ?? ""));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check, before anything is set up, that the agent can start: the runtime
 * exists and runs, and it is signed in. The runtime is asked rather than
 * second-guessed, so an API key, a token and a stored login all count, however
 * this machine keeps them. Returns the runtime's path.
 */
export async function preflight(runtime: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  if (runtime === undefined) throw new Refusal(NO_RUNTIME, EXIT.agentRuntime);
  const status = await authStatus(runtime, env);
  if (status === undefined) throw new Refusal(NO_RUNTIME, EXIT.agentRuntime);
  if (!status.loggedIn) throw new Refusal(NOT_SIGNED_IN, EXIT.agentRuntime);
  return runtime;
}

/**
 * The session every agent call in a run uses: the scripted agent when the
 * contributor test seam names a script, otherwise the real runtime, once it has
 * passed the preflight.
 */
export async function agentSession(env: NodeJS.ProcessEnv): Promise<SessionEnvironment> {
  const script = env[TEST_MOCK_SCRIPT];
  if (script) return mockSessionEnvironment({ scriptPath: script, journalPath: `${script}.journal.jsonl` });
  return { pathToClaudeCodeExecutable: await preflight(resolveRuntime(), env), env };
}
