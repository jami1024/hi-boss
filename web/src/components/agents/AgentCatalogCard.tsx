import { motion } from "framer-motion";
import { Minus, TrendingDown, TrendingUp, MessageCircle, Zap } from "lucide-react";
import type { AgentSummary } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AgentCardStatus {
  state: "running" | "idle";
  health: "ok" | "degraded" | "error" | "unknown";
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
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: "easeOut" as const },
  }),
};

function healthDot(health: string): string {
  switch (health) {
    case "ok": return "bg-emerald-400 shadow-emerald-400/50";
    case "degraded": return "bg-amber-400 shadow-amber-400/50";
    case "error": return "bg-red-400 shadow-red-400/50";
    default: return "bg-zinc-400 shadow-zinc-400/30";
  }
}

function roleBadgeStyle(role: string | null): string {
  if (role === "speaker") return "bg-sky-100 text-sky-700 border-sky-200";
  if (role === "leader") return "bg-violet-100 text-violet-700 border-violet-200";
  return "bg-zinc-100 text-zinc-600 border-zinc-200";
}

function roleLabel(role: string | null): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "--";
}

function stateScene(state: AgentCardStatus["state"] | undefined, health: string | undefined) {
  if (health === "error") {
    return { emoji: "⚠️", label: "异常中", sceneClass: "from-red-50 to-orange-50" };
  }
  if (state === "running") {
    return { emoji: "💻", label: "工作中", sceneClass: "from-blue-50 to-cyan-50" };
  }
  return { emoji: "☕", label: "休息中", sceneClass: "from-amber-50 to-yellow-50" };
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
  const scene = stateScene(status?.state, status?.health);

  return (
    <motion.div key={agent.name} custom={index} initial="hidden" animate="visible" variants={cardVariants}>
      <div
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-2xl border-2 bg-white transition-all duration-300",
          "hover:-translate-y-1 hover:shadow-lg",
          highlightAnomaly
            ? "border-red-300 shadow-red-100/60 shadow-md"
            : "border-zinc-200/80 hover:border-zinc-300 shadow-sm"
        )}
        onClick={onOpen}
      >
        {/* Scene header - office workspace */}
        <div className={cn("relative h-28 bg-gradient-to-br overflow-hidden", scene.sceneClass)}>
          {/* Decorative pixel grid */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 7px, currentColor 7px, currentColor 8px), repeating-linear-gradient(90deg, transparent, transparent 7px, currentColor 7px, currentColor 8px)",
          }} />

          {/* Character avatar */}
          <div className="absolute left-4 bottom-3 flex items-end gap-3">
            <div className={cn(
              "relative flex h-14 w-14 items-center justify-center rounded-xl border-2 bg-white/90 text-2xl shadow-md backdrop-blur-sm",
              status?.state === "running" && "border-blue-300",
              status?.health === "error" && "border-red-300",
              status?.state === "idle" && status?.health !== "error" && "border-amber-200",
            )}>
              <span className="select-none">{scene.emoji}</span>
              {/* Health indicator dot */}
              <span className={cn(
                "absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white shadow-sm",
                healthDot(status?.health ?? "unknown")
              )} />
              {/* Running pulse */}
              {status?.state === "running" && (
                <span className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full bg-emerald-400/60" />
              )}
            </div>
          </div>

          {/* Speech bubble */}
          <div className="absolute right-3 top-3 max-w-[55%]">
            <div className="relative rounded-xl rounded-br-sm bg-white/85 px-3 py-1.5 text-xs leading-relaxed text-zinc-600 shadow-sm backdrop-blur-sm">
              {agent.description
                ? <span className="line-clamp-2">{agent.description}</span>
                : <span className="italic text-zinc-400">{scene.label}...</span>}
            </div>
          </div>

          {/* Role badge */}
          <div className="absolute right-3 bottom-3">
            <span className={cn(
              "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold",
              roleBadgeStyle(agent.role)
            )}>
              {roleLabel(agent.role)}
            </span>
          </div>
        </div>

        {/* Card body */}
        <div className="space-y-3 px-4 pb-4 pt-3">
          {/* Name row */}
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-zinc-800 tracking-tight">{agent.name}</h3>
            {highlightAnomaly && (
              <Badge variant="destructive" className="text-[10px] gap-0.5">
                <Zap className="size-2.5" />需关注
              </Badge>
            )}
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            <MetaRow label="供应商" value={agent.provider ?? "claude"} />
            <MetaRow label="模型" value={agent.model ?? "默认"} />
            <MetaRow label="权限" value={agent.permissionLevel ?? "standard"} />
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">状态</span>
              <span className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                status?.state === "running"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-zinc-100 text-zinc-500"
              )}>
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status?.state === "running" ? "bg-emerald-500" : "bg-zinc-400",
                )} />
                {status?.state === "running" ? "运行中" : "空闲"}
              </span>
            </div>
          </div>

          {/* Activity bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">活跃度（5分钟）</span>
              <span className="flex items-center gap-1 font-medium text-zinc-600">
                {activity.trend === "up" ? (
                  <TrendingUp className="size-3 text-emerald-500" />
                ) : activity.trend === "down" ? (
                  <TrendingDown className="size-3 text-amber-500" />
                ) : (
                  <Minus className="size-3 text-zinc-400" />
                )}
                {recentActivity}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              {activity.delta === 0 ? "与前5分钟持平" : `${activity.delta > 0 ? "+" : ""}${activity.delta}（对比前5分钟）`}
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  heatPercent > 60 ? "bg-gradient-to-r from-amber-400 to-orange-500" :
                  heatPercent > 30 ? "bg-gradient-to-r from-sky-400 to-blue-500" :
                  "bg-gradient-to-r from-zinc-300 to-zinc-400"
                )}
                initial={{ width: 0 }}
                animate={{ width: `${heatPercent}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Anomaly badges */}
          {anomaly.score > 0 && (
            <div className="flex flex-wrap gap-1">
              {anomaly.currentHealthError && (
                <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 border border-red-100">健康异常</span>
              )}
              {anomaly.currentPending && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 border border-amber-100">待处理堆积</span>
              )}
              {anomaly.recentSpike && (
                <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 border border-violet-100">近期波动</span>
              )}
            </div>
          )}

          {/* Runtime info */}
          {(status?.currentRunId || status?.sessionTarget || status?.projectId) && (
            <div className="space-y-0.5 rounded-lg bg-zinc-50 px-3 py-2 text-[12px]">
              {status?.currentRunId && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">运行</span>
                  <span className="font-mono text-zinc-600">{status.currentRunId.slice(0, 8)}</span>
                </div>
              )}
              {status?.sessionTarget && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">会话</span>
                  <span className="font-mono text-zinc-600">{status.sessionTarget}</span>
                </div>
              )}
              {status?.projectId && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">项目</span>
                  <span className="font-mono text-zinc-600">{status.projectId}</span>
                </div>
              )}
            </div>
          )}

          {/* Bindings & pending */}
          {agent.bindings.length > 0 && (
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">适配器</span>
              <span className="font-medium text-zinc-600">{agent.bindings.join(", ")}</span>
            </div>
          )}
          {(status?.pending ?? 0) > 0 && (
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">待处理</span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700">
                {status?.pending}
              </span>
            </div>
          )}

          {/* Chat button */}
          {canDirectChat && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5 border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              onClick={(event) => {
                event.stopPropagation();
                onChat();
              }}
            >
              <MessageCircle className="size-3.5" />
              聊天
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-700 truncate ml-2 text-right">{value}</span>
    </div>
  );
}
