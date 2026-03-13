import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Globe,
  Inbox,
  Play,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";

function formatUptime(ms: number | null): string {
  if (!ms) return "--";
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}时`;
  if (hours > 0) return `${hours}时 ${minutes}分`;
  if (minutes > 0) return `${minutes}分`;
  return `${seconds % 60}秒`;
}

function healthLabel(health: string): string {
  switch (health) {
    case "ok": return "正常";
    case "degraded": return "降级";
    case "error": return "异常";
    default: return "未知";
  }
}

function roleLabel(role: string | null | undefined): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "--";
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

export function Dashboard() {
  const navigate = useNavigate();
  const { status, error, connected, authenticated } = useDaemonStatusFeed({ pollMs: 5000 });

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <Activity className="size-8 text-muted-foreground/40 mx-auto animate-pulse" />
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  const runningAgents = status.agents.filter((a) => a.state === "running");
  const totalPending = status.agents.reduce((sum, a) => sum + a.pendingCount, 0);

  return (
    <div className="p-6 space-y-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">运行脉搏</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            实时查看系统健康度与智能体工作状态。
          </p>
        </div>
        <ConnectionStatus connected={connected} authenticated={authenticated} size="compact" />
      </div>

      {/* Hero status card */}
      <motion.div custom={0} initial="hidden" animate="visible" variants={fadeUp}>
        <Card className="overflow-hidden border-primary/20">
          <div className="relative bg-gradient-to-br from-primary/15 via-card to-accent/15">
            <CardContent className="pt-6 pb-6">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                {/* Left: daemon info */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2.5">
                    <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                      <Zap className="size-5" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold leading-tight">
                        {status.running ? "系统运行中" : "系统已停止"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {status.bossName && <span className="font-medium text-foreground">{status.bossName}</span>}
                        {status.bossName && " · "}
                        已运行 {formatUptime(status.uptime)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right: quick stats */}
                <div className="flex items-center gap-6">
                  <QuickStat icon={Bot} label="智能体" value={status.agentCount} />
                  <QuickStat icon={Play} label="运行中" value={runningAgents.length} highlight={runningAgents.length > 0} />
                  <QuickStat icon={Inbox} label="待处理" value={totalPending} highlight={totalPending > 0} />
                  <QuickStat icon={Globe} label="时区" value={status.bossTimezone} small />
                </div>
              </div>
            </CardContent>
          </div>
        </Card>
      </motion.div>

      {/* Agent cards */}
      {status.agents.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-xl font-semibold">智能体编队</h2>
            <Badge variant="outline" className="text-xs">
              {status.agents.length} 个
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {status.agents.map((agent, i) => {
              const isRunning = agent.state === "running";
              const healthOk = agent.health === "ok";

              return (
                <motion.div
                  key={agent.name}
                  custom={i + 1}
                  initial="hidden"
                  animate="visible"
                  variants={fadeUp}
                >
                  <Card
                    className="group cursor-pointer border-border/60 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    onClick={() => navigate(`/agents/${encodeURIComponent(agent.name)}`)}
                  >
                    <CardContent className="pt-5 pb-4 space-y-3">
                      {/* Agent header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={`grid size-9 place-items-center rounded-lg ${isRunning ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                            <Bot className="size-4.5" />
                          </div>
                          <div>
                            <p className="font-semibold leading-tight">{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{roleLabel(agent.role)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Health dot */}
                          <span className="relative flex size-2.5" title={healthLabel(agent.health)}>
                            {isRunning && healthOk && (
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                            )}
                            <span className={`relative inline-flex size-2.5 rounded-full ${
                              healthOk ? "bg-emerald-500" :
                              agent.health === "degraded" ? "bg-amber-500" :
                              agent.health === "error" ? "bg-red-500" : "bg-gray-400"
                            }`} />
                          </span>
                          <Badge
                            variant={isRunning ? "default" : "secondary"}
                            className="text-[11px] px-2 py-0.5"
                          >
                            {isRunning ? "运行中" : "空闲"}
                          </Badge>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2.5">
                        <MiniStat label="供应商" value={agent.provider ?? "--"} />
                        <MiniStat label="待处理" value={String(agent.pendingCount)} highlight={agent.pendingCount > 0} />
                        <MiniStat label="健康" value={healthLabel(agent.health)} />
                      </div>

                      {/* Current run info */}
                      {agent.currentRun && (
                        <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                          <Activity className="size-3.5 text-primary animate-pulse shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground">
                              正在执行
                              {agent.currentRun.sessionTarget && (
                                <span className="font-mono text-foreground ml-1">{agent.currentRun.sessionTarget}</span>
                              )}
                            </p>
                            {agent.currentRun.projectId && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                项目: <span className="font-mono">{agent.currentRun.projectId}</span>
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {agent.currentRun.id.replace(/-/g, "").slice(0, 8)}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {status.agents.length === 0 && (
        <div className="text-center py-16">
          <Bot className="size-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">还没有注册任何智能体。</p>
          <p className="text-sm text-muted-foreground mt-1">
            使用 <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">hiboss agent register</code> 注册你的第一个智能体。
          </p>
        </div>
      )}
    </div>
  );
}

/* ---- Sub-components ---- */

function QuickStat({
  icon: Icon,
  label,
  value,
  highlight,
  small,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  highlight?: boolean;
  small?: boolean;
}) {
  return (
    <div className="text-center">
      <Icon className="size-4 text-muted-foreground mx-auto mb-1" />
      <p className={`font-bold leading-tight ${small ? "text-sm" : "text-xl"} ${highlight ? "text-primary" : ""}`}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      <p className={`text-sm font-semibold leading-tight ${highlight ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
