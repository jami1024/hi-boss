# File-Based Agent Memory (Protocol)

Hi-Boss agent memory is stored as **plain Markdown files** inside each agent’s `internal_space/`. These files are the durable, human-editable source of truth; indexes/caches (SQLite, vector DBs, search indexes) are optional accelerators and are rebuildable.

This document specifies the **v1 private memory protocol** (per-agent). Shared/team memory is intentionally deferred.

## Goals

- **Local-first:** all durable memory is local files.
- **Git-backupable:** a repo can back up memory with frequent commits/pushes.
- **Human-readable:** operators can read/edit memory without special tooling.
- **Prompt-bounded:** injected memory stays within a predictable size budget.
- **Extendable:** future indexing (e.g., QMD) can be layered on without changing file truth.

## Directory layout (canonical)

Per agent:

```text
{{HIBOSS_DIR}}/agents/<agent-name>/internal_space/
  MEMORY.md                     # long-term (core) memory (auto-injected)
  memories/                     # daily memory (auto-injected: latest N files; truncated)
    2026-02-11.md
    2026-02-10.md
    ...
```

Notes:
- `internal_space/` is included in provider CLI `--add-dir`, so agents can read/write these files during work.
- `memories/` is append-friendly and safe to prune/archive later.
- Hi-Boss ensures the internal space layout exists during setup and at session start. If `MEMORY.md` is missing, it is created as an empty file.

## Memory tiers

### Long-term (core): `internal_space/MEMORY.md`

Purpose:
- Stable preferences, constraints, workflows, and durable project context.
- High signal density; written to be injected on every new session.

Format:
- Plain Markdown is allowed, but keep it compact (prefer bullets and short lines).
- Avoid raw transcripts. Store abstractions (“boss prefers concise bullets”, not a full chat log).
- **Never** store secrets (tokens, API keys, passwords).

### Daily: `internal_space/memories/YYYY-MM-DD.md`

Purpose:
- A lightweight activity + decision log for the day.
- A scratchpad for things that might be promoted into long-term memory later.

Format (recommended, not required):
- One short memory per line.
- No timestamps required.
- No headings/categories required.

Example:

```text
Boss prefers concise bullet summaries.
Use internal_space/memories/YYYY-MM-DD.md for daily notes.
Do not store secrets in memory files.
```

Rules:
- Daily files should not be transcripts; store outcomes and references (paths/links), not full raw text.
- The day is derived from the filename; do not repeat the date as top-level metadata.
- When something becomes durable, copy the relevant line(s) into `internal_space/MEMORY.md` (no special format conversion).

## Curation responsibility (v1)

- Agents may append to today’s daily file during work.
- Updating `MEMORY.md` is manual and best-effort (when the agent learns something stable/reusable).
- Hi-Boss does not implement an automated “reflection/consolidation” task in v1.

## Curation enhancements (v1.1)

### afterTurn auto-extraction

After each successful agent turn, Hi-Boss automatically extracts a concise memory entry
from the turn results and appends it to the agent’s daily memory file. This uses rule-based
extraction (no LLM calls) for zero extra token cost.

Extracted information includes:
- Which envelopes were processed (senders)
- What actions were taken (envelope sends, reactions, cron creation)

The auto-extracted entries respect the daily per-file size limit.

### Session refresh notes

When a session is refreshed (daily reset, idle timeout, context overflow), Hi-Boss records
the event to the daily memory file with the refresh reason, helping agents understand
why their conversation context was reset.

### Memory reflection

Hi-Boss provides a reflection prompt builder (`memory-reflection.ts`) that can be used
to send periodic reflection envelopes to agents. The agent then reviews recent daily
memories and consolidates valuable information into MEMORY.md.

## Prompt injection (current behavior)

On each new session, Hi-Boss injects:
1. A truncated snapshot of `internal_space/MEMORY.md` (long-term), then
2. A truncated snapshot of recent daily memory (latest **N** files).

This keeps “always-on” memory small while still providing a short recency window.
If no daily files exist yet, the injected daily snapshot is empty.

### Turn-level memory recall (v1.1)

On each turn, Hi-Boss performs keyword-based recall against a broader memory window:
- Searches MEMORY.md paragraphs and up to **14** days of daily memory
- Scores each block by keyword relevance to current envelopes
- Injects top-scoring fragments (up to **2,000** chars) into the turn prompt

This ensures relevant historical context reaches the agent even in continuous sessions
where the system prompt is not regenerated. The recall budget is separate from the
system-prompt injection budget.

## Size constraints (defaults)

These defaults are chosen to keep prompt cost predictable:

- **Total injected memory budget (system prompt):** ~20,000 chars
- **Long-term injected max (`MEMORY.md`):** ~12,000 chars
- **Recent daily injected max (combined):** ~8,000 chars (per-day max × days)
- **Recent daily per-day injected max:** ~4,000 chars
- **Recent daily window (system prompt):** last **2** days/files
- **Turn-level recall budget:** ~2,000 chars (separate from system prompt)
- **Turn-level recall search window:** last **14** days/files

Enforcement:
- Injection is truncated when limits are exceeded and a visible truncation marker is appended to the injected snapshot.
- Truncation should not silently discard content without a marker (agents must notice and compact).

## Backup compatibility

If envelopes are treated as disposable, a recovery-capable backup only needs:
- `internal_space/MEMORY.md`
- `internal_space/memories/*.md`

Everything else (SQLite queue/audit, vector stores, indexes) is rebuildable runtime state.

## Multi-agent memory (v1.1)

### Background agent memory injection

Background agents (one-shot tasks) now receive relevant memory context from the sender agent.
The system recalls keyword-matched memory fragments (up to 2,000 chars) from the sender's
memory and injects them as context into the background prompt.

Background result envelopes include `sourceType: "background-result"` metadata to help
the sender agent's afterTurn handler identify and process background task results.

### Project-level shared memory

Project memory lives in `<project-root>/.hiboss/memory/` as Markdown files.
A structured write protocol (`project-memory.ts`) provides:
- Conflict-safe atomic writes (temp file + rename)
- Author and timestamp metadata in YAML frontmatter
- File naming convention: `YYYY-MM-DD-<agent>-<title>.md`
