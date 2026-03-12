/**
 * Agent management API handlers.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { resolveSessionRefreshTargetForAgent } from "../../agent/executor.js";
import { computeAgentHealth } from "../../shared/agent-health.js";
import { generateSystemInstructions } from "../../agent/instruction-generator.js";
import { getAgentDir } from "../../agent/home-setup.js";

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

function parseProjectIdFromSessionTarget(agentName: string, sessionTarget: string): string | undefined {
  const prefix = `${agentName}:`;
  if (!sessionTarget.startsWith(prefix)) return undefined;
  const projectId = sessionTarget.slice(prefix.length).trim();
  return projectId.length > 0 ? projectId : undefined;
}

export function createAgentHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  const rpcErrorToHttpStatus = (code?: number): number =>
    code === -32001 ? 401 : code === -32002 ? 404 : code === -32003 ? 409 : code === -32602 ? 400 : 500;

  const rpcErrorPayload = (error: Error & { code?: number; data?: unknown }) => {
    const data =
      error.data && typeof error.data === "object"
        ? (error.data as Record<string, unknown>)
        : undefined;
    const errorCode = typeof data?.errorCode === "string" ? data.errorCode : undefined;
    const hint = typeof data?.hint === "string" ? data.hint : undefined;
    return {
      error: error.message,
      ...(errorCode ? { errorCode } : {}),
      ...(hint ? { hint } : {}),
    };
  };

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
    const recentRuns = daemon.db.getRecentFinishedAgentRuns(agent.name, 5);
    const healthResetAt = typeof agent.metadata?.healthResetAt === "number" ? agent.metadata.healthResetAt : undefined;
    const currentRun = isBusy ? daemon.db.getCurrentRunningAgentRun(agent.name) : null;
    const lastRun = recentRuns[0] ?? null;
    const currentSessionTarget = currentRun
      ? resolveSessionRefreshTargetForAgent({ db: daemon.db, agentName: agent.name })
      : undefined;
    const currentProjectId = currentSessionTarget
      ? parseProjectIdFromSessionTarget(agent.name, currentSessionTarget)
      : undefined;

    sendJson(ctx.res, 200, {
      agent: agentSummary(agent, agentBindings),
      bindings: agentBindings,
      status: {
        agentState: isBusy ? "running" : "idle",
        agentHealth: computeAgentHealth(recentRuns, healthResetAt),
        pendingCount,
        currentRun: currentRun
          ? {
            id: currentRun.id,
            startedAt: currentRun.startedAt,
            ...(currentSessionTarget ? { sessionTarget: currentSessionTarget } : {}),
            ...(currentProjectId ? { projectId: currentProjectId } : {}),
          }
          : null,
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

    const body = ctx.body as Record<string, unknown> | undefined;
    const projectId = body?.projectId;

    try {
      const result = await daemon.rpcHandlers["agent.refresh"]!({
        token,
        agentName,
        ...(projectId !== undefined ? { projectId } : {}),
      });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      const status = error.code === -32002 ? 404 : error.code === -32602 ? 400 : 500;
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

  const listRemoteSkills: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    try {
      const result = await daemon.rpcHandlers["skill.remote.list"]!({ token, agentName });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const addRemoteSkill: RouteHandler = async (ctx) => {
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

    const skillName = typeof body.skillName === "string" ? body.skillName : undefined;
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;
    const ref = typeof body.ref === "string" ? body.ref : undefined;

    try {
      const result = await daemon.rpcHandlers["skill.remote.add"]!({
        token,
        agentName,
        skillName,
        sourceUrl,
        ref,
      });
      sendJson(ctx.res, 201, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const updateRemoteSkill: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    const skillName = ctx.params.skillName;
    if (!agentName || !skillName) {
      sendJson(ctx.res, 400, { error: "Agent name and skill name required" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    const sourceUrl = body && typeof body.sourceUrl === "string" ? body.sourceUrl : undefined;
    const ref = body && typeof body.ref === "string" ? body.ref : undefined;

    try {
      const result = await daemon.rpcHandlers["skill.remote.update"]!({
        token,
        agentName,
        skillName,
        sourceUrl,
        ref,
      });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const removeRemoteSkill: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.name;
    const skillName = ctx.params.skillName;
    if (!agentName || !skillName) {
      sendJson(ctx.res, 400, { error: "Agent name and skill name required" });
      return;
    }

    try {
      const result = await daemon.rpcHandlers["skill.remote.remove"]!({
        token,
        agentName,
        skillName,
      });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      sendJson(
        ctx.res,
        rpcErrorToHttpStatus(error.code),
        rpcErrorPayload(error as Error & { code?: number; data?: unknown })
      );
    }
  };

  const getAgentPrompt: RouteHandler = async (ctx) => {
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

    const bindings = daemon.db.getBindingsByAgentName(agent.name);
    const bossName = daemon.db.getBossName();
    const bossTimezone = daemon.db.getBossTimezone();
    const adapterIds: Record<string, string> = {};
    for (const b of bindings) {
      const bossId = daemon.db.getAdapterBossId(b.adapterType);
      if (bossId) adapterIds[b.adapterType] = bossId;
    }

    try {
      const prompt = generateSystemInstructions({
        agent,
        agentToken: "(redacted)",
        bindings,
        hibossDir: daemon.config.dataDir,
        bossTimezone,
        boss: { name: bossName ?? undefined, adapterIds },
      });
      sendJson(ctx.res, 200, { agentName: agent.name, prompt });
    } catch (err) {
      sendJson(ctx.res, 500, { error: `Failed to render prompt: ${(err as Error).message}` });
    }
  };

  const getAgentSoul: RouteHandler = async (ctx) => {
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

    const soulPath = path.join(getAgentDir(agent.name, daemon.config.dataDir), "SOUL.md");
    let content = "";
    try {
      content = fs.readFileSync(soulPath, "utf-8");
    } catch {
      // File doesn't exist yet — return empty.
    }

    sendJson(ctx.res, 200, { agentName: agent.name, content });
  };

  const updateAgentSoul: RouteHandler = async (ctx) => {
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

    const body = ctx.body as { content?: string } | undefined;
    if (!body || typeof body.content !== "string") {
      sendJson(ctx.res, 400, { error: "content (string) is required" });
      return;
    }

    const agentDir = getAgentDir(agent.name, daemon.config.dataDir);
    fs.mkdirSync(agentDir, { recursive: true });
    const soulPath = path.join(agentDir, "SOUL.md");
    fs.writeFileSync(soulPath, body.content, "utf-8");

    sendJson(ctx.res, 200, { agentName: agent.name, content: body.content });
  };

  return {
    listAgents,
    getAgentStatus,
    updateAgent,
    deleteAgent,
    refreshAgent,
    abortAgent,
    listRemoteSkills,
    addRemoteSkill,
    updateRemoteSkill,
    removeRemoteSkill,
    getAgentPrompt,
    getAgentSoul,
    updateAgentSoul,
  };
}
