/**
 * Agent management API handlers.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";

function agentSummary(agent: any, bindings: string[]) {
  return {
    name: agent.name,
    role: agent.metadata?.role ?? null,
    description: agent.description ?? null,
    workspace: agent.workspace ?? null,
    provider: agent.provider ?? null,
    model: agent.model ?? null,
    reasoningEffort: agent.reasoningEffort ?? null,
    permissionLevel: agent.permissionLevel ?? null,
    sessionPolicy: agent.sessionPolicy ?? null,
    createdAt: agent.createdAt,
    lastSeenAt: agent.lastSeenAt ?? null,
    bindings,
  };
}

export function createAgentHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  const listAgents: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agents = daemon.db.listAgents();
    const bindings = daemon.db.listBindings();

    const bindingsByAgent = new Map<string, string[]>();
    for (const b of bindings) {
      const list = bindingsByAgent.get(b.agentName) ?? [];
      list.push(b.adapterType);
      bindingsByAgent.set(b.agentName, list);
    }

    sendJson(ctx.res, 200, {
      agents: agents.map((a) => agentSummary(a, bindingsByAgent.get(a.name) ?? [])),
    });
  };

  const getAgentStatus: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    const agent = daemon.db.getAgentByNameCaseInsensitive(agentName);
    if (!agent) {
      sendJson(ctx.res, 404, { error: "Agent not found" });
      return;
    }

    const isBusy = daemon.executor.isAgentBusy(agent.name);
    const pendingCount = daemon.db.countDuePendingEnvelopesForAgent(agent.name);
    const agentBindings = daemon.db.getBindingsByAgentName(agent.name).map((b) => b.adapterType);
    const currentRun = isBusy ? daemon.db.getCurrentRunningAgentRun(agent.name) : null;
    const lastRun = daemon.db.getLastFinishedAgentRun(agent.name);

    sendJson(ctx.res, 200, {
      agent: agentSummary(agent, agentBindings),
      bindings: agentBindings,
      status: {
        agentState: isBusy ? "running" : "idle",
        agentHealth: !lastRun ? "unknown" : lastRun.status === "failed" ? "error" : "ok",
        pendingCount,
        currentRun: currentRun ? { id: currentRun.id, startedAt: currentRun.startedAt } : null,
        lastRun: lastRun ? {
          id: lastRun.id,
          startedAt: lastRun.startedAt,
          completedAt: lastRun.completedAt ?? null,
          status: lastRun.status === "failed" ? "failed"
            : lastRun.status === "cancelled" ? "cancelled" : "completed",
          error: lastRun.error ?? null,
          contextLength: lastRun.contextLength ?? null,
        } : null,
      },
    });
  };

  const updateAgent: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    // Forward to agent.set RPC handler via daemon's RPC registry
    const rpcParams: Record<string, unknown> = {
      token,
      agentName,
      ...body,
    };

    try {
      const result = await daemon.rpcHandlers["agent.set"]!(rpcParams);
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      const status = error.code === -32001 ? 401
        : error.code === -32002 ? 404
        : error.code === -32003 ? 409
        : error.code === -32602 ? 400
        : 500;
      sendJson(ctx.res, status, { error: error.message });
    }
  };

  const deleteAgent: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    try {
      const result = await daemon.rpcHandlers["agent.delete"]!({ token, agentName });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      const status = error.code === -32002 ? 404 : 500;
      sendJson(ctx.res, status, { error: error.message });
    }
  };

  const refreshAgent: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    try {
      const result = await daemon.rpcHandlers["agent.refresh"]!({ token, agentName });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      const status = error.code === -32002 ? 404 : 500;
      sendJson(ctx.res, status, { error: error.message });
    }
  };

  const abortAgent: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    try {
      const result = await daemon.rpcHandlers["agent.abort"]!({ token, agentName });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      const status = error.code === -32002 ? 404 : 500;
      sendJson(ctx.res, status, { error: error.message });
    }
  };

  return { listAgents, getAgentStatus, updateAgent, deleteAgent, refreshAgent, abortAgent };
}
