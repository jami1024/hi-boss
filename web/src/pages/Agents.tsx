import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AgentSummary } from "@/api/client";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { type AgentCardStatus } from "@/components/agents/AgentCatalogCard";
import { PixelOfficeScene } from "@/components/agents/PixelOfficeScene";
import { Badge } from "@/components/ui/badge";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsError, setAgentsError] = useState("");
  const navigate = useNavigate();

  const subscribedAgentNames = useMemo(
    () => agents.map((agent) => agent.name),
    [agents],
  );

  const { status: daemonStatus, error: statusError, connected, authenticated } = useDaemonStatusFeed({
    pollMs: 10000,
    agentNamesOverride: subscribedAgentNames,
  });

  const statuses = useMemo<Record<string, AgentCardStatus>>(() => {
    const statusMap: Record<string, AgentCardStatus> = {};
    for (const entry of daemonStatus?.agents ?? []) {
      statusMap[entry.name] = {
        state: entry.state,
        health: entry.health,
        pending: entry.pendingCount,
        ...(entry.currentRun?.id ? { currentRunId: entry.currentRun.id } : {}),
        ...(entry.currentRun?.sessionTarget
          ? { sessionTarget: entry.currentRun.sessionTarget }
          : {}),
        ...(entry.currentRun?.projectId ? { projectId: entry.currentRun.projectId } : {}),
      };
    }
    return statusMap;
  }, [daemonStatus]);

  const error = agentsError || statusError;

  useEffect(() => {
    const load = async () => {
      try {
        const { agents: list } = await api.listAgents();
        setAgents(list);
        setAgentsError("");
      } catch (err) {
        setAgentsError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const pixelAgents = useMemo(
    () => agents.map((agent) => ({ agent, status: statuses[agent.name] })),
    [agents, statuses],
  );

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 md:px-8">
        <div>
          <h1
            className="text-xl font-bold tracking-wider text-amber-200"
            style={{ fontFamily: "monospace" }}
          >
            智能体办公室
          </h1>
          <p className="mt-0.5 text-xs text-amber-200/50" style={{ fontFamily: "monospace" }}>
            实时监控所有智能体的工作状态
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg bg-[#2a2a3d] px-3 py-1.5 text-xs sm:flex" style={{ fontFamily: "monospace" }}>
            <span className="text-amber-200/60">共 <strong className="text-amber-200">{agents.length}</strong> 个</span>
          </div>
          <Badge variant="outline" className="border-amber-200/30 text-amber-200/80 sm:hidden">
            {agents.length} 个
          </Badge>
          <ConnectionStatus connected={connected} authenticated={authenticated} size="compact" />
        </div>
      </div>

      {/* Pixel Office Scene */}
      <div className="px-4 md:px-8">
        <PixelOfficeScene
          agents={pixelAgents}
          onAgentClick={(name) => navigate(`/agents/${encodeURIComponent(name)}`)}
        />
      </div>

      {/* Empty state */}
      {agents.length === 0 && !error && (
        <div className="mt-8 text-center">
          <p className="text-sm text-amber-200/50" style={{ fontFamily: "monospace" }}>
            办公室还空着，使用{" "}
            <code className="rounded bg-[#2a2a3d] px-1.5 py-0.5 text-amber-200">
              hiboss agent register
            </code>{" "}
            添加智能体
          </p>
        </div>
      )}
    </div>
  );
}
