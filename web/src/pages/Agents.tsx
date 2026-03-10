import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AgentSummary } from "@/api/client";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import {
  AgentCatalogCard,
  type AgentActivitySnapshot,
  type AgentAnomalySnapshot,
  type AgentCardStatus,
} from "@/components/agents/AgentCatalogCard";
import type { ProjectAgentRuntimeSnapshot } from "@/components/project/project-agent-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";
import { useProjectAgentTimeline } from "@/hooks/useProjectAgentTimeline";

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsError, setAgentsError] = useState("");
  const [boundSpeakerNames, setBoundSpeakerNames] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<"activity" | "anomaly" | "name">("activity");
  const navigate = useNavigate();

  const boundSpeakerNameSet = useMemo(() => new Set(boundSpeakerNames), [boundSpeakerNames]);

  const subscribedAgentNames = useMemo(
    () => agents.map((agent) => agent.name),
    [agents]
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

  const timelineStatusByName = useMemo<Record<string, ProjectAgentRuntimeSnapshot | undefined>>(() => {
    const map: Record<string, ProjectAgentRuntimeSnapshot | undefined> = {};
    for (const agentName of subscribedAgentNames) {
      const status = statuses[agentName];
      map[agentName] = status
        ? {
            state: status.state,
            health: status.health,
            pendingCount: status.pending,
            projectId: status.projectId,
            sessionTarget: status.sessionTarget,
          }
        : undefined;
    }
    return map;
  }, [statuses, subscribedAgentNames]);

  const timelineEvents = useProjectAgentTimeline(subscribedAgentNames, timelineStatusByName, 200);

  const activityByAgent = useMemo<Record<string, AgentActivitySnapshot>>(() => {
    const now = Date.now();
    const recentWindowMs = 5 * 60 * 1000;
    const previousWindowMs = recentWindowMs * 2;
    const map: Record<string, AgentActivitySnapshot> = {};
    for (const agentName of subscribedAgentNames) {
      map[agentName] = { current: 0, previous: 0, delta: 0, trend: "flat" };
    }
    for (const event of timelineEvents) {
      const elapsed = now - event.at;
      if (elapsed <= recentWindowMs) {
        map[event.agentName] = {
          ...(map[event.agentName] ?? { current: 0, previous: 0, delta: 0, trend: "flat" }),
          current: (map[event.agentName]?.current ?? 0) + 1,
        };
        continue;
      }
      if (elapsed > recentWindowMs && elapsed <= previousWindowMs) {
        map[event.agentName] = {
          ...(map[event.agentName] ?? { current: 0, previous: 0, delta: 0, trend: "flat" }),
          previous: (map[event.agentName]?.previous ?? 0) + 1,
        };
      }
    }

    for (const agentName of Object.keys(map)) {
      const current = map[agentName]?.current ?? 0;
      const previous = map[agentName]?.previous ?? 0;
      const delta = current - previous;
      map[agentName] = {
        current,
        previous,
        delta,
        trend: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      };
    }
    return map;
  }, [subscribedAgentNames, timelineEvents]);

  const anomalyByAgent = useMemo<Record<string, AgentAnomalySnapshot>>(() => {
    const now = Date.now();
    const recentWindowMs = 5 * 60 * 1000;
    const map: Record<string, AgentAnomalySnapshot> = {};
    for (const agentName of subscribedAgentNames) {
      map[agentName] = {
        recent: 0,
        currentHealthError: false,
        currentPending: false,
        recentSpike: false,
        score: 0,
      };
    }

    for (const event of timelineEvents) {
      const elapsed = now - event.at;
      if (elapsed > recentWindowMs) continue;
      const previous = map[event.agentName] ?? {
        recent: 0,
        currentHealthError: false,
        currentPending: false,
        recentSpike: false,
        score: 0,
      };
      const recentInc =
        (event.kind === "health" && event.after === "error") ||
        (event.kind === "pending" && Number(event.after) > 0) ||
        (event.kind === "observed" && event.after.includes("error"))
          ? 1
          : 0;
      map[event.agentName] = {
        ...previous,
        recent: previous.recent + recentInc,
      };
    }

    for (const agentName of Object.keys(map)) {
      const status = statuses[agentName];
      const currentHealthError = status?.health === "error";
      const currentPending = (status?.pending ?? 0) > 0;
      const recent = map[agentName]?.recent ?? 0;
      const recentSpike = recent >= 2;
      map[agentName] = {
        recent,
        currentHealthError,
        currentPending,
        recentSpike,
        score: recent + (currentHealthError ? 3 : 0) + (currentPending ? 1 : 0),
      };
    }
    return map;
  }, [statuses, subscribedAgentNames, timelineEvents]);

  useEffect(() => {
    const load = async () => {
      try {
        const [{ agents: list }, { projects }] = await Promise.all([
          api.listAgents(),
          api.listProjects({ limit: 500 }),
        ]);
        setAgents(list);
        setBoundSpeakerNames(projects.map((project) => project.speakerAgent));
        setAgentsError("");
      } catch (err) {
        setAgentsError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const canAgentDirectChat = useCallback(
    (agent: AgentSummary): boolean => agent.role === "speaker" && !boundSpeakerNameSet.has(agent.name),
    [boundSpeakerNameSet]
  );

  const displayedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const byName = a.name.localeCompare(b.name);
      if (sortMode === "name") return byName;

      const aActivity = activityByAgent[a.name] ?? { current: 0, previous: 0, delta: 0, trend: "flat" as const };
      const bActivity = activityByAgent[b.name] ?? { current: 0, previous: 0, delta: 0, trend: "flat" as const };
      const aAnomaly = anomalyByAgent[a.name]?.score ?? 0;
      const bAnomaly = anomalyByAgent[b.name]?.score ?? 0;

      if (sortMode === "activity") {
        if (bActivity.current !== aActivity.current) return bActivity.current - aActivity.current;
        if (bActivity.delta !== aActivity.delta) return bActivity.delta - aActivity.delta;
        if (bAnomaly !== aAnomaly) return bAnomaly - aAnomaly;
        return byName;
      }

      const aHealthError = statuses[a.name]?.health === "error" ? 1 : 0;
      const bHealthError = statuses[b.name]?.health === "error" ? 1 : 0;
      const aPending = statuses[a.name]?.pending ?? 0;
      const bPending = statuses[b.name]?.pending ?? 0;

      if (bAnomaly !== aAnomaly) return bAnomaly - aAnomaly;
      if (bHealthError !== aHealthError) return bHealthError - aHealthError;
      if (bPending !== aPending) return bPending - aPending;
      if (bActivity.current !== aActivity.current) return bActivity.current - aActivity.current;
      return byName;
    });
  }, [activityByAgent, agents, anomalyByAgent, sortMode, statuses]);

  const hasCustomView = sortMode !== "activity";

  const resetView = () => {
    setSortMode("activity");
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">智能体目录</h1>
          <p className="mt-1 text-sm text-foreground/72">在一个控制台中统一监控发言者与领队的运行状态。</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">共 {agents.length} 个</Badge>
          <ConnectionStatus connected={connected} authenticated={authenticated} size="compact" />
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-foreground/70">排序</span>
            <Button variant={sortMode === "activity" ? "default" : "outline"} size="sm" onClick={() => setSortMode("activity")}>活跃优先</Button>
            <Button variant={sortMode === "anomaly" ? "destructive" : "outline"} size="sm" onClick={() => setSortMode("anomaly")}>异常优先</Button>
            <Button variant={sortMode === "name" ? "default" : "outline"} size="sm" onClick={() => setSortMode("name")}>名称排序</Button>
            <Button variant="ghost" size="sm" onClick={resetView} disabled={!hasCustomView}>恢复默认</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {displayedAgents.map((agent, i) => {
          const status = statuses[agent.name];
          const activity = activityByAgent[agent.name] ?? { current: 0, previous: 0, delta: 0, trend: "flat" as const };
          const anomaly = anomalyByAgent[agent.name] ?? { recent: 0, currentHealthError: false, currentPending: false, recentSpike: false, score: 0 };
          return (
            <AgentCatalogCard
              key={agent.name}
              agent={agent}
              index={i}
              status={status}
              activity={activity}
              anomaly={anomaly}
              canDirectChat={canAgentDirectChat(agent)}
              highlightAnomaly={anomaly.score > 0}
              onOpen={() => navigate(`/agents/${encodeURIComponent(agent.name)}`)}
              onChat={() => navigate(`/agents/${encodeURIComponent(agent.name)}/chat`)}
            />
          );
        })}
      </div>

      {agents.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-foreground/72">当前还没有注册任何智能体。</p>
          <p className="mt-1 text-sm text-foreground/68">
            使用 <code className="bg-muted px-1 rounded">hiboss agent register</code> 添加智能体。
          </p>
        </div>
      )}
    </div>
  );
}
