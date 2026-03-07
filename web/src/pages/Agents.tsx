import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api, type AgentSummary } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

function healthColor(health: string): string {
  switch (health) {
    case "ok": return "bg-green-500";
    case "error": return "bg-red-500";
    default: return "bg-yellow-500";
  }
}

function roleBadgeVariant(role: string | null): "default" | "secondary" | "outline" {
  if (role === "speaker") return "default";
  if (role === "leader") return "secondary";
  return "outline";
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.3 },
  }),
};

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { state: string; health: string; pending: number }>>({});
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const { agents: list } = await api.listAgents();
        setAgents(list);

        // Fetch status for each agent
        const statusMap: typeof statuses = {};
        await Promise.all(
          list.map(async (agent) => {
            try {
              const detail = await api.getAgentStatus(agent.name);
              statusMap[agent.name] = {
                state: detail.status.agentState,
                health: detail.status.agentHealth,
                pending: detail.status.pendingCount,
              };
            } catch {
              statusMap[agent.name] = { state: "idle", health: "unknown", pending: 0 };
            }
          })
        );
        setStatuses(statusMap);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Error: {error}</p>
      </div>
    );
  }

  const filtered = agents.filter((a) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      (a.role ?? "").toLowerCase().includes(q) ||
      (a.provider ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Filter agents..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-64"
          />
          <Badge variant="outline">{agents.length} total</Badge>
        </div>
      </div>

      {filtered.length === 0 && agents.length > 0 && (
        <p className="text-muted-foreground">No agents match the filter.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((agent, i) => {
          const st = statuses[agent.name];
          return (
            <motion.div
              key={agent.name}
              custom={i}
              initial="hidden"
              animate="visible"
              variants={cardVariants}
            >
              <Card
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/agents/${encodeURIComponent(agent.name)}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{agent.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${healthColor(st?.health ?? "unknown")}`}
                      />
                      <Badge variant={roleBadgeVariant(agent.role)}>
                        {agent.role ?? "—"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {agent.description && (
                      <p className="text-foreground text-sm mb-2 line-clamp-2">
                        {agent.description}
                      </p>
                    )}
                    <div className="flex justify-between">
                      <span>Provider</span>
                      <span className="font-medium text-foreground">
                        {agent.provider ?? "claude"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Model</span>
                      <span className="font-medium text-foreground">
                        {agent.model ?? "default"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Permission</span>
                      <span className="font-medium text-foreground">
                        {agent.permissionLevel ?? "standard"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>State</span>
                      <Badge variant={st?.state === "running" ? "default" : "secondary"} className="text-xs">
                        {st?.state ?? "unknown"}
                      </Badge>
                    </div>
                    {agent.bindings.length > 0 && (
                      <div className="flex justify-between">
                        <span>Adapters</span>
                        <span className="font-medium text-foreground">
                          {agent.bindings.join(", ")}
                        </span>
                      </div>
                    )}
                    {(st?.pending ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <span>Pending</span>
                        <Badge variant="outline" className="text-xs">
                          {st?.pending}
                        </Badge>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {agents.length === 0 && !error && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No agents registered yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Use <code className="bg-muted px-1 rounded">hiboss agent register</code> to add agents.
          </p>
        </div>
      )}
    </div>
  );
}
