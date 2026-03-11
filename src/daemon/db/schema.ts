/**
 * SQLite schema definitions for Hi-Boss.
 */

import {
  DEFAULT_AGENT_PERMISSION_LEVEL,
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_AGENT_RUN_STATUS,
  DEFAULT_ENVELOPE_STATUS,
} from "../../shared/defaults.js";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

	CREATE TABLE IF NOT EXISTS agents (
	  name TEXT PRIMARY KEY,       -- unique identifier (alphanumeric, hyphens)
	  token TEXT UNIQUE NOT NULL,  -- agent token (short identifier; stored as plaintext)
	  description TEXT,
	  workspace TEXT,
  provider TEXT DEFAULT '${DEFAULT_AGENT_PROVIDER}',
  model TEXT,
  reasoning_effort TEXT,
  permission_level TEXT DEFAULT '${DEFAULT_AGENT_PERMISSION_LEVEL}',
  session_policy TEXT,           -- JSON blob for SessionPolicyConfig
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  last_seen_at INTEGER,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS envelopes (
  id TEXT PRIMARY KEY,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  from_boss INTEGER DEFAULT 0,
  content_text TEXT,
  content_attachments TEXT,
  deliver_at INTEGER,         -- unix epoch ms (UTC) (not-before delivery)
  status TEXT DEFAULT '${DEFAULT_ENVELOPE_STATUS}',
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS cron_schedules (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,   -- owner agent (sender)
  cron TEXT NOT NULL,         -- cron expression
  timezone TEXT,              -- IANA timezone (null means inherit boss timezone)
  enabled INTEGER DEFAULT 1,
  to_address TEXT NOT NULL,
  content_text TEXT,
  content_attachments TEXT,
  metadata TEXT,              -- JSON blob for envelope template metadata
  pending_envelope_id TEXT,   -- envelope id for the next scheduled occurrence (nullable)
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER,
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_bindings (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,    -- references agents(name)
  adapter_type TEXT NOT NULL,
  adapter_token TEXT NOT NULL,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  UNIQUE(adapter_type, adapter_token),
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE
);

-- Each agent can have at most one binding per adapter type.
-- Older versions relied on application-level enforcement; dedupe before enforcing.
DELETE FROM agent_bindings
WHERE rowid NOT IN (
  SELECT MAX(rowid)
  FROM agent_bindings
  GROUP BY agent_name, adapter_type
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  envelope_ids TEXT,           -- JSON array of processed envelope IDs
  final_response TEXT,         -- stored for auditing
  context_length INTEGER,      -- context length (tokens) when available
  status TEXT DEFAULT '${DEFAULT_AGENT_RUN_STATUS}', -- running, completed, failed, cancelled
  error TEXT
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  title TEXT,
  project_id TEXT,
  project_root TEXT,
  orchestrator_agent TEXT,
  main_group_channel TEXT,
  requirement_group_channel TEXT,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS work_item_channel_allowlist (
  work_item_id TEXT NOT NULL,
  channel_address TEXT NOT NULL,
  created_by_agent TEXT,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  PRIMARY KEY (work_item_id, channel_address),
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_item_channel_policies (
  work_item_id TEXT PRIMARY KEY,
  strict_allowlist INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_item_specialists (
  work_item_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  capability TEXT,
  assigned_by TEXT,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (work_item_id, agent_name),
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_item_transitions (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL,
  speaker_agent TEXT NOT NULL,
  main_group_channel TEXT,
  created_at INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
  updated_at INTEGER,
  UNIQUE(root)
);

CREATE TABLE IF NOT EXISTS project_leaders (
  project_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  capabilities_json TEXT,
  allow_dispatch_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, agent_name),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'created',
  priority TEXT NOT NULL DEFAULT 'normal',
  assignee TEXT,
  output TEXT,
  flow_log TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_progress (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  content TEXT NOT NULL,
  todos TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  project_id TEXT,
  title TEXT,
  provider TEXT,
  session_id TEXT,
  session_metadata TEXT,
  permission_override TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_name) REFERENCES agents(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_envelopes_to ON envelopes("to", status);
CREATE INDEX IF NOT EXISTS idx_envelopes_from ON envelopes("from", created_at);
CREATE INDEX IF NOT EXISTS idx_envelopes_status_deliver_at ON envelopes(status, deliver_at);
CREATE INDEX IF NOT EXISTS idx_envelopes_project_id ON envelopes(json_extract(metadata, '$.projectId'), created_at);
CREATE INDEX IF NOT EXISTS idx_cron_schedules_agent ON cron_schedules(agent_name, enabled);
CREATE INDEX IF NOT EXISTS idx_cron_schedules_pending_envelope ON cron_schedules(pending_envelope_id);
CREATE INDEX IF NOT EXISTS idx_agents_token ON agents(token);
CREATE INDEX IF NOT EXISTS idx_agent_bindings_agent ON agent_bindings(agent_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_bindings_agent_adapter_unique ON agent_bindings(agent_name, adapter_type);
CREATE INDEX IF NOT EXISTS idx_agent_bindings_adapter ON agent_bindings(adapter_type, adapter_token);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_name, started_at);
CREATE INDEX IF NOT EXISTS idx_work_items_state_updated_at ON work_items(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_items_project_id ON work_items(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_item_channel_allowlist_item ON work_item_channel_allowlist(work_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_work_item_channel_policies_strict ON work_item_channel_policies(strict_allowlist, updated_at);
CREATE INDEX IF NOT EXISTS idx_work_item_specialists_item_agent ON work_item_specialists(work_item_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_work_item_specialists_agent ON work_item_specialists(agent_name, assigned_at);
CREATE INDEX IF NOT EXISTS idx_work_item_transitions_item_created ON work_item_transitions(work_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_projects_root ON projects(root);
CREATE INDEX IF NOT EXISTS idx_projects_speaker ON projects(speaker_agent, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_leaders_project_active ON project_leaders(project_id, active, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_leaders_agent ON project_leaders(agent_name, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project_updated ON project_tasks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_tasks_state_updated ON project_tasks(state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_progress_task_created ON task_progress(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_updated ON conversations(agent_name, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_project_updated ON conversations(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_envelopes_conversation_id ON envelopes(json_extract(metadata, '$.conversationId'), created_at);
`;
