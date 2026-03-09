interface ChatMessage {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  text: string;
  status: string;
  createdAt: number;
  clientMessageId?: string;
}

interface AgentWsStatus {
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

interface WsServerMessage {
  type: "auth-ok" | "auth-fail" | "envelope" | "agent-status" | "error";
  envelope?: ChatMessage;
  agentName?: string;
  status?: AgentWsStatus;
  message?: string;
}

interface ChatSocketListener {
  enabled: boolean;
  subscriptions: string[];
  onMessage?: (msg: ChatMessage) => void;
  onStatusUpdate?: (status: AgentWsStatus) => void;
  onAgentStatusUpdate?: (agentName: string, status: AgentWsStatus) => void;
  onError?: (error: string) => void;
  onConnectionChange?: (connected: boolean, authenticated: boolean) => void;
}

export interface RegisterChatSocketListenerParams {
  enabled: boolean;
  subscriptions: string[];
  onMessage?: (msg: ChatMessage) => void;
  onStatusUpdate?: (status: AgentWsStatus) => void;
  onAgentStatusUpdate?: (agentName: string, status: AgentWsStatus) => void;
  onError?: (error: string) => void;
  onConnectionChange?: (connected: boolean, authenticated: boolean) => void;
}

function normalizeSubscriptions(subscriptions: string[]): string[] {
  return [...new Set(subscriptions.map((name) => name.trim()).filter((name) => name.length > 0))].sort();
}

function getAgentNameFromAddress(address: string): string | null {
  return address.startsWith("agent:") ? address.slice("agent:".length) : null;
}

class ChatWebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<number, ChatSocketListener>();
  private nextListenerId = 1;
  private connected = false;
  private authenticated = false;
  private readonly serverSubscriptions = new Set<string>();

  getState(): { connected: boolean; authenticated: boolean } {
    return {
      connected: this.connected,
      authenticated: this.authenticated,
    };
  }

  register(params: RegisterChatSocketListenerParams): () => void {
    const listenerId = this.nextListenerId;
    this.nextListenerId += 1;

    this.listeners.set(listenerId, {
      enabled: params.enabled,
      subscriptions: normalizeSubscriptions(params.subscriptions),
      onMessage: params.onMessage,
      onStatusUpdate: params.onStatusUpdate,
      onAgentStatusUpdate: params.onAgentStatusUpdate,
      onError: params.onError,
      onConnectionChange: params.onConnectionChange,
    });

    params.onConnectionChange?.(this.connected, this.authenticated);
    this.syncConnection();

    return () => {
      this.listeners.delete(listenerId);
      this.syncConnection();
    };
  }

  sendMessage(agentName: string, text: string, clientMessageId?: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return false;
    this.ws.send(JSON.stringify({ type: "send", agentName, text, clientMessageId }));
    return true;
  }

  private hasActiveListeners(): boolean {
    for (const listener of this.listeners.values()) {
      if (listener.enabled) return true;
    }
    return false;
  }

  private getDesiredSubscriptions(): string[] {
    const names = new Set<string>();
    for (const listener of this.listeners.values()) {
      if (!listener.enabled) continue;
      for (const name of listener.subscriptions) {
        names.add(name);
      }
    }
    return [...names].sort();
  }

  private notifyConnectionState(): void {
    for (const listener of this.listeners.values()) {
      listener.onConnectionChange?.(this.connected, this.authenticated);
    }
  }

  private notifyError(message: string): void {
    for (const listener of this.listeners.values()) {
      if (!listener.enabled) continue;
      listener.onError?.(message);
    }
  }

  private dispatchEnvelope(envelope: ChatMessage): void {
    const fromAgent = getAgentNameFromAddress(envelope.from);
    const toAgent = getAgentNameFromAddress(envelope.to);

    for (const listener of this.listeners.values()) {
      if (!listener.enabled || !listener.onMessage) continue;
      const matches = listener.subscriptions.some((name) => name === fromAgent || name === toAgent);
      if (!matches) continue;
      listener.onMessage(envelope);
    }
  }

  private dispatchAgentStatus(agentName: string, status: AgentWsStatus): void {
    for (const listener of this.listeners.values()) {
      if (!listener.enabled) continue;
      if (!listener.subscriptions.includes(agentName)) continue;
      listener.onAgentStatusUpdate?.(agentName, status);
      listener.onStatusUpdate?.(status);
    }
  }

  private syncConnection(): void {
    const hasToken = (localStorage.getItem("hiboss_token") ?? "").trim().length > 0;
    if (!this.hasActiveListeners() || !hasToken) {
      this.disconnect();
      return;
    }

    if (!this.ws) {
      this.connect();
      return;
    }

    if (this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      this.syncSubscriptions();
    }
  }

  private connect(): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.notifyConnectionState();
      const token = localStorage.getItem("hiboss_token") ?? "";
      ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (event) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(event.data) as WsServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "auth-ok":
          this.authenticated = true;
          this.serverSubscriptions.clear();
          this.notifyConnectionState();
          this.syncSubscriptions();
          break;
        case "auth-fail":
          this.notifyError(msg.message ?? "Authentication failed");
          break;
        case "envelope":
          if (msg.envelope) {
            this.dispatchEnvelope(msg.envelope);
          }
          break;
        case "agent-status":
          if (msg.agentName && msg.status) {
            this.dispatchAgentStatus(msg.agentName, msg.status);
          }
          break;
        case "error":
          this.notifyError(msg.message ?? "Unknown error");
          break;
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.connected = false;
      this.authenticated = false;
      this.serverSubscriptions.clear();
      this.notifyConnectionState();
      this.scheduleReconnect();
    };

    ws.onerror = () => undefined;
  }

  private syncSubscriptions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return;
    const desired = new Set(this.getDesiredSubscriptions());

    for (const current of this.serverSubscriptions) {
      if (desired.has(current)) continue;
      this.ws.send(JSON.stringify({ type: "unsubscribe", agentName: current }));
      this.serverSubscriptions.delete(current);
    }

    for (const target of desired) {
      if (this.serverSubscriptions.has(target)) continue;
      this.ws.send(JSON.stringify({ type: "subscribe", agentName: target }));
      this.serverSubscriptions.add(target);
    }
  }

  private disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.connected || this.authenticated) {
      this.connected = false;
      this.authenticated = false;
      this.serverSubscriptions.clear();
      this.notifyConnectionState();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    const hasToken = (localStorage.getItem("hiboss_token") ?? "").trim().length > 0;
    if (!this.hasActiveListeners() || !hasToken) return;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.syncConnection();
    }, 3000);
  }
}

const manager = new ChatWebSocketManager();

export function registerChatSocketListener(params: RegisterChatSocketListenerParams): () => void {
  return manager.register(params);
}

export function sendChatSocketMessage(agentName: string, text: string, clientMessageId?: string): boolean {
  return manager.sendMessage(agentName, text, clientMessageId);
}

export function getChatSocketState(): { connected: boolean; authenticated: boolean } {
  return manager.getState();
}
