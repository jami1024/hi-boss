/**
 * Project management API handlers for the web UI.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";

export function createProjectHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  /**
   * GET /api/v1/projects?limit=50
   */
  const listProjects: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const limit = Math.min(parseInt(ctx.query.limit ?? "50", 10) || 50, 200);
    const projects = daemon.db.listProjects({ limit });

    sendJson(ctx.res, 200, { projects });
  };

  /**
   * GET /api/v1/projects/:id
   */
  const getProject: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    sendJson(ctx.res, 200, { project });
  };

  /**
   * PUT /api/v1/projects/:id
   *
   * Update project fields: name, root, speakerAgent, mainGroupChannel.
   */
  const updateProject: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    const existing = daemon.db.getProjectById(id);
    if (!existing) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const name = typeof body.name === "string" ? body.name.trim() : existing.name;
    const root = typeof body.root === "string" ? body.root.trim() : existing.root;
    const speakerAgent = typeof body.speakerAgent === "string"
      ? body.speakerAgent.trim()
      : existing.speakerAgent;
    const mainGroupChannel = typeof body.mainGroupChannel === "string"
      ? body.mainGroupChannel.trim() || undefined
      : body.mainGroupChannel === null
        ? undefined
        : existing.mainGroupChannel;

    if (!name) {
      sendJson(ctx.res, 400, { error: "name is required" });
      return;
    }
    if (!root) {
      sendJson(ctx.res, 400, { error: "root is required" });
      return;
    }
    if (!speakerAgent) {
      sendJson(ctx.res, 400, { error: "speakerAgent is required" });
      return;
    }

    // Verify speaker agent exists
    const agent = daemon.db.getAgentByNameCaseInsensitive(speakerAgent);
    if (!agent) {
      sendJson(ctx.res, 400, { error: `Speaker agent '${speakerAgent}' not found` });
      return;
    }

    const updated = daemon.db.upsertProject({
      id,
      name,
      root,
      speakerAgent: agent.name,
      mainGroupChannel,
    });

    sendJson(ctx.res, 200, { project: updated });
  };

  /**
   * POST /api/v1/projects/:id/leaders
   *
   * Add or update a project leader.
   * Body: { agentName, capabilities?, active? }
   */
  const upsertLeader: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "agentName is required" });
      return;
    }

    // Verify agent exists
    const agent = daemon.db.getAgentByNameCaseInsensitive(agentName);
    if (!agent) {
      sendJson(ctx.res, 400, { error: `Agent '${agentName}' not found` });
      return;
    }

    const capabilities = Array.isArray(body.capabilities)
      ? (body.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    const active = body.active !== false;

    const leader = daemon.db.upsertProjectLeader({
      projectId: id,
      agentName: agent.name,
      capabilities,
      active,
    });

    sendJson(ctx.res, 200, { leader });
  };

  /**
   * PUT /api/v1/projects/:id/leaders/:agentName
   *
   * Update a leader's capabilities or active status.
   */
  const updateLeader: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const agentName = ctx.params.agentName;
    if (!id || !agentName) {
      sendJson(ctx.res, 400, { error: "Project ID and agent name required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const capabilities = Array.isArray(body.capabilities)
      ? (body.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
      : undefined;
    const active = typeof body.active === "boolean" ? body.active : undefined;

    const leader = daemon.db.upsertProjectLeader({
      projectId: id,
      agentName,
      ...(capabilities ? { capabilities } : {}),
      ...(active !== undefined ? { active } : {}),
    });

    sendJson(ctx.res, 200, { leader });
  };

  /**
   * POST /api/v1/projects/:id/select-leader
   *
   * Select the best available leader for a task.
   * Body: { requiredCapabilities?: string[] }
   */
  const selectLeader: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Project ID required" });
      return;
    }

    try {
      const result = await daemon.rpcHandlers["project.select-leader"]!({
        token,
        projectId: id,
        ...(ctx.body && typeof ctx.body === "object" ? ctx.body as Record<string, unknown> : {}),
      });
      sendJson(ctx.res, 200, result);
    } catch (err) {
      const error = err as Error & { code?: number };
      const status = error.code === -32002 ? 404 : error.code === -32602 ? 400 : 500;
      sendJson(ctx.res, status, { error: error.message });
    }
  };

  return {
    listProjects,
    getProject,
    updateProject,
    upsertLeader,
    updateLeader,
    selectLeader,
  };
}
