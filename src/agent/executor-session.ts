/**
 * Agent session creation for CLI-based provider invocation.
 *
 * Creates AgentSession objects that hold the configuration needed to spawn
 * CLI processes (claude / codex) for each turn.
 */

import type { Agent } from "./types.js";
import type { HiBossDatabase } from "../daemon/db/database.js";
import { generateSystemInstructions, generateSplitSystemInstructions } from "./instruction-generator.js";
import {
  DEFAULT_AGENT_PROVIDER,
  getDefaultRuntimeWorkspace,
} from "../shared/defaults.js";
import { errorMessage, logEvent } from "../shared/daemon-log.js";
import {
  getBossInfo,
  getRefreshReasonForPolicy,
  type AgentSession,
} from "./executor-support.js";
import { readPersistedAgentSession } from "./persisted-session.js";
import type { AgentRunTrigger } from "./executor-triggers.js";
import { getTriggerFields } from "./executor-triggers.js";
import { resolveSessionOpenMode } from "./session-resume.js";
import { writeAgentSkillFile } from "./skill-inject.js";

type SessionPolicy = {
  dailyResetAt?: { hour: number; minute: number; normalized: string };
  idleTimeoutMs?: number;
  maxContextLength?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCodexCumulativeUsageTotals(value: unknown): {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
} | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = value.inputTokens;
  const cachedInputTokens = value.cachedInputTokens;
  const outputTokens = value.outputTokens;
  if (typeof inputTokens !== "number" || !Number.isFinite(inputTokens)) return undefined;
  if (typeof cachedInputTokens !== "number" || !Number.isFinite(cachedInputTokens)) return undefined;
  if (typeof outputTokens !== "number" || !Number.isFinite(outputTokens)) return undefined;
  if (inputTokens < 0 || cachedInputTokens < 0 || outputTokens < 0) return undefined;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
  };
}

