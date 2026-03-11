/**
 * Agent executor for running agent sessions with direct CLI invocation.
 */
import type { ChildProcess } from "node:child_process";
import { formatAgentAddress, parseAddress } from "../adapters/types.js";
import type { HiBossDatabase } from "../daemon/db/database.js";
import type { CreateEnvelopeInput, Envelope } from "../envelope/types.js";
import { parseAgentRoleFromMetadata } from "../shared/agent-role.js";
import { errorMessage, logEvent } from "../shared/daemon-log.js";
import { parseSessionPolicyConfig } from "../shared/session-policy.js";
import { countDuePendingEnvelopesForAgent } from "./executor-db.js";
import { getOrCreateAgentSession } from "./executor-session.js";
import {
  queueAgentTask,
  type AgentSession,
  type OnTurnCompleteParams,
  type SessionRefreshRequest,
} from "./executor-support.js";
import type { AgentRunTrigger } from "./executor-triggers.js";
import { getTriggerFields } from "./executor-triggers.js";
import { executeCliTurn } from "./executor-turn.js";
import { getHiBossDir } from "./home-setup.js";
import { writePersistedAgentSession } from "./persisted-session.js";
import { resolveAgentRunProjectScope } from "./project-context.js";
import { resolveTurnExecutionPolicy } from "./provider-execution-policy.js";
import { buildTurnInput } from "./turn-input.js";
import type { Agent } from "./types.js";
import { appendSessionRefreshNote } from "./memory-extractor.js";

/**
 * Maximum number of pending envelopes to process in a single turn.
 */
const MAX_ENVELOPES_PER_TURN = 10;
const MAX_RUN_ERROR_NOTICE_LENGTH = 300;

