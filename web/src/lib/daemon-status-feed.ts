import type { DaemonStatus } from "../api/client.js";

export interface AgentStatusUpdate {
  agentState: "running" | "idle";
  agentHealth: "ok" | "degraded" | "error" | "unknown";
  pendingCount: number;
  currentRun?: {
    id: string;
    startedAt: number;
    sessionTarget?: string;
    projectId?: string;
  };
}

export function mergeAgentWsStatusIntoDaemonStatus(
  prev: DaemonStatus | null,
  agentName: string,
  agentStatus: AgentStatusUpdate
): DaemonStatus | null {
  if (!prev) return prev;

  let found = false;
  const nextAgents = prev.agents.map((agent: DaemonStatus["agents"][number]) => {
    if (agent.name !== agentName) return agent;
    found = true;

    const currentRun = agentStatus.currentRun?.id
      ? {
        id: agentStatus.currentRun.id,
        startedAt: agentStatus.currentRun.startedAt,
        ...(agentStatus.currentRun.sessionTarget
          ? { sessionTarget: agentStatus.currentRun.sessionTarget }
          : {}),
        ...(agentStatus.currentRun.projectId
          ? { projectId: agentStatus.currentRun.projectId }
          : {}),
      }
      : undefined;

    return {
      ...agent,
      state: agentStatus.agentState,
      health: agentStatus.agentHealth,
      pendingCount: agentStatus.pendingCount,
      ...(currentRun ? { currentRun } : { currentRun: undefined }),
    };
  });

  if (!found) return prev;
  return {
    ...prev,
    agents: nextAgents,
  };
}
