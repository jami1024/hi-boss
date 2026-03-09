import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Agent } from "../../agent/types.js";
import { HiBossDatabase } from "../../daemon/db/database.js";
import type { DaemonContext, Principal } from "../../daemon/rpc/context.js";
import type { RouteContext } from "../router.js";
import { createProjectHandlers } from "./projects.js";

function withTempDb(run: (db: HiBossDatabase, tempDir: string) => Promise<void> | void): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiboss-web-project-test-"));
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
      const agent = db.findAgentByToken(token);
      if (!agent) {
        throw Object.assign(new Error("Access denied"), { code: -32001 });
      }
      return {
        kind: "agent",
        level: agent.permissionLevel ?? "standard",
        agent,
      };
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

function createRouteContext(params: {
  token: string;
  res: RouteContext["res"];
  id: string;
  agentName?: string;
  query?: Record<string, string>;
  body?: unknown;
}): RouteContext {
  return {
    req: {} as RouteContext["req"],
    res: params.res,
    params: params.agentName ? { id: params.id, agentName: params.agentName } : { id: params.id },
    query: params.query ?? {},
    body: params.body,
    token: params.token,
  };
}

function registerProjectFixture(db: HiBossDatabase, tempDir: string): { speaker: Agent; projectId: string } {
  const speaker = db.registerAgent({
    name: "nex",
    provider: "codex",
    role: "speaker",
    workspace: path.join(tempDir, "repo-a"),
  }).agent;
  const projectId = "repo.a";
  db.upsertProject({
    id: projectId,
    name: "repo-a",
    root: path.join(tempDir, "repo-a"),
    speakerAgent: speaker.name,
  });
  db.upsertProjectLeader({ projectId, agentName: "nex", active: true, capabilities: ["implementation"] });
  return { speaker, projectId };
}

test("sendProjectChatMessage forwards to speaker with intent hint", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { speaker, projectId } = registerProjectFixture(db, tempDir);
    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.sendProjectChatMessage(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: projectId,
        body: { text: "请帮我实现登录功能" },
      })
    );

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as { id: string; intentHint: string };
    assert.ok(body.id);
    assert.equal(body.intentHint, "requirement");

    const envelope = db.getEnvelopeById(body.id);
    assert.equal(envelope?.from, "channel:web:boss");
    assert.equal(envelope?.to, `agent:${speaker.name}`);
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.projectId, projectId);
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.intentHint, "requirement");

    const tasks = db.listProjectTasks({ projectId, limit: 50 });
    assert.equal(tasks.length, 0);
  });
});

test("sendProjectChatMessage keeps simple Q&A as non-task intent", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { speaker, projectId } = registerProjectFixture(db, tempDir);
    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.sendProjectChatMessage(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: projectId,
        body: { text: "这个项目是做什么的？" },
      })
    );

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as { id: string; intentHint: string; taskId?: string };
    assert.ok(body.id);
    assert.equal(body.intentHint, "qa");
    assert.equal(body.taskId, undefined);

    const envelope = db.getEnvelopeById(body.id);
    assert.equal(envelope?.to, `agent:${speaker.name}`);
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.intentHint, "qa");
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.taskId, undefined);

    const tasks = db.listProjectTasks({ projectId, limit: 50 });
    assert.equal(tasks.length, 0);
  });
});

test("listProjectChatMessages returns project-scoped inter-agent messages", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { speaker, projectId } = registerProjectFixture(db, tempDir);
    const speakerAddress = `agent:${speaker.name}`;

    db.createEnvelope({
      from: "channel:web:boss",
      to: speakerAddress,
      fromBoss: true,
      content: { text: "project inbound" },
      metadata: { source: "web", projectId },
    });
    db.createEnvelope({
      from: speakerAddress,
      to: "channel:web:boss",
      content: { text: "project outbound" },
      metadata: { projectId },
    });
    db.createEnvelope({
      from: "channel:web:boss",
      to: speakerAddress,
      fromBoss: true,
      content: { text: "other project" },
      metadata: { source: "web", projectId: "repo.other" },
    });
    db.createEnvelope({
      from: "agent:worker-agent",
      to: "agent:lead-agent",
      content: { text: "worker to lead" },
      metadata: { projectId },
    });

    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.listProjectChatMessages(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: projectId,
        query: { limit: "50" },
      })
    );

    assert.equal(mock.getStatus(), 200);
    const body = mock.getBody() as {
      project: { id: string; availableLeaders: string[] };
      messages: Array<{ text: string }>;
    };

    assert.equal(body.project.id, projectId);
    assert.deepEqual(body.project.availableLeaders, ["nex"]);
    assert.deepEqual(
      body.messages.map((msg) => msg.text).sort(),
      ["project inbound", "project outbound", "worker to lead"]
    );
  });
});

