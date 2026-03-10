/**
 * Daemon status API handler.
 */

import type { RouteHandler } from "../router.js";
import { sendJson } from "../router.js";
import { requireBossToken } from "../middleware/auth.js";
import type { DaemonContext } from "../../daemon/rpc/context.js";
import { resolveSessionRefreshTargetForAgent } from "../../agent/executor.js";

function parseProjectIdFromSessionTarget(agentName: string, sessionTarget: string): string | undefined {
  const prefix = `${agentName}:`;
  if (!sessionTarget.startsWith(prefix)) return undefined;
  const projectId = sessionTarget.slice(prefix.length).trim();
  return projectId.length > 0 ? projectId : undefined;
}

export function createStatusHandlers(daemon: DaemonContext): Record<string, RouteHandler> {
  const getStatus: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const result = await daemon.db.getConfig("boss_name");
    const bossTimezone = daemon.db.getBossTimezone();
    const agents = daemon.db.listAgents();
    const bindings = daemon.db.listBindings();

    const agentSummary = agents.map((a) => {
      const isBusy = daemon.executor.isAgentBusy(a.name);
      const pending = daemon.db.countDuePendingEnvelopesForAgent(a.name);
      const lastRun = daemon.db.getLastFinishedAgentRun(a.name);
      const currentRun = isBusy ? daemon.db.getCurrentRunningAgentRun(a.name) : null;
      const currentSessionTarget = currentRun
        ? resolveSessionRefreshTargetForAgent({ db: daemon.db, agentName: a.name })
        : undefined;
      const currentProjectId = currentSessionTarget
        ? parseProjectIdFromSessionTarget(a.name, currentSessionTarget)
        : undefined;
      return {
        name: a.name,
        role: a.metadata?.role as string | undefined,
        provider: a.provider,
        state: isBusy ? "running" : "idle",
        health: !lastRun ? "unknown" : lastRun.status === "failed" ? "error" : "ok",
        pendingCount: pending,
        ...(currentRun
          ? {
            currentRun: {
              id: currentRun.id,
              startedAt: currentRun.startedAt,
              ...(currentSessionTarget ? { sessionTarget: currentSessionTarget } : {}),
              ...(currentProjectId ? { projectId: currentProjectId } : {}),
            },
          }
          : {}),
      };
    });

    sendJson(ctx.res, 200, {
      running: daemon.running,
      startTimeMs: daemon.startTimeMs,
      uptime: daemon.startTimeMs ? Date.now() - daemon.startTimeMs : null,
      bossName: result ?? null,
      bossTimezone,
      agentCount: agents.length,
      bindingCount: bindings.length,
      agents: agentSummary,
    });
  };

  const getTime: RouteHandler = async (ctx) => {
    const token = requireBossToken(ctx, daemon);
    if (!token) return;

    const bossTimezone = daemon.db.getBossTimezone();
    sendJson(ctx.res, 200, {
      bossTimezone,
      daemonTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  };

  return { getStatus, getTime };
}
