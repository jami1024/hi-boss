/**
 * HTTP API client for Hi-Boss Web UI.
 */

const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly hint?: string;

  constructor(params: { message: string; status: number; errorCode?: string; hint?: string }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.errorCode = params.errorCode;
    this.hint = params.hint;
  }
}

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
    throw new Error("未授权，请重新登录");
  }

  const data = (await res.json().catch(() => ({}))) as unknown;

  if (!res.ok) {
    const payload =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : {};
    throw new ApiError({
      message:
        typeof payload.error === "string" && payload.error.trim().length > 0
          ? payload.error
          : `请求失败：${res.status}`,
      status: res.status,
      errorCode: typeof payload.errorCode === "string" ? payload.errorCode : undefined,
      hint: typeof payload.hint === "string" ? payload.hint : undefined,
    });
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
  currentRun: {
    id: string;
    startedAt: number;
    sessionTarget?: string;
    projectId?: string;
  } | null;
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

export interface RemoteSkillRecord {
  skillName: string;
  sourceUrl: string;
  repositoryUrl: string;
  sourcePath: string;
  sourceRef: string;
  commit: string;
  checksum: string;
  fileCount: number;
  status: "valid" | "error";
  addedAt: string;
  lastUpdated: string;
  targetType: "agent" | "project";
  targetId: string;
}

export interface RemoteSkillRefreshRequest {
  agentName: string;
  scope: "agent" | "project";
  projectId?: string;
}

export interface RemoteSkillRefreshSummary {
  count: number;
  requested: RemoteSkillRefreshRequest[];
}

// ==================== Project Types ====================

export interface ProjectLeaderInfo {
  projectId: string;
  agentName: string;
  capabilities: string[];
  allowDispatchTo?: string[];
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

export interface ProjectChatMessage {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  text: string;
  status: string;
  createdAt: number;
}

export interface ProjectChatContext {
  id: string;
  name: string;
  root: string;
  speakerAgent: string;
  availableLeaders: string[];
}

export type ProjectTaskState =
  | "created"
  | "planning"
  | "dispatched"
  | "executing"
  | "completed"
  | "cancelled";

export type ProjectTaskPriority = "low" | "normal" | "high" | "critical";

export interface ProjectTaskFlowEntry {
  fromState?: ProjectTaskState;
  toState: ProjectTaskState;
  actor?: string;
  reason?: string;
  at: number;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  state: ProjectTaskState;
  priority: ProjectTaskPriority;
  assignee?: string;
  output?: string;
  flowLog: ProjectTaskFlowEntry[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ProjectTaskProgress {
  id: string;
  taskId: string;
  agentName: string;
  content: string;
  todos?: string[];
  createdAt: number;
}

export interface ProjectMemoryEntry {
  name: string;
  size: number;
  updatedAt: number;
  content?: string;
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
    currentRun?: {
      id: string;
      startedAt: number;
      sessionTarget?: string;
      projectId?: string;
    };
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

  refreshAgent: (name: string, opts?: { projectId?: string }) =>
    request<{ success: boolean; agentName: string }>(
      "POST",
      `/agents/${encodeURIComponent(name)}/refresh`,
      opts?.projectId ? { projectId: opts.projectId } : undefined
    ),

  abortAgent: (name: string) =>
    request<{
      success: boolean;
      agentName: string;
      cancelledRun: boolean;
      clearedPendingCount: number;
    }>("POST", `/agents/${encodeURIComponent(name)}/abort`),

  listAgentRemoteSkills: (name: string) =>
    request<{
      targetType: "agent" | "project";
      targetId: string;
      skills: RemoteSkillRecord[];
    }>("GET", `/agents/${encodeURIComponent(name)}/skills/remote`),

  addAgentRemoteSkill: (
    name: string,
    body: { skillName: string; sourceUrl: string; ref?: string }
  ) =>
    request<{
      targetType: "agent" | "project";
      targetId: string;
      skill: RemoteSkillRecord;
      refresh: RemoteSkillRefreshSummary;
    }>("POST", `/agents/${encodeURIComponent(name)}/skills/remote`, body),

  updateAgentRemoteSkill: (
    name: string,
    skillName: string,
    body?: { sourceUrl?: string; ref?: string }
  ) =>
    request<{
      targetType: "agent" | "project";
      targetId: string;
      skill: RemoteSkillRecord;
      refresh: RemoteSkillRefreshSummary;
    }>(
      "POST",
      `/agents/${encodeURIComponent(name)}/skills/remote/${encodeURIComponent(skillName)}/update`,
      body
    ),

  removeAgentRemoteSkill: (name: string, skillName: string) =>
    request<{
      success: boolean;
      targetType: "agent" | "project";
      targetId: string;
      skillName: string;
      refresh: RemoteSkillRefreshSummary;
    }>("DELETE", `/agents/${encodeURIComponent(name)}/skills/remote/${encodeURIComponent(skillName)}`),

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

  createProject: (body: {
    name: string;
    root: string;
    speakerAgent: string;
    mainGroupChannel?: string;
  }) =>
    request<{ project: ProjectSummary }>("POST", "/projects", body),

  updateProjectLeader: (projectId: string, agentName: string, body: {
    capabilities?: string[];
    active?: boolean;
  }) =>
    request<{ leader: ProjectLeaderInfo }>(
      "PUT",
      `/projects/${encodeURIComponent(projectId)}/leaders/${encodeURIComponent(agentName)}`,
      body,
    ),

  sendProjectChatMessage: (projectId: string, text: string) =>
    request<{ id: string; intentHint?: "requirement" | "qa" }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/chat/send`,
      { text }
    ),

  getProjectChatMessages: (projectId: string, opts?: { limit?: number; before?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", String(opts.before));
    const qs = params.toString();
    return request<{
      project: ProjectChatContext;
      messages: ProjectChatMessage[];
    }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/chat/messages${qs ? `?${qs}` : ""}`
    );
  },

  createProjectTask: (
    projectId: string,
    body: {
      title: string;
      text?: string;
      priority?: ProjectTaskPriority;
      autoDispatch?: boolean;
    }
  ) =>
    request<{ task: ProjectTask; envelopeId?: string }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/tasks`,
      body
    ),

  listProjectTasks: (projectId: string, opts?: { limit?: number; state?: ProjectTaskState }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.state) params.set("state", opts.state);
    const qs = params.toString();
    return request<{ tasks: ProjectTask[] }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/tasks${qs ? `?${qs}` : ""}`
    );
  },

  getProjectTask: (projectId: string, taskId: string) =>
    request<{
      task: ProjectTask;
      progress: ProjectTaskProgress[];
      envelopes: Array<{ id: string; from: string; to: string; text: string; status: string; createdAt: number }>;
    }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
    ),

  updateProjectTaskState: (
    projectId: string,
    taskId: string,
    body: {
      state: ProjectTaskState;
      assignee?: string;
      reason?: string;
      output?: string | null;
      dispatchText?: string;
    }
  ) =>
    request<{ task: ProjectTask; envelopeId?: string; completionEnvelopeId?: string }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/state`,
      body
    ),

  cancelProjectTask: (
    projectId: string,
    taskId: string,
    body?: { reason?: string; force?: boolean }
  ) =>
    request<{
      task: ProjectTask;
      cancelledRun: boolean;
      clearedPendingCount: number;
    }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
      body
    ),

  appendProjectTaskProgress: (
    projectId: string,
    taskId: string,
    body: { agentName: string; content: string; todos?: string[] }
  ) =>
    request<{ progress: ProjectTaskProgress }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/progress`,
      body
    ),

  listProjectRemoteSkills: (projectId: string) =>
    request<{
      targetType: "agent" | "project";
      targetId: string;
      skills: RemoteSkillRecord[];
    }>("GET", `/projects/${encodeURIComponent(projectId)}/skills/remote`),

  addProjectRemoteSkill: (
    projectId: string,
    body: { skillName: string; sourceUrl: string; ref?: string }
  ) =>
    request<{
      targetType: "agent" | "project";
      targetId: string;
      skill: RemoteSkillRecord;
      refresh: RemoteSkillRefreshSummary;
    }>("POST", `/projects/${encodeURIComponent(projectId)}/skills/remote`, body),

  updateProjectRemoteSkill: (
    projectId: string,
    skillName: string,
    body?: { sourceUrl?: string; ref?: string }
  ) =>
    request<{
      targetType: "agent" | "project";
      targetId: string;
      skill: RemoteSkillRecord;
      refresh: RemoteSkillRefreshSummary;
    }>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/skills/remote/${encodeURIComponent(skillName)}/update`,
      body
    ),

  removeProjectRemoteSkill: (projectId: string, skillName: string) =>
    request<{
      success: boolean;
      targetType: "agent" | "project";
      targetId: string;
      skillName: string;
      refresh: RemoteSkillRefreshSummary;
    }>("DELETE", `/projects/${encodeURIComponent(projectId)}/skills/remote/${encodeURIComponent(skillName)}`),

  listProjectMemoryEntries: (projectId: string) =>
    request<{ entries: ProjectMemoryEntry[] }>("GET", `/projects/${encodeURIComponent(projectId)}/memory`),

  getProjectMemoryEntry: (projectId: string, entryName: string) =>
    request<{ entry: ProjectMemoryEntry }>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(entryName)}`
    ),

  upsertProjectMemoryEntry: (projectId: string, entryName: string, content: string) =>
    request<{ entry: ProjectMemoryEntry; refresh: RemoteSkillRefreshSummary }>(
      "PUT",
      `/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(entryName)}`,
      { content }
    ),

  deleteProjectMemoryEntry: (projectId: string, entryName: string) =>
    request<{
      success: boolean;
      entryName: string;
      refresh: RemoteSkillRefreshSummary;
    }>("DELETE", `/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(entryName)}`),

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
