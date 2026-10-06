import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

export type Effect =
  | { write: { path: string; content: string } }
  | { edit: { path: string; old: string; new: string } }
  | { delete: { path: string } };

export type Expectation = {
  /** Omit to match any prompt at this position in the queue. */
  when?: { promptContains?: string; promptMatches?: string };
  effects?: Effect[];
  /** Assistant text reply. */
  reply?: string;
  /** Sets `structured_output` on the result message. */
  json?: unknown;
  /** Emit an error result instead of a success one. */
  fail?: { message: string };
  /** Delay in ms before responding to this turn. Overrides Script-level delayMs. */
  delayMs?: number;
  /** Sets `total_cost_usd` on the result message. Reported only. Default 0. */
  costUsd?: number;
  /** Sets `duration_ms` on the result message. Reported only: nothing waits for it (`delayMs` does). Default 0. */
  durationMs?: number;
};

export type InitConfig = {
  slash_commands?: unknown[];
};

export type Script = {
  init?: InitConfig;
  expectations: Expectation[];
  /** Default delay in ms before responding to each turn. Per-expectation delayMs overrides. */
  delayMs?: number;
};

export function loadScript(path: string): Script {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw)) return { expectations: raw };
  if (raw && typeof raw === 'object' && Array.isArray(raw.expectations)) {
    return { init: raw.init, expectations: raw.expectations, delayMs: raw.delayMs };
  }
  throw new Error(`${path}: expected an array or { expectations: [...] }`);
}

export function matches(e: Expectation, prompt: string): boolean {
  const w = e.when;
  if (!w) return true;
  if (w.promptContains !== undefined && !prompt.includes(w.promptContains)) return false;
  if (w.promptMatches !== undefined && !new RegExp(w.promptMatches).test(prompt)) return false;
  return true;
}

/** Resolve a path inside the sandbox root, refusing anything that escapes it. */
export function safePath(root: string, path: string): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`path escapes the sandbox root: ${path}`);
  }
  return full;
}

/** Applies the effect for real, and describes it as a tool_use/tool_result pair. */
export function applyEffect(root: string, effect: Effect): { name: string; input: unknown; result: string } {
  if ('write' in effect) {
    const { path, content } = effect.write;
    const full = safePath(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    return { name: 'Write', input: { file_path: full, content }, result: `Wrote ${content.length} bytes to ${full}` };
  }
  if ('delete' in effect) {
    const full = safePath(root, effect.delete.path);
    rmSync(full); // a missing file throws, as a real `rm` fails: an effect that cannot be applied
    return { name: 'Bash', input: { command: `rm -- ${full}` }, result: `Removed ${full}` };
  }
  const { path, old, new: replacement } = effect.edit;
  const full = safePath(root, path);
  const before = readFileSync(full, 'utf8');
  if (!before.includes(old)) throw new Error(`edit: string not found in ${path}`);
  writeFileSync(full, before.replace(old, replacement));
  return {
    name: 'Edit',
    input: { file_path: full, old_string: old, new_string: replacement },
    result: `Edited ${full}`,
  };
}

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

export class Emitter {
  constructor(
    private readonly sessionId: string,
    private readonly cwd: string,
    private readonly write: (frame: unknown) => void,
  ) {}

  private envelope(extra: Record<string, unknown>) {
    this.write({ uuid: randomUUID(), session_id: this.sessionId, ...extra });
  }

  init(config?: InitConfig) {
    this.envelope({
      type: 'system',
      subtype: 'init',
      apiKeySource: 'none',
      claude_code_version: 'claude-mock',
      cwd: this.cwd,
      tools: ['Write', 'Edit'],
      mcp_servers: [],
      model: 'claude-mock',
      permissionMode: 'bypassPermissions',
      slash_commands: config?.slash_commands ?? [],
      output_style: 'default',
      skills: [],
      plugins: [],
      agents: [],
    });
  }

  assistant(content: unknown[]) {
    this.envelope({
      type: 'assistant',
      message: {
        id: `msg_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-mock',
        content,
        stop_reason: null,
        stop_sequence: null,
        usage: USAGE,
      },
    });
  }

  toolResult(toolUseId: string, content: string, isError = false) {
    this.envelope({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
      },
    });
  }

  result(opts: { text: string; isError: boolean; structuredOutput?: unknown; numTurns: number; costUsd?: number; durationMs?: number }) {
    this.envelope({
      type: 'result',
      subtype: 'success',
      duration_ms: opts.durationMs ?? 0,
      duration_api_ms: 0,
      is_error: opts.isError,
      num_turns: opts.numTurns,
      result: opts.text,
      stop_reason: 'end_turn',
      total_cost_usd: opts.costUsd ?? 0,
      usage: USAGE,
      modelUsage: {},
      permission_denials: [],
      ...(opts.structuredOutput !== undefined ? { structured_output: opts.structuredOutput } : {}),
    });
  }

  /** Runs one expectation: effects for real, then the reply. Returns the result text. */
  runEffects(root: string, effects: Effect[]) {
    for (const effect of effects) {
      const id = `toolu_${randomUUID()}`;
      let outcome: { name: string; input: unknown; result: string };
      try {
        outcome = applyEffect(root, effect);
      } catch (err) {
        const name = 'write' in effect ? 'Write' : 'delete' in effect ? 'Bash' : 'Edit';
        this.assistant([{ type: 'tool_use', id, name, input: effect }]);
        this.toolResult(id, String(err), true);
        throw err;
      }
      this.assistant([{ type: 'tool_use', id, name: outcome.name, input: outcome.input }]);
      this.toolResult(id, outcome.result);
    }
  }
}
