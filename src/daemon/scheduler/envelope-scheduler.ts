import type { Envelope } from "../../envelope/types.js";
import type { HiBossDatabase } from "../db/database.js";
import type { MessageRouter } from "../router/message-router.js";
import type { AgentExecutor } from "../../agent/executor.js";
import { delayUntilUnixMs } from "../../shared/time.js";
import { BACKGROUND_AGENT_NAME } from "../../shared/defaults.js";
import { errorMessage, logEvent } from "../../shared/daemon-log.js";
import type { ProjectTask } from "../../shared/project-task.js";
import { formatAgentAddress } from "../../adapters/types.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647; // setTimeout max (~24.8 days)
const MAX_CHANNEL_ENVELOPES_PER_TICK = 100;
const MAX_BACKGROUND_ENVELOPES_PER_TICK = 100;
const ORPHAN_AGENT_ENVELOPES_BATCH_SIZE = 100;
const MAX_ORPHAN_AGENT_ENVELOPES_PER_TICK = 2000;
const MAX_STALLED_TASKS_PER_TICK = 100;
const WEB_BOSS_ADDRESS = "channel:web:boss";

interface StallPolicy {
  stallThresholdSec: number;
  maxRetry: number;
  autoRollback: boolean;
  notifyBoss: boolean;
}

const DEFAULT_STALL_POLICY: StallPolicy = {
  stallThresholdSec: 300,
  maxRetry: 1,
  autoRollback: false,
  notifyBoss: true,
};

function coercePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

function parseStallPolicy(raw: string | null): StallPolicy {
  if (!raw) return DEFAULT_STALL_POLICY;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      stallThresholdSec: coercePositiveInteger(parsed.stallThresholdSec, DEFAULT_STALL_POLICY.stallThresholdSec),
      maxRetry: coercePositiveInteger(parsed.maxRetry, DEFAULT_STALL_POLICY.maxRetry),
      autoRollback:
        typeof parsed.autoRollback === "boolean"
          ? parsed.autoRollback
          : DEFAULT_STALL_POLICY.autoRollback,
      notifyBoss:
        typeof parsed.notifyBoss === "boolean"
          ? parsed.notifyBoss
          : DEFAULT_STALL_POLICY.notifyBoss,
    };
  } catch {
    return DEFAULT_STALL_POLICY;
  }
}

export class EnvelopeScheduler {
  private nextWakeTimer: NodeJS.Timeout | null = null;
  private running = false;
  private tickInProgress = false;
  private tickQueued = false;

