/**
 * WebSocket chat handler for real-time messaging.
 *
 * Protocol:
 *   Client → Server:
 *     { type: "auth", token: "..." }         - authenticate
 *     { type: "send", agentName: "...", text: "...", clientMessageId?: "..." } - send message
 *     { type: "subscribe", agentName: "..." } - subscribe to agent updates
 *
 *   Server → Client:
 *     { type: "auth-ok" }                     - auth success
 *     { type: "auth-fail", message: "..." }   - auth failure
 *     { type: "envelope", envelope: {...} }   - new/updated envelope
 *     { type: "agent-status", agentName, status } - agent status change
 *     { type: "error", message: "..." }       - error
 */

import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { formatAgentAddress } from "../../adapters/types.js";
import { resolveSessionRefreshTargetForAgent } from "../../agent/executor.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import type { Envelope } from "../../envelope/types.js";
import { logEvent } from "../../shared/daemon-log.js";
import { validateDirectChatTarget } from "../direct-chat-policy.js";
import { WEB_BOSS_ADDRESS } from "../handlers/envelopes.js";
import { computeAgentHealth } from "../../shared/agent-health.js";

interface WsClient {
  ws: WebSocket;
  authenticated: boolean;
  subscriptions: Set<string>; // agent names
}

interface WsClientMessage {
  type: "auth" | "send" | "subscribe" | "unsubscribe";
  token?: string;
  agentName?: string;
  text?: string;
  clientMessageId?: string;
  conversationId?: string;
}

function parseProjectIdFromSessionTarget(agentName: string, sessionTarget: string): string | undefined {
  const prefix = `${agentName}:`;
  if (!sessionTarget.startsWith(prefix)) return undefined;
  const projectId = sessionTarget.slice(prefix.length).trim();
  return projectId.length > 0 ? projectId : undefined;
}

function readClientMessageIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata.clientMessageId;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export interface AgentWsStatusPayload {
  agentState: "running" | "idle";
  agentHealth: "ok" | "degraded" | "error" | "unknown";
  pendingCount: number;
  currentRun?: {
    id: string;
    startedAt: number;
    sessionTarget?: string;
    projectId?: string;
  };
}

function readConversationIdFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  const raw = metadata.conversationId;
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export interface WsEnvelopePayload {
  id: string;
  from: string;
  to: string;
  fromBoss: boolean;
  text: string;
  status: string;
  createdAt: number;
  clientMessageId?: string;
  conversationId?: string;
  permissionEscalatable?: boolean;
  replyToEnvelopeId?: string;
}

export function buildWsEnvelopePayload(envelope: Envelope): WsEnvelopePayload {
  const md = envelope.metadata as Record<string, unknown> | undefined;
  const clientMessageId = readClientMessageIdFromMetadata(md);
  const conversationId = readConversationIdFromMetadata(md);
  const permissionEscalatable = md?.permissionEscalatable === true;
  const replyToEnvelopeId = typeof md?.replyToEnvelopeId === "string" ? md.replyToEnvelopeId : undefined;
  return {
    id: envelope.id,
    from: envelope.from,
    to: envelope.to,
    fromBoss: envelope.fromBoss,
    text: envelope.content.text ?? "",
    status: envelope.status,
    createdAt: envelope.createdAt,
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(permissionEscalatable ? { permissionEscalatable: true } : {}),
    ...(replyToEnvelopeId ? { replyToEnvelopeId } : {}),
  };
}

export function buildAgentWsStatus(params: {
  daemon: DaemonContext;
  agentName: string;
}): AgentWsStatusPayload | null {
  const agent = params.daemon.db.getAgentByNameCaseInsensitive(params.agentName);
  if (!agent) return null;

  const isBusy = params.daemon.executor.isAgentBusy(agent.name);
  const pendingCount = params.daemon.db.countDuePendingEnvelopesForAgent(agent.name);
  const recentRuns = params.daemon.db.getRecentFinishedAgentRuns(agent.name, 5);
  const healthResetAt = typeof agent.metadata?.healthResetAt === "number" ? agent.metadata.healthResetAt : undefined;
  const currentRun = isBusy ? params.daemon.db.getCurrentRunningAgentRun(agent.name) : null;
  const sessionTarget = currentRun
    ? resolveSessionRefreshTargetForAgent({ db: params.daemon.db, agentName: agent.name })
    : undefined;
  const projectId = sessionTarget
    ? parseProjectIdFromSessionTarget(agent.name, sessionTarget)
    : undefined;

  return {
    agentState: isBusy ? "running" : "idle",
    agentHealth: computeAgentHealth(recentRuns, healthResetAt),
    pendingCount,
    ...(currentRun
      ? {
        currentRun: {
          id: currentRun.id,
          startedAt: currentRun.startedAt,
          ...(sessionTarget ? { sessionTarget } : {}),
          ...(projectId ? { projectId } : {}),
        },
      }
      : {}),
  };
}