test("createProject rejects non-speaker as speakerAgent", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "kai", provider: "codex", role: "leader" });
    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.createProject(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: "",
        body: {
          name: "repo-a",
          root: path.join(tempDir, "repo-a"),
          speakerAgent: "kai",
        },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Agent 'kai' must have role 'speaker'",
    });
  });
});

test("updateProject rejects selecting agent who is already a project leader as speaker", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "kai", provider: "codex", role: "speaker" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
    });
    db.upsertProjectLeader({
      projectId: "repo.a",
      agentName: "kai",
      active: true,
      capabilities: ["implementation"],
    });

    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.updateProject(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: "repo.a",
        body: {
          speakerAgent: "kai",
        },
      })
    );

    assert.equal(mock.getStatus(), 400);
    assert.deepEqual(mock.getBody(), {
      error: "Agent 'kai' is already a leader of project 'repo.a'",
    });
  });
});

test("upsertLeader rejects non-leader role and speaker conflict", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "kai", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "leo", provider: "codex", role: "leader" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
    });

    const handlers = createProjectHandlers(buildDaemonContext(db));

    const nonLeaderMock = createMockResponse();
    await handlers.upsertLeader(
      createRouteContext({
        token: "boss-token",
        res: nonLeaderMock.res,
        id: "repo.a",
        body: {
          agentName: "kai",
        },
      })
    );
    assert.equal(nonLeaderMock.getStatus(), 400);
    assert.deepEqual(nonLeaderMock.getBody(), {
      error: "Agent 'kai' must have role 'leader'",
    });

    const speakerConflictMock = createMockResponse();
    await handlers.upsertLeader(
      createRouteContext({
        token: "boss-token",
        res: speakerConflictMock.res,
        id: "repo.a",
        body: {
          agentName: "nex",
        },
      })
    );
    assert.equal(speakerConflictMock.getStatus(), 400);
    assert.deepEqual(speakerConflictMock.getBody(), {
      error: "Agent 'nex' must have role 'leader'",
    });

    const okMock = createMockResponse();
    await handlers.upsertLeader(
      createRouteContext({
        token: "boss-token",
        res: okMock.res,
        id: "repo.a",
        body: {
          agentName: "leo",
        },
      })
    );
    assert.equal(okMock.getStatus(), 200);
  });
});

test("upsertLeader accepts allowDispatchTo and updateLeader validates allowDispatchTo type", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    db.registerAgent({ name: "nex", provider: "codex", role: "speaker" });
    db.registerAgent({ name: "leo", provider: "codex", role: "leader" });
    db.upsertProject({
      id: "repo.a",
      name: "repo-a",
      root: path.join(tempDir, "repo-a"),
      speakerAgent: "nex",
    });

    const handlers = createProjectHandlers(buildDaemonContext(db));

    const upsertMock = createMockResponse();
    await handlers.upsertLeader(
      createRouteContext({
        token: "boss-token",
        res: upsertMock.res,
        id: "repo.a",
        body: {
          agentName: "leo",
          allowDispatchTo: [" NEX ", "kai", "kai"],
        },
      })
    );
    assert.equal(upsertMock.getStatus(), 200);
    const upsertBody = upsertMock.getBody() as {
      leader: { allowDispatchTo?: string[] };
    };
    assert.deepEqual(upsertBody.leader.allowDispatchTo, ["kai", "nex"]);

    const invalidUpdateMock = createMockResponse();
    await handlers.updateLeader(
      createRouteContext({
        token: "boss-token",
        res: invalidUpdateMock.res,
        id: "repo.a",
        agentName: "leo",
        body: {
          allowDispatchTo: "bad-type",
        },
        query: {},
      })
    );
    assert.equal(invalidUpdateMock.getStatus(), 400);
    assert.deepEqual(invalidUpdateMock.getBody(), {
      error: "allowDispatchTo must be string[] or null",
    });
  });
});

