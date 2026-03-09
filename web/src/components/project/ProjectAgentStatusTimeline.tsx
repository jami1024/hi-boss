import { useEffect, useMemo, useState } from "react";
import { Clock3, Flame, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type {
  ProjectAgentTimelineEvent,
  ProjectAgentTimelineEventKind,
} from "@/components/project/project-agent-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ProjectAgentStatusTimelineProps {
  agentNames: string[];
  events: ProjectAgentTimelineEvent[];
}

const RECENT_WINDOW_MS = 5 * 60 * 1000;
const PREVIOUS_WINDOW_MS = RECENT_WINDOW_MS * 2;
const EVENT_KIND_OPTIONS: ProjectAgentTimelineEventKind[] = [
  "state",
  "health",
  "pending",
  "session",
  "observed",
];

type TrendDirection = "up" | "down" | "flat";

function kindLabel(kind: ProjectAgentTimelineEventKind): string {
  if (kind === "observed") return "首次观测";
  if (kind === "state") return "状态";
  if (kind === "health") return "健康";
  if (kind === "pending") return "待处理";
  return "会话";
}

function kindVariant(kind: ProjectAgentTimelineEventKind): "default" | "secondary" | "outline" {
  return kind === "state" || kind === "health" ? "default" : kind === "observed" ? "outline" : "secondary";
}

function runtimeStateLabel(value: string): string {
  if (value === "running") return "运行中";
  if (value === "idle") return "空闲";
  if (value === "stopped") return "已停止";
  if (value === "unknown") return "未知";
  return value;
}

function healthStateLabel(value: string): string {
  if (value === "ok") return "健康";
  if (value === "error") return "异常";
  if (value === "unknown") return "未知";
  return value;
}

function eventValueLabel(kind: ProjectAgentTimelineEventKind, value: string): string {
  if (kind === "state") return runtimeStateLabel(value);
  if (kind === "health") return healthStateLabel(value);
  if (kind === "session" && value === "none") return "无";
  return value;
}

function eventSummary(event: ProjectAgentTimelineEvent): string {
  if (event.kind === "observed") {
    const [stateRaw, healthRaw] = event.after.split(" / ");
    const state = runtimeStateLabel(stateRaw ?? event.after);
    if (!healthRaw) {
      return `${event.agentName} 已上线：${state}`;
    }
    return `${event.agentName} 已上线：${state} / ${healthStateLabel(healthRaw)}`;
  }
  const before = event.before ? eventValueLabel(event.kind, event.before) : "-";
  const after = eventValueLabel(event.kind, event.after);
  return `${event.agentName} ${before} -> ${after}`;
}

function isAnomaly(event: ProjectAgentTimelineEvent): boolean {
  if (event.kind === "health") {
    return event.after === "error";
  }
  if (event.kind === "pending") {
    return Number(event.after) > 0;
  }
  if (event.kind === "observed") {
    return event.after.includes("error");
  }
  return false;
}

