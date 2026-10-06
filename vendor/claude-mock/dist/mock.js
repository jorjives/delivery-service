import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
export function loadScript(path) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(raw))
        return { expectations: raw };
    if (raw && typeof raw === 'object' && Array.isArray(raw.expectations)) {
        return { init: raw.init, expectations: raw.expectations, delayMs: raw.delayMs };
    }
    throw new Error(`${path}: expected an array or { expectations: [...] }`);
}
export function matches(e, prompt) {
    const w = e.when;
    if (!w)
        return true;
    if (w.promptContains !== undefined && !prompt.includes(w.promptContains))
        return false;
    if (w.promptMatches !== undefined && !new RegExp(w.promptMatches).test(prompt))
        return false;
    return true;
}
/** Resolve a path inside the sandbox root, refusing anything that escapes it. */
export function safePath(root, path) {
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) {
        throw new Error(`path escapes the sandbox root: ${path}`);
    }
    return full;
}
/** Applies the effect for real, and describes it as a tool_use/tool_result pair. */
export function applyEffect(root, effect) {
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
    if (!before.includes(old))
        throw new Error(`edit: string not found in ${path}`);
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
    sessionId;
    cwd;
    write;
    constructor(sessionId, cwd, write) {
        this.sessionId = sessionId;
        this.cwd = cwd;
        this.write = write;
    }
    envelope(extra) {
        this.write({ uuid: randomUUID(), session_id: this.sessionId, ...extra });
    }
    init(config) {
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
    assistant(content) {
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
    toolResult(toolUseId, content, isError = false) {
        this.envelope({
            type: 'user',
            message: {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }],
            },
        });
    }
    result(opts) {
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
    runEffects(root, effects) {
        for (const effect of effects) {
            const id = `toolu_${randomUUID()}`;
            let outcome;
            try {
                outcome = applyEffect(root, effect);
            }
            catch (err) {
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
//# sourceMappingURL=mock.js.map