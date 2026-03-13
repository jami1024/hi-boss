/**
 * Envelope browsing API handlers for the web UI.
 *
 * Boss-only access to browse all envelopes with filters.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";

export function createEnvelopeBrowseHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  /**
   * GET /api/v1/envelopes?status=pending|done&agent=name&limit=50&before=timestamp
   *
   * List envelopes with optional filters.
   * - status: filter by pending/done
   * - agent: filter by agent name (shows both inbox and outbox)
   * - limit: max results (default 50, max 200)
   * - before: only envelopes created before this unix ms timestamp (for pagination)
   */
  const listEnvelopes: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const limit = Math.min(
      parseInt(ctx.query.limit ?? "50", 10) || 50,
      200,
    );
    const status = ctx.query.status as "pending" | "done" | undefined;
    const agentFilter = ctx.query.agent?.trim() || undefined;
    const before = ctx.query.before ? parseInt(ctx.query.before, 10) : undefined;

    // Build query directly against DB since there's no general "list all" RPC
    const db = daemon.db;

    let sql = `SELECT * FROM envelopes WHERE 1=1`;
    const params: (string | number)[] = [];

    if (status === "pending" || status === "done") {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (agentFilter) {
      const agentAddr = `agent:${agentFilter}`;
      sql += ` AND ("from" = ? OR "to" = ?)`;
      params.push(agentAddr, agentAddr);
    }

    if (before && Number.isFinite(before)) {
      sql += ` AND created_at < ?`;
      params.push(before);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    // Use raw DB access - the db object exposes a `db` property for better-sqlite3
    const rawDb = (db as unknown as { db: { prepare: (sql: string) => { all: (...params: unknown[]) => unknown[] } } }).db;
    const stmt = rawDb.prepare(sql);
    const rows = stmt.all(...params) as Array<Record<string, unknown>>;

    const envelopes = rows.map((row) => ({
      id: row.id as string,
      from: row.from as string,
      to: row.to as string,
      fromBoss: Boolean(row.from_boss),
      status: row.status as string,
      createdAt: row.created_at as number,
      deliverAt: row.deliver_at as number | null,
      text: truncateText((row.content_text as string) ?? "", 200),
      hasAttachments: hasJsonArray(row.content_attachments as string | null),
      metadata: row.metadata ? safeParseJson(row.metadata as string) : undefined,
    }));

    // Count totals for display
    const countSql = status
      ? `SELECT COUNT(*) AS n FROM envelopes WHERE status = ?`
      : `SELECT COUNT(*) AS n FROM envelopes`;
    const countParams = status ? [status] : [];
    const countRow = rawDb.prepare(countSql).all(...countParams) as Array<{ n: number }>;
    const total = countRow[0]?.n ?? 0;

    sendJson(ctx.res, 200, { envelopes, total });
  };

  /**
   * GET /api/v1/envelopes/:id
   *
   * Get a single envelope by ID.
   */
  const getEnvelope: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const id = ctx.params.id;
    if (!id) {
      sendJson(ctx.res, 400, { error: "Envelope ID required" });
      return;
    }

    const envelope = daemon.db.getEnvelopeById(id);
    if (!envelope) {
      // Try prefix search
      const matches = daemon.db.findEnvelopesByIdPrefix(id, 1);
      if (matches.length === 0) {
        sendJson(ctx.res, 404, { error: "Envelope not found" });
        return;
      }
      sendJson(ctx.res, 200, { envelope: matches[0] });
      return;
    }

    sendJson(ctx.res, 200, { envelope });
  };

  return { listEnvelopes, getEnvelope };
}

function hasJsonArray(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