  constructor(
    private readonly db: HiBossDatabase,
    private readonly router: MessageRouter,
    private readonly executor: AgentExecutor
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick("startup");
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  onEnvelopeCreated(_envelope: Envelope): void {
    // Recalculate the next wake time; delivery itself is handled by the router
    // (immediate) or by scheduler ticks (future).
    this.scheduleNextWake();
  }

  private clearTimer(): void {
    if (this.nextWakeTimer) {
      clearTimeout(this.nextWakeTimer);
      this.nextWakeTimer = null;
    }
  }

  private tick(reason: string): Promise<void> {
    if (!this.running) return Promise.resolve();

    if (this.tickInProgress) {
      this.tickQueued = true;
      return Promise.resolve();
    }

    return this.runTick(reason);
  }

  private async runTick(reason: string): Promise<void> {
    let shouldRunQueuedTick = false;
    this.tickInProgress = true;
    this.tickQueued = false;

    try {
      // 1) Deliver due channel envelopes (scheduled delivery).
      const dueChannel = this.db.listDueChannelEnvelopes(MAX_CHANNEL_ENVELOPES_PER_TICK);
      for (const env of dueChannel) {
        try {
          await this.router.deliverEnvelope(env);
        } catch (err) {
          logEvent("error", "scheduler-channel-delivery-failed", {
            "envelope-id": env.id,
            error: errorMessage(err),
          });
        }
      }

      // 2) Trigger agents that have due envelopes.
      const agentNames = this.db.listAgentNamesWithDueEnvelopes();
      for (const agentName of agentNames) {
        if (agentName === BACKGROUND_AGENT_NAME) {
          const batch = this.db.getPendingEnvelopesForAgent(
            BACKGROUND_AGENT_NAME,
            MAX_BACKGROUND_ENVELOPES_PER_TICK + 1
          );
          const toDeliver = batch.slice(0, MAX_BACKGROUND_ENVELOPES_PER_TICK);
          for (const env of toDeliver) {
            try {
              await this.router.deliverEnvelope(env);
            } catch (err) {
              logEvent("error", "scheduler-background-delivery-failed", {
                "envelope-id": env.id,
                error: errorMessage(err),
              });
            }
          }

          if (batch.length > MAX_BACKGROUND_ENVELOPES_PER_TICK) {
            this.tickQueued = true;
          }
          continue;
        }

        const agent = this.db.getAgentByNameCaseInsensitive(agentName);
        if (!agent) {
          this.cleanupOrphanAgentEnvelopes(agentName);
          continue;
        }

        // Non-blocking: agent turns may take a long time (LLM call).
        this.executor.checkAndRun(agent, this.db, { kind: "scheduler", reason }).catch((err) => {
          logEvent("error", "scheduler-agent-run-failed", {
            "agent-name": agentName,
            error: errorMessage(err),
          });
        });
      }

      await this.handleStalledTasks();
    } finally {
      this.tickInProgress = false;

      shouldRunQueuedTick = this.tickQueued;
      this.tickQueued = false;
      if (!shouldRunQueuedTick) {
        this.scheduleNextWake();
      }
    }

    if (shouldRunQueuedTick) {
      void this.tick("queued");
    }
  }

  private resolveStallPolicy(projectId: string): StallPolicy {
    const projectRaw = this.db.getConfig(`project_stall_policy:${projectId}`);
    if (projectRaw) {
      return parseStallPolicy(projectRaw);
    }
    return parseStallPolicy(this.db.getConfig("stall_policy"));
  }

  private countStallStageRetries(task: ProjectTask): { retries: number; lastRetryAt?: number } {
    const retryEntries = task.flowLog.filter(
      (entry) => typeof entry.reason === "string" && entry.reason.startsWith("stall-stage1-retry-")
    );
    const lastRetryAt = retryEntries.length > 0 ? retryEntries[retryEntries.length - 1]?.at : undefined;
    return {
      retries: retryEntries.length,
      ...(typeof lastRetryAt === "number" ? { lastRetryAt } : {}),
    };
  }

  private hasFlowReason(task: ProjectTask, reason: string): boolean {
    return task.flowLog.some((entry) => entry.reason === reason);
  }

  private async triggerStallStage1Retry(params: {
    task: ProjectTask;
    speakerAgent: string;
    assignee: string;
    stalledForSec: number;
    retryIndex: number;
  }): Promise<void> {
    const envelope = await this.router.routeEnvelope({
      from: formatAgentAddress(params.speakerAgent),
      to: formatAgentAddress(params.assignee),
      content: {
        text: [
          `Task stalled: ${params.task.id}`,
          `title: ${params.task.title}`,
          `stalled-for-sec: ${params.stalledForSec}`,
          "Please continue execution and report progress updates.",
        ].join("\n"),
      },
      metadata: {
        source: "scheduler-stall-recovery",
        projectId: params.task.projectId,
        taskId: params.task.id,
        type: "stall-retry",
        retry: params.retryIndex,
      },
    });
    this.onEnvelopeCreated(envelope);

    this.db.appendProjectTaskFlowEntry({
      taskId: params.task.id,
      actor: "scheduler",
      reason: `stall-stage1-retry-${params.retryIndex}`,
    });
    logEvent("warn", "task-stall-stage1-retry", {
      "task-id": params.task.id,
      "project-id": params.task.projectId,
      "agent-name": params.assignee,
      retry: params.retryIndex,
      "stalled-for-sec": params.stalledForSec,
    });
  }

  private async triggerStallStage2NotifyBoss(params: {
    task: ProjectTask;
    speakerAgent: string;
    stalledForSec: number;
  }): Promise<void> {
    const envelope = await this.router.routeEnvelope({
      from: formatAgentAddress(params.speakerAgent),
      to: WEB_BOSS_ADDRESS,
      content: {
        text: [
          `Task stalled notice: ${params.task.id}`,
          `title: ${params.task.title}`,
          `state: ${params.task.state}`,
          `stalled-for-sec: ${params.stalledForSec}`,
          "Suggestion: intervene manually, cancel task, or keep waiting.",
        ].join("\n"),
      },
      metadata: {
        source: "scheduler-stall-recovery",
        projectId: params.task.projectId,
        taskId: params.task.id,
        type: "stall-notify-boss",
      },
    });
    this.onEnvelopeCreated(envelope);

    this.db.appendProjectTaskFlowEntry({
      taskId: params.task.id,
      actor: "scheduler",
      reason: "stall-stage2-notify-boss",
    });
    logEvent("warn", "task-stall-stage2-notify-boss", {
      "task-id": params.task.id,
      "project-id": params.task.projectId,
      "stalled-for-sec": params.stalledForSec,
    });
  }

  private async triggerStallStage3Rollback(params: {
    task: ProjectTask;
    speakerAgent: string;
    stalledForSec: number;
  }): Promise<void> {
    const rolledBack = this.db.updateProjectTaskState({
      taskId: params.task.id,
      state: "planning",
      actor: "scheduler",
      reason: "stall-stage3-rollback",
      assignee: null,
      allowRollback: true,
    });

    const envelope = await this.router.routeEnvelope({
      from: WEB_BOSS_ADDRESS,
      to: formatAgentAddress(params.speakerAgent),
      fromBoss: true,
      content: {
        text: [
          `Task rollback required: ${rolledBack.id}`,
          `title: ${rolledBack.title}`,
          `stalled-for-sec: ${params.stalledForSec}`,
          "Task was rolled back to planning. Please re-plan and dispatch again.",
        ].join("\n"),
      },
      metadata: {
        source: "scheduler-stall-recovery",
        projectId: rolledBack.projectId,
        taskId: rolledBack.id,
        type: "stall-rollback",
      },
    });
    this.onEnvelopeCreated(envelope);

    logEvent("warn", "task-stall-stage3-rollback", {
      "task-id": rolledBack.id,
      "project-id": rolledBack.projectId,
      "stalled-for-sec": params.stalledForSec,
    });
  }

  private async handleStalledTasks(): Promise<void> {
    const tasks = this.db.listActiveProjectTasks(MAX_STALLED_TASKS_PER_TICK);
    if (tasks.length === 0) return;

    const now = Date.now();

    for (const task of tasks) {
      const project = this.db.getProjectById(task.projectId);
      if (!project) continue;

      const policy = this.resolveStallPolicy(task.projectId);
      const thresholdMs = policy.stallThresholdSec * 1000;
      if (thresholdMs <= 0) continue;

      const lastProgressAt = this.db.getLatestTaskProgressAt(task.id);
      const lastStateTransitionAt = [...task.flowLog]
        .reverse()
        .find((entry) => entry.fromState !== entry.toState)?.at;
      const lastSignalAt =
        Math.max(lastProgressAt ?? 0, lastStateTransitionAt ?? 0, task.createdAt) || task.createdAt;
      const elapsedMs = now - lastSignalAt;
      if (elapsedMs < thresholdMs) continue;

      const assignee = task.assignee?.trim() || project.speakerAgent;
      if (!assignee) continue;

      const running = this.db.getCurrentRunningAgentRun(assignee);
      if (running) continue;

      const stalledForSec = Math.floor(elapsedMs / 1000);
      const { retries, lastRetryAt } = this.countStallStageRetries(task);
      const canRetryNow =
        retries < policy.maxRetry &&
        (typeof lastRetryAt !== "number" || now - lastRetryAt >= thresholdMs);

      if (canRetryNow) {
        try {
          await this.triggerStallStage1Retry({
            task,
            speakerAgent: project.speakerAgent,
            assignee,
            stalledForSec,
            retryIndex: retries + 1,
          });
        } catch (err) {
          logEvent("error", "task-stall-stage1-retry-failed", {
            "task-id": task.id,
            "project-id": task.projectId,
            error: errorMessage(err),
          });
        }
        continue;
      }

      const reachedStage2 = elapsedMs >= thresholdMs * 2;
      const stage2Done = this.hasFlowReason(task, "stall-stage2-notify-boss");
      if (policy.notifyBoss && reachedStage2 && !stage2Done) {
        try {
          await this.triggerStallStage2NotifyBoss({
            task,
            speakerAgent: project.speakerAgent,
            stalledForSec,
          });
        } catch (err) {
          logEvent("error", "task-stall-stage2-notify-boss-failed", {
            "task-id": task.id,
            "project-id": task.projectId,
            error: errorMessage(err),
          });
        }
        continue;
      }

      const reachedStage3 = elapsedMs >= thresholdMs * 3;
      const stage3Done = this.hasFlowReason(task, "stall-stage3-rollback");
      if (policy.autoRollback && reachedStage3 && !stage3Done) {
        try {
          await this.triggerStallStage3Rollback({
            task,
            speakerAgent: project.speakerAgent,
            stalledForSec,
          });
        } catch (err) {
          logEvent("error", "task-stall-stage3-rollback-failed", {
            "task-id": task.id,
            "project-id": task.projectId,
            error: errorMessage(err),
          });
        }
      }
    }
  }

  private cleanupOrphanAgentEnvelopes(agentName: string): void {
    const raw = agentName;
    const toAddress = `agent:${raw}`;
    let cleaned = 0;

    while (cleaned < MAX_ORPHAN_AGENT_ENVELOPES_PER_TICK) {
      const batch = this.db.listEnvelopes({
        address: toAddress,
        box: "inbox",
        status: "pending",
        limit: ORPHAN_AGENT_ENVELOPES_BATCH_SIZE,
        dueOnly: true,
      });

      if (batch.length === 0) break;

      const nowMs = Date.now();
      this.db.runInTransaction(() => {
        for (const env of batch) {
          const current =
            env.metadata && typeof env.metadata === "object"
              ? (env.metadata as Record<string, unknown>)
              : {};
          const next = {
            ...current,
            lastDeliveryError: {
              atMs: nowMs,
              kind: "agent-not-found",
              message: `Agent '${raw || "(empty)"}' not found`,
              to: toAddress,
            },
          };
          this.db.updateEnvelopeMetadata(env.id, next);
          this.db.updateEnvelopeStatus(env.id, "done");
        }
      });

      cleaned += batch.length;
      if (batch.length < ORPHAN_AGENT_ENVELOPES_BATCH_SIZE) break;
    }

    const hitPerTickCap = cleaned >= MAX_ORPHAN_AGENT_ENVELOPES_PER_TICK;
    let hasMoreDuePending = false;
    if (hitPerTickCap) {
      const next = this.db.listEnvelopes({
        address: toAddress,
        box: "inbox",
        status: "pending",
        limit: 1,
        dueOnly: true,
      });
      hasMoreDuePending = next.length > 0;
      if (hasMoreDuePending) {
        this.tickQueued = true;
      }
    }

    if (cleaned > 0) {
      logEvent("warn", "scheduler-orphan-agent-envelopes-cleaned", {
        "agent-name": raw || "(empty)",
        to: toAddress,
        cleaned,
        "more-pending": hasMoreDuePending,
      });
    }
  }

  scheduleNextWake(): void {
    if (!this.running) return;

    this.clearTimer();

    const next = this.db.getNextScheduledEnvelope();
    const deliverAt = next?.deliverAt;
    if (!deliverAt) {
      return;
    }

    const delay = delayUntilUnixMs(deliverAt);
    if (delay <= 0) {
      // "First tick after the instant" (best-effort): run on the next event loop tick.
      setImmediate(() => void this.tick("due-now"));
      return;
    }

    const clamped = Math.min(delay, MAX_TIMER_DELAY_MS);
    this.nextWakeTimer = setTimeout(() => {
      void this.tick("timer");
    }, clamped);
  }
}
