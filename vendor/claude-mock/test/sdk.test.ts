import { describe, expect, it, beforeEach } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-mock-'));
});

function script(input: unknown[] | { init?: unknown; expectations: unknown[] }): string {
  const path = join(dir, 'mock.json');
  writeFileSync(path, JSON.stringify(input));
  return path;
}

function run(prompt: string, scriptPath: string) {
  return query({
    prompt,
    options: {
      cwd: dir,
      pathToClaudeCodeExecutable: CLI,
      env: {
        ...process.env,
        CLAUDE_MOCK_SCRIPT: scriptPath,
        CLAUDE_MOCK_JOURNAL: join(dir, 'journal.jsonl'),
      },
    },
  });
}

async function collect(prompt: string, scriptPath: string) {
  const messages = [];
  for await (const m of run(prompt, scriptPath)) messages.push(m);
  return messages;
}

const journal = () =>
  readFileSync(join(dir, 'journal.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

describe('fake CLI', () => {
  it('replies with scripted text', async () => {
    const messages = await collect('hello there', script([{ reply: 'Hi from the mock.' }]));
    const result: any = messages.at(-1);
    expect(result.type).toBe('result');
    expect(result.subtype).toBe('success');
    expect(result.result).toBe('Hi from the mock.');
  });

  it('applies a file write as a real side effect and emits the tool transcript', async () => {
    const messages = await collect(
      'summarise the repo',
      script([
        {
          when: { promptContains: 'summarise' },
          effects: [{ write: { path: 'out/summary.md', content: '# Summary' } }],
          reply: 'Written.',
        },
      ]),
    );
    expect(readFileSync(join(dir, 'out/summary.md'), 'utf8')).toBe('# Summary');

    const toolUse: any = messages.find(
      (m: any) => m.type === 'assistant' && m.message.content.some((c: any) => c.type === 'tool_use'),
    );
    expect(toolUse.message.content[0]).toMatchObject({ type: 'tool_use', name: 'Write' });
    const toolResult: any = messages.find(
      (m: any) => m.type === 'user' && m.message.content?.[0]?.type === 'tool_result',
    );
    expect(toolResult.message.content[0].is_error).toBe(false);
  });

  it('returns structured output', async () => {
    const messages = await collect('JSON only', script([{ json: { status: 'ok', files: 3 } }]));
    expect((messages.at(-1) as any).structured_output).toEqual({ status: 'ok', files: 3 });
  });

  it('matches expectations in order and records prompts in the journal', async () => {
    const path = script([
      { when: { promptContains: 'nudge' }, json: { ok: true } },
      { reply: 'no json here' },
    ]);
    const first: any = (await collect('do the thing', path)).at(-1);
    expect(first.result).toBe('no json here');
    expect(first.structured_output).toBeUndefined();

    const second: any = (await collect('a nudge: JSON only please', path)).at(-1);
    expect(second.structured_output).toEqual({ ok: true });

    expect(journal().filter((e) => e.event === 'matched').map((e) => e.prompt)).toEqual(['do the thing', 'a nudge: JSON only please']);
  });

  it('injects a failure result', async () => {
    const result: any = (
      await collect('boom', script([{ fail: { message: 'rate limited' } }]))
    ).at(-1);
    expect(result.type).toBe('result');
    expect(result.is_error).toBe(true);
    expect(result.result).toContain('rate limited');
  });

  it('passes slash_commands from init config into the init message', async () => {
    const cmds = [{ name: '/test', description: 'A test command' }];
    const messages = await collect(
      'hi',
      script({ init: { slash_commands: cmds }, expectations: [{ reply: 'ok' }] }),
    );
    const init: any = messages.find((m: any) => m.type === 'system' && m.subtype === 'init');
    expect(init.slash_commands).toEqual(cmds);
  });

  it('applies a global delayMs to each turn', async () => {
    const start = Date.now();
    const messages = await collect(
      'hello',
      script({ delayMs: 150, expectations: [{ reply: 'delayed' }] }),
    );
    const elapsed = Date.now() - start;
    expect((messages.at(-1) as any).result).toBe('delayed');
    expect(elapsed).toBeGreaterThanOrEqual(100); // allow some jitter
  });

  it('uses per-expectation delayMs, overriding global', async () => {
    const start = Date.now();
    const messages = await collect(
      'hello',
      script({ delayMs: 500, expectations: [{ delayMs: 100, reply: 'fast override' }] }),
    );
    const elapsed = Date.now() - start;
    expect((messages.at(-1) as any).result).toBe('fast override');
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(400); // must not use the global 500ms
  });

  it('records unmatched prompts instead of inventing a reply', async () => {
    const result: any = (
      await collect('unexpected', script([{ when: { promptContains: 'never' }, reply: 'x' } ]))
    ).at(-1);
    expect(result.is_error).toBe(true);
    expect(journal().some((e) => e.event === 'unmatched')).toBe(true);
    expect(existsSync(join(dir, 'out'))).toBe(false);
  });
});
