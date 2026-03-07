/**
 * HTTP API client for Hi-Boss Web UI.
 */

const API_BASE = "/api/v1";

function getToken(): string {
  return localStorage.getItem("hiboss_token") ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem("hiboss_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("hiboss_token");
}

export function hasToken(): boolean {
  return Boolean(localStorage.getItem("hiboss_token"));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
  };

  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("Unauthorized");
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? `Request failed: ${res.status}`);
  }

  return data as T;
}

// ==================== Types ====================

export interface AgentSummary {
  name: string;
  role: "speaker" | "leader" | null;
  description: string | null;
  workspace: string | null;
  provider: "claude" | "codex" | null;
  model: string | null;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | null;
  permissionLevel: "restricted" | "standard" | "privileged" | "boss" | null;
  sessionPolicy: SessionPolicy | null;
  createdAt: number;
  lastSeenAt: number | null;
  bindings: string[];
}

export interface SessionPolicy {
  dailyResetAt?: string;
  idleTimeout?: string;
  maxContextLength?: number;
}

export interface AgentStatus {
  agentState: "running" | "idle";
  agentHealth: "ok" | "error" | "unknown";
  pendingCount: number;
  currentRun: { id: string; startedAt: number } | null;
  lastRun: {
    id: string;
    startedAt: number;
    completedAt: number | null;
    status: "completed" | "failed" | "cancelled";
    error: string | null;
    contextLength: number | null;
  } | null;
}

export interface AgentDetailResponse {
  agent: AgentSummary;
  bindings: string[];
  status: AgentStatus;
}

export interface AgentUpdateParams {
  role?: "speaker" | "leader";
  description?: string | null;
  workspace?: string | null;
  provider?: "claude" | "codex" | null;
  model?: string | null;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" | null;
  permissionLevel?: "restricted" | "standard" | "privileged" | "boss";
  sessionPolicy?: SessionPolicy | null;
}

export interface AgentSetResult {
  success: boolean;
  agent: {
    name: string;
    role?: "speaker" | "leader";
    description?: string;
    workspace?: string;
    provider: "claude" | "codex";
    model?: string;
    reasoningEffort?: string;
    permissionLevel: string;
    sessionPolicy?: SessionPolicy;
  };
  bindings: string[];
}

// ==================== Project Types ====================

export interface ProjectLeaderInfo {
  projectId: string;
  agentName: string;
  capabilities: string[];
  active: boolean;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  root: string;
  speakerAgent: string;
  mainGroupChannel?: string;
  createdAt: number;
  updatedAt?: number;
  leaders?: ProjectLeaderInfo[];
}

export interface ProjectUpdateParams {
  name?: string;
  root?: string;
  speakerAgent?: string;
  mainGroupChannel?: string | null;
}

// ==================== Prompt Types ====================

export interface PromptFileEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: PromptFileEntry[];
}

// ==================== Config Types ====================

export interface DaemonConfig {
  setupCompleted: boolean;
  dataDir: string;
  bossName: string;
  bossTimezone: string;
  daemonTimezone: string;
  agentCount: number;
  bindingCount: number;
  adapters: Array<{
    type: string;
    bossId: string | null;
    bindings: string[];
  }>;
  agents: Array<{
    name: string;
    role: string;
    provider: string;
    workspace: string;
  }>;
}

// ==================== Envelope Types ====================

export interface EnvelopeSummary {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  status: string;
  createdAt: number;
  deliverAt: number | null;
  text: string;
  hasAttachments: boolean;
  metadata?: Record<string, unknown>;
}

