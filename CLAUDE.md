# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Build & development commands

```bash
# Install dependencies
npm i

# Build (TypeScript -> dist/) and make CLI available locally
npm run build && npm link

# Type-check without emitting
npm run typecheck

# Run all tests (Node.js built-in test runner, no npm test script)
node --import tsx --test 'src/**/*.test.ts'

# Run a single test file
node --import tsx --test src/daemon/db/database.test.ts

# Validate prompt templates
npm run prompts:check

# Validate default values
npm run defaults:check

# Regenerate CLI examples (after changing CLI output/formatting)
npm run examples:cli

# Regenerate prompt examples (after changing prompt templates/rendering)
npm run examples:prompts

# Regenerate magic inventory (do not hand-edit the output file)
npm run inventory:magic
```

There is no linter configured. There is no `npm test` script — use `node --import tsx --test` directly.

## Architecture notes beyond AGENTS.md

**IPC flow**: CLI (`src/cli/`) -> JSON-RPC over Unix socket -> daemon (`src/daemon/ipc/server.ts`) -> RPC handlers (`src/daemon/rpc/`) -> DB (`src/daemon/db/database.ts`). The CLI is purely a thin client; all state lives in the daemon's SQLite database.

**Agent execution pipeline**: When envelopes arrive for an agent, the executor (`src/agent/executor.ts`) builds a turn input from pending envelopes, generates instructions via the prompt system, spawns a provider CLI (Claude Code or Codex) as a subprocess, and parses the output. The executor splits into focused modules: `executor-turn.ts` (turn logic), `executor-session.ts` (session management), `executor-triggers.ts` (wake triggers), `executor-db.ts` (DB interactions), `executor-support.ts` (helpers).

**Background vs foreground agents**: `src/agent/executor.ts` handles foreground (speaker) agents; `src/agent/background-executor.ts` handles leader/background agents that run tasks in parallel without blocking the speaker flow.

**Prompt templates**: Located in `prompts/` as `.md` files using Nunjucks syntax for variable interpolation. Three layers: `system/` (agent identity/role/tools), `turn/` (per-turn context + envelopes), `envelope/` (individual envelope formatting). The renderer is `src/shared/prompt-renderer.ts`; context is built by `src/shared/prompt-context.ts`.

**Adapter pattern**: Each chat platform (Telegram, Feishu) implements the `ChatAdapter` interface from `src/adapters/types.ts`. Adapters are registered via `src/adapters/registry.ts` and bridged to the envelope system through `src/daemon/bridges/channel-bridge.ts`. Inbound messages become envelopes; outbound envelopes are sent via the adapter.

**Tests**: Use Node.js built-in `node:test` and `node:assert/strict`. Test files are co-located with source files as `*.test.ts`. Tests typically create temporary directories/databases for isolation.
