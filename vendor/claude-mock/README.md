# claude-mock

A scripted fake `claude` CLI. Point the Claude Agent SDK's executable option at it
and your harness runs its real code paths — message parsing, tool transcript,
structured output, file side effects — with no API cost and no model.

It mocks at the CLI seam rather than at `query()` or HTTP, so the same binary
serves a TypeScript harness, a Python one, or anything else that shells out.

## Install

```bash
npm i -D /home/jorjives/dev/tools/claude-mock   # then: npx claude-mock
```

Or `sudo npm link` in this directory to get `claude-mock` on `PATH` everywhere.

## Use

Write a script of expectations:

```json
[
  {
    "when": { "promptContains": "summarise the repo" },
    "effects": [{ "write": { "path": "out/summary.md", "content": "# Summary" } }],
    "reply": "I've written the summary."
  },
  {
    "when": { "promptMatches": "JSON only" },
    "json": { "status": "ok", "files": 3 }
  }
]
```

Point the SDK at the fake CLI and hand it the script through the environment:

```ts
// TypeScript
query({
  prompt: 'summarise the repo',
  options: {
    cwd: sandbox,
    pathToClaudeCodeExecutable: 'node_modules/.bin/claude-mock',
    env: { ...process.env, CLAUDE_MOCK_SCRIPT: 'mock.json', CLAUDE_MOCK_JOURNAL: 'journal.jsonl' },
  },
});
```

```python
# Python
opts = ClaudeAgentOptions(cwd=sandbox, env={**os.environ, "CLAUDE_MOCK_SCRIPT": "mock.json"})
opts.cli_path = "node_modules/.bin/claude-mock"
```

## Expectations

Each prompt consumes the first unconsumed expectation that matches it; an
expectation with no `when` matches anything. That is how the nudge case works:
put the nudged response behind a `when`, and the unconditional one after it.

| Field | Effect |
|---|---|
| `when.promptContains` | Substring match on the prompt text |
| `when.promptMatches` | Regular expression (source string) |
| `effects` | `{"write": {path, content}}` or `{"edit": {path, old, new}}`, applied for real |
| `reply` | Assistant text, and the result message's `result` |
| `json` | Sets `structured_output` on the result message |
| `fail.message` | Result with `is_error: true` carrying that text |

Effects run inside the CLI's working directory (the SDK's `cwd`) and each one
emits the matching `tool_use`/`tool_result` pair, so the transcript your harness
parses looks like a real one. Paths that resolve outside that root are refused.

## Verification

Set `CLAUDE_MOCK_JOURNAL` to a path and every turn appends a JSON line:

```json
{"session_id":"…","event":"matched","prompt":"summarise the repo","expectation":0}
{"session_id":"…","event":"finished","turns":1,"unconsumed":[]}
```

`event` is one of `matched`, `unmatched`, `effect_failed`, `finished`. Assert on
`unconsumed` for the "all expectations were used" check, and on `prompt` to spy
on what the harness actually sent. An unmatched prompt returns an error result
rather than inventing a reply.

## Deliberately not here

Recorded-fixture replay, `error_max_turns` / mid-stream truncation, shell-command
effects, and permission-prompt flows. Add each when a harness test actually needs it.
