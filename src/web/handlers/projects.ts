/**
 * Project management API handlers for the web UI.
 */

import { formatAgentAddress } from "../../adapters/types.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { deriveProjectIdFromRoot } from "../../daemon/rpc/work-item-orchestration.js";
import {
  classifyProjectChatIntent,
} from "../../shared/project-intent.js";
import { isProjectTaskPriority, isProjectTaskState } from "../../shared/project-task.js";
import { requireBossToken } from "../middleware/auth.js";
import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { WEB_BOSS_ADDRESS } from "./envelopes.js";

export function createProjectHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  const normalizeTaskId = (raw: string | undefined): string | null => {
    if (!raw) return null;
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : null;
  };

  const parseLimit = (raw: string | undefined, fallback = 50, max = 100): number => {
    const parsed = parseInt(raw ?? `${fallback}`, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
  };

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
    if (agent.role !== "speaker") {
      sendJson(ctx.res, 400, { error: `Agent '${agent.name}' must have role 'speaker'` });
      return;
    }

    const hasLeaderConflict = daemon.db
      .listProjectLeaders(existing.id, { activeOnly: false })
      .some((leader) => leader.agentName === agent.name);
    if (hasLeaderConflict) {
      sendJson(ctx.res, 400, { error: `Agent '${agent.name}' is already a leader of project '${existing.id}'` });
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
    if (agent.role !== "leader") {
      sendJson(ctx.res, 400, { error: `Agent '${agent.name}' must have role 'leader'` });
      return;
    }
    if (agent.name === project.speakerAgent) {
      sendJson(ctx.res, 400, { error: `Agent '${agent.name}' cannot be both speaker and leader` });
      return;
    }

    const capabilities = Array.isArray(body.capabilities)
      ? (body.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    const hasAllowDispatchTo = Object.hasOwn(body, "allowDispatchTo");
    const allowDispatchTo = Array.isArray(body.allowDispatchTo)
      ? (body.allowDispatchTo as unknown[]).filter((value): value is string => typeof value === "string")
      : body.allowDispatchTo === null
        ? null
        : undefined;
    if (hasAllowDispatchTo && allowDispatchTo === undefined) {
      sendJson(ctx.res, 400, { error: "allowDispatchTo must be string[] or null" });
      return;
    }
    const active = body.active !== false;

    const leader = daemon.db.upsertProjectLeader({
      projectId: id,
      agentName: agent.name,
      capabilities,
      ...(hasAllowDispatchTo ? { allowDispatchTo } : {}),
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
    const hasAllowDispatchTo = Object.hasOwn(body, "allowDispatchTo");
    const allowDispatchTo = Array.isArray(body.allowDispatchTo)
      ? (body.allowDispatchTo as unknown[]).filter((value): value is string => typeof value === "string")
      : body.allowDispatchTo === null
        ? null
        : undefined;
    if (hasAllowDispatchTo && allowDispatchTo === undefined) {
      sendJson(ctx.res, 400, { error: "allowDispatchTo must be string[] or null" });
      return;
    }
    const active = typeof body.active === "boolean" ? body.active : undefined;

    const targetAgent = daemon.db.getAgentByNameCaseInsensitive(agentName.trim());
    if (!targetAgent) {
      sendJson(ctx.res, 400, { error: `Agent '${agentName}' not found` });
      return;
    }
    if (targetAgent.role !== "leader") {
      sendJson(ctx.res, 400, { error: `Agent '${targetAgent.name}' must have role 'leader'` });
      return;
    }
    if (targetAgent.name === project.speakerAgent) {
      sendJson(ctx.res, 400, { error: `Agent '${targetAgent.name}' cannot be both speaker and leader` });
      return;
    }

    const leader = daemon.db.upsertProjectLeader({
      projectId: id,
      agentName: targetAgent.name,
      ...(capabilities ? { capabilities } : {}),
      ...(hasAllowDispatchTo ? { allowDispatchTo } : {}),
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
      const selectLeaderHandler = daemon.rpcHandlers["project.select-leader"];
      if (!selectLeaderHandler) {
        sendJson(ctx.res, 500, { error: "project.select-leader handler is not available" });
        return;
      }

      const result = await selectLeaderHandler({
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

  /**
   * POST /api/v1/projects
   *
   * Create a new project.
   * Body: { name, root, speakerAgent, mainGroupChannel? }
   */
  const createProject: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const root = typeof body.root === "string" ? body.root.trim() : "";
    const speakerAgentName = typeof body.speakerAgent === "string" ? body.speakerAgent.trim() : "";
    const mainGroupChannel = typeof body.mainGroupChannel === "string"
      ? body.mainGroupChannel.trim() || undefined
      : undefined;

    if (!name) {
      sendJson(ctx.res, 400, { error: "name is required" });
      return;
    }
    if (!root) {
      sendJson(ctx.res, 400, { error: "root is required" });
      return;
    }
    if (!speakerAgentName) {
      sendJson(ctx.res, 400, { error: "speakerAgent is required" });
      return;
    }

    // Verify speaker agent exists
    const agent = daemon.db.getAgentByNameCaseInsensitive(speakerAgentName);
    if (!agent) {
      sendJson(ctx.res, 400, { error: `Speaker agent '${speakerAgentName}' not found` });
      return;
    }
    if (agent.role !== "speaker") {
      sendJson(ctx.res, 400, { error: `Agent '${agent.name}' must have role 'speaker'` });
      return;
    }

    const id = deriveProjectIdFromRoot(root);

    // Check if project already exists
    const existing = daemon.db.getProjectById(id);
    if (existing) {
      sendJson(ctx.res, 409, { error: `Project already exists for root '${root}'` });
      return;
    }

    const project = daemon.db.upsertProject({
      id,
      name,
      root,
      speakerAgent: agent.name,
      mainGroupChannel,
    });

    sendJson(ctx.res, 201, { project });
  };

  const sendProjectChatMessage: RouteHandler = async (ctx) => {
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

    const body = ctx.body as { text?: string } | undefined;
    const text = body?.text?.trim();
    if (!text) {
      sendJson(ctx.res, 400, { error: "text is required" });
      return;
    }

    const intentHint = classifyProjectChatIntent(text);

    const envelope = await daemon.router.routeEnvelope({
      from: WEB_BOSS_ADDRESS,
      to: formatAgentAddress(project.speakerAgent),
      fromBoss: true,
      content: { text },
      metadata: {
        source: "web",
        projectId: project.id,
        intentHint,
      },
    });

    daemon.scheduler.onEnvelopeCreated(envelope);
    sendJson(ctx.res, 200, {
      id: envelope.id,
      intentHint,
    });
  };

  const listProjectChatMessages: RouteHandler = async (ctx) => {
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

    const limit = parseLimit(ctx.query.limit, 50, 100);
    const before = ctx.query.before ? parseInt(ctx.query.before, 10) : undefined;

    const messages = daemon.db
      .listProjectChatEnvelopes({
        projectId: project.id,
        limit,
        ...(typeof before === "number" && Number.isFinite(before) ? { createdBefore: before } : {}),
      })
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((env) => ({
        id: env.id,
        from: env.from,
        to: env.to,
        fromBoss: env.fromBoss,
        text: env.content.text ?? "",
        status: env.status,
        createdAt: env.createdAt,
      }));

    sendJson(ctx.res, 200, {
      project: {
        id: project.id,
        name: project.name,
        root: project.root,
        speakerAgent: project.speakerAgent,
        availableLeaders: daemon.db
          .listProjectLeaders(project.id, { activeOnly: true })
          .map((leader) => leader.agentName),
      },
      messages,
    });
  };

  const createProjectTask: RouteHandler = async (ctx) => {
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

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const priorityRaw = typeof body.priority === "string" ? body.priority.trim().toLowerCase() : undefined;
    const autoDispatch = body.autoDispatch !== false;
    if (!title) {
      sendJson(ctx.res, 400, { error: "title is required" });
      return;
    }
    if (priorityRaw && !isProjectTaskPriority(priorityRaw)) {
      sendJson(ctx.res, 400, { error: "priority must be low|normal|high|critical" });
      return;
    }

    try {
      let task = daemon.db.createProjectTask({
        projectId: project.id,
        title,
        priority: priorityRaw,
        actor: WEB_BOSS_ADDRESS,
        reason: "boss-created",
      });

      let envelopeId: string | undefined;
      if (autoDispatch) {
        const contentText =
          text ||
          [
            `Task: ${task.title}`,
            `task-id: ${task.id}`,
            "state: created",
            "Please plan and coordinate this task in project context.",
          ].join("\n");
        const envelope = await daemon.router.routeEnvelope({
          from: WEB_BOSS_ADDRESS,
          to: formatAgentAddress(project.speakerAgent),
          fromBoss: true,
          content: { text: contentText },
          metadata: {
            source: "web",
            projectId: project.id,
            taskId: task.id,
          },
        });
        daemon.scheduler.onEnvelopeCreated(envelope);
        envelopeId = envelope.id;
        task = daemon.db.updateProjectTaskState({
          taskId: task.id,
          state: "planning",
          actor: project.speakerAgent,
          reason: "auto-dispatch-to-speaker",
        });
      }

      sendJson(ctx.res, 201, {
        task,
        ...(envelopeId ? { envelopeId } : {}),
      });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  const listProjectTasks: RouteHandler = async (ctx) => {
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

    const limit = parseLimit(ctx.query.limit, 50, 200);
    const stateRaw = typeof ctx.query.state === "string" ? ctx.query.state.trim().toLowerCase() : undefined;
    if (stateRaw && !isProjectTaskState(stateRaw)) {
      sendJson(ctx.res, 400, { error: "state is invalid" });
      return;
    }
    const state = stateRaw && isProjectTaskState(stateRaw) ? stateRaw : undefined;

    const tasks = daemon.db.listProjectTasks({
      projectId: project.id,
      limit,
      ...(state ? { state } : {}),
    });
    sendJson(ctx.res, 200, { tasks });
  };

  const getProjectTask: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const taskId = normalizeTaskId(ctx.params.taskId);
    if (!id || !taskId) {
      sendJson(ctx.res, 400, { error: "Project ID and task ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const task = daemon.db.getProjectTaskById(taskId);
    if (!task || task.projectId !== project.id) {
      sendJson(ctx.res, 404, { error: "Task not found" });
      return;
    }

    const progress = daemon.db.listTaskProgress({ taskId: task.id, limit: 200 }).sort((a, b) => a.createdAt - b.createdAt);
    const envelopes = daemon.db
      .listTaskEnvelopes({ taskId: task.id, limit: 200 })
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((env) => ({
        id: env.id,
        from: env.from,
        to: env.to,
        text: env.content.text ?? "",
        status: env.status,
        createdAt: env.createdAt,
      }));

    sendJson(ctx.res, 200, { task, progress, envelopes });
  };

  const updateProjectTaskState: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const taskId = normalizeTaskId(ctx.params.taskId);
    if (!id || !taskId) {
      sendJson(ctx.res, 400, { error: "Project ID and task ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const task = daemon.db.getProjectTaskById(taskId);
    if (!task || task.projectId !== project.id) {
      sendJson(ctx.res, 404, { error: "Task not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const stateRaw = typeof body.state === "string" ? body.state.trim().toLowerCase() : "";
    if (!isProjectTaskState(stateRaw)) {
      sendJson(ctx.res, 400, { error: "state is required and invalid" });
      return;
    }
    const assignee = typeof body.assignee === "string" ? body.assignee.trim() : undefined;
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;
    const output =
      typeof body.output === "string"
        ? body.output.trim()
        : body.output === null
          ? null
          : undefined;

    if (stateRaw === "dispatched" && !assignee) {
      sendJson(ctx.res, 400, { error: "assignee is required for dispatched state" });
      return;
    }

    if (assignee) {
      const assigneeAgent = daemon.db.getAgentByNameCaseInsensitive(assignee);
      if (!assigneeAgent) {
        sendJson(ctx.res, 400, { error: `Assignee '${assignee}' not found` });
        return;
      }
      if (stateRaw === "dispatched") {
        const leader = daemon.db
          .listProjectLeaders(project.id, { activeOnly: true })
          .find((item) => item.agentName === assigneeAgent.name);
        if (!leader) {
          sendJson(ctx.res, 400, { error: `Assignee '${assigneeAgent.name}' is not an active project leader` });
          return;
        }
      }
    }

    try {
      const nextTask = daemon.db.updateProjectTaskState({
        taskId: task.id,
        state: stateRaw,
        actor: WEB_BOSS_ADDRESS,
        ...(reason ? { reason } : {}),
        ...(Object.hasOwn(body, "assignee") ? { assignee: assignee ?? null } : {}),
        ...(Object.hasOwn(body, "output") ? { output } : {}),
      });

      let envelopeId: string | undefined;
      let completionEnvelopeId: string | undefined;
      if (stateRaw === "dispatched" && assignee) {
        const dispatchText =
          typeof body.dispatchText === "string" && body.dispatchText.trim()
            ? body.dispatchText.trim()
            : [
                `Task: ${nextTask.title}`,
                `task-id: ${nextTask.id}`,
                `state: ${nextTask.state}`,
                "Please execute this task and report progress to the speaker.",
              ].join("\n");
        const envelope = await daemon.router.routeEnvelope({
          from: formatAgentAddress(project.speakerAgent),
          to: formatAgentAddress(assignee),
          content: { text: dispatchText },
          metadata: {
            source: "web",
            projectId: project.id,
            taskId: nextTask.id,
          },
        });
        daemon.scheduler.onEnvelopeCreated(envelope);
        envelopeId = envelope.id;
      }

      if (stateRaw === "completed") {
        const completionText =
          typeof body.completionText === "string" && body.completionText.trim()
            ? body.completionText.trim()
            : [
                `Task completed: ${nextTask.id}`,
                `title: ${nextTask.title}`,
                ...(nextTask.output ? [`output: ${nextTask.output}`] : []),
                "speaker-summary: task marked completed from project task board.",
              ].join("\n");

        try {
          const completionEnvelope = await daemon.router.routeEnvelope({
            from: formatAgentAddress(project.speakerAgent),
            to: WEB_BOSS_ADDRESS,
            content: { text: completionText },
            metadata: {
              source: "web",
              projectId: project.id,
              taskId: nextTask.id,
              type: "task-completed",
            },
          });
          daemon.scheduler.onEnvelopeCreated(completionEnvelope);
          completionEnvelopeId = completionEnvelope.id;
        } catch {
        }
      }

      sendJson(ctx.res, 200, {
        task: nextTask,
        ...(envelopeId ? { envelopeId } : {}),
        ...(completionEnvelopeId ? { completionEnvelopeId } : {}),
      });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  const cancelProjectTask: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const taskId = normalizeTaskId(ctx.params.taskId);
    if (!id || !taskId) {
      sendJson(ctx.res, 400, { error: "Project ID and task ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }

    const task = daemon.db.getProjectTaskById(taskId);
    if (!task || task.projectId !== project.id) {
      sendJson(ctx.res, 404, { error: "Task not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : undefined;
    const force = body?.force === true || ctx.query.force === "true";

    if (task.state === "completed") {
      sendJson(ctx.res, 400, { error: "Completed task cannot be cancelled" });
      return;
    }

    try {
      const cancelledTask =
        task.state === "cancelled"
          ? task
          : daemon.db.updateProjectTaskState({
              taskId: task.id,
              state: "cancelled",
              actor: WEB_BOSS_ADDRESS,
              reason: reason || (force ? "boss-force-cancel" : "boss-cancel"),
              allowRollback: true,
            });

      let cancelledRun = false;
      let clearedPendingCount = 0;
      if (force && task.assignee) {
        cancelledRun = daemon.executor.abortCurrentRun(task.assignee, "web:task.cancel");
        clearedPendingCount = daemon.db.markDuePendingNonCronEnvelopesDoneForAgent(task.assignee);
        if (cancelledRun || clearedPendingCount > 0) {
          daemon.db.appendProjectTaskFlowEntry({
            taskId: cancelledTask.id,
            actor: WEB_BOSS_ADDRESS,
            reason: `force-stop:${task.assignee}`,
          });
        }
      }

      sendJson(ctx.res, 200, {
        task: daemon.db.getProjectTaskById(cancelledTask.id) ?? cancelledTask,
        cancelledRun,
        clearedPendingCount,
      });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  const appendTaskProgress: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    const taskId = normalizeTaskId(ctx.params.taskId);
    if (!id || !taskId) {
      sendJson(ctx.res, 400, { error: "Project ID and task ID required" });
      return;
    }

    const project = daemon.db.getProjectById(id);
    if (!project) {
      sendJson(ctx.res, 404, { error: "Project not found" });
      return;
    }
    const task = daemon.db.getProjectTaskById(taskId);
    if (!task || task.projectId !== project.id) {
      sendJson(ctx.res, 404, { error: "Task not found" });
      return;
    }

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!agentName || !content) {
      sendJson(ctx.res, 400, { error: "agentName and content are required" });
      return;
    }

    const todos = Array.isArray(body.todos)
      ? (body.todos as unknown[]).filter((item): item is string => typeof item === "string")
      : undefined;

    try {
      const progress = daemon.db.createTaskProgress({
        taskId: task.id,
        agentName,
        content,
        ...(todos ? { todos } : {}),
      });
      sendJson(ctx.res, 201, { progress });
    } catch (err) {
      sendJson(ctx.res, 400, { error: (err as Error).message });
    }
  };

  return {
    createProject,
    listProjects,
    getProject,
    updateProject,
    upsertLeader,
    updateLeader,
    selectLeader,
    sendProjectChatMessage,
    listProjectChatMessages,
    createProjectTask,
    listProjectTasks,
    getProjectTask,
    updateProjectTaskState,
    cancelProjectTask,
    appendTaskProgress,
  };
}