function readProjectIdFromEnvelopeMetadata(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  if (!metadata) return undefined;
  const value = metadata.projectId;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readTaskIdFromEnvelopeMetadata(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  if (!metadata) return undefined;
  const value = metadata.taskId;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRunErrorForNotification(error: string): string {
  const normalized = error.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return "unknown error";
  if (normalized.length <= MAX_RUN_ERROR_NOTICE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_RUN_ERROR_NOTICE_LENGTH)}...`;
}

export interface AgentRunNotificationRouter {
  routeEnvelope(input: CreateEnvelopeInput): Promise<Envelope>;
}

export function buildRunFailureNotificationEnvelopes(params: {
  agentName: string;
  runId: string;
  triggeringEnvelopes: Envelope[];
  error: string;
  executionMode?: "full-access" | "workspace-sandbox";
}): CreateEnvelopeInput[] {
  const senderAddress = formatAgentAddress(params.agentName);
  const normalizedError = normalizeRunErrorForNotification(params.error);

  const notices: CreateEnvelopeInput[] = [];
  for (const envelope of params.triggeringEnvelopes) {
    const recipient = envelope.from;
    if (recipient.trim().length === 0 || recipient === senderAddress) continue;

    const sourceMetadata = envelope.metadata as Record<string, unknown> | undefined;
    const metadata: Record<string, unknown> = {
      source: "agent-run-failure",
      failedAgent: params.agentName,
      failedRunId: params.runId,
      replyToEnvelopeId: envelope.id,
    };
    const projectId = readProjectIdFromEnvelopeMetadata(sourceMetadata);
    if (projectId) metadata.projectId = projectId;
    const taskId = readTaskIdFromEnvelopeMetadata(sourceMetadata);
    if (taskId) metadata.taskId = taskId;

    // When the run failed in sandbox mode, mark the failure as escalatable
    // so the Web UI can offer a "grant full access & retry" button.
    if (params.executionMode === "workspace-sandbox") {
      metadata.permissionEscalatable = true;
      metadata.executionMode = params.executionMode;
    }

    notices.push({
      from: senderAddress,
      to: recipient,
      fromBoss: false,
      content: {
        text: [
          "Agent run failed while processing your message.",
          `agent: ${params.agentName}`,
          `run-id: ${params.runId}`,
          `error: ${normalizedError}`,
        ].join("\n"),
      },
      metadata,
    });
  }

  return notices;
}

export function resolveSessionRefreshTargetForAgent(params: {
  db: HiBossDatabase | null;
  agentName: string;
}): string {
  const run = params.db?.getCurrentRunningAgentRun(params.agentName);
  if (!run) return params.agentName;

  let projectId: string | undefined;
  for (const envelopeId of run.envelopeIds) {
    const envelope = params.db?.getEnvelopeById(envelopeId);
    const envelopeProjectId = readProjectIdFromEnvelopeMetadata(
      envelope?.metadata as Record<string, unknown> | undefined
    );
    if (!envelopeProjectId) continue;
    if (!projectId) {
      projectId = envelopeProjectId;
      continue;
    }
    if (projectId !== envelopeProjectId) {
      return params.agentName;
    }
  }

  return projectId ? `${params.agentName}:${projectId}` : params.agentName;
}

type InFlightAgentRun = {
  runRecordId: string;
  abortController: AbortController;
  childProcess: ChildProcess | null;
  abortReason?: string;
};

/**
 * Agent executor manages agent sessions and runs.
 */
export class AgentExecutor {
  private sessions: Map<string, AgentSession> = new Map();
  private agentLocks: Map<string, Promise<void>> = new Map();
  private inFlightRuns: Map<string, InFlightAgentRun> = new Map();
  private pendingSessionRefresh: Map<string, SessionRefreshRequest> = new Map();
  private db: HiBossDatabase | null;
  private router: AgentRunNotificationRouter | null;
  private hibossDir: string;
  private onEnvelopesDone?: (envelopeIds: string[], db: HiBossDatabase) => void | Promise<void>;
  private onTurnComplete?: (params: OnTurnCompleteParams) => void | Promise<void>;

  constructor(
    options: {
      db?: HiBossDatabase;
      router?: AgentRunNotificationRouter;
      hibossDir?: string;
      onEnvelopesDone?: (envelopeIds: string[], db: HiBossDatabase) => void | Promise<void>;
      onTurnComplete?: (params: OnTurnCompleteParams) => void | Promise<void>;
    } = {}
  ) {
    this.db = options.db ?? null;
    this.router = options.router ?? null;
    this.hibossDir = options.hibossDir ?? getHiBossDir();
    this.onEnvelopesDone = options.onEnvelopesDone;
    this.onTurnComplete = options.onTurnComplete;
  }

  private async notifyRunFailure(params: {
    agentName: string;
    runId: string;
    triggeringEnvelopes: Envelope[];
    error: string;
    executionMode?: "full-access" | "workspace-sandbox";
  }): Promise<void> {
    if (!this.router) return;

    const notices = buildRunFailureNotificationEnvelopes(params);
    for (const notice of notices) {
      try {
        await this.router.routeEnvelope(notice);
      } catch (err) {
        logEvent("warn", "agent-run-failure-notification-failed", {
          "agent-name": params.agentName,
          "agent-run-id": params.runId,
          to: notice.to,
          error: errorMessage(err),
        });
      }
    }
  }

  /**
   * True if the daemon currently has a queued or in-flight task for this agent.
   */
  isAgentBusy(agentName: string): boolean {
    return this.agentLocks.has(agentName);
  }

  /**
   * Cancel the current in-flight run for an agent (best-effort).
   */
  abortCurrentRun(agentName: string, reason: string): boolean {
    const inFlight = this.inFlightRuns.get(agentName);
    if (!inFlight) return false;

    if (!inFlight.abortReason) {
      inFlight.abortReason = reason;
    }

    inFlight.abortController.abort();

    if (inFlight.childProcess) {
      try {
        if (inFlight.childProcess.pid) {
          process.kill(-inFlight.childProcess.pid, "SIGTERM");
        } else {
          inFlight.childProcess.kill("SIGTERM");
        }
      } catch {
        try { inFlight.childProcess.kill("SIGTERM"); } catch { /* best-effort */ }
      }
    }

    return true;
  }

  /**
   * Request a session refresh for an agent.
   */
  requestSessionRefresh(
    agentName: string,
    reason: string,
    scope: "agent" | "auto-project" | "project" = "agent",
    projectId?: string
  ): void {
    const sessionTarget = scope === "auto-project"
      ? resolveSessionRefreshTargetForAgent({ db: this.db, agentName })
      : scope === "project" && projectId
      ? `${agentName}:${projectId}`
      : agentName;

    const existing = this.pendingSessionRefresh.get(sessionTarget);
    if (existing) {
      existing.reasons.push(reason);
    } else {
      this.pendingSessionRefresh.set(sessionTarget, {
        requestedAtMs: Date.now(),
        reasons: [reason],
      });
    }

    queueAgentTask({
      agentLocks: this.agentLocks,
      agentName,
      log: () => undefined,
      task: async () => {
        await this.applyPendingSessionRefresh(sessionTarget);
      },
    }).catch((err) => {
      logEvent("error", "agent-session-remove-queue-failed", {
        "agent-name": agentName,
        error: errorMessage(err),
      });
    });
  }

  private getSessionPolicy(agent: Agent) {
    return parseSessionPolicyConfig(agent.sessionPolicy, { strict: false });
  }

  private resolveSessionKeysForTarget(target: string): string[] {
    if (target.includes(":")) {
      return this.sessions.has(target) ? [target] : [];
    }

    const prefix = `${target}:`;
    return [...this.sessions.keys()].filter((sessionKey) => sessionKey === target || sessionKey.startsWith(prefix));
  }

  private resolvePendingRefreshKeysForTarget(target: string): string[] {
    if (target.includes(":")) {
      return this.pendingSessionRefresh.has(target) ? [target] : [];
    }

    const prefix = `${target}:`;
    return [...this.pendingSessionRefresh.keys()].filter((pendingTarget) =>
      pendingTarget === target || pendingTarget.startsWith(prefix)
    );
  }

  private getAndClearPendingRefreshReasons(sessionTarget: string): {
    targets: string[];
    reasons: string[];
  } {
    const agentName = sessionTarget.includes(":")
      ? sessionTarget.slice(0, sessionTarget.indexOf(":"))
      : sessionTarget;
    const targetsToCheck = sessionTarget.includes(":")
      ? [agentName, sessionTarget]
      : [sessionTarget];

    const targets: string[] = [];
    const reasons: string[] = [];
    for (const target of targetsToCheck) {
      const pending = this.pendingSessionRefresh.get(target);
      if (!pending) continue;
      this.pendingSessionRefresh.delete(target);
      targets.push(target);
      reasons.push(...pending.reasons);
    }

    return { targets, reasons };
  }

  private async applyPendingSessionRefresh(sessionTarget: string): Promise<string[]> {
    const { targets, reasons } = this.getAndClearPendingRefreshReasons(sessionTarget);
    if (reasons.length === 0) return [];

    for (const target of targets) {
      await this.refreshSession(target, reasons.join(","));
    }

    return reasons;
  }

  /**
   * Check and run agent if pending envelopes exist.
   */
  async checkAndRun(agent: Agent, db: HiBossDatabase, trigger?: AgentRunTrigger): Promise<void> {
    const agentName = agent.name;

    await queueAgentTask({
      agentLocks: this.agentLocks,
      agentName,
      log: () => undefined,
      task: async () => {
        const acknowledged = await this.runAgent(agent, db, trigger);

        // Self-reschedule if more pending work exists
        if (acknowledged > 0) {
          const pending = db.getPendingEnvelopesForAgent(agent.name, 1);
          if (pending.length > 0) {
            setImmediate(() => {
              this.checkAndRun(agent, db, { kind: "reschedule" }).catch((err) => {
                logEvent("error", "agent-check-and-run-failed", {
                  "agent-name": agent.name,
                  ...getTriggerFields({ kind: "reschedule" }),
                  error: errorMessage(err),
                });
              });
            });
          }
        }
      },
    });
  }

  /**
   * Run the agent with pending envelopes.
   */
  private async runAgent(agent: Agent, db: HiBossDatabase, trigger?: AgentRunTrigger): Promise<number> {
    // Get pending envelopes
    const envelopes = db.getPendingEnvelopesForAgent(
      agent.name,
      MAX_ENVELOPES_PER_TURN
    );

    if (envelopes.length === 0) {
      return 0;
    }

    const runProjectScope = resolveAgentRunProjectScope({
      db,
      agentName: agent.name,
      envelopes,
    });

    let runTaskId: string | undefined;
    for (const envelope of envelopes) {
      const taskId = readTaskIdFromEnvelopeMetadata(
        envelope.metadata as Record<string, unknown> | undefined
      );
      if (!taskId) continue;
      if (!runTaskId) {
        runTaskId = taskId;
        continue;
      }
      if (runTaskId !== taskId) {
        throw new Error("Conflicting task context in a single agent run");
      }
    }

    // Mark envelopes done immediately after read (at-most-once).
    const envelopeIds = envelopes.map((e) => e.id);
    db.markEnvelopesDone(envelopeIds);

    if (this.onEnvelopesDone) {
      try {
        await this.onEnvelopesDone(envelopeIds, db);
      } catch (err) {
        logEvent("error", "agent-on-envelopes-done-failed", {
          "agent-name": agent.name,
          error: errorMessage(err),
        });
      }
    }

    const pendingRemainingCount = countDuePendingEnvelopesForAgent(db, agent.name);

    if (runTaskId) {
      const role = parseAgentRoleFromMetadata(agent.metadata);
      if (role === "leader") {
        const task = db.getProjectTaskById(runTaskId);
        if (task && (task.state === "dispatched" || task.state === "executing")) {
          db.updateProjectTaskState({
            taskId: task.id,
            state: "executing",
            actor: agent.name,
            reason: "leader-run-started",
            assignee: agent.name,
          });
        }
      }
    }

    // Create run record for auditing
    const run = db.createAgentRun(agent.name, envelopeIds);
    const triggerFields = getTriggerFields(trigger);
    let runStartedAtMs: number | null = null;
    let effectivePolicy: { mode: "full-access" | "workspace-sandbox"; reason: string } = {
      mode: "workspace-sandbox",
      reason: "default-safe-mode",
    };

    const inFlight: InFlightAgentRun = {
      runRecordId: run.id,
      abortController: new AbortController(),
      childProcess: null,
    };
    this.inFlightRuns.set(agent.name, inFlight);

    try {
      if (inFlight.abortController.signal.aborted) {
        const reason = inFlight.abortReason ?? "abort-requested";
        db.cancelAgentRun(run.id, reason);
        logEvent("info", "agent-run-complete", {
          "agent-name": agent.name,
          "agent-run-id": run.id,
          state: "cancelled",
          "duration-ms": 0,
          "context-length": null,
          reason,
        });
        return envelopeIds.length;
      }

      // Get or create session
      const session = await this.getOrCreateSession(agent, db, runProjectScope, trigger);

      // Build turn input
      const turnInput = buildTurnInput({
        context: {
          datetimeMs: Date.now(),
          agentName: agent.name,
          bossTimezone: db.getBossTimezone(),
        },
        envelopes,
        hibossDir: this.hibossDir,
      });

      const executionPolicy = resolveTurnExecutionPolicy({
        permissionLevel: agent.permissionLevel,
        envelopes,
      });

      // Check conversation-level permission override (Web UI "grant full access").
      effectivePolicy = executionPolicy;
      if (effectivePolicy.mode === "workspace-sandbox" && runProjectScope.conversationId) {
        const conversation = db.getConversationById(runProjectScope.conversationId);
        if (conversation?.permissionOverride === "full-access") {
          effectivePolicy = {
            mode: "full-access",
            reason: "conversation-permission-override",
          };
        }
      }

      logEvent("info", "agent-run-start", {
        "agent-name": agent.name,
        "agent-run-id": run.id,
        "session-key": runProjectScope.sessionKey,
        "project-id": runProjectScope.projectId,
        "envelopes-read-count": envelopeIds.length,
        "pending-remaining-count": pendingRemainingCount,
        "execution-mode": effectivePolicy.mode,
        "execution-mode-reason": effectivePolicy.reason,
        ...triggerFields,
      });
      runStartedAtMs = Date.now();

      // Execute the turn via CLI
      const turn = await executeCliTurn(session, turnInput, {
        hibossDir: this.hibossDir,
        agentName: agent.name,
        executionMode: effectivePolicy.mode,
        signal: inFlight.abortController.signal,
        onChildProcess: (proc) => {
          inFlight.childProcess = proc;
        },
      });

      if (turn.status === "cancelled") {
        const reason = inFlight.abortReason ?? "run-cancelled";
        db.cancelAgentRun(run.id, reason);
        logEvent("info", "agent-run-complete", {
          "agent-name": agent.name,
          "agent-run-id": run.id,
          state: "cancelled",
          "duration-ms": runStartedAtMs ? Date.now() - runStartedAtMs : 0,
          "context-length": null,
          reason,
        });
        return envelopeIds.length;
      }

      const response = turn.finalText;
      session.lastRunCompletedAtMs = Date.now();

      // Update session ID from CLI output (for resume on next turn).
      if (turn.sessionId) {
        session.sessionId = turn.sessionId;
      }

      // Persist session handle for best-effort resume after daemon restart.
      if (session.sessionId && !runProjectScope.isProjectScoped) {
        try {
          writePersistedAgentSession(db, agent.name, {
            version: 1,
            provider: session.provider,
            handle: {
              provider: session.provider,
              sessionId: session.sessionId,
              ...(session.provider === "codex" && session.codexCumulativeUsageTotals
                ? { metadata: { codexCumulativeUsage: session.codexCumulativeUsageTotals } }
                : {}),
            },
            createdAtMs: session.createdAtMs,
            lastRunCompletedAtMs: session.lastRunCompletedAtMs,
            updatedAtMs: Date.now(),
          });
        } catch (err) {
          logEvent("warn", "agent-session-snapshot-failed", {
            "agent-name": agent.name,
            error: errorMessage(err),
          });
        }
      }

      // Persist session to conversation record for conversation-scoped runs.
      if (session.sessionId && runProjectScope.conversationId) {
        try {
          db.updateConversationSession(runProjectScope.conversationId, {
            provider: session.provider,
            sessionId: session.sessionId,
            ...(session.provider === "codex" && session.codexCumulativeUsageTotals
              ? { sessionMetadata: { codexCumulativeUsage: session.codexCumulativeUsageTotals } }
              : {}),
          });
          db.updateConversationActivity(runProjectScope.conversationId);
        } catch (err) {
          logEvent("warn", "conversation-session-persist-failed", {
            "agent-name": agent.name,
            "conversation-id": runProjectScope.conversationId,
            error: errorMessage(err),
          });
        }
      }

      // Complete the run record
      db.completeAgentRun(run.id, response, turn.usage.contextLength);

      // afterTurn hook: let memory extractor and other modules process the completed turn.
      if (this.onTurnComplete) {
        try {
          await this.onTurnComplete({
            agentName: agent.name,
            runId: run.id,
            sessionKey: runProjectScope.sessionKey,
            isProjectScoped: runProjectScope.isProjectScoped,
            envelopes,
            response,
            usage: turn.usage,
            hibossDir: this.hibossDir,
          });
        } catch (err) {
          logEvent("warn", "agent-on-turn-complete-failed", {
            "agent-name": agent.name,
            "agent-run-id": run.id,
            error: errorMessage(err),
          });
        }
      }

      logEvent("info", "agent-run-complete", {
        "agent-name": agent.name,
        "agent-run-id": run.id,
        state: "success",
        "session-key": runProjectScope.sessionKey,
        "duration-ms": runStartedAtMs ? Date.now() - runStartedAtMs : 0,
        "context-length": turn.usage.contextLength,
        "input-tokens": turn.usage.inputTokens,
        "output-tokens": turn.usage.outputTokens,
        "cache-read-tokens": turn.usage.cacheReadTokens,
        "cache-write-tokens": turn.usage.cacheWriteTokens,
        "total-tokens": turn.usage.totalTokens,
      });

      // Context-length refresh: if a run grew the context too large, reset the session for the next run.
      const policy = this.getSessionPolicy(agent);
      if (
        typeof policy.maxContextLength === "number" &&
        turn.usage.contextLength !== null &&
        turn.usage.contextLength > policy.maxContextLength
      ) {
        await this.refreshSession(
          runProjectScope.sessionKey,
          `max-context-length:${turn.usage.contextLength}>${policy.maxContextLength}`
        );
      }
      return envelopeIds.length;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      db.failAgentRun(run.id, errMsg);
      await this.notifyRunFailure({
        agentName: agent.name,
        runId: run.id,
        triggeringEnvelopes: envelopes,
        error: errMsg,
        executionMode: effectivePolicy.mode,
      });
      logEvent("info", "agent-run-complete", {
        "agent-name": agent.name,
        "agent-run-id": run.id,
        state: "failed",
        "duration-ms": runStartedAtMs ? Date.now() - runStartedAtMs : 0,
        "context-length": null,
        error: errMsg,
      });
      throw error;
    } finally {
      const existing = this.inFlightRuns.get(agent.name);
      if (existing && existing.runRecordId === run.id) {
        this.inFlightRuns.delete(agent.name);
      }
    }
  }

  /**
   * Get or create a session for an agent.
   */
  private async getOrCreateSession(
    agent: Agent,
    db: HiBossDatabase,
    runProjectScope: ReturnType<typeof resolveAgentRunProjectScope>,
    trigger?: AgentRunTrigger
  ): Promise<AgentSession> {
    return await getOrCreateAgentSession({
      agent,
      db,
      hibossDir: this.hibossDir,
      sessions: this.sessions,
      sessionKey: runProjectScope.sessionKey,
      workspaceOverride: runProjectScope.workspaceOverride,
      additionalContext: runProjectScope.additionalContext,
      persistSessionHandle: !runProjectScope.isProjectScoped,
      conversationId: runProjectScope.conversationId,
      applyPendingSessionRefresh: (name) => this.applyPendingSessionRefresh(name),
      refreshSession: (name, reason) => this.refreshSession(name, reason),
      getSessionPolicy: (a) => this.getSessionPolicy(a),
      trigger,
    });
  }

  /**
   * Refresh session for an agent (called by /new command).
   *
   * Clears the existing session so a new one will be created on next run.
   */
  async refreshSession(agentNameOrSessionKey: string, reason?: string): Promise<void> {
    const agentName = agentNameOrSessionKey.includes(":")
      ? agentNameOrSessionKey.slice(0, agentNameOrSessionKey.indexOf(":"))
      : agentNameOrSessionKey;

    // Phase 1: Record session refresh event to daily memory before clearing.
    const existingSession = this.sessions.get(agentNameOrSessionKey);
    if (existingSession) {
      try {
        appendSessionRefreshNote({
          hibossDir: this.hibossDir,
          agentName,
          reason,
          sessionCreatedAtMs: existingSession.createdAtMs,
          lastRunAtMs: existingSession.lastRunCompletedAtMs,
        });
      } catch {
        // Best-effort; do not block refresh.
      }
    }

    const pendingTargets = this.resolvePendingRefreshKeysForTarget(agentNameOrSessionKey);
    for (const target of pendingTargets) {
      this.pendingSessionRefresh.delete(target);
    }

    if (this.db && !agentNameOrSessionKey.includes(":")) {
      try {
        writePersistedAgentSession(this.db, agentName, null);
      } catch (err) {
        logEvent("warn", "agent-session-handle-clear-failed", {
          "agent-name": agentName,
          reason,
          error: errorMessage(err),
        });
      }
    }

    const removedSessionKeys = this.resolveSessionKeysForTarget(agentNameOrSessionKey);
    for (const sessionKey of removedSessionKeys) {
      this.sessions.delete(sessionKey);
    }

    logEvent("info", "agent-session-remove", {
      "agent-name": agentName,
      "session-target": agentNameOrSessionKey,
      "session-count": removedSessionKeys.length,
      reason,
      state: "success",
    });
  }

  /**
   * Close all sessions on shutdown.
   */
  async closeAll(): Promise<void> {
    // Kill any in-flight CLI processes
    for (const [, inFlight] of this.inFlightRuns) {
      if (inFlight.childProcess) {
        try {
          inFlight.childProcess.kill("SIGTERM");
        } catch {
          // best-effort
        }
      }
    }
    this.sessions.clear();
    this.agentLocks.clear();
    this.inFlightRuns.clear();
  }
}

export function createAgentExecutor(options?: {
  db?: HiBossDatabase;
  router?: AgentRunNotificationRouter;
  hibossDir?: string;
  onEnvelopesDone?: (envelopeIds: string[], db: HiBossDatabase) => void | Promise<void>;
  onTurnComplete?: (params: OnTurnCompleteParams) => void | Promise<void>;
}): AgentExecutor {
  return new AgentExecutor(options);
}
