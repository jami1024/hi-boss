/**
 * Configuration and system info API handlers for the web UI.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { getDaemonIanaTimeZone } from "../../shared/timezone.js";

export function createConfigHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  /**
   * GET /api/v1/config
   *
   * Returns daemon configuration overview.
   */
  const getConfig: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const bossName = daemon.db.getBossName() ?? "";
    const bossTimezone = daemon.db.getBossTimezone();
    const daemonTimezone = getDaemonIanaTimeZone();
    const setupCompleted = daemon.db.isSetupComplete();
    const agents = daemon.db.listAgents();
    const bindings = daemon.db.listBindings();

    // Collect unique adapter types and boss IDs
    const adapterTypes = [...new Set(bindings.map((b) => b.adapterType))];
    const adapterBossIds: Record<string, string> = {};
    for (const adapterType of adapterTypes) {
      const bossId = daemon.db.getAdapterBossId(adapterType);
      if (bossId) adapterBossIds[adapterType] = bossId;
    }

    sendJson(ctx.res, 200, {
      setupCompleted,
      dataDir: daemon.config.dataDir,
      bossName,
      bossTimezone,
      daemonTimezone,
      agentCount: agents.length,
      bindingCount: bindings.length,
      adapters: adapterTypes.map((type) => ({
        type,
        bossId: adapterBossIds[type] ?? null,
        bindings: bindings
          .filter((b) => b.adapterType === type)
          .map((b) => b.agentName),
      })),
      agents: agents.map((a) => ({
        name: a.name,
        role: a.role,
        provider: a.provider,
        workspace: a.workspace,
      })),
    });
  };

  /**
   * PUT /api/v1/config
   *
   * Update boss configuration (name, timezone).
   * Body: { bossName?: string, bossTimezone?: string }
   */
  const updateConfig: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      sendJson(ctx.res, 400, { error: "Request body required" });
      return;
    }

    if (typeof body.bossName === "string") {
      const name = body.bossName.trim();
      if (name) {
        daemon.db.setBossName(name);
      }
    }

    if (typeof body.bossTimezone === "string") {
      const tz = body.bossTimezone.trim();
      if (tz) {
        daemon.db.setConfig("boss_timezone", tz);
      }
    }

    // Return updated config
    const bossName = daemon.db.getBossName() ?? "";
    const bossTimezone = daemon.db.getBossTimezone();

    sendJson(ctx.res, 200, { bossName, bossTimezone });
  };

  return { getConfig, updateConfig };
}
