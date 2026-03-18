import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Inbox, Play, Zap } from "lucide-react";
import { api, type AgentSummary, type EnvelopeSummary, type ProjectSummary } from "@/api/client";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { type AgentCardStatus } from "@/components/agents/AgentCatalogCard";
import { PixelOfficeScene } from "@/components/agents/PixelOfficeScene";
import { Badge } from "@/components/ui/8bit/badge";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";

import "@/components/ui/8bit/styles/retro.css";

function formatUptime(ms: number | null): string {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds % 60}s`;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsError, setAgentsError] = useState("");
  const [recentEnvelopes, setRecentEnvelopes] = useState<EnvelopeSummary[]>([]);
  const [recentProjects, setRecentProjects] = useState<ProjectSummary[]>([]);
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

  // Fetch recent envelopes
  useEffect(() => {
    const loadEnvelopes = async () => {
      try {
        const { envelopes } = await api.listEnvelopes({ limit: 10 });
        setRecentEnvelopes(envelopes);
      } catch {
        // silently ignore
      }
    };
    loadEnvelopes();
    const interval = setInterval(loadEnvelopes, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch recent projects
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const { projects } = await api.listProjects({ limit: 3 });
        setRecentProjects(projects);
      } catch {
        // silently ignore
      }
    };
    loadProjects();
    const interval = setInterval(loadProjects, 30000);
    return () => clearInterval(interval);
  }, []);

  const pixelAgents = useMemo(
    () => agents.map((agent) => ({ agent, status: statuses[agent.name] })),
    [agents, statuses],
  );

  const runningCount = Object.values(statuses).filter((s) => s.state === "running").length;
  const totalPending = Object.values(statuses).reduce((sum, s) => sum + (s.pending ?? 0), 0);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e]">
      {/* Header: system status + agent stats */}
      <div className="flex items-center justify-between px-6 py-3 md:px-8">
        {/* Left: system status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-amber-400" />
            <h1 className="retro text-sm tracking-wider text-amber-200">
              Agent Office
            </h1>
          </div>
          {daemonStatus && (
            <div className="hidden items-center gap-2 rounded bg-[#2a2a3d]/80 px-2.5 py-1 sm:flex">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
              </span>
              <span className="retro text-[7px] text-emerald-300/80">
                {daemonStatus.running ? "ONLINE" : "OFFLINE"}
              </span>
              {daemonStatus.bossName && (
                <>
                  <span className="text-amber-200/20">|</span>
                  <span className="retro text-[7px] text-amber-200/60">
                    {daemonStatus.bossName}
                  </span>
                </>
              )}
              <span className="text-amber-200/20">|</span>
              <span className="retro text-[7px] text-amber-200/40">
                UP {formatUptime(daemonStatus.uptime)}
              </span>
            </div>
          )}
        </div>

        {/* Right: quick stats + connection */}
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <Badge variant="outline" className="border-amber-200/30 bg-transparent text-amber-200/70 text-[9px] gap-1">
              <Bot className="size-2.5" />
              {agents.length}
            </Badge>
            {runningCount > 0 && (
              <Badge variant="default" className="bg-emerald-600/80 text-white text-[9px] gap-1">
                <Play className="size-2.5" />
                {runningCount}
              </Badge>
            )}
            {totalPending > 0 && (
              <Badge variant="default" className="bg-amber-600/80 text-white text-[9px] gap-1">
                <Inbox className="size-2.5" />
                {totalPending}
              </Badge>
            )}
          </div>
          <ConnectionStatus connected={connected} authenticated={authenticated} size="compact" />
        </div>
      </div>

      {/* Pixel Office Scene */}
      <div className="px-4 pb-4 md:px-8">
        <PixelOfficeScene
          agents={pixelAgents}
          recentMessages={recentEnvelopes}
          recentProjects={recentProjects}
          onAgentClick={(name) => navigate(`/agents/${encodeURIComponent(name)}`)}
          onViewAllMessages={() => navigate("/envelopes")}
          onProjectClick={(id) => navigate(`/projects/${encodeURIComponent(id)}`)}
          onViewAllProjects={() => navigate("/projects")}
        />
      </div>

      {/* Empty state */}
      {agents.length === 0 && !error && (
        <div className="mt-8 text-center">
          <Bot className="mx-auto mb-3 size-10 text-amber-200/20" />
          <p className="retro text-[8px] text-amber-200/50">
            Office is empty. Use{" "}
            <code className="rounded bg-[#2a2a3d] px-1.5 py-0.5 text-amber-200">
              hiboss agent register
            </code>{" "}
            to add agents.
          </p>
        </div>
      )}
    </div>
  );
}
