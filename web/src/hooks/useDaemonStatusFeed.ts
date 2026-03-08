import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type DaemonStatus } from "@/api/client";
import { useWebSocket, type AgentWsStatus } from "@/hooks/useWebSocket";
import { mergeAgentWsStatusIntoDaemonStatus } from "@/lib/daemon-status-feed";

interface UseDaemonStatusFeedOptions {
  pollMs?: number;
  agentNamesOverride?: string[];
  websocketEnabled?: boolean;
}

export function useDaemonStatusFeed(options: UseDaemonStatusFeedOptions = {}) {
  const { pollMs = 5000, agentNamesOverride, websocketEnabled = true } = options;
  const [status, setStatus] = useState<DaemonStatus | null>(null);
  const [error, setError] = useState("");

  const subscribedAgentNames = useMemo(() => {
    const source =
      agentNamesOverride && agentNamesOverride.length > 0
        ? agentNamesOverride
        : status?.agents.map((agent) => agent.name) ?? [];
    return [...new Set(source.map((name) => name.trim()).filter((name) => name.length > 0))];
  }, [agentNamesOverride, status]);

  const mergeAgentStatus = useCallback((agentName: string, agentStatus: AgentWsStatus) => {
    setStatus((prev) => mergeAgentWsStatusIntoDaemonStatus(prev, agentName, agentStatus));
  }, []);

  const { connected, authenticated } = useWebSocket({
    agentNames: subscribedAgentNames,
    enabled: websocketEnabled,
    onAgentStatusUpdate: mergeAgentStatus,
  });

  const reload = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    const interval = setInterval(() => {
      void reload();
    }, pollMs);
    return () => clearInterval(interval);
  }, [pollMs, reload]);

  return {
    status,
    error,
    connected,
    authenticated,
    reload,
    mergeAgentStatus,
  };
}
