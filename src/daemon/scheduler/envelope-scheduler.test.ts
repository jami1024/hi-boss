import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentExecutor } from "../../agent/executor.js";
import type { CreateEnvelopeInput, Envelope } from "../../envelope/types.js";
import { HiBossDatabase } from "../db/database.js";
import type { MessageRouter } from "../router/message-router.js";
import { EnvelopeScheduler } from "./envelope-scheduler.js";

interface TestableScheduler {
  runTick(reason: string): Promise<void>;
}

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-scheduler-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

async function withFakeNow(nowMs: number, run: () => Promise<void> | void): Promise<void> {
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    await run();
  } finally {
    Date.now = originalNow;
  }
}

function createTestScheduler(db: HiBossDatabase): EnvelopeScheduler {
  const router = {
    routeEnvelope: async (input: CreateEnvelopeInput): Promise<Envelope> => db.createEnvelope(input),
    deliverEnvelope: async (): Promise<void> => undefined,
  } as unknown as MessageRouter;

  const executor = {
    checkAndRun: async (): Promise<void> => undefined,
  } as unknown as AgentExecutor;

  return new EnvelopeScheduler(db, router, executor);
}

async function runTick(scheduler: EnvelopeScheduler, reason: string): Promise<void> {
  const testable = scheduler as unknown as TestableScheduler;
  await testable.runTick(reason);
}

test("scheduler performs stage1 retry and stage2 boss notification for stalled task", async () => {
  await withTempDb(async (db, tempDir) => {
    const base = 1_700_000_000_000;
    await withFakeNow(base, async () => {
      db.setConfig(
        "stall_policy",
        JSON.stringify({ stallThresholdSec: 10, maxRetry: 1, notifyBoss: true, autoRollback: false })
      );

      db.registerAgent({
        name: "nex",
        provider: "codex",
        role: "speaker",
        workspace: path.join(tempDir, "repo-a"),
      });
      db.registerAgent({
        name: "kai",
        provider: "codex",
        role: "leader",
        workspace: path.join(tempDir, "repo-a"),
      });
      db.upsertProject({
        id: "repo.a",
        name: "repo-a",
        root: path.join(tempDir, "repo-a"),
        speakerAgent: "nex",
      });
      db.upsertProjectLeader({ projectId: "repo.a", agentName: "kai", active: true });

      const task = db.createProjectTask({
        projectId: "repo.a",
        title: "Implement scheduler recovery",
        actor: "channel:web:boss",
      });
      db.updateProjectTaskState({ taskId: task.id, state: "planning", actor: "nex", reason: "plan" });
      db.updateProjectTaskState({
        taskId: task.id,
        state: "dispatched",
        actor: "nex",
        assignee: "kai",
        reason: "dispatch",
      });
      db.updateProjectTaskState({
        taskId: task.id,
        state: "executing",
        actor: "kai",
        assignee: "kai",
        reason: "start",
      });
    });

    const scheduler = createTestScheduler(db);
    const activeTask = db.listActiveProjectTasks(10)[0];
    assert.ok(activeTask);

    await withFakeNow(base + 11_000, async () => {
      await runTick(scheduler, "test-stage1");
    });

    const afterRetry = db.getProjectTaskById(activeTask.id);
    assert.ok(afterRetry?.flowLog.some((entry) => entry.reason === "stall-stage1-retry-1"));
    const retryEnvelope = db
      .listTaskEnvelopes({ taskId: activeTask.id, limit: 20 })
      .find((env) => (env.metadata as Record<string, unknown> | undefined)?.type === "stall-retry");
    assert.ok(retryEnvelope);
    assert.equal(retryEnvelope?.to, "agent:kai");

    await withFakeNow(base + 21_000, async () => {
      await runTick(scheduler, "test-stage2");
    });

    const afterNotify = db.getProjectTaskById(activeTask.id);
    assert.ok(afterNotify?.flowLog.some((entry) => entry.reason === "stall-stage2-notify-boss"));
    const notifyEnvelope = db
      .listTaskEnvelopes({ taskId: activeTask.id, limit: 20 })
      .find((env) => (env.metadata as Record<string, unknown> | undefined)?.type === "stall-notify-boss");
    assert.ok(notifyEnvelope);
    assert.equal(notifyEnvelope?.to, "channel:web:boss");
  });
});

test("scheduler performs stage3 rollback when policy enables auto rollback", async () => {
  await withTempDb(async (db, tempDir) => {
    const base = 1_700_001_000_000;
    await withFakeNow(base, async () => {
      db.setConfig(
        "stall_policy",
        JSON.stringify({ stallThresholdSec: 10, maxRetry: 1, notifyBoss: true, autoRollback: true })
      );

      db.registerAgent({
        name: "nex",
        provider: "codex",
        role: "speaker",
        workspace: path.join(tempDir, "repo-b"),
      });
      db.registerAgent({
        name: "kai",
        provider: "codex",
        role: "leader",
        workspace: path.join(tempDir, "repo-b"),
      });
      db.upsertProject({
        id: "repo.b",
        name: "repo-b",
        root: path.join(tempDir, "repo-b"),
        speakerAgent: "nex",
      });
      db.upsertProjectLeader({ projectId: "repo.b", agentName: "kai", active: true });

      const task = db.createProjectTask({
        projectId: "repo.b",
        title: "Recover stalled task",
        actor: "channel:web:boss",
      });
      db.updateProjectTaskState({ taskId: task.id, state: "planning", actor: "nex", reason: "plan" });
      db.updateProjectTaskState({
        taskId: task.id,
        state: "dispatched",
        actor: "nex",
        assignee: "kai",
        reason: "dispatch",
      });
      db.updateProjectTaskState({
        taskId: task.id,
        state: "executing",
        actor: "kai",
        assignee: "kai",
        reason: "start",
      });

      db.appendProjectTaskFlowEntry({
        taskId: task.id,
        actor: "scheduler",
        reason: "stall-stage1-retry-1",
        at: base + 11_000,
      });
      db.appendProjectTaskFlowEntry({
        taskId: task.id,
        actor: "scheduler",
        reason: "stall-stage2-notify-boss",
        at: base + 21_000,
      });
    });

    const scheduler = createTestScheduler(db);
    const activeTask = db.listActiveProjectTasks(10)[0];
    assert.ok(activeTask);

    await withFakeNow(base + 31_000, async () => {
      await runTick(scheduler, "test-stage3");
    });

    const afterRollback = db.getProjectTaskById(activeTask.id);
    assert.equal(afterRollback?.state, "planning");
    assert.equal(afterRollback?.assignee, undefined);
    assert.ok(afterRollback?.flowLog.some((entry) => entry.reason === "stall-stage3-rollback"));

    const rollbackEnvelope = db
      .listTaskEnvelopes({ taskId: activeTask.id, limit: 20 })
      .find((env) => (env.metadata as Record<string, unknown> | undefined)?.type === "stall-rollback");
    assert.ok(rollbackEnvelope);
    assert.equal(rollbackEnvelope?.to, "agent:nex");
  });
});
