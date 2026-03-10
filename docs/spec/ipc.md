# IPC (CLI ↔ daemon)

Hi-Boss uses local IPC so the `hiboss` CLI can talk to the running daemon.

Key files:

- `src/daemon/ipc/server.ts` — JSON-RPC server over a local socket
- `src/cli/ipc-client.ts` — JSON-RPC client used by the CLI
- `src/daemon/ipc/types.ts` — method params/result types and error codes
- `src/daemon/daemon.ts` — method implementations

---

## Transport

- Socket path: `~/hiboss/.daemon/daemon.sock` (or `{{HIBOSS_DIR}}/.daemon/daemon.sock` when overridden)
- Protocol: JSON-RPC 2.0

---

## Authentication model

Most RPC methods require a **token** (agent or boss):

- the CLI passes `token` in params (or uses `HIBOSS_TOKEN` when `--token` is omitted)
- the daemon treats it as a **boss token** if it matches `config.boss_token_hash`, otherwise as an **agent token** (`agents.token`)

Bootstrap methods do not require a token:

- `setup.check`
- `setup.execute`
- `boss.verify`

All other methods require a token and are authorized by the permission policy (see `docs/spec/configuration.md`).

---

## RPC Methods (current)

Canonical envelope methods:

- `envelope.send`
- `envelope.list`
- `envelope.thread`

Reactions:

- `reaction.set`

Work items:

- `work-item.list`
- `work-item.get`
- `work-item.update`

Projects:

- `project.list`
- `project.get`
- `project.select-leader`

Skills:

- `skill.remote.add`
- `skill.remote.list`
- `skill.remote.update`
- `skill.remote.remove`

`skill.remote.add` / `skill.remote.update` / `skill.remote.remove` results include a `refresh` summary (`count`, `requested[]`) that describes session refresh requests triggered by the mutation.
When these methods fail validation/safety checks, error `data` may include `{ errorCode, hint }` for user-facing diagnostics.

Cron:

- `cron.create`
- `cron.list`
- `cron.enable`
- `cron.disable`
- `cron.delete`

Backwards-compatible aliases:

None.

Agents:

- `agent.register`
- `agent.set`
- `agent.list`
- `agent.bind`
- `agent.unbind`
- `agent.refresh` (requests a session refresh)
- `agent.abort` (cancels current run + clears due pending non-cron envelopes)
- `agent.self` (resolve `token` → current agent config)
- `agent.session-policy.set`
- `agent.status`

`agent.refresh` params:
- `token` (required)
- `agentName` (required)
- `projectId` (optional): when provided, refresh targets the project-scoped session key `<agentName>:<projectId>`; when omitted, daemon uses auto-project targeting (falls back to agent-scoped refresh when project context is unavailable)

Daemon:

- `daemon.status`
- `daemon.ping`
- `daemon.time`

Setup:

- `setup.check`
- `setup.execute`

Boss:

- `boss.verify`