export async function getOrCreateAgentSession(params: {
  agent: Agent;
  db: HiBossDatabase;
  hibossDir: string;
  sessions: Map<string, AgentSession>;
  sessionKey: string;
  workspaceOverride?: string;
  additionalContext?: string;
  persistSessionHandle?: boolean;
  conversationId?: string;
  applyPendingSessionRefresh: (sessionTarget: string) => Promise<string[]>;
  refreshSession: (sessionKeyOrAgentName: string, reason?: string) => Promise<void>;
  getSessionPolicy: (agent: Agent) => SessionPolicy;
  trigger?: AgentRunTrigger;
}): Promise<AgentSession> {
  // Apply any pending refresh request at the first safe point (before a run).
  const pendingRefreshReasons = await params.applyPendingSessionRefresh(params.sessionKey);
  const triggerFields = getTriggerFields(params.trigger);

  let session = params.sessions.get(params.sessionKey);
  let policyRefreshReason: string | null = null;

  // Apply policy-based refreshes before starting a new run.
  if (session) {
    const policy = params.getSessionPolicy(params.agent);
    const reason = getRefreshReasonForPolicy(session, policy, new Date());
    if (reason) {
      policyRefreshReason = reason;
      await params.refreshSession(params.sessionKey);
      session = undefined;
    }
  }

  if (!session) {
    // Get agent token from database
    const agentRecord = params.db.getAgentByName(params.agent.name);
    if (!agentRecord) {
      throw new Error(`Agent ${params.agent.name} not found in database`);
    }

    const desiredProvider = params.agent.provider ?? DEFAULT_AGENT_PROVIDER;
    const shouldUsePersistedSessionHandle = params.persistSessionHandle ?? true;

    // Conversation-scoped runs load session from the conversations table.
    // Only use the conversation session if it belongs to THIS agent.
    const rawConversation = params.conversationId
      ? params.db.getConversationById(params.conversationId)
      : null;
    const conversationRecord =
      rawConversation && rawConversation.agentName === params.agent.name
        ? rawConversation
        : null;

    const persisted = conversationRecord
      ? null  // Skip agent-level persisted session for conversation-scoped runs.
      : shouldUsePersistedSessionHandle
        ? readPersistedAgentSession(agentRecord)
        : null;

    // If a conversation has a stored session, prefer its provider.
    const conversationProvider = conversationRecord?.sessionId && conversationRecord.provider
      ? (conversationRecord.provider as "claude" | "codex")
      : null;

    // If a resumable session handle exists, prefer its provider.
    const provider =
      conversationProvider
        ?? (persisted?.handle.sessionId && (persisted.provider === "claude" || persisted.provider === "codex")
          ? persisted.provider
          : desiredProvider);
    const workspace = params.workspaceOverride ?? params.agent.workspace ?? getDefaultRuntimeWorkspace();

    // For conversation-scoped runs, load codex cumulative usage from conversation metadata.
    const codexCumulativeUsageTotals =
      provider === "codex"
        ? parseCodexCumulativeUsageTotals(
            conversationRecord?.sessionMetadata?.codexCumulativeUsage
              ?? persisted?.handle.metadata?.codexCumulativeUsage
          )
        : undefined;

    try {
      const bindings = params.db.getBindingsByAgentName(params.agent.name);
      const boss = getBossInfo(params.db, bindings);

      let sessionId: string | undefined;
      let createdAtMs: number;
      let lastRunCompletedAtMs: number | undefined;
      let openMode: "open" | "resume";
      let openReason: string;

      if (conversationRecord?.sessionId) {
        // Resume from conversation-stored session.
        sessionId = conversationRecord.sessionId;
        createdAtMs = conversationRecord.createdAt;
        lastRunCompletedAtMs = conversationRecord.updatedAt;
        openMode = "resume";
        openReason = "conversation-resume";
      } else if (conversationRecord) {
        // New conversation, no session yet.
        sessionId = undefined;
        createdAtMs = Date.now();
        lastRunCompletedAtMs = undefined;
        openMode = "open";
        openReason = "conversation-open";
      } else if (shouldUsePersistedSessionHandle) {
        const resolved = resolveSessionOpenMode({
          agent: params.agent,
          agentRecord,
          provider,
          db: params.db,
          policy: params.getSessionPolicy(params.agent),
        });
        sessionId = resolved.sessionId;
        createdAtMs = resolved.createdAtMs;
        lastRunCompletedAtMs = resolved.lastRunCompletedAtMs;
        openMode = resolved.openMode;
        openReason = resolved.openReason;
      } else {
        sessionId = undefined;
        createdAtMs = Date.now();
        lastRunCompletedAtMs = undefined;
        openMode = "open";
        openReason = "project-scoped-open";
      }

      const instructionCtx = {
          agent: params.agent,
          agentToken: agentRecord.token,
          bindings,
          runtimeWorkspace: workspace,
          bossTimezone: params.db.getBossTimezone(),
          hibossDir: params.hibossDir,
          boss,
          additionalContext: params.additionalContext ?? "",
        };

      // For Claude: split instructions into stable (skill file) + dynamic (inline).
      // For Codex: use the full instructions inline (Codex has no CLAUDE.md loading).
      let systemInstructions: string;
      let skillInjectDir: string | undefined;

      if (provider === "claude") {
        const split = generateSplitSystemInstructions(instructionCtx);
        const { dirPath } = writeAgentSkillFile({
          hibossDir: params.hibossDir,
          agentName: params.agent.name,
          content: split.stableContent,
        });
        systemInstructions = split.dynamicContent;
        skillInjectDir = dirPath;
      } else {
        systemInstructions = generateSystemInstructions(instructionCtx);
      }

      session = {
        provider,
        agentToken: agentRecord.token,
        systemInstructions,
        workspace,
        model: params.agent.model,
        reasoningEffort: params.agent.reasoningEffort,
        sessionId,
        createdAtMs,
        ...(skillInjectDir ? { skillInjectDir } : {}),
        ...(codexCumulativeUsageTotals ? { codexCumulativeUsageTotals } : {}),
        ...(lastRunCompletedAtMs !== undefined ? { lastRunCompletedAtMs } : {}),
      };
      params.sessions.set(params.sessionKey, session);

      const refreshReasons = [...pendingRefreshReasons, ...(policyRefreshReason ? [policyRefreshReason] : [])];
      const event = openMode === "resume" ? "agent-session-load" : "agent-session-create";
      logEvent("info", event, {
        "agent-name": params.agent.name,
        provider,
        ...(provider !== desiredProvider ? { "desired-provider": desiredProvider } : {}),
        state: "success",
        ...triggerFields,
        "session-key": params.sessionKey,
        "open-mode": openMode,
        "open-reason": openReason,
        "refresh-reasons": refreshReasons.length > 0 ? refreshReasons.join(",") : undefined,
      });
    } catch (err) {
      const provider = params.agent.provider ?? DEFAULT_AGENT_PROVIDER;
      logEvent("info", "agent-session-create", {
        "agent-name": params.agent.name,
        provider,
        state: "failed",
        ...triggerFields,
        "session-key": params.sessionKey,
        error: errorMessage(err),
      });
      throw err;
    }
  }

  return session;
}