export interface EnvelopeDetail {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  content: {
    text?: string;
    attachments?: Array<{
      source: string;
      filename?: string;
    }>;
  };
  deliverAt?: number;
  status: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface DaemonStatus {
  running: boolean;
  startTimeMs: number | null;
  uptime: number | null;
  bossName: string | null;
  bossTimezone: string;
  agentCount: number;
  bindingCount: number;
  agents: Array<{
    name: string;
    role: string | null;
    provider: string | null;
    state: "running" | "idle";
    health: "ok" | "error" | "unknown";
    pendingCount: number;
  }>;
}

// ==================== API ====================

export const api = {
  ping: () => request<{ ok: boolean }>("GET", "/ping"),

  getStatus: () => request<DaemonStatus>("GET", "/status"),

  getTime: () =>
    request<{
      bossTimezone: string;
      daemonTimezone: string;
    }>("GET", "/time"),

  listAgents: () =>
    request<{ agents: AgentSummary[] }>("GET", "/agents"),

  getAgentStatus: (name: string) =>
    request<AgentDetailResponse>("GET", `/agents/${encodeURIComponent(name)}/status`),

  updateAgent: (name: string, params: AgentUpdateParams) =>
    request<AgentSetResult>("PUT", `/agents/${encodeURIComponent(name)}`, params),

  deleteAgent: (name: string) =>
    request<{ success: boolean; agentName: string }>("DELETE", `/agents/${encodeURIComponent(name)}`),

  refreshAgent: (name: string) =>
    request<{ success: boolean; agentName: string }>("POST", `/agents/${encodeURIComponent(name)}/refresh`),

  abortAgent: (name: string) =>
    request<{
      success: boolean;
      agentName: string;
      cancelledRun: boolean;
      clearedPendingCount: number;
    }>("POST", `/agents/${encodeURIComponent(name)}/abort`),

  // Chat
  sendChatMessage: (agentName: string, text: string) =>
    request<{ id: string }>("POST", `/chat/${encodeURIComponent(agentName)}/send`, { text }),

  getChatMessages: (agentName: string, opts?: { limit?: number; before?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", String(opts.before));
    const qs = params.toString();
    return request<{
      messages: Array<{
        id: string;
        from: string;
        to: string;
        fromBoss: boolean;
        text: string;
        status: string;
        createdAt: number;
      }>;
    }>("GET", `/chat/${encodeURIComponent(agentName)}/messages${qs ? `?${qs}` : ""}`);
  },

  // Projects
  listProjects: (opts?: { limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<{ projects: ProjectSummary[] }>("GET", `/projects${qs ? `?${qs}` : ""}`);
  },

  getProject: (id: string) =>
    request<{ project: ProjectSummary }>("GET", `/projects/${encodeURIComponent(id)}`),

  updateProject: (id: string, params: ProjectUpdateParams) =>
    request<{ project: ProjectSummary }>("PUT", `/projects/${encodeURIComponent(id)}`, params),

  upsertProjectLeader: (projectId: string, body: {
    agentName: string;
    capabilities?: string[];
    active?: boolean;
  }) =>
    request<{ leader: ProjectLeaderInfo }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/leaders`,
      body,
    ),

  updateProjectLeader: (projectId: string, agentName: string, body: {
    capabilities?: string[];
    active?: boolean;
  }) =>
    request<{ leader: ProjectLeaderInfo }>(
      "PUT",
      `/projects/${encodeURIComponent(projectId)}/leaders/${encodeURIComponent(agentName)}`,
      body,
    ),

  // Prompts
  listPrompts: () =>
    request<{ promptsDir: string; tree: PromptFileEntry[] }>("GET", "/prompts"),

  getPrompt: (path: string) =>
    request<{ path: string; content: string }>(
      "GET",
      `/prompts/file?path=${encodeURIComponent(path)}`,
    ),

  updatePrompt: (path: string, content: string) =>
    request<{ path: string; content: string }>("PUT", "/prompts/file", { path, content }),

  // Config
  getConfig: () => request<DaemonConfig>("GET", "/config"),

  updateConfig: (params: { bossName?: string; bossTimezone?: string }) =>
    request<{ bossName: string; bossTimezone: string }>("PUT", "/config", params),

  // Envelopes
  listEnvelopes: (opts?: { status?: string; agent?: string; limit?: number; before?: number }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.agent) params.set("agent", opts.agent);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", String(opts.before));
    const qs = params.toString();
    return request<{ envelopes: EnvelopeSummary[]; total: number }>(
      "GET",
      `/envelopes${qs ? `?${qs}` : ""}`,
    );
  },

  getEnvelope: (id: string) =>
    request<{ envelope: EnvelopeDetail }>("GET", `/envelopes/${encodeURIComponent(id)}`),
};