test("createProjectTask persists task and auto-dispatches to speaker", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { projectId, speaker } = registerProjectFixture(db, tempDir);
    const handlers = createProjectHandlers(buildDaemonContext(db));
    const mock = createMockResponse();

    await handlers.createProjectTask(
      createRouteContext({
        token: "boss-token",
        res: mock.res,
        id: projectId,
        body: {
          title: "Implement routing guard",
          text: "Please draft the implementation plan first.",
        },
      })
    );

    assert.equal(mock.getStatus(), 201);
    const body = mock.getBody() as {
      task: { id: string; state: string; projectId: string };
      envelopeId: string;
    };
    assert.equal(body.task.projectId, projectId);
    assert.equal(body.task.state, "planning");
    const envelope = db.getEnvelopeById(body.envelopeId);
    assert.equal(envelope?.to, `agent:${speaker.name}`);
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.taskId, body.task.id);
    assert.equal((envelope?.metadata as Record<string, unknown> | undefined)?.projectId, projectId);
  });
});

test("task state and progress endpoints support lifecycle updates", async () => {
  await withTempDb(async (db, tempDir) => {
    db.setBossToken("boss-token");
    const { projectId } = registerProjectFixture(db, tempDir);
    db.registerAgent({ name: "kai", provider: "codex", role: "leader", workspace: path.join(tempDir, "repo-a") });
    db.upsertProjectLeader({ projectId, agentName: "kai", active: true, capabilities: ["implementation"] });

    const handlers = createProjectHandlers(buildDaemonContext(db));

    const createMock = createMockResponse();
    await handlers.createProjectTask(
      createRouteContext({
        token: "boss-token",
        res: createMock.res,
        id: projectId,
        body: {
          title: "Build API tests",
          autoDispatch: false,
        },
      })
    );
    assert.equal(createMock.getStatus(), 201);
    const taskId = (createMock.getBody() as { task: { id: string } }).task.id;

    const planningMock = createMockResponse();
    await handlers.updateProjectTaskState({
      req: {} as RouteContext["req"],
      res: planningMock.res,
      params: { id: projectId, taskId },
      query: {},
      body: { state: "planning" },
      token: "boss-token",
    });
    assert.equal(planningMock.getStatus(), 200);

    const dispatchMock = createMockResponse();
    await handlers.updateProjectTaskState({
      req: {} as RouteContext["req"],
      res: dispatchMock.res,
      params: { id: projectId, taskId },
      query: {},
      body: { state: "dispatched", assignee: "kai" },
      token: "boss-token",
    });
    assert.equal(dispatchMock.getStatus(), 200);

    const progressMock = createMockResponse();
    await handlers.appendTaskProgress({
      req: {} as RouteContext["req"],
      res: progressMock.res,
      params: { id: projectId, taskId },
      query: {},
      body: {
        agentName: "kai",
        content: "Finished api tests for project tasks",
        todos: ["add tests done", "cleanup doing"],
      },
      token: "boss-token",
    });
    assert.equal(progressMock.getStatus(), 201);

    const getMock = createMockResponse();
    await handlers.getProjectTask({
      req: {} as RouteContext["req"],
      res: getMock.res,
      params: { id: projectId, taskId },
      query: {},
      body: undefined,
      token: "boss-token",
    });
    assert.equal(getMock.getStatus(), 200);
    const taskBody = getMock.getBody() as {
      task: { state: string; assignee?: string };
      progress: Array<{ agentName: string }>;
    };
    assert.equal(taskBody.task.state, "dispatched");
    assert.equal(taskBody.task.assignee, "kai");
    assert.equal(taskBody.progress.length, 1);
    assert.equal(taskBody.progress[0]?.agentName, "kai");
  });
});
