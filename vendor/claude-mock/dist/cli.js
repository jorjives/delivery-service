#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { Emitter, loadScript, matches } from './mock.js';
const scriptPath = process.env.CLAUDE_MOCK_SCRIPT;
if (!scriptPath) {
    console.error('claude-mock: set CLAUDE_MOCK_SCRIPT to a JSON file of expectations');
    process.exit(2);
}
const root = process.cwd();
const journalPath = process.env.CLAUDE_MOCK_JOURNAL;
const sessionId = randomUUID();
const { init: initConfig, expectations, delayMs: globalDelayMs } = loadScript(scriptPath);
const consumed = new Set();
let numTurns = 0;
let started = false;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
const emitter = new Emitter(sessionId, root, send);
const journal = (entry) => {
    if (journalPath)
        appendFileSync(journalPath, JSON.stringify({ session_id: sessionId, ...entry }) + '\n');
};
function promptOf(message) {
    const { content } = message;
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    return content
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join('\n');
}
function take(prompt) {
    const index = expectations.findIndex((e, i) => !consumed.has(i) && matches(e, prompt));
    if (index === -1)
        return undefined;
    consumed.add(index);
    return { index, expectation: expectations[index] };
}
function respondToTurn(prompt) {
    const taken = take(prompt);
    if (!taken) {
        journal({ event: 'unmatched', prompt });
        emitter.result({
            text: `claude-mock: no expectation matched prompt: ${JSON.stringify(prompt)}`,
            isError: true,
            numTurns,
        });
        return;
    }
    const { index, expectation } = taken;
    const delay = expectation.delayMs ?? globalDelayMs ?? 0;
    const emit = () => {
        journal({ event: 'matched', prompt, expectation: index });
        const reported = { costUsd: expectation.costUsd, durationMs: expectation.durationMs };
        if (expectation.fail) {
            emitter.result({ text: expectation.fail.message, isError: true, numTurns, ...reported });
            return;
        }
        try {
            emitter.runEffects(root, expectation.effects ?? []);
        }
        catch (err) {
            journal({ event: 'effect_failed', prompt, expectation: index, error: String(err) });
            emitter.result({ text: String(err), isError: true, numTurns, ...reported });
            return;
        }
        const text = expectation.reply ?? (expectation.json !== undefined ? JSON.stringify(expectation.json) : '');
        if (text)
            emitter.assistant([{ type: 'text', text }]);
        emitter.result({ text, isError: false, structuredOutput: expectation.json, numTurns, ...reported });
    };
    if (delay > 0)
        setTimeout(emit, delay);
    else
        emit();
}
/** How long to wait after emitting init before responding to the first turn.
 * The real CLI emits init and then takes seconds to process the first API call;
 * without this delay, the init message and the result arrive on the same event-
 * loop tick, which races downstream topic-rebinding flows (e.g. the Agent SDK
 * host rekeying a session topic before the client has resubscribed). */
const initDelayMs = Number(process.env.CLAUDE_MOCK_INIT_DELAY_MS) || 0;
function turn(prompt) {
    numTurns += 1;
    if (!started) {
        started = true;
        emitter.init(initConfig);
        if (initDelayMs > 0) {
            setTimeout(() => respondToTurn(prompt), initDelayMs);
            return;
        }
    }
    respondToTurn(prompt);
}
createInterface({ input: process.stdin })
    .on('line', (line) => {
    if (!line.trim())
        return;
    let frame;
    try {
        frame = JSON.parse(line);
    }
    catch {
        return;
    }
    if (frame.type === 'control_request') {
        send({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: {} } });
        return;
    }
    if (frame.type === 'user' && frame.message)
        turn(promptOf(frame.message));
})
    .on('close', () => {
    const unconsumed = expectations.map((_, i) => i).filter((i) => !consumed.has(i));
    journal({ event: 'finished', turns: numTurns, unconsumed });
    process.exit(0);
});
//# sourceMappingURL=cli.js.map