import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DaemonStatus {
  running: boolean;
  startTimeMs: number | null;
  uptime: number | null;
  bossName: string | null;
  bossTimezone: string;
  agentCount: number;
  bindingCount: number;
  agents: Array<{
    name: string;
    role: string | null;
    provider: string | null;
    state: "running" | "idle";
    health: "ok" | "error" | "unknown";
    pendingCount: number;
  }>;
}

function formatUptime(ms: number | null): string {
  if (!ms) return "—";
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function healthColor(health: string): string {
  switch (health) {
    case "ok": return "bg-green-500";
    case "error": return "bg-red-500";
    default: return "bg-yellow-500";
  }
}

function stateVariant(state: string): "default" | "secondary" | "outline" {
  return state === "running" ? "default" : "secondary";
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
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.getStatus();
        setStatus(data);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Error: {error}</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { title: "Status", value: status.running ? "Running" : "Stopped" },
          { title: "Uptime", value: formatUptime(status.uptime) },
          { title: "Agents", value: String(status.agentCount) },
          { title: "Timezone", value: status.bossTimezone },
        ].map((stat, i) => (
          <motion.div
            key={stat.title}
            custom={i}
            initial="hidden"
            animate="visible"
            variants={cardVariants}
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{stat.value}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Agent cards */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Agents</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {status.agents.map((agent, i) => (
            <motion.div
              key={agent.name}
              custom={i + 4}
              initial="hidden"
              animate="visible"
              variants={cardVariants}
            >
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{agent.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${healthColor(agent.health)}`}
                      />
                      <Badge variant={stateVariant(agent.state)}>
                        {agent.state}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Role</span>
                      <span className="font-medium text-foreground">
                        {agent.role ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Provider</span>
                      <span className="font-medium text-foreground">
                        {agent.provider ?? "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pending</span>
                      <span className="font-medium text-foreground">
                        {agent.pendingCount}
                      </span>
                    </div>
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
