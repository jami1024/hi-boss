import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useDaemonStatusFeed } from "@/hooks/useDaemonStatusFeed";

function formatUptime(ms: number | null): string {
  if (!ms) return "—";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟 ${secs}秒`;
  return `${secs}秒`;
}

function healthColor(health: string): string {
  switch (health) {
    case "ok": return "bg-green-500";
    case "degraded": return "bg-yellow-500";
    case "error": return "bg-red-500";
    default: return "bg-gray-400";
  }
}

function stateVariant(state: string): "default" | "secondary" | "outline" {
  return state === "running" ? "default" : "secondary";
}

function stateLabel(state: string): string {
  if (state === "running") return "运行中";
  if (state === "idle") return "空闲";
  if (state === "stopped") return "已停止";
  return "未知";
}

function roleLabel(role: string | null | undefined): string {
  if (role === "speaker") return "发言者";
  if (role === "leader") return "领队";
  return role ?? "—";
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.3 },
  }),
};

export function Dashboard() {
  const { status, error, connected, authenticated } = useDaemonStatusFeed({ pollMs: 5000 });

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">错误：{error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">运行脉搏</h1>
          <p className="mt-1 text-sm text-muted-foreground">实时查看路由、智能体与项目会话的系统健康度。</p>
        </div>
        <ConnectionStatus connected={connected} authenticated={authenticated} size="compact" />
      </div>

      <Card className="border-primary/20 bg-gradient-to-r from-primary/18 via-card to-accent/22">
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">守护进程状态</p>
            <p className="mt-1 text-3xl font-bold">{status.running ? "运行中" : "已停止"}</p>
            <p className="mt-1 text-sm text-muted-foreground">运行时长 {formatUptime(status.uptime)} · 时区 {status.bossTimezone}</p>
          </div>
          <Badge variant={status.running ? "default" : "secondary"} className="w-fit">
            {status.running ? "运行中" : "已停止"}
          </Badge>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "状态", value: status.running ? "运行中" : "已停止" },
          { title: "运行时长", value: formatUptime(status.uptime) },
          { title: "智能体数量", value: String(status.agentCount) },
          { title: "时区", value: status.bossTimezone },
        ].map((stat, i) => (
          <motion.div
            key={stat.title}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
          >
            <Card className="border-border/70 bg-card/90">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Agent cards */}
      <div>
        <h2 className="mb-3 text-xl font-semibold">智能体编队</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {status.agents.map((agent, i) => (
            <motion.div
              key={agent.name}
              custom={i + 4}
              initial="hidden"
              animate="visible"
              variants={cardVariants}
            >
              <Card className="border-border/75 hover:border-primary/45 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{agent.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${healthColor(agent.health)}`}
                      />
                      <Badge variant={stateVariant(agent.state)}>
                        {stateLabel(agent.state)}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>角色</span>
                      <span className="font-medium text-foreground">
                        {roleLabel(agent.role)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>供应商</span>
                      <span className="font-medium text-foreground">
                        {agent.provider ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>待处理</span>
                      <span className="font-medium text-foreground">
                        {agent.pendingCount}
                      </span>
                    </div>
                    {agent.currentRun && (
                      <div className="flex justify-between">
                        <span>当前运行</span>
                        <span className="font-mono text-xs text-foreground">{agent.currentRun.id.slice(0, 8)}</span>
                      </div>
                    )}
                    {agent.currentRun?.sessionTarget && (
                      <div className="flex justify-between">
                        <span>会话目标</span>
                        <span className="font-mono text-xs text-foreground">{agent.currentRun.sessionTarget}</span>
                      </div>
                    )}
                    {agent.currentRun?.projectId && (
                      <div className="flex justify-between">
                        <span>项目</span>
                        <span className="font-mono text-xs text-foreground">{agent.currentRun.projectId}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