export class ChatWebSocket {
  private wss: WebSocketServer | null = null;
  private clients: Set<WsClient> = new Set();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  /** Track last known envelope per agent for polling. */
  private lastEnvelopeTimestamp: Map<string, number> = new Map();

  constructor(private daemon: DaemonContext) {}

  /**
   * Attach to an existing HTTP server.
   */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: "/ws/chat" });

    this.wss.on("connection", (ws) => {
      const client: WsClient = {
        ws,
        authenticated: false,
        subscriptions: new Set(),
      };
      this.clients.add(client);

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as WsClientMessage;
          this.handleMessage(client, msg);
        } catch {
          this.send(client, { type: "error", message: "Invalid JSON" });
        }
      });

      ws.on("close", () => {
        this.clients.delete(client);
      });

      ws.on("error", () => {
        this.clients.delete(client);
      });
    });

    // Poll for new envelopes destined for web:boss
    this.pollInterval = setInterval(() => this.pollNewEnvelopes(), 2000);
  }

  /**
   * Shut down the WebSocket server.
   */
  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    for (const client of this.clients) {
      client.ws.close();
    }
    this.clients.clear();

    return new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Broadcast a new envelope to subscribed clients.
   */
  broadcastEnvelope(envelope: Envelope): void {
    const agentName = this.extractAgentName(envelope);
    if (!agentName) return;
    const payload = buildWsEnvelopePayload(envelope);

    for (const client of this.clients) {
      if (client.authenticated && client.subscriptions.has(agentName)) {
        this.send(client, {
          type: "envelope",
          envelope: payload,
        });
      }
    }
  }

  /**
   * Broadcast agent status update.
   */
  broadcastAgentStatus(agentName: string): void {
    const status = buildAgentWsStatus({
      daemon: this.daemon,
      agentName,
    });
    if (!status) return;

    for (const client of this.clients) {
      if (client.authenticated && client.subscriptions.has(agentName)) {
        this.send(client, {
          type: "agent-status",
          agentName,
          status,
        });
      }
    }
  }

  private handleMessage(client: WsClient, msg: WsClientMessage): void {
    switch (msg.type) {
      case "auth":
        this.handleAuth(client, msg.token ?? "");
        break;
      case "send":
        this.handleSend(client, msg.agentName ?? "", msg.text ?? "", msg.clientMessageId ?? "", msg.conversationId ?? "");
        break;
      case "subscribe":
        this.handleSubscribe(client, msg.agentName ?? "");
        break;
      case "unsubscribe":
        this.handleUnsubscribe(client, msg.agentName ?? "");
        break;
      default:
        this.send(client, {
          type: "error",
          message: `Unknown message type: ${String((msg as { type?: unknown }).type ?? "")}`,
        });
    }
  }

  private handleAuth(client: WsClient, token: string): void {
    if (!token.trim()) {
      this.send(client, { type: "auth-fail", message: "Token required" });
      return;
    }

    try {
      const principal = this.daemon.resolvePrincipal(token.trim());
      if (principal.kind !== "boss") {
        this.send(client, { type: "auth-fail", message: "Boss token required" });
        return;
      }
      client.authenticated = true;
      this.send(client, { type: "auth-ok" });
    } catch {
      this.send(client, { type: "auth-fail", message: "Invalid token" });
    }
  }

  private async handleSend(
    client: WsClient,
    agentName: string,
    text: string,
    clientMessageIdRaw: string,
    conversationIdRaw: string
  ): Promise<void> {
    if (!client.authenticated) {
      this.send(client, { type: "error", message: "Not authenticated" });
      return;
    }

    if (!agentName.trim()) {
      this.send(client, { type: "error", message: "agentName required" });
      return;
    }

    if (!text.trim()) {
      this.send(client, { type: "error", message: "text required" });
      return;
    }

    const agent = this.daemon.db.getAgentByNameCaseInsensitive(agentName.trim());
    if (!agent) {
      this.send(client, { type: "error", message: "Agent not found" });
      return;
    }

    const validationError = validateDirectChatTarget(this.daemon.db, agent);
    if (validationError) {
      this.send(client, { type: "error", message: validationError });
      return;
    }

    try {
      const clientMessageId = clientMessageIdRaw.trim();
      const conversationId = conversationIdRaw.trim();
      const envelope = await this.daemon.router.routeEnvelope({
        from: WEB_BOSS_ADDRESS,
        to: formatAgentAddress(agent.name),
        fromBoss: true,
        content: { text: text.trim() },
        metadata: {
          source: "web",
          ...(clientMessageId ? { clientMessageId } : {}),
          ...(conversationId ? { conversationId } : {}),
        },
      });

      this.daemon.scheduler.onEnvelopeCreated(envelope);

      // Broadcast to all subscribed clients
      this.broadcastEnvelope(envelope);

      logEvent("info", "web-chat-send", {
        "agent-name": agent.name,
        "envelope-id": envelope.id,
      });
    } catch (err) {
      this.send(client, {
        type: "error",
        message: `Send failed: ${(err as Error).message}`,
      });
    }
  }

  private handleSubscribe(client: WsClient, agentName: string): void {
    if (!client.authenticated) {
      this.send(client, { type: "error", message: "Not authenticated" });
      return;
    }

    if (!agentName.trim()) {
      this.send(client, { type: "error", message: "agentName required" });
      return;
    }

    const agent = this.daemon.db.getAgentByNameCaseInsensitive(agentName.trim());
    if (!agent) {
      this.send(client, { type: "error", message: "Agent not found" });
      return;
    }

    client.subscriptions.add(agent.name);

    // Send current status immediately
    this.broadcastAgentStatus(agent.name);
  }

  private handleUnsubscribe(client: WsClient, agentName: string): void {
    if (agentName.trim()) {
      client.subscriptions.delete(agentName.trim());
    }
  }

  /**
   * Poll for new envelopes from agents to web:boss.
   * This catches agent replies that the router doesn't push to us directly.
   */
  private pollNewEnvelopes(): void {
    // Collect all subscribed agent names across all clients
    const subscribedAgents = new Set<string>();
    for (const client of this.clients) {
      if (client.authenticated) {
        for (const name of client.subscriptions) {
          subscribedAgents.add(name);
        }
      }
    }

    for (const agentName of subscribedAgents) {
      const agentAddr = formatAgentAddress(agentName);
      const lastTs = this.lastEnvelopeTimestamp.get(agentName) ?? 0;

      // Check for new envelopes from agent → web:boss
      const envelopes = this.daemon.db.listEnvelopesByRoute({
        from: agentAddr,
        to: WEB_BOSS_ADDRESS,
        status: "done",
        limit: 10,
        createdAfter: lastTs > 0 ? lastTs + 1 : undefined,
      });

      for (const env of envelopes) {
        this.broadcastEnvelope(env);
        const ts = this.lastEnvelopeTimestamp.get(agentName) ?? 0;
        if (env.createdAt > ts) {
          this.lastEnvelopeTimestamp.set(agentName, env.createdAt);
        }
      }

      // Also broadcast agent status updates
      this.broadcastAgentStatus(agentName);
    }
  }

  private extractAgentName(envelope: Envelope): string | null {
    // Boss → Agent
    if (envelope.from === WEB_BOSS_ADDRESS && envelope.to.startsWith("agent:")) {
      return envelope.to.slice(6);
    }
    // Agent → Boss
    if (envelope.to === WEB_BOSS_ADDRESS && envelope.from.startsWith("agent:")) {
      return envelope.from.slice(6);
    }
    return null;
  }

  private send(client: WsClient, data: unknown): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }
}
