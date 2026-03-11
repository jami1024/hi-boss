/**
 * Conversation API handlers for the web UI.
 *
 * Provides CRUD operations for conversations and message exchange
 * between the boss and agents via the web UI.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { formatAgentAddress } from "../../adapters/types.js";
import { validateDirectChatTarget } from "../direct-chat-policy.js";
import { WEB_BOSS_ADDRESS } from "./envelopes.js";

export function createConversationHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  /**
   * POST /api/v1/conversations
   *
   * Create a new conversation with an agent.
   * Body: { agentName: string, projectId?: string, title?: string }
   */
  const createConversation: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const body = ctx.body as { agentName?: string; projectId?: string; title?: string } | undefined;
    if (!body || !body.agentName?.trim()) {
      sendJson(ctx.res, 400, { error: "agentName is required" });
      return;
    }

    const agent = daemon.db.getAgentByNameCaseInsensitive(body.agentName.trim());
    if (!agent) {
      sendJson(ctx.res, 404, { error: "Agent not found" });
      return;
    }

    if (body.projectId) {
      const project = daemon.db.getProjectById(body.projectId);
      if (!project) {
        sendJson(ctx.res, 404, { error: "Project not found" });
        return;
      }
    } else {
      const validationError = validateDirectChatTarget(daemon.db, agent);
      if (validationError) {
        sendJson(ctx.res, 400, { error: validationError });
        return;
      }
    }

    const conversation = daemon.db.createConversation({
      agentName: agent.name,
      projectId: body.projectId,
      title: body.title,
    });

    sendJson(ctx.res, 200, conversation);
  };

  /**
   * GET /api/v1/conversations?agentName=x&projectId=y&limit=50
   *
   * List conversations, optionally filtered by agent name or project.
   */
  const listConversations: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.query.agentName || undefined;
    const projectId = ctx.query.projectId || undefined;
    const limit = Math.min(parseInt(ctx.query.limit ?? "50", 10) || 50, 100);

    const conversations = daemon.db.listConversations({ agentName, projectId, limit });

    sendJson(ctx.res, 200, { conversations });
  };

  /**
   * GET /api/v1/conversations/:id
   *
   * Get a single conversation by ID.
   */
  const getConversation: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Conversation ID required" });
      return;
    }

    const conversation = daemon.db.getConversationById(id);
    if (!conversation) {
      sendJson(ctx.res, 404, { error: "Conversation not found" });
      return;
    }

    sendJson(ctx.res, 200, { conversation });
  };

  /**
   * GET /api/v1/conversations/:id/messages?limit=50&before=<ms>
   *
   * List messages in a conversation, ordered by created_at.
   */
  const listMessages: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Conversation ID required" });
      return;
    }

    const conversation = daemon.db.getConversationById(id);
    if (!conversation) {
      sendJson(ctx.res, 404, { error: "Conversation not found" });
      return;
    }

    const limit = Math.min(parseInt(ctx.query.limit ?? "50", 10) || 50, 100);
    const before = ctx.query.before ? parseInt(ctx.query.before, 10) : undefined;

    const envelopes = daemon.db.listConversationEnvelopes({
      conversationId: id,
      limit,
      ...(before ? { createdBefore: before } : {}),
    });

    const messages = envelopes.map((env) => {
      const md = env.metadata as Record<string, unknown> | undefined;
      return {
        id: env.id,
        from: env.from,
        to: env.to,
        fromBoss: env.fromBoss,
        text: env.content.text ?? "",
        status: env.status,
        createdAt: env.createdAt,
        ...(md?.permissionEscalatable === true ? { permissionEscalatable: true } : {}),
        ...(typeof md?.replyToEnvelopeId === "string" ? { replyToEnvelopeId: md.replyToEnvelopeId } : {}),
      };
    });

    sendJson(ctx.res, 200, { messages });
  };

  /**
   * POST /api/v1/conversations/:id/send
   *
   * Send a message in a conversation from the boss (web UI) to the agent.
   */
  const sendMessage: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Conversation ID required" });
      return;
    }

    const conversation = daemon.db.getConversationById(id);
    if (!conversation) {
      sendJson(ctx.res, 404, { error: "Conversation not found" });
      return;
    }

    const body = ctx.body as { text?: string } | undefined;
    if (!body || !body.text?.trim()) {
      sendJson(ctx.res, 400, { error: "text is required" });
      return;
    }

    const text = body.text.trim();

    const envelope = await daemon.router.routeEnvelope({
      from: WEB_BOSS_ADDRESS,
      to: formatAgentAddress(conversation.agentName),
      fromBoss: true,
      content: { text },
      metadata: {
        source: "web",
        conversationId: conversation.id,
        ...(conversation.projectId ? { projectId: conversation.projectId } : {}),
      },
    });

    daemon.scheduler.onEnvelopeCreated(envelope);

    // Auto-set title if the conversation has no title yet
    if (!conversation.title) {
      daemon.db.updateConversationTitle(
        id,
        text.slice(0, 50) + (text.length > 50 ? "..." : ""),
      );
    }

    daemon.db.updateConversationActivity(id);

    sendJson(ctx.res, 200, { id: envelope.id });
  };

  /**
   * PUT /api/v1/conversations/:id
   *
   * Update a conversation (e.g. rename title).
   * Body: { title: string }
   */
  const updateConversation: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Conversation ID required" });
      return;
    }

    const conversation = daemon.db.getConversationById(id);
    if (!conversation) {
      sendJson(ctx.res, 404, { error: "Conversation not found" });
      return;
    }

    const body = ctx.body as { title?: string } | undefined;
    if (!body || typeof body.title !== "string") {
      sendJson(ctx.res, 400, { error: "title is required" });
      return;
    }

    daemon.db.updateConversationTitle(id, body.title);

    const updated = daemon.db.getConversationById(id);
    sendJson(ctx.res, 200, { conversation: updated });
  };

  /**
   * DELETE /api/v1/conversations/:id
   *
   * Delete a conversation.
   */
  const deleteConversation: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Conversation ID required" });
      return;
    }

    const conversation = daemon.db.getConversationById(id);
    if (!conversation) {
      sendJson(ctx.res, 404, { error: "Conversation not found" });
      return;
    }

    daemon.db.deleteConversation(id);

    sendJson(ctx.res, 200, { ok: true });
  };

  /**
   * POST /api/v1/conversations/:id/grant-access
   *
   * Grant full-access permission override for a conversation.
   * Optionally retry by resending a message.
   * Body: { retryText?: string }
   */
  const grantAccess: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Conversation ID required" });
      return;
    }

    const conversation = daemon.db.getConversationById(id);
    if (!conversation) {
      sendJson(ctx.res, 404, { error: "Conversation not found" });
      return;
    }

    // Set permission override on the conversation.
    daemon.db.updateConversationPermissionOverride(id, "full-access");

    const body = ctx.body as { retryText?: string } | undefined;
    let retryEnvelopeId: string | undefined;

    // If retryText is provided, resend the message so the agent retries with full access.
    if (body?.retryText?.trim()) {
      const envelope = await daemon.router.routeEnvelope({
        from: WEB_BOSS_ADDRESS,
        to: formatAgentAddress(conversation.agentName),
        fromBoss: true,
        content: { text: body.retryText.trim() },
        metadata: {
          source: "web",
          conversationId: conversation.id,
          ...(conversation.projectId ? { projectId: conversation.projectId } : {}),
        },
      });
      daemon.scheduler.onEnvelopeCreated(envelope);
      daemon.db.updateConversationActivity(id);
      retryEnvelopeId = envelope.id;
    }

    const updated = daemon.db.getConversationById(id);
    sendJson(ctx.res, 200, {
      conversation: updated,
      ...(retryEnvelopeId ? { retryEnvelopeId } : {}),
    });
  };

  return {
    createConversation,
    listConversations,
    getConversation,
    listMessages,
    sendMessage,
    updateConversation,
    deleteConversation,
    grantAccess,
  };
}
