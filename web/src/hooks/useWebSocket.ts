import { useEffect, useRef, useCallback, useState } from "react";
import { hasToken } from "@/api/client";

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  text: string;
  status: string;
  createdAt: number;
}

export interface AgentWsStatus {
  agentState: "running" | "idle";
  agentHealth: "ok" | "error" | "unknown";
  pendingCount: number;
}

interface WsServerMessage {
  type: "auth-ok" | "auth-fail" | "envelope" | "agent-status" | "error";
  envelope?: ChatMessage;
  agentName?: string;
  status?: AgentWsStatus;
  message?: string;
}

interface UseWebSocketOptions {
  agentName: string;
  onMessage?: (msg: ChatMessage) => void;
  onStatusUpdate?: (status: AgentWsStatus) => void;
  onError?: (error: string) => void;
}

export function useWebSocket({
  agentName,
  onMessage,
  onStatusUpdate,
  onError,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!hasToken() || !mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected(true);
      // Authenticate
      const token = localStorage.getItem("hiboss_token") ?? "";
      ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data) as WsServerMessage;

        switch (msg.type) {
          case "auth-ok":
            setAuthenticated(true);
            // Subscribe to agent
            ws.send(JSON.stringify({ type: "subscribe", agentName }));
            break;
          case "auth-fail":
            onError?.(msg.message ?? "Authentication failed");
            break;
          case "envelope":
            if (msg.envelope) {
              onMessage?.(msg.envelope);
            }
            break;
          case "agent-status":
            if (msg.status) {
              onStatusUpdate?.(msg.status);
            }
            break;
          case "error":
            onError?.(msg.message ?? "Unknown error");
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      setAuthenticated(false);
      // Reconnect after 3s
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, 3000);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }, [agentName, onMessage, onStatusUpdate, onError]);

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticated) {
      wsRef.current.send(JSON.stringify({
        type: "send",
        agentName,
        text,
      }));
    }
  }, [agentName, authenticated]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, authenticated, sendMessage };
}
