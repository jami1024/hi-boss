import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getChatSocketState,
  registerChatSocketListener,
  sendChatSocketMessage,
} from "@/lib/chat-websocket-manager";

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  text: string;
  status: string;
  createdAt: number;
  clientMessageId?: string;
}

export interface AgentWsStatus {
  agentState: "running" | "idle";
  agentHealth: "ok" | "error" | "unknown";
  pendingCount: number;
  currentRun?: {
    id: string;
    startedAt: number;
    sessionTarget?: string;
    projectId?: string;
  };
}

interface UseWebSocketOptions {
  agentName?: string;
  agentNames?: string[];
  enabled?: boolean;
  onMessage?: (msg: ChatMessage) => void;
  onStatusUpdate?: (status: AgentWsStatus) => void;
  onAgentStatusUpdate?: (agentName: string, status: AgentWsStatus) => void;
  onError?: (error: string) => void;
}

export function useWebSocket({
  agentName,
  agentNames,
  enabled = true,
  onMessage,
  onStatusUpdate,
  onAgentStatusUpdate,
  onError,
}: UseWebSocketOptions) {
  const normalizedPrimaryAgentName = (agentName ?? "").trim();
  const subscriptionKey = useMemo(() => {
    const normalized = (agentNames ?? [])
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const unique = [...new Set(normalized)].sort();
    if (unique.length > 0) {
      return unique.join("\u001f");
    }
    return normalizedPrimaryAgentName;
  }, [agentNames, normalizedPrimaryAgentName]);

  const getSubscriptionTargets = useCallback((): string[] => {
    return subscriptionKey ? subscriptionKey.split("\u001f") : [];
  }, [subscriptionKey]);

  const initialStateRef = useRef(getChatSocketState());
  const [connected, setConnected] = useState(initialStateRef.current.connected);
  const [authenticated, setAuthenticated] = useState(initialStateRef.current.authenticated);

  const sendMessage = useCallback((text: string, clientMessageId?: string): boolean => {
    if (!normalizedPrimaryAgentName) return false;
    if (!authenticated) return false;
    return sendChatSocketMessage(normalizedPrimaryAgentName, text, clientMessageId);
  }, [normalizedPrimaryAgentName, authenticated]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setAuthenticated(false);
      return;
    }

    return registerChatSocketListener({
      enabled,
      subscriptions: getSubscriptionTargets(),
      onMessage,
      onStatusUpdate,
      onAgentStatusUpdate,
      onError,
      onConnectionChange: (nextConnected, nextAuthenticated) => {
        setConnected(nextConnected);
        setAuthenticated(nextAuthenticated);
      },
    });

  }, [
    enabled,
    getSubscriptionTargets,
    onMessage,
    onStatusUpdate,
    onAgentStatusUpdate,
    onError,
  ]);

  return { connected, authenticated, sendMessage };
}
