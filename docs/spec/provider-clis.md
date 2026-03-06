# Provider CLIs (Claude Code + Codex CLI)

This document specifies canonical Hi-Boss behavior for provider CLI invocation.

Providers:
- Claude Code CLI (`claude`)
- Codex CLI (`codex exec`)

Third-party reference docs (non-canonical):
- `docs/refs/providers/claude-code-cli.md`
- `docs/refs/providers/codex-cli.md`

Manual experiments:
- `docs/experiments/provider-clis/manual-experiments.md`

Key implementation files:
- `src/agent/executor-turn.ts` (process spawning + args)
- `src/agent/background-turn.ts` (background process spawning + final text extraction)
- `src/agent/provider-cli-parsers.ts` (JSONL parsing)
- `src/agent/session-resume.ts` / `src/agent/persisted-session.ts` (resume handles)

## Provider homes (shared, forced)

Provider state is shared across all agents (no per-agent provider homes). Hi-Boss always uses the user's default homes:
- Claude: `~/.claude`
- Codex: `~/.codex`

To keep behavior stable, Hi-Boss clears provider-home override env vars when spawning provider processes:
- clears `CLAUDE_CONFIG_DIR`
- clears `CODEX_HOME`

## System instructions injection

- Claude: `--append-system-prompt <text>` (appends Hi-Boss system instructions)
- Codex: `-c developer_instructions=<text>` (sets developer instructions)

## Runtime controls (canonical)

Hi-Boss uses a hybrid execution policy per run. It resolves one of two modes:

- `full-access`
- `workspace-sandbox`

Resolution rules (in order):

1. If any pending envelope for the run is from a non-boss channel sender (`from: channel:*` and `fromBoss=false`), force `workspace-sandbox`.
2. Otherwise, if any pending envelope is from a boss channel sender (`from: channel:*` and `fromBoss=true`) and agent `permissionLevel` is not `restricted`, use `full-access`.
3. Otherwise, if the current turn text is classified as **read/search-only** and agent `permissionLevel` is not `restricted`, use `full-access`.
4. Otherwise, use `workspace-sandbox`.

Background one-shot policy (`to: agent:background`):

- Read/search-only prompt + non-`restricted` sender permission -> `full-access`
- Otherwise -> `workspace-sandbox`

Read/search-only classification is heuristic text intent detection. If mutating intent is detected (edit/delete/create/run/build/test/etc.), Hi-Boss stays in `workspace-sandbox`.

Separately, inbound channel routing has a destructive confirmation gate for boss-origin delete/clear/reset intents. Unconfirmed requests are not routed to agents and instead receive a confirmation prompt.

Provider-specific runtime flags by mode:

- Codex:
  - `full-access`: `--dangerously-bypass-approvals-and-sandbox`
  - `workspace-sandbox`: `--ask-for-approval never --sandbox workspace-write`
- Claude:
  - `full-access`: `--permission-mode bypassPermissions`
  - `workspace-sandbox`: `--permission-mode default`

## Invocation (canonical)

Claude (per turn):
- `claude -p --append-system-prompt ... --output-format stream-json --verbose --permission-mode <bypassPermissions|default>`
- Adds `--add-dir` for:
  - `{{HIBOSS_DIR}}/agents/<agent>/internal_space`
  - `{{HIBOSS_DIR}}/.daemon`
- Adds `--model <model>` when configured.
- Adds `-r <session-id>` when resuming.

Codex (per turn):
- Fresh: `codex [--dangerously-bypass-approvals-and-sandbox | --ask-for-approval never --sandbox workspace-write] exec --json --skip-git-repo-check --add-dir {{HIBOSS_DIR}}/agents/<agent>/internal_space --add-dir {{HIBOSS_DIR}}/.daemon -c developer_instructions=... [-c model_reasoning_effort="..."] [-m <model>] <prompt>`
- Resume: `codex [--dangerously-bypass-approvals-and-sandbox | --ask-for-approval never --sandbox workspace-write] exec resume --json --skip-git-repo-check [-c ...] [-m <model>] <thread-id> <prompt>`
  - Note: `codex exec resume` does not support `--add-dir`.

Background one-shot (`to: agent:background`):
- Claude: `claude -p --output-format text --permission-mode <bypassPermissions|default> [-m <model>]`
- Codex: `codex [--dangerously-bypass-approvals-and-sandbox | --ask-for-approval never --sandbox workspace-write] exec --skip-git-repo-check -o <tmp-file> [-c model_reasoning_effort="..."] [-m <model>] <prompt>`
- Final feedback text is taken from provider-native stable outputs (Claude text stdout, Codex `-o` file), not JSONL event parsing.

## Abort / cancellation behavior

Provider CLIs can be aborted by terminating the child process (SIGINT/SIGTERM). Expect partial output; do not assume a final success-result event.

## Token usage

### Hi-Boss metrics

A single Hi-Boss "turn" (one `codex exec` or `claude -p` invocation) can trigger multiple model calls (tool loops). Hi-Boss computes two kinds of metrics:

| Metric | Meaning | Logged | Persisted |
|---|---|---|---|
| `context-length` | Final model-call size (prompt + output of the last API request in the turn) | Always | `agent_runs.context_length` |
| `input-tokens` | Total input tokens consumed in the turn (billing) | Debug only | No |
| `output-tokens` | Total output tokens consumed in the turn (billing) | Debug only | No |
| `cache-read-tokens` | Cache hits (prompt tokens served from cache) | Debug only | No |
| `cache-write-tokens` | Cache writes (new prompt tokens written to cache) | Debug only | No |
| `total-tokens` | `input-tokens + output-tokens` | Debug only | No |

- All metrics are logged on the `agent-run-complete` event. Debug-only fields require `hiboss daemon start --debug`.
- `context-length` drives the `session-max-context-length` refresh policy. If missing (`null`), the policy check is skipped.
- On failure/cancellation, `context-length` is cleared to `NULL`.

### Calculation: Claude

Source: `--output-format stream-json` JSONL.

`context-length` from the last `type:"assistant"` event's `message.usage`:

```text
context-length = input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens
```

All four fields are needed because Claude reports `input_tokens` as only the uncached portion; cached tokens are separate.

Billing fields from aggregated `result.usage` (summed across all model calls in the turn):

```text
input-tokens       = result.usage.input_tokens
output-tokens      = result.usage.output_tokens
cache-read-tokens  = result.usage.cache_read_input_tokens
cache-write-tokens = result.usage.cache_creation_input_tokens
total-tokens       = input-tokens + output-tokens
```

### Calculation: Codex

`context-length` from the rollout log on disk (best-effort enrichment):

```text
# File: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread_id>.jsonl
# Event: last event_msg with payload.type="token_count"

context-length = last_token_usage.input_tokens + last_token_usage.output_tokens
```

`cached_input_tokens` is a breakdown within `input_tokens` (not additive).

Billing fields are per-turn deltas from cumulative `turn.completed.usage`:

```text
input-tokens       = current.input_tokens - previous.input_tokens
output-tokens      = current.output_tokens - previous.output_tokens
cache-read-tokens  = current.cached_input_tokens - previous.cached_input_tokens
cache-write-tokens = null  (Codex does not report this)
total-tokens       = input-tokens + output-tokens
```

Hi-Boss persists the last-seen cumulative totals in `agents.metadata.sessionHandle` (`codexCumulativeUsage`). If prior totals are missing (first run or upgrade while resuming), billing fields are `null` for that run.

For raw provider output/event reference details, see:
- `docs/refs/providers/claude-code-cli.md`
- `docs/refs/providers/codex-cli.md`
