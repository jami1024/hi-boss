export interface ProjectAgentRuntimeSnapshot {
  state: "running" | "idle";
  health: "ok" | "error" | "unknown";
  pendingCount: number;
  projectId?: string;
  sessionTarget?: string;
}

export type ProjectAgentTimelineEventKind =
  | "observed"
  | "state"
  | "health"
  | "pending"
  | "session";

export interface ProjectAgentTimelineEvent {
  id: string;
  agentName: string;
  kind: ProjectAgentTimelineEventKind;
  before?: string;
  after: string;
  at: number;
}
