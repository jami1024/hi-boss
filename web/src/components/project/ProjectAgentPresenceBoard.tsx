import { Activity, Mic2, ShieldCheck, UserRound } from "lucide-react";
import type { ProjectLeaderInfo } from "@/api/client";
import type { ProjectAgentRuntimeSnapshot } from "@/components/project/project-agent-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ProjectAgentPresenceBoardProps {
  speakerAgent: string;
  leaders: ProjectLeaderInfo[];
  statusByName: Record<string, ProjectAgentRuntimeSnapshot | undefined>;
  onOpenAgent: (agentName: string) => void;
}

function healthLabel(health: ProjectAgentRuntimeSnapshot["health"] | undefined): string {
  if (health === "ok") return "健康";
  if (health === "degraded") return "亚健康";
  if (health === "error") return "异常";
  return "未知";
}

function stateVariant(state: ProjectAgentRuntimeSnapshot["state"] | undefined): "default" | "secondary" {
  return state === "running" ? "default" : "secondary";
}

function stateLabel(state: ProjectAgentRuntimeSnapshot["state"] | undefined): string {
  if (state === "running") return "运行中";
  if (state === "idle") return "空闲";
  return "未知";
}

function healthVariant(health: ProjectAgentRuntimeSnapshot["health"] | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (health === "ok") return "default";
  if (health === "degraded") return "secondary";
  if (health === "error") return "destructive";
  return "outline";
}

export function ProjectAgentPresenceBoard({
  speakerAgent,
  leaders,
  statusByName,
  onOpenAgent,
}: ProjectAgentPresenceBoardProps) {
  const speakerStatus = statusByName[speakerAgent];
  const activeLeaders = leaders.filter((leader) => leader.active);
  const standbyLeaders = leaders.filter((leader) => !leader.active);

  return (
    <Card className="border-primary/25 bg-gradient-to-br from-card via-card to-primary/8">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="size-5" />
          项目智能体工位
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">发言智能体</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
                <Mic2 className="size-4" />
                {speakerAgent}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {speakerStatus?.sessionTarget ?? "暂无会话目标"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={stateVariant(speakerStatus?.state)}>{stateLabel(speakerStatus?.state)}</Badge>
              <Badge variant={healthVariant(speakerStatus?.health)}>{healthLabel(speakerStatus?.health)}</Badge>
              {(speakerStatus?.pendingCount ?? 0) > 0 && (
                <Badge variant="outline">待处理 {speakerStatus?.pendingCount}</Badge>
              )}
            </div>
          </div>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => onOpenAgent(speakerAgent)}>
              打开发言智能体
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">在线工位</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {activeLeaders.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无激活领队。</p>
            )}
            {activeLeaders.map((leader) => {
              const st = statusByName[leader.agentName];
              return (
                <div key={leader.agentName} className="rounded-xl border border-border/70 bg-background/75 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-medium">
                      <ShieldCheck className="size-4" />
                      {leader.agentName}
                    </p>
                    <Badge variant={stateVariant(st?.state)}>{stateLabel(st?.state)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={healthVariant(st?.health)}>{healthLabel(st?.health)}</Badge>
                    {(st?.pendingCount ?? 0) > 0 && <Badge variant="outline">待处理 {st?.pendingCount}</Badge>}
                  </div>
                  {leader.capabilities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {leader.capabilities.slice(0, 4).map((cap) => (
                        <Badge key={cap} variant="secondary" className="text-[10px]">
                          {cap}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-2">
                    <Button variant="ghost" size="sm" onClick={() => onOpenAgent(leader.agentName)}>
                      打开
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {standbyLeaders.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">待命区</p>
            <div className="flex flex-wrap gap-2">
              {standbyLeaders.map((leader) => (
                <Badge key={leader.agentName} variant="outline" className="rounded-full px-3 py-1">
                  <UserRound className="size-3" />
                  {leader.agentName}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
