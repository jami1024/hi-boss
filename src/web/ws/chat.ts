/**
 * WebSocket chat handler for real-time messaging.
 *
 * Protocol:
 *   Client → Server:
 *     { type: "auth", token: "..." }         - authenticate
 *     { type: "send", agentName: "...", text: "..." } - send message
 *     { type: "subscribe", agentName: "..." } - subscribe to agent updates
 *
 *   Server → Client:
 *     { type: "auth-ok" }                     - auth success
 *     { type: "auth-fail", message: "..." }   - auth failure
 *     { type: "envelope", envelope: {...} }   - new/updated envelope
 *     { type: "agent-status", agentName, status } - agent status change
 *     { type: "error", message: "..." }       - error
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { formatAgentAddress } from "../../adapters/types.js";
import { WEB_BOSS_ADDRESS } from "../handlers/envelopes.js";
import { logEvent } from "../../shared/daemon-log.js";
import type { Envelope } from "../../envelope/types.js";

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

    for (const client of this.clients) {
      if (client.authenticated && client.subscriptions.has(agentName)) {
        this.send(client, {
          type: "envelope",
          envelope: {
            id: envelope.id,
            from: envelope.from,
            to: envelope.to,
            fromBoss: envelope.fromBoss,
            text: envelope.content.text ?? "",
            status: envelope.status,
            createdAt: envelope.createdAt,
          },
        });
      }
    }
  }

  /**
   * Broadcast agent status update.
   */
  broadcastAgentStatus(agentName: string): void {
    const agent = this.daemon.db.getAgentByNameCaseInsensitive(agentName);
    if (!agent) return;

    const isBusy = this.daemon.executor.isAgentBusy(agent.name);
    const pendingCount = this.daemon.db.countDuePendingEnvelopesForAgent(agent.name);
    const lastRun = this.daemon.db.getLastFinishedAgentRun(agent.name);

    const status = {
      agentState: isBusy ? "running" : "idle",
      agentHealth: !lastRun ? "unknown" : lastRun.status === "failed" ? "error" : "ok",
      pendingCount,
    };

    for (const client of this.clients) {
      if (client.authenticated && client.subscriptions.has(agent.name)) {
        this.send(client, {
          type: "agent-status",
          agentName: agent.name,
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
        this.handleSend(client, msg.agentName ?? "", msg.text ?? "");
        break;
      case "subscribe":
        this.handleSubscribe(client, msg.agentName ?? "");
        break;
      case "unsubscribe":
        this.handleUnsubscribe(client, msg.agentName ?? "");
        break;
      default:
        this.send(client, { type: "error", message: `Unknown message type: ${(msg as any).type}` });
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

  private async handleSend(client: WsClient, agentName: string, text: string): Promise<void> {
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

    try {
      const envelope = await this.daemon.router.routeEnvelope({
        from: WEB_BOSS_ADDRESS,
        to: formatAgentAddress(agent.name),
        fromBoss: true,
        content: { text: text.trim() },
        metadata: { source: "web" },
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
