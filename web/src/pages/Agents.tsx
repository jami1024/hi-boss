import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Inbox, Zap, Heart, Monitor, MessageSquare, ArrowRight } from "lucide-react";
import { api, type AgentSummary, type EnvelopeSummary } from "@/api/client";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { type AgentCardStatus } from "@/components/agents/AgentCatalogCard";
import { PixelOfficeScene } from "@/components/agents/PixelOfficeScene";
import { Badge } from "@/components/ui/8bit/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/8bit/card";
import { Button } from "@/components/ui/8bit/button";
import HealthBar from "@/components/ui/8bit/health-bar";
import { Progress } from "@/components/ui/8bit/progress";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";
import { cn } from "@/lib/utils";

import "@/components/ui/8bit/styles/retro.css";

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsError, setAgentsError] = useState("");
  const [recentEnvelopes, setRecentEnvelopes] = useState<EnvelopeSummary[]>([]);
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

  const pixelAgents = useMemo(
    () => agents.map((agent) => ({ agent, status: statuses[agent.name] })),
    [agents, statuses],
  );

  const runningCount = Object.values(statuses).filter((s) => s.state === "running").length;

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e]">
      {/* 8-bit Header */}
      <div className="flex items-center justify-between px-6 py-3 md:px-8">
        <div>
          <h1 className="retro text-lg tracking-wider text-amber-200">
            Agent Office
          </h1>
          <p className="retro mt-1 text-[8px] text-amber-200/50">
            Real-time agent monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 rounded bg-[#2a2a3d] px-3 py-1.5 sm:flex">
            <Badge variant="outline" className="border-amber-200/40 bg-transparent text-amber-200/80 text-[10px]">
              {agents.length} Agents
            </Badge>
            {runningCount > 0 && (
              <Badge variant="default" className="bg-emerald-600 text-white text-[10px]">
                <span className="relative mr-1 inline-flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-300" />
                </span>
                {runningCount} Running
              </Badge>
            )}
          </div>
          <ConnectionStatus connected={connected} authenticated={authenticated} size="compact" />
        </div>
      </div>

      {/* Main content: Office scene + Recent messages side by side on large screens */}
      <div className="flex flex-col gap-4 px-4 md:px-8 lg:flex-row">
        {/* Left: Pixel Office Scene */}
        <div className="min-w-0 flex-1">
          <PixelOfficeScene
            agents={pixelAgents}
            onAgentClick={(name) => navigate(`/agents/${encodeURIComponent(name)}`)}
          />
        </div>

        {/* Right: Recent Messages Panel */}
        <div className="w-full shrink-0 lg:w-80 xl:w-96">
          <div className="flex items-center justify-between mb-2">
            <h2 className="retro text-[10px] text-amber-200/70 tracking-wider flex items-center gap-1.5">
              <MessageSquare className="size-3" />
              Recent Messages
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="retro text-[7px] text-amber-200/50 hover:text-amber-200/80 hover:bg-transparent px-1 h-6"
              onClick={() => navigate("/envelopes")}
            >
              ALL &gt;&gt;
            </Button>
          </div>
          <div className="rounded-xl border-2 border-[#2a2a3d] bg-[#1e1e30] overflow-hidden">
            {recentEnvelopes.length > 0 ? (
              <div className="max-h-[420px] overflow-y-auto divide-y divide-[#2a2a3d]/50">
                {recentEnvelopes.map((env) => (
                  <RecentMessageRow key={env.id} envelope={env} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10">
                <MessageSquare className="mb-2 size-6 text-amber-200/15" />
                <p className="retro text-[8px] text-amber-200/30">
                  No messages yet
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 8-bit Agent Info Cards */}
      {agents.length > 0 && (
        <div className="px-4 pb-8 pt-5 md:px-8">
          <h2 className="retro mb-4 text-xs text-amber-200/70 tracking-wider">
            [ Agent Status ]
          </h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const st = statuses[agent.name];
              return (
                <AgentInfoCard
                  key={agent.name}
                  agent={agent}
                  status={st}
                  onClick={() => navigate(`/agents/${encodeURIComponent(agent.name)}`)}
                />
              );
            })}
          </div>
        </div>
      )}

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

/* ------------------------------------------------------------------ */
/*  Recent Message Row                                                 */
/* ------------------------------------------------------------------ */

function RecentMessageRow({ envelope }: { envelope: EnvelopeSummary }) {
  const isBoss = envelope.fromBoss;
  const timeStr = formatRelativeTime(envelope.createdAt);
  const text = envelope.text || "(no content)";

  // Shorten address for display (remove "agent:" / "channel:" prefix)
  const shortAddr = (addr: string) => addr.replace(/^(agent|channel|boss):/, "");

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-[#2a2a3d]/40">
      {/* Direction dot */}
      <div className={cn(
        "mt-1 size-2 shrink-0 rounded-full",
        isBoss ? "bg-sky-400" : "bg-emerald-400",
      )} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="retro text-[7px] font-bold text-amber-200/80 truncate max-w-[80px]">
            {shortAddr(envelope.from)}
          </span>
          <ArrowRight className="size-2 shrink-0 text-amber-200/25" />
          <span className="retro text-[7px] text-amber-200/50 truncate max-w-[80px]">
            {shortAddr(envelope.to)}
          </span>
          {isBoss && (
            <span className="retro rounded bg-sky-600/40 px-1 text-[5px] text-sky-300 leading-relaxed">
              BOSS
            </span>
          )}
          <span className="ml-auto retro text-[6px] text-amber-200/30 shrink-0">
            {timeStr}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-amber-100/50 line-clamp-1 leading-relaxed">
          {text}
        </p>
      </div>

      {/* Status */}
      <EnvelopeStatusDot status={envelope.status} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Envelope Status Dot                                                */
/* ------------------------------------------------------------------ */

function EnvelopeStatusDot({ status }: { status: string }) {
  const label =
    status === "pending" ? "PEND" :
    status === "delivered" ? "DLVR" :
    status === "done" ? "DONE" :
    status === "failed" ? "FAIL" :
    status.toUpperCase().slice(0, 4);

  const color =
    status === "pending" ? "bg-amber-500/80 text-amber-100" :
    status === "delivered" ? "bg-sky-500/80 text-sky-100" :
    status === "done" ? "bg-emerald-600/80 text-emerald-100" :
    status === "failed" ? "bg-red-600/80 text-red-100" :
    "bg-zinc-600 text-zinc-300";

  return (
    <span className={cn("retro mt-1 shrink-0 rounded px-1 py-[1px] text-[5px]", color)}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  8-bit Agent Info Card                                              */
/* ------------------------------------------------------------------ */

function AgentInfoCard({
  agent,
  status,
  onClick,
}: {
  agent: AgentSummary;
  status?: AgentCardStatus;
  onClick: () => void;
}) {
  const isRunning = status?.state === "running";
  const isError = status?.health === "error";
  const healthValue =
    status?.health === "ok" ? 100 :
    status?.health === "degraded" ? 50 :
    status?.health === "error" ? 20 : 80;

  return (
    <Card
      className={cn(
        "cursor-pointer bg-[#2a2a3d] text-amber-100 transition-all hover:bg-[#33334d]",
        isError && "border-red-500/50",
        isRunning && "border-emerald-500/50",
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="retro text-[10px] text-amber-200 tracking-wide">
            {agent.name}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {agent.role && (
              <Badge
                variant={agent.role === "speaker" ? "default" : "secondary"}
                className={cn(
                  "text-[8px] px-1.5 py-0",
                  agent.role === "speaker"
                    ? "bg-sky-600 text-white"
                    : agent.role === "leader"
                      ? "bg-violet-600 text-white"
                      : "bg-zinc-600 text-zinc-200",
                )}
              >
                {agent.role}
              </Badge>
            )}
            <StateBadge state={status?.state} health={status?.health} />
          </div>
        </div>
        {agent.description && (
          <p className="retro mt-1 text-[7px] text-amber-200/50 line-clamp-1">
            {agent.description}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {/* Health bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="retro flex items-center gap-1 text-[7px] text-amber-200/60">
              <Heart className="size-2.5" /> HP
            </span>
            <span className="retro text-[7px] text-amber-200/60">{healthValue}%</span>
          </div>
          <HealthBar value={healthValue} variant="retro" className="h-3" />
        </div>

        {/* Activity / Pending bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="retro flex items-center gap-1 text-[7px] text-amber-200/60">
              <Inbox className="size-2.5" /> Pending
            </span>
            <span className="retro text-[7px] text-amber-200/60">{status?.pending ?? 0}</span>
          </div>
          <Progress
            value={Math.min(100, (status?.pending ?? 0) * 20)}
            variant="retro"
            className="h-3"
            progressBg="bg-amber-500"
          />
        </div>

        {/* Info row */}
        <div className="flex items-center justify-between pt-1">
          <span className="retro flex items-center gap-1 text-[7px] text-amber-200/50">
            <Monitor className="size-2.5" />
            {agent.provider ?? "claude"}
          </span>
          {isRunning && (
            <span className="retro flex items-center gap-1 text-[7px] text-emerald-400">
              <Zap className="size-2.5" /> Active
            </span>
          )}
        </div>

        {/* Runtime info */}
        {status?.currentRunId && (
          <div className="rounded bg-[#1a1a2e]/60 px-2 py-1.5">
            <div className="retro flex items-center justify-between text-[7px]">
              <span className="text-amber-200/40">Run</span>
              <span className="font-mono text-amber-200/70">{status.currentRunId.slice(0, 8)}</span>
            </div>
            {status?.sessionTarget && (
              <div className="retro flex items-center justify-between text-[7px] mt-0.5">
                <span className="text-amber-200/40">Session</span>
                <span className="font-mono text-amber-200/70">{status.sessionTarget}</span>
              </div>
            )}
          </div>
        )}

        {/* View detail button */}
        <Button
          variant="outline"
          size="sm"
          className="retro w-full border-amber-200/30 text-amber-200/80 text-[8px] hover:bg-amber-200/10"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          View Detail &gt;&gt;
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  State Badge                                                        */
/* ------------------------------------------------------------------ */

function StateBadge({ state, health }: { state?: string; health?: string }) {
  if (health === "error") {
    return (
      <Badge variant="destructive" className="text-[8px] px-1.5 py-0 bg-red-600 text-white animate-pulse">
        ERR
      </Badge>
    );
  }
  if (state === "running") {
    return (
      <Badge variant="default" className="text-[8px] px-1.5 py-0 bg-emerald-600 text-white">
        RUN
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[8px] px-1.5 py-0 bg-zinc-600 text-zinc-200">
      IDLE
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
