# CLI: Work Items

This document specifies `hiboss work-item ...`.

Work items are persistent orchestration records stored in SQLite (`work_items`) and linked from envelopes via metadata keys:
- `workItemId`
- `workItemState`
- `workItemTitle`

## `hiboss work-item list`

Lists persistent work items.

Flags:
- `--token <token>` (optional; defaults to `HIBOSS_TOKEN`)
- `--state <state>` (optional; `new|triaged|in-progress|awaiting-user|blocked|done|archived`)
- `-n, --limit <n>` (optional; default `50`, max `200`)

Output (parseable, one block per item):
- `work-item-id:`
- `work-item-state:`
- `work-item-title:` (`(none)` when empty)
- `work-item-channel-allowlist:` (comma-separated channel addresses or `(none)`)
- `created-at:` (boss timezone offset)
- `updated-at:` (boss timezone offset or `(none)`)

Empty output:

```text
no-work-items: true
```

Default permission:
- `restricted`

## `hiboss work-item get`

Gets one work item by id.

Flags:
- `--id <id>` (required; lowercase letters/numbers with optional `. _ : -`)
- `--token <token>` (optional; defaults to `HIBOSS_TOKEN`)

Output (parseable):
- `work-item-id:`
- `work-item-state:`
- `work-item-title:` (`(none)` when empty)
- `work-item-channel-allowlist:` (comma-separated channel addresses or `(none)`)
- `created-at:`
- `updated-at:`

Default permission:
- `restricted`

## `hiboss work-item update`

Updates a work item's state and/or title.

Flags:
- `--id <id>` (required)
- `--token <token>` (optional; defaults to `HIBOSS_TOKEN`)
- `--state <state>` (optional; `new|triaged|in-progress|awaiting-user|blocked|done|archived`)
- `--title <title>` (optional; non-empty, max 200 chars)
- `--clear-title` (optional; clears title; cannot be used with `--title`)
- `--add-channel <address>` (optional, repeatable; must be `channel:<adapter>:<chat-id>`)
- `--remove-channel <address>` (optional, repeatable; must be `channel:<adapter>:<chat-id>`)

Validation rules:
- Must provide at least one of `--state`, `--title`, `--clear-title`, `--add-channel`, `--remove-channel`.
- `--title` and `--clear-title` are mutually exclusive.
- State transition must satisfy lifecycle guards.
- `--state done` requires `leader` role (orchestrator authority boundary).
- `--add-channel` / `--remove-channel` require `leader` role.
- The same channel cannot appear in both `--add-channel` and `--remove-channel` within one call.
- Any explicit `--add-channel`/`--remove-channel` update switches the work item to strict allowlist mode.
- In strict allowlist mode, non-leader sends cannot auto-seed/expand channels (even when allowlist is empty).

Lifecycle transition rules:
- `new` -> `triaged|in-progress|blocked|archived`
- `triaged` -> `in-progress|blocked|archived`
- `in-progress` -> `awaiting-user|blocked|done|archived`
- `awaiting-user` -> `in-progress|blocked|done|archived`
- `blocked` -> `triaged|in-progress|awaiting-user|archived`
- `done` -> `in-progress|archived`
- `archived` -> (none)

Output (parseable):
- `work-item-id:`
- `work-item-state:`
- `work-item-title:`
- `work-item-channel-allowlist:`
- `created-at:`
- `updated-at:`

Default permission:
- `restricted`
