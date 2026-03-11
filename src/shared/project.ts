export interface ProjectLeader {
  projectId: string;
  agentName: string;
  capabilities: string[];
  allowDispatchTo?: string[];
  active: boolean;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  root: string;
  speakerAgent: string;
  mainGroupChannel?: string;
  createdAt: number;
  updatedAt?: number;
  leaders?: ProjectLeader[];
}

export interface ProjectLeaderCandidate {
  agentName: string;
  capabilities: string[];
  active: boolean;
  busy: boolean;
  agentHealth: "ok" | "degraded" | "error" | "unknown";
}
