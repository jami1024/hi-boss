import type { ChannelCommand, ChannelCommandHandler, MessageContent } from "../adapters/types.js";
import type { HiBossDatabase } from "./db/database.js";
import type { AgentExecutor } from "../agent/executor.js";
import {
  DEFAULT_AGENT_PERMISSION_LEVEL,
  DEFAULT_AGENT_PROVIDER,
  getDefaultRuntimeWorkspace,
} from "../shared/defaults.js";
import { formatUnixMsAsTimeZoneOffset } from "../shared/time.js";
import { formatShortId } from "../shared/id-format.js";
import { computeAgentHealth } from "../shared/agent-health.js";

type EnrichedChannelCommand = ChannelCommand & { agentName?: string; platform?: string };

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,63}$/;
const CHANNEL_PROJECT_CONTEXT_KEY_PREFIX = "channel_project_context";

function buildChannelProjectContextKey(platform: string, chatId: string, agentName: string): string {
  return `${CHANNEL_PROJECT_CONTEXT_KEY_PREFIX}:${platform}:${chatId}:${agentName}`;
}

function normalizeProjectId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || !PROJECT_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

function buildAgentStatusText(params: { db: HiBossDatabase; executor: AgentExecutor; agentName: string }): string {
  const agent = params.db.getAgentByNameCaseInsensitive(params.agentName);
  if (!agent) {
    return "error: Agent not found";
  }

  const bossTz = params.db.getBossTimezone();
  const effectiveProvider = agent.provider ?? DEFAULT_AGENT_PROVIDER;
  const effectivePermissionLevel = agent.permissionLevel ?? DEFAULT_AGENT_PERMISSION_LEVEL;
  const effectiveWorkspace = agent.workspace ?? getDefaultRuntimeWorkspace();

  const isBusy = params.executor.isAgentBusy(agent.name);
  const pendingCount = params.db.countDuePendingEnvelopesForAgent(agent.name);
  const bindings = params.db.getBindingsByAgentName(agent.name).map((b) => b.adapterType);

  const currentRun = isBusy ? params.db.getCurrentRunningAgentRun(agent.name) : null;
  const recentRuns = params.db.getRecentFinishedAgentRuns(agent.name, 5);
  const healthResetAt = typeof agent.metadata?.healthResetAt === "number" ? agent.metadata.healthResetAt : undefined;
  const lastRun = recentRuns[0] ?? null;

  const lines: string[] = [];
  lines.push(`name: ${agent.name}`);
  lines.push(`workspace: ${effectiveWorkspace}`);
  lines.push(`provider: ${effectiveProvider}`);
  lines.push(`model: ${agent.model ?? "default"}`);
  lines.push(`reasoning-effort: ${agent.reasoningEffort ?? "default"}`);
  lines.push(`permission-level: ${effectivePermissionLevel}`);
  if (bindings.length > 0) {
    lines.push(`bindings: ${bindings.join(", ")}`);
  }

  if (agent.sessionPolicy) {
    const sp = agent.sessionPolicy;
    if (typeof sp.dailyResetAt === "string" && sp.dailyResetAt) {
      lines.push(`session-daily-reset-at: ${sp.dailyResetAt}`);
    }
    if (typeof sp.idleTimeout === "string" && sp.idleTimeout) {
      lines.push(`session-idle-timeout: ${sp.idleTimeout}`);
    }
    if (typeof sp.maxContextLength === "number") {
      lines.push(`session-max-context-length: ${sp.maxContextLength}`);
    }
  }

  const agentState = isBusy ? "running" : "idle";
  const agentHealth = computeAgentHealth(recentRuns, healthResetAt);

  lines.push(`agent-state: ${agentState}`);
  lines.push(`agent-health: ${agentHealth}`);
  lines.push(`pending-count: ${pendingCount}`);

  if (currentRun) {
    lines.push(`current-run-id: ${formatShortId(currentRun.id)}`);
    lines.push(`current-run-started-at: ${formatUnixMsAsTimeZoneOffset(currentRun.startedAt, bossTz)}`);
  }

  if (!lastRun) {
    lines.push("last-run-status: none");
    return lines.join("\n");
  }

  lines.push(`last-run-id: ${formatShortId(lastRun.id)}`);
  lines.push(
    `last-run-status: ${
      lastRun.status === "failed"
        ? "failed"
        : lastRun.status === "cancelled"
          ? "cancelled"
          : "completed"
    }`
  );
  lines.push(`last-run-started-at: ${formatUnixMsAsTimeZoneOffset(lastRun.startedAt, bossTz)}`);
  if (typeof lastRun.completedAt === "number") {
    lines.push(`last-run-completed-at: ${formatUnixMsAsTimeZoneOffset(lastRun.completedAt, bossTz)}`);
  }
  if (typeof lastRun.contextLength === "number") {
    lines.push(`last-run-context-length: ${lastRun.contextLength}`);
  }
  if ((lastRun.status === "failed" || lastRun.status === "cancelled") && lastRun.error) {
    lines.push(`last-run-error: ${lastRun.error}`);
  }

  return lines.join("\n");
}

export function createChannelCommandHandler(params: {
  db: HiBossDatabase;
  executor: AgentExecutor;
}): ChannelCommandHandler {
  return (command): MessageContent | void => {
    const c = command as EnrichedChannelCommand;
    if (typeof c.command !== "string") return;

    if (c.command === "new" && typeof c.agentName === "string" && c.agentName) {
      const contextKey =
        typeof c.platform === "string" && c.platform.trim() && c.chatId.trim()
          ? buildChannelProjectContextKey(c.platform.trim(), c.chatId.trim(), c.agentName)
          : null;

      const rawProjectId = typeof c.args === "string" ? c.args.trim() : "";
      if (!rawProjectId) {
        if (contextKey) {
          params.db.setConfig(contextKey, "");
        }
        params.executor.requestSessionRefresh(c.agentName, "telegram:/new", "auto-project");
        return { text: "Session refresh requested." };
      }

      const projectId = normalizeProjectId(rawProjectId);
      if (!projectId) {
        return {
          text: "error: Invalid project-id (expected lowercase letters/numbers with optional . _ : -)",
        };
      }

      const project = params.db.getProjectById(projectId);
      if (!project) {
        return { text: "error: Project not found" };
      }

      const isProjectMember =
        project.speakerAgent === c.agentName ||
        params.db.listProjectLeaders(project.id, { activeOnly: false }).some((leader) => leader.agentName === c.agentName);
      if (!isProjectMember) {
        return { text: `error: Agent '${c.agentName}' is not bound to project '${project.id}'` };
      }

      if (contextKey) {
        params.db.setConfig(contextKey, project.id);
      }

      params.executor.requestSessionRefresh(c.agentName, "telegram:/new", "project", project.id);
      return { text: "Session refresh requested." };
    }

    if (c.command === "status" && typeof c.agentName === "string" && c.agentName) {
      return { text: buildAgentStatusText({ db: params.db, executor: params.executor, agentName: c.agentName }) };
    }

    if (c.command === "abort" && typeof c.agentName === "string" && c.agentName) {
      const cancelledRun = params.executor.abortCurrentRun(c.agentName, "telegram:/abort");
      const clearedPendingCount = params.db.markDuePendingNonCronEnvelopesDoneForAgent(c.agentName);
      const lines = [
        "abort: ok",
        `agent-name: ${c.agentName}`,
        `cancelled-run: ${cancelledRun ? "true" : "false"}`,
        `cleared-pending-count: ${clearedPendingCount}`,
      ];
      return { text: lines.join("\n") };
    }
  };
}