function trendDirection(current: number, previous: number): TrendDirection {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function TrendMark({ direction }: { direction: TrendDirection }) {
  if (direction === "up") {
    return <TrendingUp className="size-3 text-emerald-500" />;
  }
  if (direction === "down") {
    return <TrendingDown className="size-3 text-amber-500" />;
  }
  return <Minus className="size-3 text-muted-foreground" />;
}

export function ProjectAgentStatusTimeline({ agentNames, events }: ProjectAgentStatusTimelineProps) {
  const [selectedKinds, setSelectedKinds] = useState<ProjectAgentTimelineEventKind[]>(EVENT_KIND_OPTIONS);
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>("all");

  useEffect(() => {
    if (selectedAgent !== "all" && !agentNames.includes(selectedAgent)) {
      setSelectedAgent("all");
    }
  }, [agentNames, selectedAgent]);

  const toggleKind = (kind: ProjectAgentTimelineEventKind) => {
    setSelectedKinds((previous) =>
      previous.includes(kind)
        ? previous.filter((candidate) => candidate !== kind)
        : [...previous, kind]
    );
  };

  const grouped = useMemo(() => {
    const byAgent = new Map<string, ProjectAgentTimelineEvent[]>();
    for (const agentName of agentNames) {
      byAgent.set(agentName, []);
    }
    for (const event of events) {
      if (!byAgent.has(event.agentName)) {
        byAgent.set(event.agentName, []);
      }
      byAgent.get(event.agentName)?.push(event);
    }

    const now = Date.now();
    const sorted = [...byAgent.entries()]
      .map(([agentName, rawEvents]) => {
        const eventsByKind = rawEvents.filter((event) => selectedKinds.includes(event.kind));
        const visibleEvents = anomaliesOnly ? eventsByKind.filter(isAnomaly) : eventsByKind;
        const recentCount = rawEvents.filter((event) => now - event.at <= RECENT_WINDOW_MS).length;
        const previousCount = rawEvents.filter(
          (event) => now - event.at > RECENT_WINDOW_MS && now - event.at <= PREVIOUS_WINDOW_MS
        ).length;
        const recentAnomalyCount = rawEvents.filter(
          (event) => now - event.at <= RECENT_WINDOW_MS && isAnomaly(event)
        ).length;
        const previousAnomalyCount = rawEvents.filter(
          (event) => now - event.at > RECENT_WINDOW_MS && now - event.at <= PREVIOUS_WINDOW_MS && isAnomaly(event)
        ).length;

        const heatCount = anomaliesOnly ? recentAnomalyCount : recentCount;
        const previousHeatCount = anomaliesOnly ? previousAnomalyCount : previousCount;
        return {
          agentName,
          events: visibleEvents,
          recentCount,
          recentAnomalyCount,
          heatCount,
          heatDelta: heatCount - previousHeatCount,
          trend: trendDirection(heatCount, previousHeatCount),
          heatPercent: Math.min(100, heatCount * 20),
        };
      })
      .sort((a, b) => {
        if (a.heatCount !== b.heatCount) {
          return b.heatCount - a.heatCount;
        }
        return a.agentName.localeCompare(b.agentName);
      });

    if (selectedAgent === "all") {
      return sorted;
    }
    return sorted.filter((group) => group.agentName === selectedAgent);
  }, [agentNames, anomaliesOnly, events, selectedAgent, selectedKinds]);

  return (
    <Card className="border-border/75">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock3 className="size-4" />
          智能体状态时间线
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {EVENT_KIND_OPTIONS.map((kind) => (
            <Button
              key={kind}
              variant={selectedKinds.includes(kind) ? "default" : "outline"}
              size="sm"
              onClick={() => toggleKind(kind)}
            >
              {kindLabel(kind)}
            </Button>
          ))}
          <Button
            variant={anomaliesOnly ? "destructive" : "outline"}
            size="sm"
            onClick={() => setAnomaliesOnly((previous) => !previous)}
          >
            仅看异常
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedKinds(EVENT_KIND_OPTIONS);
              setAnomaliesOnly(false);
              setSelectedAgent("all");
            }}
          >
            重置
          </Button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            variant={selectedAgent === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedAgent("all")}
          >
            全部智能体
          </Button>
          {agentNames.map((agentName) => (
            <Button
              key={agentName}
              variant={selectedAgent === agentName ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedAgent(agentName)}
            >
              {agentName}
            </Button>
          ))}
        </div>

        {grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground">等待实时状态变化...</p>
        ) : (
          <div className="space-y-2">
            {grouped.map((group) => (
              <details
                key={group.agentName}
                className="rounded-lg border border-border/60 bg-background/70 p-3"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{group.agentName}</span>
                      <Badge variant="outline">{group.events.length} 条事件</Badge>
                    </div>
                    <Badge variant={group.heatCount > 0 ? "default" : "secondary"}>
                      <Flame className="size-3" />
                      {anomaliesOnly ? group.recentAnomalyCount : group.recentCount}/5m
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                    <TrendMark direction={group.trend} />
                    <span>
                      {group.heatDelta === 0
                        ? "与前5分钟持平"
                        : `${group.heatDelta > 0 ? "+" : ""}${group.heatDelta}（对比前5分钟）`}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent via-primary to-primary transition-[width]"
                      style={{ width: `${group.heatPercent}%` }}
                    />
                  </div>
                </summary>
                <div className="mt-3 space-y-2">
                  {group.events.length === 0 ? (
                    <p className="text-sm text-muted-foreground">暂无事件。</p>
                  ) : (
                    group.events.map((event) => (
                      <div key={event.id} className="rounded-md border border-border/55 bg-background/70 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={kindVariant(event.kind)}>{kindLabel(event.kind)}</Badge>
                          <span className="text-xs text-muted-foreground">{formatTime(event.at)}</span>
                        </div>
                        <p className="mt-1.5 text-sm">{eventSummary(event)}</p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
