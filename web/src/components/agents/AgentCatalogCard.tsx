import { motion } from "framer-motion";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { AgentSummary } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface AgentCardStatus {
  state: "running" | "idle";
  health: "ok" | "error" | "unknown";
  pending: number;
  currentRunId?: string;
  sessionTarget?: string;
  projectId?: string;
}

export interface AgentActivitySnapshot {
  current: number;
  previous: number;
  delta: number;
  trend: "up" | "down" | "flat";
}

export interface AgentAnomalySnapshot {
  recent: number;
  currentHealthError: boolean;
  currentPending: boolean;
  recentSpike: boolean;
  score: number;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3 },
  }),
};

function healthColor(health: string): string {
  switch (health) {
    case "ok":
      return "bg-green-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-yellow-500";
  }
}

function roleBadgeVariant(role: string | null): "default" | "secondary" | "outline" {
  if (role === "speaker") return "default";
  if (role === "leader") return "secondary";
  return "outline";
}

function roleLabel(role: string | null): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "—";
}

function stateLabel(state: AgentCardStatus["state"] | undefined): string {
  if (state === "running") return "运行中";
  if (state === "idle") return "空闲";
  return "未知";
}

interface AgentCatalogCardProps {
  agent: AgentSummary;
  index: number;
  status?: AgentCardStatus;
  activity: AgentActivitySnapshot;
  anomaly: AgentAnomalySnapshot;
  canDirectChat: boolean;
  highlightAnomaly: boolean;
  onOpen: () => void;
  onChat: () => void;
}

export function AgentCatalogCard({
  agent,
  index,
  status,
  activity,
  anomaly,
  canDirectChat,
  highlightAnomaly,
  onOpen,
  onChat,
}: AgentCatalogCardProps) {
  const recentActivity = activity.current;
  const heatPercent = Math.min(100, recentActivity * 20);
  const metaLabelClass = "text-foreground/72";

  return (
    <motion.div key={agent.name} custom={index} initial="hidden" animate="visible" variants={cardVariants}>
      <Card
        className={cn(
          "cursor-pointer transition-[border-color,background-color,transform] hover:-translate-y-0.5",
          highlightAnomaly
            ? "border-destructive/50 bg-destructive/5 shadow-[inset_0_0_0_1px_hsl(var(--destructive)/0.12)] hover:border-destructive/70"
            : "border-border/75 hover:border-primary/40"
        )}
        onClick={onOpen}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${healthColor(status?.health ?? "unknown")}`} />
              <Badge variant={roleBadgeVariant(agent.role)}>{roleLabel(agent.role)}</Badge>
              {highlightAnomaly && (
                <Badge variant="destructive" className="text-[10px]">
                  需关注
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm text-foreground/80">
            {agent.description && <p className="text-foreground text-sm mb-2 line-clamp-2">{agent.description}</p>}
            <div className="flex justify-between">
              <span className={metaLabelClass}>供应商</span>
              <span className="font-medium text-foreground">{agent.provider ?? "claude"}</span>
            </div>
            <div className="flex justify-between">
              <span className={metaLabelClass}>模型</span>
              <span className="font-medium text-foreground">{agent.model ?? "默认"}</span>
            </div>
            <div className="flex justify-between">
              <span className={metaLabelClass}>权限</span>
              <span className="font-medium text-foreground">{agent.permissionLevel ?? "标准"}</span>
            </div>
            <div className="flex justify-between">
              <span className={metaLabelClass}>状态</span>
              <Badge variant={status?.state === "running" ? "default" : "secondary"} className="text-xs">
                {stateLabel(status?.state)}
              </Badge>
            </div>
            <div className="pt-1">
              <div className="flex justify-between text-xs">
                <span className={metaLabelClass}>活跃度（5分钟）</span>
                <span className="flex items-center gap-1 font-medium text-foreground">
                  {activity.trend === "up" ? (
                    <TrendingUp className="size-3 text-emerald-500" />
                  ) : activity.trend === "down" ? (
                    <TrendingDown className="size-3 text-amber-500" />
                  ) : (
                    <Minus className="size-3 text-foreground/65" />
                  )}
                  {recentActivity}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-foreground/74">
                {activity.delta === 0 ? "与前5分钟持平" : `${activity.delta > 0 ? "+" : ""}${activity.delta}（对比前5分钟）`}
              </p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent via-primary to-primary transition-[width]"
                  style={{ width: `${heatPercent}%` }}
                />
              </div>
            </div>
            {anomaly.score > 0 && (
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className={metaLabelClass}>异常信号</span>
                  <Badge variant="destructive" className="text-xs">
                    {anomaly.score}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {anomaly.currentHealthError && (
                    <Badge variant="destructive" className="text-[10px]">
                      健康异常
                    </Badge>
                  )}
                  {anomaly.currentPending && (
                    <Badge variant="secondary" className="text-[10px]">
                      待处理堆积
                    </Badge>
                  )}
                  {anomaly.recentSpike && (
                    <Badge variant="outline" className="text-[10px]">
                      近期波动
                    </Badge>
                  )}
                </div>
              </div>
            )}
            {status?.currentRunId && (
              <div className="flex justify-between">
                <span className={metaLabelClass}>当前运行</span>
                <span className="font-mono text-xs text-foreground">{status.currentRunId.slice(0, 8)}</span>
              </div>
            )}
            {status?.sessionTarget && (
              <div className="flex justify-between">
                <span className={metaLabelClass}>会话目标</span>
                <span className="font-mono text-xs text-foreground">{status.sessionTarget}</span>
              </div>
            )}
            {status?.projectId && (
              <div className="flex justify-between">
                <span className={metaLabelClass}>项目</span>
                <span className="font-mono text-xs text-foreground">{status.projectId}</span>
              </div>
            )}
            {agent.bindings.length > 0 && (
              <div className="flex justify-between">
                <span className={metaLabelClass}>适配器</span>
                <span className="font-medium text-foreground">{agent.bindings.join(", ")}</span>
              </div>
            )}
            {(status?.pending ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className={metaLabelClass}>待处理</span>
                <Badge variant="outline" className="text-xs">
                  {status?.pending}
                </Badge>
              </div>
            )}
            {canDirectChat && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChat();
                  }}
                >
                  聊天
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
