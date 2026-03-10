import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createProjectHandlers } from "./projects.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-project-task-actions-test-"));
  const dbPath = path.join(tempDir, "hiboss.db");
  const db = new HiBossDatabase(dbPath);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

function buildDaemonContext(db: HiBossDatabase): DaemonContext {
  return {
    db,
    router: {
      routeEnvelope: async (input) => db.createEnvelope(input),
    } as DaemonContext["router"],
    executor: {
      isAgentBusy: () => false,
      abortCurrentRun: (agentName: string, reason: string) => {
        const run = db.getCurrentRunningAgentRun(agentName);
        if (!run) return false;
        db.cancelAgentRun(run.id, reason);
        return true;
      },
    } as unknown as DaemonContext["executor"],
    scheduler: {
      onEnvelopeCreated: () => undefined,
    } as unknown as DaemonContext["scheduler"],
    cronScheduler: null,
    adapters: new Map(),
    config: {
      dataDir: os.tmpdir(),
      daemonDir: os.tmpdir(),
    },
    running: true,
    startTimeMs: Date.now(),
    resolvePrincipal: (token: string): Principal => {
      if (db.verifyBossToken(token)) {
        return { kind: "boss", level: "boss" };
      }
      throw Object.assign(new Error("Access denied"), { code: -32001 });
    },
    assertOperationAllowed: () => undefined,
    getPermissionPolicy: () => ({
      version: 1,
      defaultLevel: "restricted",
      levelWeights: { restricted: 0, standard: 1, privileged: 2, boss: 3 },
      operations: {},
      inheritance: {},
    }),
    createAdapterForBinding: async () => null,
    removeAdapter: async () => undefined,
    registerAgentHandler: () => undefined,
    rpcHandlers: {
      "project.select-leader": async () => ({ selected: undefined, candidates: [], requiredCapabilities: [] }),
    },
  };
}

function createMockResponse(): {
  res: RouteContext["res"];
  getStatus: () => number;
  getBody: () => unknown;
} {
  let status = 0;
  let payload = "";
  const res = {
    writeHead: (code: number) => {
      status = code;
      return res;
    },
    end: (body?: string | Buffer) => {
      payload = typeof body === "string" ? body : body ? body.toString("utf-8") : "";
      return res;
    },
  } as unknown as RouteContext["res"];

  return {
    res,
    getStatus: () => status,
    getBody: () => (payload ? JSON.parse(payload) : undefined),
  };
}

function registerProjectFixture(db: HiBossDatabase, tempDir: string): { projectId: string; speakerName: string; leaderName: string } {
  db.registerAgent({ name: "nex", provider: "codex", role: "speaker", workspace: path.join(tempDir, "repo-a") });
  db.registerAgent({ name: "kai", provider: "codex", role: "leader", workspace: path.join(tempDir, "repo-a") });
  const projectId = "repo.a";
  db.upsertProject({
    id: projectId,
    name: "repo-a",
    root: path.join(tempDir, "repo-a"),
    speakerAgent: "nex",
  });
  db.upsertProjectLeader({ projectId, agentName: "nex", active: true });
  db.upsertProjectLeader({ projectId, agentName: "kai", active: true });
  return { projectId, speakerName: "nex", leaderName: "kai" };
}

test("cancelProjectTask force-stops assignee run and clears pending queue", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { projectId, leaderName } = registerProjectFixture(db, tempDir);
    const task = db.createProjectTask({ projectId, title: "Long running task" });
    db.updateProjectTaskState({ taskId: task.id, state: "planning", actor: "nex" });
    db.updateProjectTaskState({ taskId: task.id, state: "dispatched", actor: "nex", assignee: leaderName });
    db.updateProjectTaskState({ taskId: task.id, state: "executing", actor: leaderName, assignee: leaderName });

    const pendingEnvelope = db.createEnvelope({
      from: "agent:nex",
      to: `agent:${leaderName}`,
      content: { text: "work chunk" },
      metadata: { projectId, taskId: task.id },
    });
    db.createAgentRun(leaderName, [pendingEnvelope.id]);

    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();
    await handlers.cancelProjectTask({
      req: {} as RouteContext["req"],
      res: mock.res,
      params: { id: projectId, taskId: task.id },
      query: {},
      body: { force: true, reason: "force-cancel-test" },
      token: "boss-token",
    });

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as {
      task: { state: string; flowLog: Array<{ reason?: string }> };
      cancelledRun: boolean;
      clearedPendingCount: number;
    };
    assert.equal(body.task.state, "cancelled");
    assert.equal(body.cancelledRun, true);
    assert.equal(body.clearedPendingCount, 1);
    assert.ok(body.task.flowLog.some((entry) => entry.reason === `force-stop:${leaderName}`));
  });
});

test("updateProjectTaskState completed emits completion envelope to boss channel", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { projectId, leaderName } = registerProjectFixture(db, tempDir);
    const task = db.createProjectTask({ projectId, title: "Deliver milestone" });
    db.updateProjectTaskState({ taskId: task.id, state: "planning", actor: "nex" });
    db.updateProjectTaskState({ taskId: task.id, state: "dispatched", actor: "nex", assignee: leaderName });
    db.updateProjectTaskState({ taskId: task.id, state: "executing", actor: leaderName, assignee: leaderName });

    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();
    await handlers.updateProjectTaskState({
      req: {} as RouteContext["req"],
      res: mock.res,
      params: { id: projectId, taskId: task.id },
      query: {},
      body: { state: "completed", output: "done", completionText: "Task done and verified." },
      token: "boss-token",
    });

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as { task: { state: string }; completionEnvelopeId?: string };
    assert.equal(body.task.state, "completed");
    assert.ok(body.completionEnvelopeId);

    const completionEnvelopeId = body.completionEnvelopeId;
    if (!completionEnvelopeId) {
      throw new Error("Expected completionEnvelopeId to be present");
    }
    const completionEnvelope = db.getEnvelopeById(completionEnvelopeId);
    assert.equal(completionEnvelope?.from, "agent:nex");
    assert.equal(completionEnvelope?.to, "channel:web:boss");
    assert.equal((completionEnvelope?.metadata as Record<string, unknown> | undefined)?.projectId, projectId);
    assert.equal((completionEnvelope?.metadata as Record<string, unknown> | undefined)?.taskId, task.id);
    assert.equal((completionEnvelope?.metadata as Record<string, unknown> | undefined)?.type, "task-completed");
  });
});
