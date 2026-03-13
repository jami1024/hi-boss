/**
 * Envelope / chat API handlers for the web UI.
 *
 * Provides a boss-friendly chat interface: the boss sends messages
 * to agents via the web UI using a virtual "channel:web:boss" address,
 * and can query conversation history in both directions.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { formatAgentAddress } from "../../adapters/types.js";
import type { Envelope } from "../../envelope/types.js";
import { validateDirectChatTarget } from "../direct-chat-policy.js";
import {
  hasDestructiveIntent,
  stripDestructiveConfirmationPrefix,
  DESTRUCTIVE_CONFIRMATION_TEXT,
} from "../../shared/destructive-intent.js";

/** Virtual address for boss messages sent via the web UI. */
export const WEB_BOSS_ADDRESS = "channel:web:boss";

export function createEnvelopeHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  /**
   * POST /api/v1/chat/:agentName/send
   *
   * Send a message from the boss (web UI) to an agent.
   * Creates an envelope with from=channel:web:boss, to=agent:<name>, fromBoss=true.
   */
  const sendMessage: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.agentName;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    const agent = daemon.db.getAgentByNameCaseInsensitive(agentName);
    if (!agent) {
      sendJson(ctx.res, 404, { error: "Agent not found" });
      return;
    }

    const validationError = validateDirectChatTarget(daemon.db, agent);
    if (validationError) {
      sendJson(ctx.res, 400, { error: validationError });
      return;
    }

    const body = ctx.body as { text?: string } | undefined;
    if (!body || !body.text?.trim()) {
      sendJson(ctx.res, 400, { error: "text is required" });
      return;
    }

    // Destructive-intent gate: require explicit confirmation prefix for high-risk operations.
    let effectiveText = body.text.trim();
    const confirmedText = stripDestructiveConfirmationPrefix(effectiveText);
    if (confirmedText !== undefined) {
      effectiveText = confirmedText;
    } else if (hasDestructiveIntent(effectiveText)) {
      sendJson(ctx.res, 409, {
        error: "destructive-confirmation-required",
        message: DESTRUCTIVE_CONFIRMATION_TEXT,
      });
      return;
    }

    const envelope = await daemon.router.routeEnvelope({
      from: WEB_BOSS_ADDRESS,
      to: formatAgentAddress(agent.name),
      fromBoss: true,
      content: { text: effectiveText },
      metadata: { source: "web" },
    });

    daemon.scheduler.onEnvelopeCreated(envelope);

    sendJson(ctx.res, 200, { id: envelope.id });
  };

  /**
   * GET /api/v1/chat/:agentName/messages?limit=50&before=<ms>
   *
   * List conversation between the boss (web) and a specific agent.
   * Returns envelopes in both directions, ordered by created_at desc.
   */
  const listMessages: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const agentName = ctx.params.agentName;
    if (!agentName) {
      sendJson(ctx.res, 400, { error: "Agent name required" });
      return;
    }

    const agent = daemon.db.getAgentByNameCaseInsensitive(agentName);
    if (!agent) {
      sendJson(ctx.res, 404, { error: "Agent not found" });
      return;
    }

    const validationError = validateDirectChatTarget(daemon.db, agent);
    if (validationError) {
      sendJson(ctx.res, 400, { error: validationError });
      return;
    }

    const limit = Math.min(parseInt(ctx.query.limit ?? "50", 10) || 50, 100);
    const before = ctx.query.before ? parseInt(ctx.query.before, 10) : undefined;

    const agentAddr = formatAgentAddress(agent.name);

    // Fetch both directions
    const inbound = daemon.db.listEnvelopesByRoute({
      from: WEB_BOSS_ADDRESS,
      to: agentAddr,
      status: "done",
      limit,
      ...(before ? { createdBefore: before } : {}),
    });

    const outbound = daemon.db.listEnvelopesByRoute({
      from: agentAddr,
      to: WEB_BOSS_ADDRESS,
      status: "done",
      limit,
      ...(before ? { createdBefore: before } : {}),
    });

    // Also get pending envelopes (boss → agent, not yet processed)
    const pending = daemon.db.listEnvelopesByRoute({
      from: WEB_BOSS_ADDRESS,
      to: agentAddr,
      status: "pending",
      limit,
    });

    // Merge, deduplicate, and sort by created_at desc
    const seen = new Set<string>();
    const all: Envelope[] = [];
    for (const env of [...inbound, ...outbound, ...pending]) {
      if (!seen.has(env.id)) {
        seen.add(env.id);
        all.push(env);
      }
    }
    all.sort((a, b) => a.createdAt - b.createdAt);

    // Take last N
    const messages = all.slice(-limit);

    sendJson(ctx.res, 200, {
      messages: messages.map((env) => ({
        id: env.id,
        from: env.from,
        to: env.to,
        fromBoss: env.fromBoss,
        text: env.content.text ?? "",
        status: env.status,
        createdAt: env.createdAt,
      })),
    });
  };

  return { sendMessage, listMessages };
}
